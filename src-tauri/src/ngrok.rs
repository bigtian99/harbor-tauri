//! ngrok 端口映射：输入本地端口 → 起一条公网隧道（复用本机已安装的 ngrok）。
//!
//! 设计要点：
//! - 不内置 ngrok 二进制（体积 + license），只调用本机 `ngrok`（PATH → /usr/local/bin → /opt/homebrew/bin…）。
//! - **用 stdout 的 JSON 日志判断成败**（`--log stdout --log-format json`）：
//!   `msg=started tunnel` 带 `url` 即成功；`lvl=eror/crit` 或 `command failed` 带 `err` 即失败。
//! - **复用已存在的隧道**：ngrok 免费账号同一时间只允许一个 agent 会话，若目标端口已经被
//!   本机其它 ngrok 映射（常见：用户自己开着一个），直接返回它的公网地址（`owned=false`，不提供停止）。
//! - 失败时把 ngrok 原始报错 + 可操作提示一起返回（如 ERR_NGROK_334「端点已在线」）。
//! - 自建的子进程句柄常驻；关闭映射 / 退出应用时 kill，避免留下公网隧道。

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::utils::find_command_path;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NgrokTunnel {
    pub port: u16,
    pub public_url: String,
    /// true = 本应用起的隧道（可由「停止映射」关闭）；false = 复用了外部 ngrok 的隧道
    pub owned: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NgrokInfo {
    pub installed: bool,
    pub path: String,
    pub version: String,
}

struct ActiveTunnel {
    tunnel: NgrokTunnel,
    child: Option<Child>,
}

static ACTIVE: Mutex<Option<ActiveTunnel>> = Mutex::new(None);

fn find_ngrok() -> Option<String> {
    if let Some(p) = find_command_path("ngrok") {
        return Some(p);
    }
    let exe = if cfg!(windows) { "ngrok.exe" } else { "ngrok" };
    for dir in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"] {
        let p = std::path::Path::new(dir).join(exe);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if c2.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// 把 ngrok 原始报错翻译成「原因 + 该怎么做」。
fn friendly_ngrok_error(raw: &str) -> String {
    let text = strip_ansi(raw).trim().to_string();
    if text.is_empty() {
        return "ngrok 启动失败（无输出）".to_string();
    }
    let lower = text.to_lowercase();
    let mut tips: Vec<&str> = Vec::new();
    if text.contains("ERR_NGROK_334") || lower.contains("is already online") {
        tips.push("该 ngrok 端点已在线：免费版同一账号同时只能有一个 ngrok 会话/端点。请先停掉已在运行的 ngrok（如 `pkill ngrok`）再试。");
    } else if text.contains("ERR_NGROK_4018") || lower.contains("authtoken") {
        tips.push("需要先配置 authtoken：在终端执行 `ngrok config add-authtoken <你的 token>`。");
    } else if text.contains("ERR_NGROK_105")
        || text.contains("ERR_NGROK_108")
        || lower.contains("context deadline")
        || lower.contains("no such host")
        || lower.contains("connection refused")
    {
        tips.push("连不上 ngrok 服务（网络/代理问题）：检查网络或代理设置。");
    }
    if tips.is_empty() {
        text
    } else {
        format!("{text}\n\n提示：{}", tips.join(" "))
    }
}

fn take_last_err(buf: &str) -> String {
    buf.lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

/// 从 ngrok 本地 API 的 JSON 里解析出所有隧道 (public_url, addr)。
fn parse_tunnels(json: &str) -> Option<Vec<(String, String)>> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let items = v.get("tunnels")?.as_array()?;
    let mut out = Vec::new();
    for t in items {
        let addr = t
            .get("config")
            .and_then(|c| c.get("addr"))
            .and_then(|a| a.as_str())
            .unwrap_or("")
            .to_string();
        let public = t
            .get("public_url")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string();
        if public.starts_with("http") {
            out.push((public, addr));
        }
    }
    Some(out)
}

fn addr_matches_port(addr: &str, port: u16) -> bool {
    let needle = format!(":{port}");
    addr.ends_with(&needle)
        || addr.contains(&format!("localhost{needle}"))
        || addr.contains(&format!("127.0.0.1{needle}"))
}

/// 读取本机已运行的 ngrok 本地 API（默认 4040，被占用时会顺延）里的全部隧道。
fn fetch_local_tunnels() -> Vec<(String, String)> {
    for api_port in 4040u16..=4044u16 {
        let url = format!("http://127.0.0.1:{api_port}/api/tunnels");
        let Ok(client) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(700))
            .build()
        else {
            continue;
        };
        let Ok(resp) = client.get(&url).send() else {
            continue;
        };
        let Ok(text) = resp.text() else { continue };
        if let Some(list) = parse_tunnels(&text) {
            return list;
        }
    }
    Vec::new()
}

/// 从 ngrok 本地 API 的 JSON 里挑出映射到该端口的公网地址（仅测试用）。
#[cfg(test)]
fn pick_public_url_for_port(json: &str, port: u16) -> Option<String> {
    parse_tunnels(json)?
        .into_iter()
        .find(|(_, addr)| addr_matches_port(addr, port))
        .map(|(url, _)| url)
}

/// 查询本机已运行的 ngrok 本地 API（默认 4040，被占用时会顺延），
/// 找出 `config.addr` 指向该端口的隧道公网地址。
fn existing_public_url_for_port(port: u16) -> Option<String> {
    fetch_local_tunnels()
        .into_iter()
        .find(|(_, addr)| addr_matches_port(addr, port))
        .map(|(url, _)| url)
}

fn stop_locked() -> bool {
    let mut guard = ACTIVE.lock().unwrap();
    let Some(mut active) = guard.take() else {
        return false;
    };
    if let Some(child) = active.child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    active.tunnel.owned
}

/// 应用退出时的清理（避免留下公网隧道）。
pub(crate) fn shutdown() {
    stop_locked();
}

#[tauri::command]
pub async fn ngrok_info() -> Result<NgrokInfo, String> {
    tauri::async_runtime::spawn_blocking(|| match find_ngrok() {
        Some(path) => {
            let version = Command::new(&path)
                .arg("version")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            NgrokInfo {
                installed: true,
                path,
                version,
            }
        }
        None => NgrokInfo {
            installed: false,
            path: String::new(),
            version: String::new(),
        },
    })
    .await
    .map_err(|e| format!("读取 ngrok 信息线程异常: {e}"))
}

#[tauri::command]
pub async fn ngrok_status() -> Option<NgrokTunnel> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut guard = ACTIVE.lock().unwrap();
        let Some(active) = guard.as_mut() else {
            return None;
        };
        if let Some(child) = active.child.as_mut() {
            // 自建隧道：子进程退出（崩溃/被外部 kill/被顶掉）即视为未映射
            if matches!(child.try_wait(), Ok(Some(_))) {
                *guard = None;
                return None;
            }
            return Some(active.tunnel.clone());
        }
        // 复用的外部隧道：重新确认它还在（外部 ngrok 停了也应清掉，避免一直显示旧地址）
        let port = active.tunnel.port;
        match existing_public_url_for_port(port) {
            Some(url) => Some(NgrokTunnel {
                port,
                public_url: url,
                owned: false,
            }),
            None => {
                *guard = None;
                None
            }
        }
    })
    .await
    .ok()
    .flatten()
}

/// 统计本机 ngrok 进程数（含外部启动的）。
fn count_ngrok_processes() -> u32 {
    #[cfg(unix)]
    {
        if let Ok(o) = Command::new("pgrep").args(["-x", "ngrok"]).output() {
            return String::from_utf8_lossy(&o.stdout).split_whitespace().count() as u32;
        }
        0
    }
    #[cfg(windows)]
    {
        if let Ok(o) = Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq ngrok.exe", "/FO", "CSV", "/NH"])
            .output()
        {
            let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
            return s.lines().filter(|l| l.contains("ngrok.exe")).count() as u32;
        }
        0
    }
}

/// 本机当前运行中的 ngrok 进程数（0 → 前端禁用「停止全部映射」）。
#[tauri::command]
pub async fn ngrok_running() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(count_ngrok_processes)
        .await
        .map_err(|e| format!("统计 ngrok 进程线程异常: {e}"))
}

#[tauri::command]
pub async fn ngrok_stop() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(stop_locked)
        .await
        .map_err(|e| format!("停止 ngrok 线程异常: {e}"))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NgrokStopAllResult {
    pub killed: usize,
    /// 执行后仍存在的 ngrok 进程数（用于前端校准状态）
    pub remaining: u32,
}

/// 停止全部映射：本应用起的 + 外部启动的 ngrok 进程（会一并停掉，需谨慎）。
#[tauri::command]
pub async fn ngrok_stop_all() -> Result<NgrokStopAllResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut killed = 0usize;
        // 1) 本应用起的
        if stop_locked() {
            killed += 1;
        }

        // 2) 外部 ngrok 进程（按进程名精确匹配）
        #[cfg(unix)]
        {
            let list = || -> Vec<String> {
                Command::new("pgrep")
                    .args(["-x", "ngrok"])
                    .output()
                    .ok()
                    .map(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .split_whitespace()
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let pids = list();
            for pid in &pids {
                let _ = Command::new("kill").args(["-TERM", pid]).status();
            }
            if !pids.is_empty() {
                std::thread::sleep(Duration::from_millis(400));
            }
            // 还没退的强杀
            for pid in list() {
                let _ = Command::new("kill").args(["-KILL", &pid]).status();
            }
            killed += pids.len();
        }
        #[cfg(windows)]
        {
            if let Ok(o) = Command::new("taskkill")
                .args(["/IM", "ngrok.exe", "/F"])
                .output()
            {
                if o.status.success() {
                    killed += 1;
                }
            }
        }
        crate::diag::diag_log("ngrok", &format!("ngrok_stop_all killed={killed}"));
        let remaining = count_ngrok_processes();
        Ok(NgrokStopAllResult { killed, remaining })
    })
    .await
    .map_err(|e| format!("停止全部 ngrok 线程异常: {e}"))?
}

#[tauri::command]
pub async fn ngrok_start(port: u16) -> Result<NgrokTunnel, String> {
    tauri::async_runtime::spawn_blocking(move || start_blocking(port))
        .await
        .map_err(|e| format!("ngrok 启动线程异常: {e}"))?
}

/// 同一端口已经在映射（且自建子进程仍活着）→ 直接复用，避免重复点击又等十几秒。
fn active_tunnel_for_port(port: u16) -> Option<NgrokTunnel> {
    let mut guard = ACTIVE.lock().unwrap();
    let active = guard.as_mut()?;
    if active.tunnel.port != port {
        return None;
    }
    if let Some(child) = active.child.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *guard = None;
            return None;
        }
    }
    Some(active.tunnel.clone())
}

fn start_blocking(port: u16) -> Result<NgrokTunnel, String> {
    if port == 0 {
        return Err("端口无效".to_string());
    }
    // 已在映射同一端口 → 直接返回（省掉 ngrok 十几秒的重新握手）
    if let Some(existing) = active_tunnel_for_port(port) {
        crate::diag::diag_log(
            "ngrok",
            &format!("ngrok_start reuse active port={port} url={}", existing.public_url),
        );
        return Ok(existing);
    }
    stop_locked();

    let bin = find_ngrok().ok_or_else(|| {
        "未找到 ngrok，请先安装：macOS `brew install --cask ngrok`；Windows 到 ngrok.com 下载并加入 PATH".to_string()
    })?;
    let target = format!("127.0.0.1:{port}");
    crate::diag::diag_log("ngrok", &format!("ngrok_start bin={bin} target={target}"));

    // 该端口已被本机其它 ngrok 映射 → 直接复用（免费账号只能一个会话）
    if let Some(url) = existing_public_url_for_port(port) {
        crate::diag::diag_log("ngrok", &format!("ngrok_start reuse existing url={url}"));
        let tunnel = NgrokTunnel {
            port,
            public_url: url,
            owned: false,
        };
        *ACTIVE.lock().unwrap() = Some(ActiveTunnel {
            tunnel: tunnel.clone(),
            child: None,
        });
        return Ok(tunnel);
    }

    let mut child = Command::new(&bin)
        .args(["http", &target, "--log", "stdout", "--log-format", "json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 ngrok 失败: {e}"))?;

    // stdout：线程逐行推给主流程；拿到成功结果后接收端会被 drop，
    // 此时必须【继续排空管道】（忽略 send 错误），否则 ngrok 日志写满管道会卡死/掉线。
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
    }
    // stderr：持续收进缓冲，失败时取最后一行
    let err_buf = std::sync::Arc::new(Mutex::new(String::new()));
    if let Some(err) = child.stderr.take() {
        let buf = err_buf.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let mut b = buf.lock().unwrap();
                if b.len() < 8000 {
                    b.push_str(&line);
                    b.push('\n');
                }
            }
        });
    }

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut last_err = String::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match rx.recv_timeout(left) {
            Ok(line) => {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                    continue;
                };
                let msg = v.get("msg").and_then(|m| m.as_str()).unwrap_or("");
                let lvl = v.get("lvl").and_then(|m| m.as_str()).unwrap_or("");
                if msg == "started tunnel" {
                    if let Some(url) = v.get("url").and_then(|u| u.as_str()) {
                        if url.starts_with("http") {
                            let tunnel = NgrokTunnel {
                                port,
                                public_url: url.to_string(),
                                owned: true,
                            };
                            *ACTIVE.lock().unwrap() = Some(ActiveTunnel {
                                tunnel: tunnel.clone(),
                                child: Some(child),
                            });
                            crate::diag::diag_log(
                                "ngrok",
                                &format!("ngrok_start ok port={port} url={url}"),
                            );
                            return Ok(tunnel);
                        }
                    }
                }
                if (lvl == "eror" || lvl == "crit" || msg.contains("command failed"))
                    && v.get("err").and_then(|e| e.as_str()).is_some()
                {
                    last_err = v
                        .get("err")
                        .and_then(|e| e.as_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = child.kill();
    let _ = child.wait();

    // 起不来但该端口其实已被外部 ngrok 映射 → 复用
    if let Some(url) = existing_public_url_for_port(port) {
        let tunnel = NgrokTunnel {
            port,
            public_url: url,
            owned: false,
        };
        *ACTIVE.lock().unwrap() = Some(ActiveTunnel {
            tunnel: tunnel.clone(),
            child: None,
        });
        return Ok(tunnel);
    }

    let raw = if !last_err.trim().is_empty() {
        last_err
    } else {
        take_last_err(&err_buf.lock().unwrap())
    };
    let mut msg = if raw.trim().is_empty() {
        format!("ngrok 在 30 秒内未建立隧道（端口 {port}）")
    } else {
        friendly_ngrok_error(&raw)
    };
    // 「端点已在线」时把本机现有隧道列出来，便于定位要停哪一个
    let lower = raw.to_lowercase();
    if raw.contains("ERR_NGROK_334") || lower.contains("is already online") {
        let tunnels = fetch_local_tunnels();
        if !tunnels.is_empty() {
            let list = tunnels
                .iter()
                .map(|(url, addr)| format!("  - {url} → {addr}"))
                .collect::<Vec<_>>()
                .join("\n");
            msg = format!(
                "{msg}\n\n当前本机已有 ngrok 隧道：\n{list}\n\n要么停掉它（`pkill ngrok`，或停对应端口：`pkill -f \"ngrok http 9999\"`），要么给本应用配置另一个 ngrok 账号的 authtoken。"
            );
        }
    }
    crate::diag::diag_log("ngrok", &format!("ngrok_start failed port={port}: {msg}"));
    Err(msg)
}

#[cfg(test)]
mod tests {
    use super::{friendly_ngrok_error, strip_ansi};

    #[test]
    fn strips_ansi_escapes() {
        assert_eq!(strip_ansi("\u{1b}[92mgreen\u{1b}[0m ok"), "green ok");
    }

    #[test]
    fn already_online_gets_actionable_hint() {
        let raw = "failed to start tunnel: The endpoint 'https://x.ngrok-free.dev' is already online.\r\n\r\nERR_NGROK_334\r\n";
        let msg = friendly_ngrok_error(raw);
        assert!(msg.contains("ERR_NGROK_334"));
        assert!(msg.contains("pkill ngrok"), "should tell user how to fix: {msg}");
    }

    #[test]
    fn authtoken_error_gets_config_hint() {
        let msg = friendly_ngrok_error("failed to start tunnel: ERR_NGROK_4018 authtoken is required");
        assert!(msg.contains("add-authtoken"), "got: {msg}");
    }

    #[test]
    fn unknown_error_passes_through() {
        let msg = friendly_ngrok_error("something weird happened");
        assert_eq!(msg, "something weird happened");
    }

    #[test]
    fn empty_error_has_fallback() {
        assert_eq!(friendly_ngrok_error("   "), "ngrok 启动失败（无输出）");
    }

    #[test]
    fn picks_existing_tunnel_by_port() {
        // 取自真实 ngrok 本地 API 形状
        let json = r#"{"tunnels":[{"public_url":"https://x.ngrok-free.dev","config":{"addr":"http://localhost:9999"}}]}"#;
        assert_eq!(
            super::pick_public_url_for_port(json, 9999).as_deref(),
            Some("https://x.ngrok-free.dev")
        );
        assert_eq!(super::pick_public_url_for_port(json, 8080), None);
        assert_eq!(super::pick_public_url_for_port("not json", 9999), None);
    }

    #[test]
    fn parses_multiple_tunnels() {
        let json = r#"{"tunnels":[
            {"public_url":"https://a.ngrok-free.dev","config":{"addr":"http://localhost:9999"}},
            {"public_url":"https://b.ngrok-free.dev","config":{"addr":"http://127.0.0.1:8080"}}
        ]}"#;
        let list = super::parse_tunnels(json).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].1, "http://127.0.0.1:8080");
        assert!(super::addr_matches_port("http://127.0.0.1:8080", 8080));
        assert!(!super::addr_matches_port("http://127.0.0.1:8080", 8081));
    }
}
