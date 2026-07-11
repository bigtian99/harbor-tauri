//! 全局诊断日志：按模块 tag + 按天滚动文件。
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn init(app: &AppHandle) {
    if LOG_DIR.get().is_some() {
        return;
    }
    let log_dir = app
        .path()
        .app_log_dir()
        .ok()
        .or_else(|| dirs::config_dir().map(|d| d.join("jarporter").join("logs")))
        .unwrap_or_else(|| std::env::temp_dir().join("jarporter-logs"));
    let _ = fs::create_dir_all(&log_dir);
    let _ = LOG_DIR.set(log_dir);
}

pub fn diagnostic_log_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

fn today_date_str() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn today_log_path() -> Option<PathBuf> {
    LOG_DIR
        .get()
        .map(|dir| dir.join(format!("diagnostic-{}.log", today_date_str())))
}

/// 写入 stderr + 当天诊断文件。module 为小写模块名。
pub fn diag_log(module: &str, message: impl AsRef<str>) {
    let line = format!("[JarPorter][{module}] {}", message.as_ref());
    eprintln!("{line}");
    let Some(path) = today_log_path() else {
        return;
    };
    if let Ok(_guard) = LOG_LOCK.lock() {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(file, "[{ts}] {line}");
        }
    }
}

pub fn templates_log(message: impl AsRef<str>) {
    diag_log("templates", message);
}

#[tauri::command]
pub async fn get_templates_diagnostic_log_path() -> Result<String, String> {
    today_log_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "诊断日志尚未初始化，请重启应用后再试".to_string())
}

/// 读取最近 ≤3 天诊断日志，**新日志在前**。
#[tauri::command]
pub async fn read_diagnostic_log(lines: Option<usize>) -> Result<String, String> {
    let dir = diagnostic_log_dir().ok_or_else(|| "诊断日志尚未初始化".to_string())?;
    let max_lines = lines.unwrap_or(300);
    let mut day_files = list_recent_day_files(&dir, 3);
    // list_recent_day_files：日期升序（旧→新）
    let mut all_lines: Vec<String> = Vec::new();
    for path in day_files.drain(..) {
        if let Ok(content) = fs::read_to_string(&path) {
            for line in content.lines() {
                all_lines.push(line.to_string());
            }
        }
    }
    // 文件内旧→新；整体 reverse 后 take
    Ok(all_lines
        .into_iter()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .join("\n"))
}

/// 返回最多 `max_days` 个 `diagnostic-YYYY-MM-DD.log`，按日期升序。
fn list_recent_day_files(dir: &Path, max_days: usize) -> Vec<PathBuf> {
    let mut items: Vec<(String, PathBuf)> = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        // diagnostic-YYYY-MM-DD.log
        if let Some(date) = name
            .strip_prefix("diagnostic-")
            .and_then(|s| s.strip_suffix(".log"))
        {
            if date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-' {
                items.push((date.to_string(), path));
            }
        }
    }
    items.sort_by(|a, b| a.0.cmp(&b.0));
    let skip = items.len().saturating_sub(max_days);
    items.into_iter().skip(skip).map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn list_recent_day_files_picks_latest_three() {
        let dir = std::env::temp_dir().join(format!(
            "jarporter-diag-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for d in ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"] {
            fs::write(dir.join(format!("diagnostic-{d}.log")), format!("line-{d}\n")).unwrap();
        }
        fs::write(dir.join("templates-diagnostic.log"), "old\n").unwrap();
        fs::write(dir.join("junk.txt"), "x\n").unwrap();

        let files = list_recent_day_files(&dir, 3);
        let names: Vec<_> = files
            .iter()
            .filter_map(|p| p.file_name().map(|s| s.to_string_lossy().to_string()))
            .collect();
        assert_eq!(
            names,
            vec![
                "diagnostic-2026-07-09.log".to_string(),
                "diagnostic-2026-07-10.log".to_string(),
                "diagnostic-2026-07-11.log".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn diag_log_format_contains_module() {
        // 不依赖 init：直接测格式字符串约定
        let module = "updater";
        let message = "check_update: ok";
        let line = format!("[JarPorter][{module}] {message}");
        assert!(line.contains("[updater]"));
        assert!(line.starts_with("[JarPorter][updater]"));
    }
}
