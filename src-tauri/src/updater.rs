use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const GITHUB_REPO: &str = "bigtian99/harbor-tauri";
const GITHUB_API_LATEST: &str =
    "https://api.github.com/repos/bigtian99/harbor-tauri/releases/latest";
const USER_AGENT: &str = "JarPorter-Updater/1.0";
const REQUEST_TIMEOUT: u64 = 15;
const DOWNLOAD_TIMEOUT: u64 = 600; // 10 分钟，dmg 可能较大

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub needs_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    /// GitHub release asset id；优先走 API 下载（比 browser 直链更稳）
    pub asset_id: u64,
    pub file_size: u64,
    /// Release 更新说明（GitHub body，markdown 原文）
    pub release_notes: String,
}

fn empty_update(current_version: String, latest_version: String) -> UpdateInfo {
    UpdateInfo {
        needs_update: false,
        current_version,
        latest_version,
        download_url: String::new(),
        asset_id: 0,
        file_size: 0,
        release_notes: String::new(),
    }
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .connect_timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

/// 匹配当前 macOS 架构的 .dmg：文件名含 aarch64 / arm64 或 x64 / x86_64
fn match_dmg_asset(name: &str, arch: &str) -> bool {
    if !name.ends_with(".dmg") {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    // 跳过 ops 变体（若命名带 ops）
    if lower.contains("ops") {
        return false;
    }
    match arch {
        "aarch64" => lower.contains("aarch64") || lower.contains("arm64"),
        _ => lower.contains("x64") || lower.contains("x86_64") || lower.contains("amd64"),
    }
}

/// 粗检：真实 dmg 通常 >1MB，且不是 HTML/JSON 错误页
fn validate_dmg_file(path: &std::path::Path, expected_size: u64) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取下载文件失败: {}", e))?;
    let len = meta.len();
    if len < 1_000_000 {
        // 读前 200 字节看是不是 HTML/JSON
        let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut head = [0u8; 200];
        let n = f.read(&mut head).unwrap_or(0);
        let preview = String::from_utf8_lossy(&head[..n]);
        let kind = if preview.contains("<!DOCTYPE") || preview.contains("<html") {
            "HTML 页面"
        } else if preview.trim_start().starts_with('{') {
            "JSON"
        } else {
            "未知内容"
        };
        return Err(format!(
            "下载文件异常（{}，仅 {} 字节）。多半不是合法 dmg，请检查网络/代理后重试。",
            kind, len
        ));
    }
    if expected_size > 0 && len + 64 * 1024 < expected_size {
        return Err(format!(
            "文件不完整: 预期约 {} 字节, 实际 {} 字节",
            expected_size, len
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = match http_client(REQUEST_TIMEOUT) {
        Ok(c) => c,
        Err(e) => {
            crate::diag::diag_log("updater", &format!("check_update: {e}"));
            return Ok(empty_update(current_version, String::new()));
        }
    };

    let response = match client.get(GITHUB_API_LATEST).send() {
        Ok(r) => r,
        Err(e) => {
            crate::diag::diag_log("updater", &format!(
                "check_update: network error fetching {}, error={}",
                GITHUB_API_LATEST, e
            ));
            return Ok(empty_update(current_version, String::new()));
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        crate::diag::diag_log("updater", &format!(
            "check_update: non-200 status {} from {}",
            status.as_u16(),
            GITHUB_API_LATEST
        ));
        return Ok(empty_update(current_version, String::new()));
    }

    let json: serde_json::Value = response.json().map_err(|e| {
        crate::diag::diag_log("updater", &format!(
            "check_update: failed to parse JSON response from {}, error={}",
            GITHUB_API_LATEST, e
        ));
        format!("解析 GitHub API 响应失败: {}", e)
    })?;

    let tag_name = json["tag_name"].as_str().unwrap_or("");
    let latest_version = tag_name.strip_prefix('v').unwrap_or(tag_name).to_string();
    let release_notes = json["body"].as_str().unwrap_or("").trim().to_string();

    let Ok(current) = semver::Version::parse(&current_version) else {
        crate::diag::diag_log("updater", &format!(
            "check_update: failed to parse current version '{}' as semver",
            current_version
        ));
        return Ok(empty_update(current_version, latest_version));
    };

    let Ok(latest) = semver::Version::parse(&latest_version) else {
        crate::diag::diag_log("updater", &format!(
            "check_update: failed to parse latest version '{}' as semver",
            latest_version
        ));
        return Ok(empty_update(current_version, latest_version));
    };

    if latest <= current {
        crate::diag::diag_log("updater", &format!(
            "check_update: current={}, latest={}, needs_update=false (up to date)",
            current_version, latest_version
        ));
        return Ok(empty_update(current_version, latest.to_string()));
    }

    let arch = std::env::consts::ARCH;
    let assets = match json["assets"].as_array() {
        Some(a) => a,
        None => {
            return Ok(empty_update(current_version, latest.to_string()));
        }
    };

    let mut download_url = String::new();
    let mut asset_id = 0u64;
    let mut file_size = 0u64;

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if match_dmg_asset(name, arch) {
            download_url = asset["browser_download_url"]
                .as_str()
                .unwrap_or("")
                .to_string();
            asset_id = asset["id"].as_u64().unwrap_or(0);
            file_size = asset["size"].as_u64().unwrap_or(0);
            crate::diag::diag_log("updater", &format!(
                "check_update: matched asset name={}, id={}, size={}",
                name, asset_id, file_size
            ));
            break;
        }
    }

    if download_url.is_empty() {
        crate::diag::diag_log("updater", &format!(
            "check_update: current={}, latest={}, needs_update=false (no matching {} dmg asset found)",
            current_version, latest_version, arch
        ));
    } else {
        crate::diag::diag_log("updater", &format!(
            "check_update: current={}, latest={}, needs_update=true, url={}, asset_id={}, size={}, notes_len={}",
            current_version, latest_version, download_url, asset_id, file_size, release_notes.len()
        ));
    }

    Ok(UpdateInfo {
        needs_update: !download_url.is_empty() || asset_id > 0,
        current_version,
        latest_version: latest.to_string(),
        download_url,
        asset_id,
        file_size,
        release_notes,
    })
}

/// 下载 dmg：优先 GitHub API asset，失败再试 browser 直链
fn download_dmg_file(
    client: &reqwest::blocking::Client,
    download_url: &str,
    asset_id: u64,
    expected_size: u64,
    dmg_path: &std::path::Path,
    app: &AppHandle,
) -> Result<u64, String> {
    let mut last_err = String::new();

    if asset_id > 0 {
        let api_url = format!(
            "https://api.github.com/repos/{}/releases/assets/{}",
            GITHUB_REPO, asset_id
        );
        crate::diag::diag_log("updater", &format!(
            "download_and_install: try API asset url={}",
            api_url
        ));
        match try_download(client, &api_url, true, expected_size, dmg_path, app) {
            Ok(n) => return Ok(n),
            Err(e) => {
                crate::diag::diag_log("updater", &format!(
                    "download_and_install: API asset failed: {}",
                    e
                ));
                last_err = e;
                let _ = fs::remove_file(dmg_path);
            }
        }
    }

    if !download_url.is_empty() {
        crate::diag::diag_log("updater", &format!(
            "download_and_install: try browser url={}",
            download_url
        ));
        match try_download(client, download_url, false, expected_size, dmg_path, app) {
            Ok(n) => return Ok(n),
            Err(e) => {
                crate::diag::diag_log("updater", &format!(
                    "download_and_install: browser url failed: {}",
                    e
                ));
                last_err = e;
                let _ = fs::remove_file(dmg_path);
            }
        }
    }

    Err(format!(
        "下载失败: {}。可点「手动下载」或配置代理后重试。",
        last_err
    ))
}

fn try_download(
    client: &reqwest::blocking::Client,
    url: &str,
    api_asset: bool,
    expected_size: u64,
    dmg_path: &std::path::Path,
    app: &AppHandle,
) -> Result<u64, String> {
    let mut req = client.get(url);
    if api_asset {
        // 必须：否则 API 返回 JSON 元数据而不是二进制
        req = req.header(reqwest::header::ACCEPT, "application/octet-stream");
    }

    let mut response = req.send().map_err(|e| format!("请求失败: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    let total_size = response
        .content_length()
        .or(if expected_size > 0 {
            Some(expected_size)
        } else {
            None
        })
        .unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file =
        fs::File::create(dmg_path).map_err(|e| format!("创建临时文件失败: {}", e))?;
    let mut last_emit_pct: i16 = -1;
    let mut last_emit_at = std::time::Instant::now();

    // 立刻给前端一条进度，避免一直停在 0
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "downloading",
            "percent": 0,
            "downloaded": 0u64,
            "total": total_size,
            "message": if total_size > 0 {
                format!("正在下载更新... 0% (0 / {:.1} MB)", total_size as f64 / 1024.0 / 1024.0)
            } else {
                "正在下载更新...".to_string()
            },
        }),
    )
    .ok();

    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = response
            .read(&mut buf)
            .map_err(|e| format!("读取失败: {}", e))?;
        if n == 0 {
            break;
        }
        // 防 API 误下到 JSON 错误页
        if downloaded == 0 && n > 0 {
            if buf[0] == b'{' {
                return Err("返回了 JSON 而非安装包".into());
            }
            if buf.starts_with(b"<!DOCTYPE")
                || buf.starts_with(b"<html")
                || buf.starts_with(b"<HTML")
            {
                return Err("返回了 HTML 页面而非安装包（多半被墙/需代理）".into());
            }
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入失败: {}", e))?;
        downloaded += n as u64;

        // 节流：至少 1% 变化或 200ms 再发，避免刷爆事件
        let pct = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8
        } else {
            // 无总大小：用已下载 MB 做伪进度上限 95
            let fake = ((downloaded as f64 / (20.0 * 1024.0 * 1024.0)) * 95.0).min(95.0) as u8;
            fake
        };
        let due = last_emit_at.elapsed().as_millis() >= 200 || pct as i16 != last_emit_pct;
        if due {
            last_emit_pct = pct as i16;
            last_emit_at = std::time::Instant::now();
            let msg = if total_size > 0 {
                format!(
                    "正在下载… {}% ({:.1} / {:.1} MB)",
                    pct,
                    downloaded as f64 / 1024.0 / 1024.0,
                    total_size as f64 / 1024.0 / 1024.0
                )
            } else {
                format!(
                    "正在下载… {:.1} MB",
                    downloaded as f64 / 1024.0 / 1024.0
                )
            };
            app.emit(
                "update-progress",
                serde_json::json!({
                    "phase": "downloading",
                    "percent": pct,
                    "downloaded": downloaded,
                    "total": total_size,
                    "message": msg,
                }),
            )
            .ok();
        }
    }
    drop(file);

    validate_dmg_file(dmg_path, expected_size.max(total_size))?;
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "downloading",
            "percent": 100,
            "downloaded": downloaded,
            "total": total_size.max(downloaded),
            "message": "下载完成，准备安装…",
        }),
    )
    .ok();
    Ok(downloaded)
}

/// 真正干活的同步实现。必须丢到 blocking 线程，否则会卡死前端事件循环，
/// 导致 `update-progress` 事件和 React 重绘都发不出去。
#[cfg(target_os = "macos")]
fn download_and_install_blocking(
    app: AppHandle,
    download_url: String,
    asset_id: u64,
    expected_size: u64,
) -> Result<(), String> {
    crate::diag::diag_log("updater", &format!(
        "download_and_install: starting url={}, asset_id={}, expected_size={}",
        download_url, asset_id, expected_size
    ));
    let cache_dir = dirs::cache_dir()
        .ok_or("无法获取缓存目录")?
        .join("jarporter")
        .join("update");

    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败: {}", e))?;

    // 清掉旧的坏包，避免复用损坏缓存
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("dmg") {
                let _ = fs::remove_file(&p);
            }
        }
    }

    let filename = download_url
        .split('/')
        .last()
        .filter(|s| s.ends_with(".dmg"))
        .unwrap_or("JarPorter-update.dmg");
    let dmg_path = cache_dir.join(filename);

    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "downloading",
            "percent": 0,
            "message": "正在下载更新..."
        }),
    )
    .ok();

    let client = http_client(DOWNLOAD_TIMEOUT)?;
    let size = download_dmg_file(
        &client,
        &download_url,
        asset_id,
        expected_size,
        &dmg_path,
        &app,
    )?;

    crate::diag::diag_log("updater", &format!(
        "download_and_install: download complete, file={}, size={}",
        dmg_path.display(),
        size
    ));

    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "installing",
            "percent": 100,
            "message": "正在安装更新..."
        }),
    )
    .ok();

    // 挂载前再验一次
    validate_dmg_file(&dmg_path, expected_size)?;

    let mount_output = Command::new("hdiutil")
        .args([
            "attach",
            dmg_path.to_str().unwrap(),
            "-nobrowse",
            "-readonly",
        ])
        .output()
        .map_err(|e| format!("挂载 dmg 失败: {}", e))?;

    if !mount_output.status.success() {
        let stderr = String::from_utf8_lossy(&mount_output.stderr);
        let stdout = String::from_utf8_lossy(&mount_output.stdout);
        let actual = fs::metadata(&dmg_path).map(|m| m.len()).unwrap_or(0);
        let err_msg = format!(
            "挂载 dmg 失败 (file={} bytes): {} {}",
            actual,
            stderr.trim(),
            stdout.trim()
        );
        crate::diag::diag_log("updater", &format!(
            "download_and_install: mount failed, dmg={}, error={}",
            dmg_path.display(),
            err_msg
        ));
        let _ = fs::remove_file(&dmg_path);
        return Err(err_msg);
    }

    let stdout = String::from_utf8_lossy(&mount_output.stdout);
    let mount_point = stdout
        .lines()
        .rev()
        .find_map(|line| {
            // hdiutil 输出最后列是 /Volumes/...
            line.split_whitespace()
                .find(|p| p.starts_with("/Volumes/"))
                .map(|s| s.to_string())
        })
        .ok_or_else(|| {
            format!(
                "无法解析挂载点，hdiutil 输出: {}",
                stdout.chars().take(300).collect::<String>()
            )
        })?;

    crate::diag::diag_log("updater", &format!(
        "download_and_install: mounted at {}",
        mount_point
    ));

    let app_name = "JarPorter.app";
    let mount_root = PathBuf::from(&mount_point);
    // 有的 dmg 根目录就是 .app，有的套一层文件夹
    let mounted_app = if mount_root.join(app_name).exists() {
        mount_root.join(app_name)
    } else {
        // 扫一层
        fs::read_dir(&mount_root)
            .ok()
            .and_then(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .find(|p| p.extension().and_then(|s| s.to_str()) == Some("app"))
            })
            .unwrap_or_else(|| mount_root.join(app_name))
    };

    if !mounted_app.exists() {
        let _ = Command::new("hdiutil")
            .args(["detach", &mount_point, "-quiet"])
            .output();
        let _ = fs::remove_file(&dmg_path);
        return Err(format!(
            "dmg 内未找到 {}.app（挂载点 {}）",
            "JarPorter", mount_point
        ));
    }

    let target_app = PathBuf::from("/Applications").join(app_name);

    // 覆盖安装：先删旧的再复制
    if target_app.exists() {
        let rm = Command::new("rm")
            .args(["-rf", target_app.to_str().unwrap()])
            .status();
        if rm.map(|s| !s.success()).unwrap_or(true) {
            // 回退到 fs
            let _ = fs::remove_dir_all(&target_app);
        }
    }

    let cp_status = Command::new("cp")
        .args([
            "-R",
            mounted_app.to_str().unwrap(),
            target_app.to_str().unwrap(),
        ])
        .status()
        .map_err(|e| format!("复制应用失败: {}", e))?;

    if !cp_status.success() {
        let _ = Command::new("hdiutil")
            .args(["detach", &mount_point, "-quiet"])
            .output();
        let _ = fs::remove_file(&dmg_path);
        crate::diag::diag_log("updater", &format!(
            "download_and_install: copy failed, from={}, to={}",
            mounted_app.display(),
            target_app.display()
        ));
        return Err("复制应用到 /Applications 失败（可能需要权限）".into());
    }

    let _ = Command::new("hdiutil")
        .args(["detach", &mount_point, "-quiet"])
        .output();
    let _ = fs::remove_file(&dmg_path);

    crate::diag::diag_log("updater", &format!(
        "download_and_install: install complete, app copied to {}",
        target_app.display()
    ));

    let _ = Command::new("open")
        .args([target_app.to_str().unwrap()])
        .spawn();

    std::process::exit(0);
}

/// async 命令 + spawn_blocking：下载/安装不堵 UI 线程，进度条才能动。
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn download_and_install(
    app: AppHandle,
    download_url: String,
    asset_id: Option<u64>,
    file_size: Option<u64>,
) -> Result<(), String> {
    let asset_id = asset_id.unwrap_or(0);
    let expected_size = file_size.unwrap_or(0);
    // 先让前端有机会 paint 下载态
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "downloading",
            "percent": 0,
            "message": "正在准备下载…"
        }),
    )
    .ok();

    tauri::async_runtime::spawn_blocking(move || {
        download_and_install_blocking(app, download_url, asset_id, expected_size)
    })
    .await
    .map_err(|e| format!("下载任务异常: {}", e))?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn download_and_install(
    _app: AppHandle,
    _download_url: String,
    _asset_id: Option<u64>,
    _file_size: Option<u64>,
) -> Result<(), String> {
    Err("当前平台不支持自动更新，请手动下载最新版本".into())
}
