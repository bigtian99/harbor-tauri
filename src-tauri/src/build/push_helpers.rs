//! Docker login / push / rmi 等推送共享步骤。

use crate::build::{docker_output, emit_progress};
use crate::models::HarborEnv;
use crate::utils::{silent_docker_command, CANCEL_FLAG, TrackedPid};
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

/// 选中的 Harbor 环境必填项校验（错误提示由 `HarborEnv::validate` 给出，含环境名）。
pub(crate) fn require_harbor_env(env: &HarborEnv) -> Result<(), String> {
    env.validate()
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

fn harbor_login_host(raw: &str) -> String {
    let s = raw.trim().trim_end_matches('/');
    s.strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(s)
        .trim_end_matches('/')
        .to_string()
}

fn docker_login_harbor_sync(
    harbor_url: String,
    username: String,
    password: String,
    skip_if_session: bool,
) -> Result<bool, String> {
    let host = harbor_login_host(&harbor_url);
    let session_key = harbor_session_key(&host, &username, &password);
    let mut session = HARBOR_LOGIN_SESSION
        .lock()
        .map_err(|_| "Harbor 登录锁异常".to_string())?;
    if skip_if_session && session.as_ref() == Some(&session_key) {
        crate::diag::diag_log(
            "docker",
            &format!("跳过 docker login（会话内已登录）: {host}"),
        );
        return Ok(false);
    }

    let mut child = silent_docker_command()
        .args(["login", &host, "-u", &username, "--password-stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 docker login 失败: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(password.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("docker login 失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker login 失败:\n{stderr}"));
    }

    *session = Some(session_key);
    crate::diag::diag_log("docker", &format!("docker login 成功: {host}"));
    Ok(true)
}

/// `docker login` Harbor（password-stdin）。
/// 返回 `true` 表示本次真正执行了 login；`false` 表示本进程已登录过同一账号，直接跳过。
pub(crate) async fn docker_login_harbor(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        docker_login_harbor_sync(harbor_url, username, password, true)
    })
    .await
    .map_err(|e| format!("登录线程异常: {e}"))?
}

/// 用当前表单账号强制 `docker login`，只验证能否登录。
#[tauri::command]
pub async fn test_harbor_connection(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let url = harbor_url.trim().to_string();
    let user = username.trim().to_string();
    crate::diag::diag_log(
        "docker",
        &format!(
            "test_harbor_connection host={} user={}",
            harbor_login_host(&url),
            user
        ),
    );
    if url.is_empty() || user.is_empty() || password.is_empty() {
        return Err("请填写 Harbor 地址、用户名和密码".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        docker_login_harbor_sync(url, user, password, false)?;
        Ok("登录成功".to_string())
    })
    .await
    .map_err(|e| format!("登录线程异常: {e}"))?
}

/// Harbor 项目列表请求超时（秒）
const HARBOR_API_TIMEOUT_SECS: u64 = 15;

/// 项目下拉的数据
#[derive(serde::Serialize)]
pub struct HarborProjects {
    pub names: Vec<String>,
    /// true = 该 Harbor 是自签证书，本次读取跳过了 TLS 校验（前端据此提示）
    pub insecure: bool,
}

/// Harbor 网页地址常被填成 `https://host/harbor`，而 API 与 docker 用的都是裸主机名。
fn harbor_api_host(raw: &str) -> String {
    harbor_login_host(raw)
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

/// 候选 base：用户显式写了协议就先用它，再兜底另一个协议。
fn harbor_base_candidates(raw: &str) -> Vec<String> {
    let host = harbor_api_host(raw);
    if host.is_empty() {
        return Vec::new();
    }
    if raw.trim().starts_with("http://") {
        vec![format!("http://{host}"), format!("https://{host}")]
    } else {
        vec![format!("https://{host}"), format!("http://{host}")]
    }
}

/// 复用 docker 的证书目录：按 Harbor 文档把 CA 放进 `~/.docker/certs.d/<host>/` 后，
/// 这里就能正常校验，无需降级跳过校验。
fn docker_ca_for_host(host: &str) -> Option<reqwest::Certificate> {
    let dir = dirs::home_dir()?.join(".docker").join("certs.d").join(host);
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if !(name.ends_with(".crt") || name.ends_with(".pem")) {
            continue;
        }
        if let Ok(pem) = std::fs::read(entry.path()) {
            if let Ok(cert) = reqwest::Certificate::from_pem(&pem) {
                return Some(cert);
            }
        }
    }
    None
}

/// `reqwest::Error` 的 Display 只有 "error sending request"，证书原因在 source 链里，
/// 拼出来才能既让用户看懂、又让 `is_cert_error` 判得出来。
fn harbor_err_chain(e: &reqwest::Error) -> String {
    let mut out = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        out.push_str(" <- ");
        out.push_str(&s.to_string());
        src = s.source();
    }
    out
}

/// 只有证书/TLS 类错误才允许降级重试；网络、超时错误不降级，避免无谓地关掉校验。
fn is_cert_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    // 英文证书错误关键词
    if m.contains("certificate") || m.contains("ssl") || m.contains("tls") {
        return true;
    }
    // 中文证书错误关键词（Windows 简体中文系统）
    if msg.contains("证书") || msg.contains("根证书") || msg.contains("不受信任") {
        return true;
    }
    // Windows 证书错误代码
    if msg.contains("-2146762487") || msg.contains("0x800B010F") {
        return true;
    }
    false
}

fn harbor_get_projects(
    base: &str,
    user: &str,
    password: &str,
    ca: Option<&reqwest::Certificate>,
    insecure: bool,
) -> Result<Vec<String>, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(HARBOR_API_TIMEOUT_SECS));
    if insecure {
        builder = builder.danger_accept_invalid_certs(true);
    }
    if let Some(ca) = ca {
        builder = builder.add_root_certificate(ca.clone());
    }
    let client = builder
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
    let resp = client
        .get(format!("{base}/api/v2.0/projects?page=1&page_size=100"))
        .basic_auth(user, Some(password))
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("连接 Harbor 失败: {}", harbor_err_chain(&e)))?;
    let status = resp.status().as_u16();
    // 401/403 说明地址与协议都对，只是账号不对：换协议重试没有意义
    if status == 401 || status == 403 {
        return Err("Harbor 认证失败，请检查用户名和密码".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("读取 Harbor 项目失败: HTTP {status}"));
    }
    // `/projects` 对匿名也开放：密码错了不会报错，只会静默少列私有项目。
    // 用 `/users/current` 确认这次是真的登录上了，避免给出一个「看着对但缺项目」的下拉。
    let auth = client
        .get(format!("{base}/api/v2.0/users/current"))
        .basic_auth(user, Some(password))
        .header("Accept", "application/json")
        .send();
    if let Ok(r) = auth {
        let code = r.status().as_u16();
        if code == 401 || code == 403 {
            return Err("Harbor 认证失败，请检查用户名和密码".into());
        }
    }
    let arr = resp
        .json::<Vec<serde_json::Value>>()
        .map_err(|e| format!("解析 Harbor 项目失败: {e}"))?;
    let mut names: Vec<String> = arr
        .iter()
        .filter_map(|v| v.get("name").and_then(|n| n.as_str()))
        .map(|s| s.to_string())
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

fn fetch_harbor_projects(
    url: &str,
    user: &str,
    password: &str,
) -> Result<HarborProjects, String> {
    let bases = harbor_base_candidates(url);
    if bases.is_empty() {
        return Err("请填写 Harbor 地址、用户名和密码".into());
    }
    let host = harbor_api_host(url);
    let ca = docker_ca_for_host(&host);
    // 保留首个候选（首选协议）的错误：它比兜底协议的错误更能说明问题
    let mut first_err: Option<String> = None;
    for base in bases {
        let (names, insecure) =
            match harbor_get_projects(&base, user, password, ca.as_ref(), false) {
                Ok(names) => (names, false),
                Err(e) if e.starts_with("Harbor 认证失败") => return Err(e),
                Err(e) if is_cert_error(&e) => {
                    crate::diag::diag_log(
                        "docker",
                        &format!("list_harbor_projects {host} 证书不受信任，本次读取降级为跳过校验"),
                    );
                    match harbor_get_projects(&base, user, password, ca.as_ref(), true) {
                        Ok(names) => (names, true),
                        Err(e2) => {
                            first_err.get_or_insert(e2);
                            continue;
                        }
                    }
                }
                Err(e) => {
                    first_err.get_or_insert(e);
                    continue;
                }
            };
        crate::diag::diag_log(
            "docker",
            &format!(
                "list_harbor_projects ok base={base} count={} insecure={insecure}",
                names.len()
            ),
        );
        return Ok(HarborProjects { names, insecure });
    }
    let err = first_err.unwrap_or_else(|| "无法连接 Harbor".to_string());
    crate::diag::diag_log("docker", &format!("list_harbor_projects failed: {err}"));
    Err(err)
}

/// 列出 Harbor 项目名，供配置页「项目」下拉选择。
#[tauri::command]
pub async fn list_harbor_projects(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<HarborProjects, String> {
    let url = harbor_url.trim().to_string();
    let user = username.trim().to_string();
    crate::diag::diag_log(
        "docker",
        &format!(
            "list_harbor_projects host={} user={}",
            harbor_login_host(&url),
            user
        ),
    );
    if url.is_empty() || user.is_empty() || password.is_empty() {
        return Err("请先填写 Harbor 地址、用户名和密码".into());
    }
    tauri::async_runtime::spawn_blocking(move || fetch_harbor_projects(&url, &user, &password))
        .await
        .map_err(|e| format!("读取 Harbor 项目线程异常: {e}"))?
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
        let _tracked = TrackedPid::new(child.id());

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
        // 实现用 round，避免 (f64 as u64) 截断与 12.3MiB 浮点边界不一致
        assert_eq!(
            parse_docker_size("12.3MB"),
            Some((12.3_f64 * 1024.0 * 1024.0).round() as u64)
        );
        assert_eq!(parse_docker_size("12MB"), Some(12 * 1024 * 1024));
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

    #[test]
    fn harbor_login_host_strips_scheme() {
        assert_eq!(
            harbor_login_host("https://dockerhub.kubekey.local/"),
            "dockerhub.kubekey.local"
        );
        assert_eq!(harbor_login_host("harbor.example.com"), "harbor.example.com");
    }

    #[test]
    fn harbor_api_host_drops_ui_path() {
        // Harbor 网页地址常带 /harbor，API 与 docker 都用裸主机
        assert_eq!(harbor_api_host("https://39.108.213.95/harbor"), "39.108.213.95");
        assert_eq!(harbor_api_host("39.108.213.95"), "39.108.213.95");
        assert_eq!(harbor_api_host("http://harbor.lan:8080/"), "harbor.lan:8080");
        assert!(harbor_api_host("  ").is_empty());
    }

    #[test]
    fn base_candidates_honor_explicit_scheme() {
        assert_eq!(
            harbor_base_candidates("http://h1/harbor"),
            vec!["http://h1".to_string(), "https://h1".to_string()]
        );
        assert_eq!(
            harbor_base_candidates("h1"),
            vec!["https://h1".to_string(), "http://h1".to_string()]
        );
        assert!(harbor_base_candidates("").is_empty());
    }

    #[test]
    fn only_tls_errors_allow_downgrade() {
        assert!(is_cert_error("连接 Harbor 失败: invalid peer certificate"));
        assert!(is_cert_error("连接 Harbor 失败: SSL certificate problem"));
        assert!(!is_cert_error("连接 Harbor 失败: connection timed out"));
        assert!(!is_cert_error("读取 Harbor 项目失败: HTTP 502"));
    }

    /// 自签证书 Harbor 的降级路径验证：占位账号即可，密码不参与 TLS 判断。
    /// 运行：`JARPORTER_TEST_HARBOR_SELF_SIGNED_URL=https://host cargo test -- --ignored self_signed`
    #[test]
    #[ignore = "需要真实自签证书 Harbor 的 JARPORTER_TEST_HARBOR_SELF_SIGNED_URL"]
    fn live_self_signed_needs_insecure_fallback() {
        let url = std::env::var("JARPORTER_TEST_HARBOR_SELF_SIGNED_URL")
            .expect("缺少 JARPORTER_TEST_HARBOR_SELF_SIGNED_URL");
        let base = format!("https://{}", harbor_api_host(&url));
        let strict = harbor_get_projects(&base, "probe", "probe", None, false)
            .expect_err("严格校验不应通过自签证书");
        assert!(is_cert_error(&strict), "严格模式应报证书错误，实际: {strict}");
        // 跳过校验后 TLS 握手完成、Harbor 才会回 401 —— 证明降级路径真的通了；
        // 同时验证「匿名也能列公开项目」这个坑被 users/current 拦住了
        let loose = harbor_get_projects(&base, "probe", "probe", None, true)
            .expect_err("占位账号不应成功");
        assert!(
            loose.starts_with("Harbor 认证失败"),
            "跳过校验后应拿到 401，实际: {loose}"
        );
    }

    /// 真实 Harbor 连通性验证；凭据走环境变量，源码不留明文。
    /// 运行：`cargo test -p jarporter -- --ignored live_harbor_projects`
    #[test]
    #[ignore = "需要真实 Harbor 环境变量 JARPORTER_TEST_HARBOR_URL/USER/PASSWORD"]
    fn live_harbor_projects() {
        let url = std::env::var("JARPORTER_TEST_HARBOR_URL")
            .expect("缺少 JARPORTER_TEST_HARBOR_URL");
        let user = std::env::var("JARPORTER_TEST_HARBOR_USER").expect("缺少 USER");
        let pass = std::env::var("JARPORTER_TEST_HARBOR_PASSWORD").expect("缺少 PASSWORD");
        let got = fetch_harbor_projects(&url, &user, &pass).expect("拉取 Harbor 项目失败");
        println!(
            "projects={:?} insecure={}",
            got.names, got.insecure
        );
        assert!(!got.names.is_empty(), "项目列表不应为空");
        assert!(
            got.names.iter().all(|n| !n.trim().is_empty()),
            "项目名不应有空值"
        );
    }
}
