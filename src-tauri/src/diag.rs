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
    if let Err(e) = fs::create_dir_all(&log_dir) {
        // 仍 set 目录，便于 path 命令与后续 create 重试；stderr 提示一次
        eprintln!("[JarPorter][app] 诊断日志目录创建失败: {} ({e})", log_dir.display());
    }
    let _ = LOG_DIR.set(log_dir);
}

pub fn diagnostic_log_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

pub fn today_log_path() -> Option<PathBuf> {
    let now = chrono::Local::now();
    LOG_DIR
        .get()
        .map(|dir| dir.join(format!("diagnostic-{}.log", now.format("%Y-%m-%d"))))
}

fn lock_log() -> std::sync::MutexGuard<'static, ()> {
    // poison 后仍继续写文件，避免一次 panic 永久停日志
    LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 写入 stderr + 当天诊断文件。module 为小写模块名。
pub fn diag_log(module: &str, message: impl AsRef<str>) {
    // 单次 now：path 日期与行内时间戳一致，避免跨午夜 skew
    let now = chrono::Local::now();
    let line = format!("[JarPorter][{module}] {}", message.as_ref());
    eprintln!("{line}");

    let Some(dir) = LOG_DIR.get() else {
        return;
    };
    let path = dir.join(format!("diagnostic-{}.log", now.format("%Y-%m-%d")));
    let _ = fs::create_dir_all(dir); // 目录被删/init 失败时重试

    let _guard = lock_log();
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            let ts = now.format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(file, "[{ts}] {line}");
        }
        Err(e) => {
            // 文件写失败至少打一次可观测信号（stderr）；避免完全静默
            eprintln!("[JarPorter][app] 写入诊断文件失败 {}: {e}", path.display());
        }
    }
}

#[tauri::command]
pub async fn get_templates_diagnostic_log_path() -> Result<String, String> {
    today_log_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "诊断日志尚未初始化，请重启应用后再试".to_string())
}

/// 读取最近 ≤3 个按日诊断文件（及旧版单文件回退），**新日志在前**。
#[tauri::command]
pub async fn read_diagnostic_log(lines: Option<usize>) -> Result<String, String> {
    let max_lines = lines.unwrap_or(300);
    tauri::async_runtime::spawn_blocking(move || read_diagnostic_log_sync(max_lines))
        .await
        .map_err(|e| format!("读取日志任务异常: {e}"))?
}

fn read_diagnostic_log_sync(max_lines: usize) -> Result<String, String> {
    let dir = diagnostic_log_dir().ok_or_else(|| "诊断日志尚未初始化".to_string())?;
    let day_files = list_recent_day_files(&dir, 3);

    let mut all_lines: Vec<String> = Vec::new();
    let mut read_errors: Vec<String> = Vec::new();

    // 与写路径同锁，避免读到半行（持锁时间 = 读文件时长，可接受）
    let _guard = lock_log();

    if day_files.is_empty() {
        // 升级回退：尚无按日文件时展示旧 templates-diagnostic.log，避免系统日志空白
        let legacy = dir.join("templates-diagnostic.log");
        if legacy.is_file() {
            match fs::read_to_string(&legacy) {
                Ok(content) => {
                    all_lines.push(
                        "[JarPorter][app] （以下为升级前 templates-diagnostic.log，仅回退展示）"
                            .to_string(),
                    );
                    for line in content.lines() {
                        all_lines.push(line.to_string());
                    }
                }
                Err(e) => {
                    return Err(format!("读取旧诊断日志失败: {e}"));
                }
            }
        }
    } else {
        for path in &day_files {
            match fs::read_to_string(path) {
                Ok(content) => {
                    for line in content.lines() {
                        all_lines.push(line.to_string());
                    }
                }
                Err(e) => {
                    read_errors.push(format!("{}: {e}", path.display()));
                }
            }
        }
    }
    drop(_guard);

    if all_lines.is_empty() {
        if !read_errors.is_empty() {
            return Err(format!("读取日志失败: {}", read_errors.join("; ")));
        }
        return Ok(String::new());
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
            if is_yyyy_mm_dd(date) {
                items.push((date.to_string(), path));
            }
        }
    }
    items.sort_by(|a, b| a.0.cmp(&b.0));
    let skip = items.len().saturating_sub(max_days);
    items.into_iter().skip(skip).map(|(_, p)| p).collect()
}

fn is_yyyy_mm_dd(s: &str) -> bool {
    if s.len() != 10 || s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return false;
    }
    let y = &s[0..4];
    let m = &s[5..7];
    let d = &s[8..10];
    if !y.bytes().all(|b| b.is_ascii_digit())
        || !m.bytes().all(|b| b.is_ascii_digit())
        || !d.bytes().all(|b| b.is_ascii_digit())
    {
        return false;
    }
    let month: u8 = m.parse().unwrap_or(0);
    let day: u8 = d.parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
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
        fs::write(dir.join("diagnostic-xxxx-yy-zz.log"), "bad\n").unwrap();

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
    fn is_yyyy_mm_dd_rejects_garbage() {
        assert!(is_yyyy_mm_dd("2026-07-11"));
        assert!(!is_yyyy_mm_dd("xxxx-yy-zz"));
        assert!(!is_yyyy_mm_dd("2026-13-01"));
        assert!(!is_yyyy_mm_dd("2026-00-10"));
        assert!(!is_yyyy_mm_dd("2026-07-32"));
    }

    #[test]
    fn diag_log_format_contains_module() {
        let module = "updater";
        let message = "check_update: ok";
        let line = format!("[JarPorter][{module}] {message}");
        assert!(line.contains("[updater]"));
        assert!(line.starts_with("[JarPorter][updater]"));
    }
}
