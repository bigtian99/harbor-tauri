//! Docker login / push / rmi 等推送共享步骤。

use crate::build::{docker_output, emit_progress};
use crate::models::HarborConfig;
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

/// 按 `harbor_env_id`（或 `harbor_last_env_id`）选中环境并 mirror 到顶层四字段。
pub(crate) fn apply_harbor_env(
    config: &mut HarborConfig,
    harbor_env_id: Option<String>,
) -> Result<(), String> {
    if !config.harbor_environments.is_empty() {
        let want = harbor_env_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| config.harbor_last_env_id.clone());
        let env = config
            .harbor_environments
            .iter()
            .find(|e| e.id == want)
            .or_else(|| config.harbor_environments.first())
            .cloned()
            .ok_or_else(|| "请先配置Harbor信息".to_string())?;
        crate::diag::diag_log(
            "build",
            &format!(
                "apply_harbor_env id={} name={} url={} project={}",
                env.id, env.name, env.harbor_url, env.project
            ),
        );
        config.harbor_url = harbor_registry_host(&env.harbor_url);
        config.username = env.username;
        config.password = env.password;
        config.project = env.project;
        config.harbor_last_env_id = env.id;
    }
    // 旧配置顶层字段也可能带协议
    if !config.harbor_url.is_empty() {
        config.harbor_url = harbor_registry_host(&config.harbor_url);
    }
    require_harbor_config(config)
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

/// 去掉 http(s):// 与尾斜杠，得到 Docker registry 主机（镜像引用与 login 共用）。
pub(crate) fn harbor_registry_host(raw: &str) -> String {
    let s = raw.trim().trim_end_matches('/');
    s.strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(s)
        .trim_end_matches('/')
        .to_string()
}

fn harbor_login_host(raw: &str) -> String {
    harbor_registry_host(raw)
}

/// 探测 Registry `/v2/` 返回的 Bearer realm 主机（忽略证书错误）。
fn probe_registry_auth_realm_host(registry_host: &str) -> Option<String> {
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()?;
    for base in [
        format!("https://{registry_host}/v2/"),
        format!("http://{registry_host}/v2/"),
    ] {
        let resp = client.get(&base).send().ok()?;
        let auth = resp
            .headers()
            .get(reqwest::header::WWW_AUTHENTICATE)?
            .to_str()
            .ok()?;
        // Bearer realm="https://dockerhub.kubekey.local/service/token",service="harbor-registry"
        let realm = auth
            .split("realm=\"")
            .nth(1)?
            .split('"')
            .next()?
            .trim();
        if realm.is_empty() {
            continue;
        }
        return Some(harbor_registry_host(realm));
    }
    None
}

fn docker_login_failure_hint(registry_host: &str, stderr: &str) -> String {
    if stderr.contains("x509") || stderr.contains("certificate") {
        return format!(
            "\n\n提示: Harbor 证书主机名与地址「{registry_host}」不匹配（常见于公网 IP 访问内网证书）。\n\
在 Docker Desktop → Settings → Docker Engine 的 JSON 中加入后 Apply & Restart:\n\
  \"insecure-registries\": [\"{registry_host}\"]\n\
或改用证书里的地址登录，或让运维给 Harbor 证书加上该 IP/域名。"
        );
    }
    if stderr.to_ascii_lowercase().contains("unauthorized") {
        if let Some(realm_host) = probe_registry_auth_realm_host(registry_host) {
            if !realm_host.eq_ignore_ascii_case(registry_host)
                && !realm_host.is_empty()
            {
                return format!(
                    "\n\n提示: 该 Harbor 的 Docker 认证地址配错了。\n\
Registry「{registry_host}」返回的 token 地址是「{realm_host}」（常为安装时的旧域名）。\n\
Docker login/push 会去「{realm_host}」要令牌，因而出现 unauthorized。\n\n\
正确修法（在 Harbor 服务器上）: 把 harbor.yml 的 external_url 改为 https://{registry_host} 后重新 apply/重启。\n\
临时绕过（会影响「{realm_host}」原解析）: 在本机 /etc/hosts 增加一行\n\
  {registry_host}  {realm_host}\n\
用完后请删掉该行，以免连错其它 Harbor。"
                );
            }
        }
        return "\n\n提示: 账号密码可能不正确，或该 Harbor 未授权 Docker 登录。".to_string();
    }
    String::new()
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
        let hint = docker_login_failure_hint(&host, &stderr);
        return Err(format!("docker login 失败:\n{stderr}{hint}"));
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

/// 测试 Harbor：优先用 HTTP API 验账号（忽略坏证书）；再尝试 docker login 并附加结果。
#[tauri::command]
pub async fn test_harbor_connection(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let url = harbor_url.trim().to_string();
    let user = username.trim().to_string();
    let pass = password;
    let host = harbor_registry_host(&url);
    crate::diag::diag_log(
        "docker",
        &format!("test_harbor_connection host={host} user={user}"),
    );
    if host.is_empty() || user.is_empty() || pass.is_empty() {
        return Err("请填写 Harbor 地址、用户名和密码".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let projects = list_harbor_projects_sync(&host, &user, &pass)?;
        let api_msg = format!("Harbor 账号可用，可见项目 {} 个", projects.len());
        match docker_login_harbor_sync(url, user, pass, false) {
            Ok(_) => {
                crate::diag::diag_log("docker", "test_harbor_connection api+docker ok");
                Ok(format!("{api_msg}；Docker login 成功"))
            }
            Err(e) => {
                // 证书主机名不匹配时 docker login 常失败，但不影响「账号是否正确」
                let brief = e.lines().take(3).collect::<Vec<_>>().join(" ");
                crate::diag::diag_log(
                    "docker",
                    &format!("test_harbor_connection api ok, docker fail: {brief}"),
                );
                Ok(format!(
                    "{api_msg}。Docker login 失败（需把 {host} 加入 insecure-registries 才能推镜像）：{brief}"
                ))
            }
        }
    })
    .await
    .map_err(|e| format!("登录线程异常: {e}"))?
}

/// 通过 Harbor HTTP API 列出当前账号可见的项目名（忽略自签/主机名不匹配证书）。
#[tauri::command]
pub async fn list_harbor_projects(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<Vec<String>, String> {
    let host = harbor_registry_host(&harbor_url);
    let user = username.trim().to_string();
    let pass = password.clone();
    crate::diag::diag_log(
        "docker",
        &format!("list_harbor_projects host={host} user={user}"),
    );
    if host.is_empty() || user.is_empty() || pass.is_empty() {
        return Err("请填写 Harbor 地址、用户名和密码".into());
    }
    tauri::async_runtime::spawn_blocking(move || list_harbor_projects_sync(&host, &user, &pass))
        .await
        .map_err(|e| format!("拉取项目线程异常: {e}"))?
}

fn list_harbor_projects_sync(host: &str, username: &str, password: &str) -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    // Harbor 控制台多为 https；http 作回退
    let candidates = [
        format!("https://{host}/api/v2.0/projects?page_size=100"),
        format!("http://{host}/api/v2.0/projects?page_size=100"),
    ];
    let mut last_err = String::from("无法连接 Harbor API");
    for url in candidates {
        let resp = match client.get(&url).basic_auth(username, Some(password)).send() {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("请求 {url} 失败: {e}");
                continue;
            }
        };
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        if !status.is_success() {
            last_err = format!("Harbor API {status}: {}", body.chars().take(200).collect::<String>());
            // 401/403 不必再试 http
            if status.as_u16() == 401 || status.as_u16() == 403 {
                break;
            }
            continue;
        }
        let projects: Vec<serde_json::Value> = serde_json::from_str(&body)
            .map_err(|e| format!("解析项目列表失败: {e}"))?;
        let mut names: Vec<String> = projects
            .iter()
            .filter_map(|p| p.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
            .filter(|s| !s.trim().is_empty())
            .collect();
        names.sort();
        names.dedup();
        crate::diag::diag_log(
            "docker",
            &format!("list_harbor_projects ok host={host} count={}", names.len()),
        );
        return Ok(names);
    }
    Err(last_err)
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

    #[test]
    fn harbor_login_host_strips_scheme() {
        assert_eq!(
            harbor_registry_host("https://dockerhub.kubekey.local/"),
            "dockerhub.kubekey.local"
        );
        assert_eq!(
            harbor_registry_host("http://39.108.213.95"),
            "39.108.213.95"
        );
        assert_eq!(harbor_registry_host("harbor.example.com"), "harbor.example.com");
    }
}
