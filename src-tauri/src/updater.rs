use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const GITHUB_API_URL: &str =
    "https://api.github.com/repos/daijunxiong/jarporter/releases/latest";
const USER_AGENT: &str = "JarPorter-Updater/1.0";
const REQUEST_TIMEOUT: u64 = 10;
const DOWNLOAD_TIMEOUT: u64 = 600; // 10 分钟，dmg 可能较大

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub needs_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub file_size: u64,
}

#[tauri::command]
pub fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    // 1. HTTP GET GitHub Releases API
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = match client.get(GITHUB_API_URL).send() {
        Ok(r) => r,
        Err(_) => {
            // 网络不通 → 静默跳过
            return Ok(UpdateInfo {
                needs_update: false,
                current_version,
                latest_version: String::new(),
                download_url: String::new(),
                file_size: 0,
            });
        }
    };

    if !response.status().is_success() {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version: String::new(),
            download_url: String::new(),
            file_size: 0,
        });
    }

    let json: serde_json::Value = response
        .json()
        .map_err(|e| format!("解析 GitHub API 响应失败: {}", e))?;

    // 2. 版本比较
    let tag_name = json["tag_name"].as_str().unwrap_or("");
    let latest_version = tag_name.strip_prefix('v').unwrap_or(tag_name).to_string();

    let Ok(current) = semver::Version::parse(&current_version) else {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version,
            download_url: String::new(),
            file_size: 0,
        });
    };

    let Ok(latest) = semver::Version::parse(&latest_version) else {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version,
            download_url: String::new(),
            file_size: 0,
        });
    };

    if latest <= current {
        crate::landing::templates_log(&format!(
            "check_update: current={}, latest={}, needs_update=false (up to date)",
            current_version, latest_version
        ));
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version: latest.to_string(),
            download_url: String::new(),
            file_size: 0,
        });
    }

    // 3. 匹配当前架构的 dmg asset
    let arch = std::env::consts::ARCH;
    // macOS: ARCH 为 "aarch64" 或 "x86_64"
    let arch_key: &str = if arch == "aarch64" { "aarch64" } else { "x64" };

    let assets = match json["assets"].as_array() {
        Some(a) => a,
        None => {
            return Ok(UpdateInfo {
                needs_update: false,
                current_version,
                latest_version: latest.to_string(),
                download_url: String::new(),
                file_size: 0,
            });
        }
    };

    let mut download_url = String::new();
    let mut file_size = 0u64;

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if name.ends_with(".dmg") && name.contains(arch_key) {
            download_url = asset["browser_download_url"]
                .as_str()
                .unwrap_or("")
                .to_string();
            file_size = asset["size"].as_u64().unwrap_or(0);
            break;
        }
    }

    if download_url.is_empty() {
        crate::landing::templates_log(&format!(
            "check_update: current={}, latest={}, needs_update=false (no matching {} dmg asset found)",
            current_version, latest_version, arch_key
        ));
    } else {
        crate::landing::templates_log(&format!(
            "check_update: current={}, latest={}, needs_update=true, url={}, size={}",
            current_version, latest_version, download_url, file_size
        ));
    }

    Ok(UpdateInfo {
        needs_update: !download_url.is_empty(),
        current_version,
        latest_version: latest.to_string(),
        download_url,
        file_size,
    })
}

#[tauri::command]
pub fn download_and_install(
    app: AppHandle,
    download_url: String,
) -> Result<(), String> {
    crate::landing::templates_log(&format!(
        "download_and_install: starting download from {}",
        download_url
    ));
    let cache_dir = dirs::cache_dir()
        .ok_or("无法获取缓存目录")?
        .join("jarporter")
        .join("update");

    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("创建缓存目录失败: {}", e))?;

    let filename = download_url
        .split('/')
        .last()
        .unwrap_or("JarPorter.dmg");
    let dmg_path = cache_dir.join(filename);

    // Phase 1: 下载
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "downloading",
            "percent": 0,
            "message": "正在下载更新..."
        }),
    )
    .ok();

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut response = client
        .get(&download_url)
        .send()
        .map_err(|e| {
            crate::landing::templates_log(&format!(
                "download_and_install: download request failed, url={}, error={}",
                download_url, e
            ));
            format!("下载请求失败: {}", e)
        })?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&dmg_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;

    let mut buf = [0u8; 8192];
    loop {
        let n = response
            .read(&mut buf)
            .map_err(|e| format!("下载读取失败: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += n as u64;
        if total_size > 0 {
            let pct = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            app.emit(
                "update-progress",
                serde_json::json!({
                    "phase": "downloading",
                    "percent": pct,
                    "message": format!("正在下载更新... {}%", pct),
                }),
            )
            .ok();
        }
    }
    drop(file);

    // 校验文件大小
    if total_size > 0 {
        let actual_size = fs::metadata(&dmg_path)
            .map_err(|e| format!("读取文件信息失败: {}", e))?
            .len();
        if actual_size != total_size {
            let _ = fs::remove_file(&dmg_path);
            return Err(format!(
                "文件校验失败: 预期 {} 字节, 实际 {} 字节",
                total_size, actual_size
            ));
        }
    }

    crate::landing::templates_log(&format!(
        "download_and_install: download complete, file={}, size={}",
        dmg_path.display(),
        fs::metadata(&dmg_path).map(|m| m.len()).unwrap_or(0)
    ));

    // Phase 2: 挂载 dmg
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "installing",
            "percent": 100,
            "message": "正在安装更新..."
        }),
    )
    .ok();

    let mount_output = Command::new("hdiutil")
        .args([
            "attach",
            dmg_path.to_str().unwrap(),
            "-nobrowse",
            "-quiet",
        ])
        .output()
        .map_err(|e| format!("挂载 dmg 失败: {}", e))?;

    if !mount_output.status.success() {
        let _ = fs::remove_file(&dmg_path);
        let err_msg = format!(
            "挂载 dmg 失败: {}",
            String::from_utf8_lossy(&mount_output.stderr)
        );
        crate::landing::templates_log(&format!(
            "download_and_install: mount failed, dmg={}, error={}",
            dmg_path.display(), err_msg
        ));
        return Err(err_msg);
    }

    // hdiutil 输出的最后一行格式: /dev/disk4s1\t/Volumes/JarPorter
    let stdout = String::from_utf8_lossy(&mount_output.stdout);
    let mount_point = stdout
        .lines()
        .last()
        .and_then(|line| line.split('\t').last())
        .map(|s| s.trim().to_string())
        .ok_or("无法解析挂载点")?;

    let app_name = "JarPorter.app";
    let mounted_app = PathBuf::from(&mount_point).join(app_name);
    let target_app = PathBuf::from("/Applications").join(app_name);

    // Phase 3: 复制到 /Applications
    let cp_status = Command::new("cp")
        .args([
            "-R",
            mounted_app.to_str().unwrap(),
            target_app.to_str().unwrap(),
        ])
        .status()
        .map_err(|e| format!("复制应用失败: {}", e))?;

    if !cp_status.success() {
        // 卸载再报错
        let _ = Command::new("hdiutil")
            .args(["detach", &mount_point, "-quiet"])
            .output();
        let _ = fs::remove_file(&dmg_path);
        crate::landing::templates_log(&format!(
            "download_and_install: copy failed, from={}, to={}",
            mounted_app.display(), target_app.display()
        ));
        return Err("复制应用到 /Applications 失败".into());
    }

    // Phase 4: 卸载 + 清理
    let _ = Command::new("hdiutil")
        .args(["detach", &mount_point, "-quiet"])
        .output();
    let _ = fs::remove_file(&dmg_path);

    crate::landing::templates_log(&format!(
        "download_and_install: install complete, app copied to {}",
        target_app.display()
    ));

    // Phase 5: 拉起新版本 + 退出
    let _ = Command::new("open")
        .args([target_app.to_str().unwrap()])
        .spawn();

    std::process::exit(0);
}
