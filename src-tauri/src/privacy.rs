//! 隐私协议 HTML 上传（运营）：FTP 到 common.tiankongshuyu.cn，本地持久化历史。

use crate::landing::run_ftp_upload_with;
use crate::models::APP_CONFIG_DIR;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const PRIVACY_FTP_HOST: &str = "60.205.155.142";
const PRIVACY_PUBLIC_BASE: &str = "http://common.tiankongshuyu.cn";
const HISTORY_FILE: &str = "privacy_uploads.json";
const HISTORY_MAX: usize = 200;

const WORDS: &[&str] = &[
    "apple", "ocean", "swift", "coral", "maple", "river", "cloud", "amber", "pearl", "stone",
    "flame", "grove", "bloom", "cedar", "frost", "harbor", "ivory", "jade", "lemon", "mint",
    "nova", "olive", "pine", "quartz", "raven", "sage", "tide", "umbra", "violet", "willow",
    "xenon", "amberly",
];

static HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyUploadRecord {
    pub id: String,
    pub source_name: String,
    pub remote_dir: String,
    pub url: String,
    pub uploaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyUploadResult {
    pub id: String,
    pub source_name: String,
    pub remote_dir: String,
    pub url: String,
    pub status: String,
    pub message: String,
    pub uploaded_at: String,
}

fn history_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join(APP_CONFIG_DIR);
    let _ = fs::create_dir_all(&app_dir);
    app_dir.join(HISTORY_FILE)
}

fn now_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn pick_remote_dir() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let word = WORDS[(nanos as usize) % WORDS.len()];
    format!("{}{}", unix_secs(), word)
}

fn load_history_unlocked() -> Vec<PrivacyUploadRecord> {
    let path = history_path();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(e) => {
            crate::diag::diag_log("ops", &format!("读取隐私上传历史失败: {e}"));
            Vec::new()
        }
    }
}

fn save_history_unlocked(records: &[PrivacyUploadRecord]) -> Result<(), String> {
    let path = history_path();
    let raw = serde_json::to_string_pretty(records)
        .map_err(|e| format!("序列化隐私上传历史失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入隐私上传历史失败: {e}"))
}

fn prepend_history(record: PrivacyUploadRecord) -> Result<(), String> {
    let _guard = HISTORY_LOCK
        .lock()
        .map_err(|_| "隐私上传历史锁异常".to_string())?;
    let mut list = load_history_unlocked();
    list.retain(|r| r.id != record.id);
    list.insert(0, record);
    list.truncate(HISTORY_MAX);
    save_history_unlocked(&list)
}

fn is_html_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let l = e.to_ascii_lowercase();
            l == "html" || l == "htm"
        })
        .unwrap_or(false)
}

#[tauri::command]
pub async fn list_privacy_uploads() -> Result<Vec<PrivacyUploadRecord>, String> {
    let _guard = HISTORY_LOCK
        .lock()
        .map_err(|_| "隐私上传历史锁异常".to_string())?;
    Ok(load_history_unlocked())
}

#[tauri::command]
pub async fn delete_privacy_uploads(ids: Vec<String>) -> Result<(), String> {
    let _guard = HISTORY_LOCK
        .lock()
        .map_err(|_| "隐私上传历史锁异常".to_string())?;
    let mut list = load_history_unlocked();
    let before = list.len();
    list.retain(|r| !ids.contains(&r.id));
    save_history_unlocked(&list)?;
    crate::diag::diag_log(
        "ops",
        &format!(
            "delete_privacy_uploads ids={} removed={}",
            ids.len(),
            before.saturating_sub(list.len())
        ),
    );
    Ok(())
}

#[tauri::command]
pub async fn clear_privacy_uploads() -> Result<(), String> {
    let _guard = HISTORY_LOCK
        .lock()
        .map_err(|_| "隐私上传历史锁异常".to_string())?;
    save_history_unlocked(&[])?;
    crate::diag::diag_log("ops", "clear_privacy_uploads ok");
    Ok(())
}

#[tauri::command]
pub async fn upload_privacy_html(paths: Vec<String>) -> Result<Vec<PrivacyUploadResult>, String> {
    if paths.is_empty() {
        return Err("请先选择 HTML 文件".to_string());
    }
    crate::diag::diag_log("ops", &format!("upload_privacy_html count={}", paths.len()));

    let mut results = Vec::new();
    for path_str in paths {
        let source = PathBuf::from(&path_str);
        let source_name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());

        if !source.is_file() {
            results.push(PrivacyUploadResult {
                id: String::new(),
                source_name,
                remote_dir: String::new(),
                url: String::new(),
                status: "error".to_string(),
                message: format!("文件不存在: {path_str}"),
                uploaded_at: now_stamp(),
            });
            continue;
        }
        if !is_html_path(&source) {
            results.push(PrivacyUploadResult {
                id: String::new(),
                source_name,
                remote_dir: String::new(),
                url: String::new(),
                status: "error".to_string(),
                message: "仅支持 .html / .htm 文件".to_string(),
                uploaded_at: now_stamp(),
            });
            continue;
        }

        let remote_dir = pick_remote_dir();
        let uploaded_at = now_stamp();
        let tmp_root = std::env::temp_dir().join(format!("jarporter-privacy-{remote_dir}"));
        let upload_result = (|| -> Result<(String, String), String> {
            if tmp_root.exists() {
                fs::remove_dir_all(&tmp_root).ok();
            }
            fs::create_dir_all(&tmp_root).map_err(|e| format!("创建临时目录失败: {e}"))?;
            let dest = tmp_root.join("index.html");
            fs::copy(&source, &dest).map_err(|e| format!("复制 HTML 失败: {e}"))?;

            run_ftp_upload_with(&tmp_root, &remote_dir, PRIVACY_FTP_HOST, None, "ops")?;
            let url = format!("{PRIVACY_PUBLIC_BASE}/{remote_dir}/");
            Ok((remote_dir.clone(), url))
        })();

        let _ = fs::remove_dir_all(&tmp_root);

        match upload_result {
            Ok((dir, url)) => {
                let id = dir.clone();
                let record = PrivacyUploadRecord {
                    id: id.clone(),
                    source_name: source_name.clone(),
                    remote_dir: dir.clone(),
                    url: url.clone(),
                    uploaded_at: uploaded_at.clone(),
                };
                if let Err(e) = prepend_history(record) {
                    crate::diag::diag_log("ops", &format!("写入历史失败（上传已成功）: {e}"));
                }
                crate::diag::diag_log("ops", &format!("✅ 隐私协议上传成功: {url}"));
                results.push(PrivacyUploadResult {
                    id,
                    source_name,
                    remote_dir: dir,
                    url,
                    status: "success".to_string(),
                    message: "上传成功".to_string(),
                    uploaded_at,
                });
            }
            Err(e) => {
                crate::diag::diag_log(
                    "ops",
                    &format!("❌ 隐私协议上传失败 file={source_name}: {e}"),
                );
                results.push(PrivacyUploadResult {
                    id: String::new(),
                    source_name,
                    remote_dir: String::new(),
                    url: String::new(),
                    status: "error".to_string(),
                    message: e,
                    uploaded_at,
                });
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::is_html_path;
    use std::path::Path;

    #[test]
    fn accepts_html_extensions() {
        assert!(is_html_path(Path::new("a.html")));
        assert!(is_html_path(Path::new("a.HTM")));
        assert!(!is_html_path(Path::new("a.txt")));
    }
}
