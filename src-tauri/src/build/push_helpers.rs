//! Docker login / push / rmi 等推送共享步骤。

use crate::build::{docker_output, emit_progress};
use crate::models::HarborConfig;
use crate::utils::{silent_docker_command, CANCEL_FLAG, CURRENT_PID};
use std::collections::HashMap;
use std::io::Write;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// 进程内已成功 login 的 Harbor 会话（url|user|password），避免并行推重复 docker login。
// ponytail: 全局一份；改密码/账号后 key 变会重新 login
static HARBOR_LOGIN_SESSION: Mutex<Option<String>> = Mutex::new(None);

/// Harbor 必填项校验。
pub(crate) fn require_harbor_config(config: &HarborConfig) -> Result<(), String> {
    if config.harbor_url.is_empty()
        || config.username.is_empty()
        || config.password.is_empty()
        || config.project.is_empty()
    {
        return Err("请先配置Harbor信息".to_string());
    }
    Ok(())
}

/// 空或 `latest` 时生成 `v.YY.MM.DD.HH.MM`，否则原样返回。
pub(crate) fn resolve_final_tag(image_tag: String) -> String {
    if image_tag.is_empty() || image_tag == "latest" {
        let now = chrono::Local::now();
        now.format("v.%y.%m.%d.%H.%M").to_string()
    } else {
        image_tag
    }
}

fn harbor_session_key(harbor_url: &str, username: &str, password: &str) -> String {
    format!("{harbor_url}\0{username}\0{password}")
}

/// `docker login` Harbor（password-stdin）。
/// 返回 `true` 表示本次真正执行了 login；`false` 表示本进程已登录过同一账号，直接跳过。
pub(crate) async fn docker_login_harbor(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    let session_key = harbor_session_key(&harbor_url, &username, &password);

    let login_result: Result<bool, String> = tauri::async_runtime::spawn_blocking(move || {
        // 持锁贯穿「查会话 → login → 记会话」，并行推时只会有一个真正 login
        let mut session = HARBOR_LOGIN_SESSION
            .lock()
            .map_err(|_| "Harbor 登录锁异常".to_string())?;
        if session.as_ref() == Some(&session_key) {
            crate::diag::diag_log(
                "docker",
                &format!("跳过 docker login（会话内已登录）: {}", harbor_url),
            );
            return Ok(false);
        }

        let mut child = silent_docker_command()
            .args(["login", &harbor_url, "-u", &username, "--password-stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker login失败: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(password.as_bytes())
                .map_err(|e| e.to_string())?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("docker login失败: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker login失败:\n{}", stderr));
        }

        *session = Some(session_key);
        crate::diag::diag_log("docker", &format!("docker login 成功: {}", harbor_url));
        Ok(true)
    })
    .await
    .map_err(|e| format!("登录线程异常: {}", e))?;

    login_result
}

/// 解析 Docker 尺寸字符串：`1.024kB` / `45.23MB` / `1.2GB`
fn parse_docker_size(raw: &str) -> Option<u64> {
    let s = raw.trim().replace(' ', "");
    if s.is_empty() {
        return None;
    }
    let (num_str, mult) = if let Some(n) = s.strip_suffix("GB").or_else(|| s.strip_suffix("GiB")) {
        (n, 1024u64 * 1024 * 1024)
    } else if let Some(n) = s.strip_suffix("MB").or_else(|| s.strip_suffix("MiB")) {
        (n, 1024 * 1024)
    } else if let Some(n) = s
        .strip_suffix("kB")
        .or_else(|| s.strip_suffix("KB"))
        .or_else(|| s.strip_suffix("KiB"))
    {
        (n, 1024)
    } else if let Some(n) = s.strip_suffix('B') {
        (n, 1)
    } else {
        return None;
    };
    let n: f64 = num_str.parse().ok()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    Some((n * mult as f64).round() as u64)
}

fn format_mb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / (1024.0 * 1024.0))
}

#[derive(Default, Clone)]
struct LayerProg {
    current: u64,
    total: u64,
    done: bool,
}

fn extract_size_pair(rest: &str) -> Option<(String, String)> {
    let mut best: Option<(String, String)> = None;
    for (slash_at, _) in rest.match_indices('/') {
        let before = &rest[..slash_at];
        let after = &rest[slash_at + 1..];
        let left = before
            .rsplit(|c: char| !(c.is_ascii_alphanumeric() || c == '.'))
            .next()
            .unwrap_or("")
            .trim();
        let right_end = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.'))
            .unwrap_or(after.len());
        let right = after[..right_end].trim();
        if parse_docker_size(left).is_some() && parse_docker_size(right).is_some() {
            best = Some((left.to_string(), right.to_string()));
        }
    }
    best
}

/// 解析一行 docker push 进度（经典 CLI 输出）。
fn ingest_push_line(line: &str, layers: &mut HashMap<String, LayerProg>) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    let Some((id_raw, rest)) = line.split_once(':') else {
        return false;
    };
    let id = id_raw.trim();
    if id.is_empty() || id.contains(' ') || id.len() > 64 {
        return false;
    }
    let rest = rest.trim();
    let lower = rest.to_ascii_lowercase();
    let entry = layers.entry(id.to_string()).or_default();

    if lower.contains("already exists")
        || lower.starts_with("pushed")
        || lower.starts_with("mounted")
        || lower.contains("mounted from")
    {
        entry.done = true;
        if entry.total > 0 {
            entry.current = entry.total;
        }
        return true;
    }

    if let Some((cur_s, tot_s)) = extract_size_pair(rest) {
        if let (Some(cur), Some(tot)) = (parse_docker_size(&cur_s), parse_docker_size(&tot_s)) {
            entry.current = cur.min(tot);
            entry.total = tot.max(1);
            if entry.current >= entry.total {
                entry.done = true;
            }
            return true;
        }
    }

    lower.starts_with("pushing")
        || lower.starts_with("preparing")
        || lower.starts_with("waiting")
}

fn summarize_push_layers(layers: &HashMap<String, LayerProg>) -> (u64, u64, usize, usize, u32) {
    let mut sent = 0u64;
    let mut total = 0u64;
    let mut done = 0usize;
    let known = layers.len();
    for lp in layers.values() {
        if lp.done {
            done += 1;
        }
        if lp.total > 0 {
            sent += lp.current.min(lp.total);
            total += lp.total;
        }
    }
    let pct = if total > 0 {
        ((sent as f64 / total as f64) * 100.0).floor() as u32
    } else if known > 0 {
        ((done as f64 / known as f64) * 100.0).floor() as u32
    } else {
        0
    };
    (sent, total, done, known, pct.min(99))
}

fn emit_harbor_push_progress(
    app: &AppHandle,
    label: Option<&str>,
    base_pct: u32,
    layers: &HashMap<String, LayerProg>,
) {
    let (sent, total, done, known, layer_pct) = summarize_push_layers(layers);
    let span = 14u32;
    let bar =
        (base_pct + (layer_pct as f64 / 100.0 * span as f64).floor() as u32).min(base_pct + span);
    let msg = if total > 0 {
        format!(
            "📤 Harbor 推送 {}% ({}/{} MB) · {}/{} 层",
            layer_pct,
            format_mb(sent),
            format_mb(total),
            done,
            known.max(1)
        )
    } else if known > 0 {
        format!("📤 Harbor 推送 · 已完成 {}/{} 层（复用/准备中）", done, known)
    } else {
        "📤 Harbor 推送中…".to_string()
    };
    let text = match label {
        Some(l) if !l.is_empty() => format!("[{l}] {msg}"),
        _ => msg,
    };
    emit_progress(app, bar, &text, "push");
}

fn pipe_push_output(
    app: &AppHandle,
    label: Option<&str>,
    base_pct: u32,
    mut reader: impl std::io::Read,
    layers: &mut HashMap<String, LayerProg>,
    log_buf: &mut String,
) {
    let mut last_emit = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or_else(Instant::now);
    let mut last_bucket: u32 = 999;
    let mut buf = [0u8; 4096];
    let mut acc: Vec<u8> = Vec::new();

    let handle_line = |line: &str,
                           layers: &mut HashMap<String, LayerProg>,
                           log_buf: &mut String,
                           last_emit: &mut Instant,
                           last_bucket: &mut u32| {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return;
        }
        if !line.trim().is_empty() && log_buf.len() < 32_000 {
            log_buf.push_str(line);
            log_buf.push('\n');
        }
        if !ingest_push_line(line, layers) {
            return;
        }
        let (_, _, _, _, layer_pct) = summarize_push_layers(layers);
        let bucket = layer_pct / 2;
        let due = last_emit.elapsed() >= Duration::from_millis(250) || bucket != *last_bucket;
        if due {
            emit_harbor_push_progress(app, label, base_pct, layers);
            *last_emit = Instant::now();
            *last_bucket = bucket;
        }
    };

    loop {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            break;
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        for &b in &buf[..n] {
            if b == b'\n' || b == b'\r' {
                if !acc.is_empty() {
                    let line = String::from_utf8_lossy(&acc).into_owned();
                    acc.clear();
                    handle_line(
                        &line,
                        layers,
                        log_buf,
                        &mut last_emit,
                        &mut last_bucket,
                    );
                }
            } else {
                acc.push(b);
            }
        }
    }
    if !acc.is_empty() {
        let line = String::from_utf8_lossy(&acc).into_owned();
        handle_line(
            &line,
            layers,
            log_buf,
            &mut last_emit,
            &mut last_bucket,
        );
    }
}

/// `docker push`：流式解析层进度并 emit（类似 FTP 的 % / MB）；可被 cancel_build 打断。
pub(crate) async fn docker_push_image(
    app: AppHandle,
    full_image: String,
    progress_label: Option<String>,
    base_pct: u32,
) -> Result<(), String> {
    crate::diag::diag_log("docker", &format!("docker push 开始: {}", full_image));
    let started = Instant::now();
    let full_image_push = full_image.clone();
    let label = progress_label;
    let push_result = tauri::async_runtime::spawn_blocking(move || {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("构建已取消".to_string());
        }
        let start_msg = match &label {
            Some(l) if !l.is_empty() => format!("[{l}] 📤 Harbor 推送开始…"),
            _ => "📤 Harbor 推送开始…".to_string(),
        };
        emit_progress(&app, base_pct, &start_msg, "push");

        let mut child = silent_docker_command()
            .args(["push", &full_image_push])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker push失败: {}", e))?;
        *CURRENT_PID.lock().unwrap() = Some(child.id());

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut layers: HashMap<String, LayerProg> = HashMap::new();
        let mut log_buf = String::new();

        let app_err = app.clone();
        let label_err = label.clone();
        let err_handle = stderr.map(|err| {
            std::thread::spawn(move || {
                let mut layers_err: HashMap<String, LayerProg> = HashMap::new();
                let mut log_err = String::new();
                pipe_push_output(
                    &app_err,
                    label_err.as_deref(),
                    base_pct,
                    err,
                    &mut layers_err,
                    &mut log_err,
                );
                (layers_err, log_err)
            })
        });

        if let Some(out) = stdout {
            pipe_push_output(
                &app,
                label.as_deref(),
                base_pct,
                out,
                &mut layers,
                &mut log_buf,
            );
        }

        if let Some(h) = err_handle {
            if let Ok((err_layers, err_log)) = h.join() {
                for (k, v) in err_layers {
                    let e = layers.entry(k).or_default();
                    if v.total > e.total {
                        e.total = v.total;
                    }
                    if v.current > e.current {
                        e.current = v.current;
                    }
                    e.done = e.done || v.done;
                }
                if log_buf.len() < 32_000 {
                    log_buf.push_str(&err_log);
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("docker push失败: {}", e))?;
        *CURRENT_PID.lock().unwrap() = None;

        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("构建已取消".to_string());
        }
        emit_harbor_push_progress(&app, label.as_deref(), base_pct, &layers);
        if !status.success() {
            return Err(if log_buf.trim().is_empty() {
                "docker push失败".to_string()
            } else {
                format!("docker push失败:\n{}", log_buf.trim())
            });
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("推送线程异常: {}", e))?;

    push_result?;
    let secs = started.elapsed().as_secs();
    crate::diag::diag_log(
        "docker",
        &format!("docker push 完成 ({secs}s): {}", full_image),
    );
    Ok(())
}

/// 尽力删除本地镜像/标签；失败只记日志，不抛错。
pub(crate) async fn docker_rmi_best_effort(full_image: String, success_log: &str, skip_log: &str) {
    let full_image_remove = full_image.clone();
    let remove_result =
        tauri::async_runtime::spawn_blocking(move || docker_output(&["rmi", &full_image_remove]))
            .await;

    match remove_result {
        Ok(Ok(output)) if output.status.success() => {
            crate::diag::diag_log("docker", &format!("{}: {}", success_log, full_image));
        }
        _ => {
            crate::diag::diag_log("docker", &format!("{}: {}", skip_log, full_image));
        }
    }
}

#[cfg(test)]
mod push_progress_tests {
    use super::*;

    #[test]
    fn parses_size_units() {
        assert_eq!(parse_docker_size("12.3MB"), Some((12.3 * 1024.0 * 1024.0) as u64));
        assert!(parse_docker_size("1.024kB").is_some());
    }

    #[test]
    fn ingests_pushing_and_exists() {
        let mut layers = HashMap::new();
        assert!(ingest_push_line(
            "abc123: Pushing [====>    ] 12.3MB/45.2MB",
            &mut layers
        ));
        assert_eq!(layers["abc123"].total, parse_docker_size("45.2MB").unwrap());
        assert!(ingest_push_line("def456: Layer already exists", &mut layers));
        assert!(layers["def456"].done);
        let (_sent, total, done, known, pct) = summarize_push_layers(&layers);
        assert_eq!(done, 1);
        assert_eq!(known, 2);
        assert!(total > 0);
        assert!(pct > 0);
    }
}
