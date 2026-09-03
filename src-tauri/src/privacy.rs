//! 隐私协议 HTML 上传（运营）：FTP 到 common.tiankongshuyu.cn，本地持久化历史。

use crate::landing::{
    landing_temp_root, require_privacy_ftp, run_ftp_download_file_with, run_ftp_upload_with,
};
use crate::models::APP_CONFIG_DIR;
use crate::preview_server::ensure_preview_server_started;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// 隐私 FTP 登录后的站点根主机名。逻辑 `remote_dir` 含此前缀，实际 CWD 需剥掉。
/// 公开域名（非账号密码）；连接主机/账号走用户配置。
const PRIVACY_FTP_SITE_HOST: &str = "common.tiankongshuyu.cn";
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyTarget {
    pub remote_dir: String,
    pub preview_url: String,
}

/// 访问地址 → FTP 目录：去掉协议后 `host[/path…]`（首尾 `/` 已剥除）。
pub fn parse_privacy_target_url_inner(raw: &str) -> Result<PrivacyTarget, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("请输入访问地址".into());
    }
    let with_scheme = if s.contains("://") {
        s.to_string()
    } else {
        format!("http://{s}")
    };
    let u = url::Url::parse(&with_scheme).map_err(|e| format!("无效地址: {e}"))?;
    let host = u
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "地址缺少域名".to_string())?
        .to_string();
    let path_trim = u.path().trim_matches('/');
    let remote_dir = if path_trim.is_empty() {
        host.clone()
    } else {
        format!("{host}/{path_trim}")
    };
    let preview_url = if path_trim.is_empty() {
        format!("{}://{}/", u.scheme(), host)
    } else {
        format!("{}://{}/{}/", u.scheme(), host, path_trim)
    };
    Ok(PrivacyTarget {
        remote_dir,
        preview_url,
    })
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
    format!("{PRIVACY_FTP_SITE_HOST}/{}{}", unix_secs(), word)
}

/// 将逻辑目录（host/path）转为 FTP 相对路径。
/// 实测登录根已在 common 站点内，不能再 CWD `common.tiankongshuyu.cn`。
fn ftp_cwd_path(remote_dir: &str) -> Result<String, String> {
    let dir = remote_dir.trim().trim_matches('/');
    if dir.is_empty() || dir.contains("..") {
        return Err("非法远端目录".into());
    }
    if dir == PRIVACY_FTP_SITE_HOST {
        return Ok(String::new());
    }
    let prefix = format!("{PRIVACY_FTP_SITE_HOST}/");
    if let Some(rest) = dir.strip_prefix(&prefix) {
        let rest = rest.trim_matches('/');
        if rest.is_empty() || rest.contains("..") {
            return Err("非法远端目录".into());
        }
        return Ok(rest.to_string());
    }
    Err(format!(
        "当前隐私 FTP 登录根为 {PRIVACY_FTP_SITE_HOST}，无法访问其它站点目录：{dir}"
    ))
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
pub async fn parse_privacy_target_url(url: String) -> Result<PrivacyTarget, String> {
    let t = parse_privacy_target_url_inner(&url)?;
    crate::diag::diag_log(
        "ops",
        &format!(
            "parse_privacy_target_url remote_dir={} preview_url={}",
            t.remote_dir, t.preview_url
        ),
    );
    Ok(t)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyFtpPreview {
    pub remote_dir: String,
    /// 相对预览根目录的路径，如 `privacy-ftp-preview/.../index.html`
    pub relative_path: String,
    /// 本地预览 HTTP 地址（127.0.0.1），不是公网链接
    pub preview_url: String,
}

fn privacy_ftp_preview_local_dir(remote_dir: &str) -> Result<PathBuf, String> {
    if remote_dir.contains("..") || remote_dir.trim().is_empty() {
        return Err("非法远端目录".into());
    }
    // 预览根复用 landing_temp_root，走现有 preview_server
    let safe = remote_dir
        .split('/')
        .filter(|p| !p.is_empty() && *p != "." && *p != "..")
        .collect::<Vec<_>>()
        .join("/");
    if safe.is_empty() {
        return Err("非法远端目录".into());
    }
    Ok(landing_temp_root()
        .join("privacy-ftp-preview")
        .join(safe))
}

/// 从 FTP 拉取远端目录 index.html，写入本地预览根，返回 127.0.0.1 预览地址。
#[tauri::command]
pub async fn preview_privacy_ftp(
    target_url: String,
    preview_state: tauri::State<'_, crate::preview_server::PreviewServerState>,
) -> Result<PrivacyFtpPreview, String> {
    let target = parse_privacy_target_url_inner(&target_url)?;
    let local_dir = privacy_ftp_preview_local_dir(&target.remote_dir)?;
    if local_dir.exists() {
        fs::remove_dir_all(&local_dir).ok();
    }
    fs::create_dir_all(&local_dir).map_err(|e| format!("创建预览目录失败: {e}"))?;
    let local_index = local_dir.join("index.html");

    crate::diag::diag_log(
        "ops",
        &format!(
            "preview_privacy_ftp remote_dir={} local={}",
            target.remote_dir,
            local_index.display()
        ),
    );

    let ftp_path = ftp_cwd_path(&target.remote_dir)?;
    crate::diag::diag_log(
        "ops",
        &format!(
            "preview_privacy_ftp ftp_cwd={} (logical={})",
            if ftp_path.is_empty() { "." } else { &ftp_path },
            target.remote_dir
        ),
    );
    let config = crate::config_cmd::load_config_sync()?;
    let (ftp_host, ftp_user, ftp_pass) = require_privacy_ftp(&config)?;
    run_ftp_download_file_with(
        &ftp_path,
        "index.html",
        &local_index,
        &ftp_host,
        &ftp_user,
        &ftp_pass,
        None,
        "ops",
    )?;

    if !local_index.is_file() {
        return Err("FTP 上下载成功但本地未找到 index.html".into());
    }

    let relative_path = format!(
        "privacy-ftp-preview/{}/index.html",
        target.remote_dir.trim_matches('/')
    );
    let preview_info = ensure_preview_server_started(preview_state)?;
    let preview_url = format!(
        "{}/{}",
        preview_info.base_url.trim_end_matches('/'),
        relative_path
            .split('/')
            .map(|s| {
                // 路径段编码，保留 /
                urlencoding_segment(s)
            })
            .collect::<Vec<_>>()
            .join("/")
    );

    crate::diag::diag_log("ops", &format!("preview_privacy_ftp ok url={preview_url}"));
    Ok(PrivacyFtpPreview {
        remote_dir: target.remote_dir,
        relative_path,
        preview_url,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyFtpDownload {
    pub remote_dir: String,
    pub local_path: String,
}

/// 从 FTP 下载远端目录的 index.html 到用户指定本地路径。
#[tauri::command]
pub async fn download_privacy_ftp(
    target_url: String,
    local_path: String,
) -> Result<PrivacyFtpDownload, String> {
    let target = parse_privacy_target_url_inner(&target_url)?;
    let dest = PathBuf::from(&local_path);
    if dest
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.trim().is_empty())
        .unwrap_or(true)
    {
        return Err("请指定本地保存文件路径".into());
    }

    let ftp_path = ftp_cwd_path(&target.remote_dir)?;
    crate::diag::diag_log(
        "ops",
        &format!(
            "download_privacy_ftp logical={} ftp_cwd={} local={}",
            target.remote_dir,
            if ftp_path.is_empty() { "." } else { &ftp_path },
            dest.display()
        ),
    );

    let config = crate::config_cmd::load_config_sync()?;
    let (ftp_host, ftp_user, ftp_pass) = require_privacy_ftp(&config)?;
    run_ftp_download_file_with(
        &ftp_path,
        "index.html",
        &dest,
        &ftp_host,
        &ftp_user,
        &ftp_pass,
        None,
        "ops",
    )?;

    if !dest.is_file() {
        return Err("下载完成但本地文件不存在".into());
    }

    crate::diag::diag_log(
        "ops",
        &format!("download_privacy_ftp ok path={}", dest.display()),
    );
    Ok(PrivacyFtpDownload {
        remote_dir: target.remote_dir,
        local_path: dest.to_string_lossy().to_string(),
    })
}

fn urlencoding_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[tauri::command]
pub async fn upload_privacy_html(
    paths: Vec<String>,
    target_url: Option<String>,
) -> Result<Vec<PrivacyUploadResult>, String> {
    if paths.is_empty() {
        return Err("请先选择 HTML 文件".to_string());
    }

    let overwrite = target_url
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let overwrite_target = if overwrite {
        Some(parse_privacy_target_url_inner(
            target_url.as_ref().unwrap().trim(),
        )?)
    } else {
        None
    };

    if let Some(t) = &overwrite_target {
        if paths.len() != 1 {
            return Err("覆盖模式仅支持单个 HTML 文件".into());
        }
        crate::diag::diag_log(
            "ops",
            &format!(
                "upload_privacy_html mode=overwrite remote_dir={} count=1",
                t.remote_dir
            ),
        );
    } else {
        crate::diag::diag_log(
            "ops",
            &format!("upload_privacy_html mode=create count={}", paths.len()),
        );
    }

    let config = crate::config_cmd::load_config_sync()?;
    let (ftp_host, ftp_user, ftp_pass) = require_privacy_ftp(&config)?;
    crate::diag::diag_log(
        "ops",
        &format!("privacy FTP host={} user={}", ftp_host, ftp_user),
    );

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

        let (remote_dir, public_url) = if let Some(t) = &overwrite_target {
            (t.remote_dir.clone(), t.preview_url.clone())
        } else {
            let dir = pick_remote_dir();
            let leaf = dir.rsplit('/').next().unwrap_or(dir.as_str());
            let url = format!("{PRIVACY_PUBLIC_BASE}/{leaf}/");
            (dir, url)
        };

        let uploaded_at = now_stamp();
        let tmp_key = remote_dir.replace('/', "_");
        let tmp_root = std::env::temp_dir().join(format!("jarporter-privacy-{tmp_key}"));
        let ftp_path = match ftp_cwd_path(&remote_dir) {
            Ok(p) => p,
            Err(e) => {
                results.push(PrivacyUploadResult {
                    id: String::new(),
                    source_name,
                    remote_dir: String::new(),
                    url: String::new(),
                    status: "error".to_string(),
                    message: e,
                    uploaded_at,
                });
                continue;
            }
        };
        crate::diag::diag_log(
            "ops",
            &format!(
                "privacy FTP host={} logical_dir={} ftp_cwd={}",
                ftp_host,
                remote_dir,
                if ftp_path.is_empty() { "." } else { &ftp_path }
            ),
        );
        let upload_result = (|| -> Result<(String, String), String> {
            if tmp_root.exists() {
                fs::remove_dir_all(&tmp_root).ok();
            }
            fs::create_dir_all(&tmp_root).map_err(|e| format!("创建临时目录失败: {e}"))?;
            let dest = tmp_root.join("index.html");
            fs::copy(&source, &dest).map_err(|e| format!("复制 HTML 失败: {e}"))?;

            run_ftp_upload_with(
                &tmp_root,
                &ftp_path,
                &ftp_host,
                &ftp_user,
                &ftp_pass,
                None,
                "ops",
            )?;
            Ok((remote_dir.clone(), public_url.clone()))
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
                let mode = if overwrite_target.is_some() {
                    "overwrite"
                } else {
                    "create"
                };
                crate::diag::diag_log(
                    "ops",
                    &format!("✅ 隐私协议上传成功 mode={mode} url={url}"),
                );
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
    use super::{ftp_cwd_path, is_html_path, parse_privacy_target_url_inner, pick_remote_dir};
    use std::path::Path;

    #[test]
    fn accepts_html_extensions() {
        assert!(is_html_path(Path::new("a.html")));
        assert!(is_html_path(Path::new("a.HTM")));
        assert!(!is_html_path(Path::new("a.txt")));
    }

    #[test]
    fn parse_common_with_dir() {
        let t = parse_privacy_target_url_inner("http://common.tiankongshuyu.cn/1785467601raven/")
            .expect("ok");
        assert_eq!(t.remote_dir, "common.tiankongshuyu.cn/1785467601raven");
        assert_eq!(t.preview_url, "http://common.tiankongshuyu.cn/1785467601raven/");
    }

    #[test]
    fn parse_subdomain_root() {
        let t = parse_privacy_target_url_inner("https://ythtpictorial.tiankongshuyu.cn/")
            .expect("ok");
        assert_eq!(t.remote_dir, "ythtpictorial.tiankongshuyu.cn");
        assert_eq!(t.preview_url, "https://ythtpictorial.tiankongshuyu.cn/");
    }

    #[test]
    fn parse_subdomain_nested() {
        let t = parse_privacy_target_url_inner("https://ythtpictorial.tiankongshuyu.cn/foo/bar/")
            .expect("ok");
        assert_eq!(t.remote_dir, "ythtpictorial.tiankongshuyu.cn/foo/bar");
        assert_eq!(t.preview_url, "https://ythtpictorial.tiankongshuyu.cn/foo/bar/");
    }

    #[test]
    fn parse_rejects_empty_and_garbage() {
        assert!(parse_privacy_target_url_inner("").is_err());
        assert!(parse_privacy_target_url_inner("   ").is_err());
        assert!(parse_privacy_target_url_inner("not a url").is_err());
    }

    #[test]
    fn pick_remote_dir_has_common_prefix() {
        let d = pick_remote_dir();
        assert!(
            d.starts_with("common.tiankongshuyu.cn/"),
            "got {d}"
        );
        assert!(!d.ends_with('/'));
    }

    #[test]
    fn ftp_cwd_strips_common_host_prefix() {
        assert_eq!(
            ftp_cwd_path("common.tiankongshuyu.cn/1785467601raven").unwrap(),
            "1785467601raven"
        );
        assert_eq!(ftp_cwd_path("common.tiankongshuyu.cn").unwrap(), "");
        assert!(ftp_cwd_path("ythtpictorial.tiankongshuyu.cn").is_err());
        assert!(ftp_cwd_path("ythtpictorial.tiankongshuyu.cn/foo").is_err());
    }
}
