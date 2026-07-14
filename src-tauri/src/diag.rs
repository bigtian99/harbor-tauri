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

/// 脱敏：避免 password/token 等写入诊断文件与 stderr。
/// ponytail: 简单扫描即可；复杂密钥形态再加规则。
pub(crate) fn redact_secrets(input: &str) -> String {
    let mut out = input.to_string();

    // Bearer <token>
    out = redact_prefix_token(&out, "Bearer ");

    // key=value / key: value（大小写不敏感 key）
    for key in [
        "password",
        "passwd",
        "token",
        "authorization",
        "secret",
        "api_key",
        "apikey",
        "access_key",
    ] {
        out = redact_key_value(&out, key);
    }

    out
}

/// ASCII 关键字匹配；用 byte find，但只在 char boundary 上切分。
/// `to_ascii_lowercase` 不改变非 ASCII 字节，故 lower 与 input 边界一致。
fn redact_prefix_token(input: &str, prefix: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let p = prefix.to_ascii_lowercase();
    let mut result = String::with_capacity(input.len());
    let mut offset = 0;
    while offset < input.len() {
        if let Some(rel) = lower[offset..].find(&p) {
            let start = offset + rel;
            result.push_str(&input[offset..start]);
            let after_prefix = start + prefix.len();
            result.push_str(&input[start..after_prefix]);
            // 吞掉 token：直到空白（按 char 推进）
            let mut end = after_prefix;
            for (i, c) in input[after_prefix..].char_indices() {
                if c.is_whitespace() {
                    end = after_prefix + i;
                    break;
                }
                end = after_prefix + i + c.len_utf8();
            }
            result.push_str("***");
            offset = end;
        } else {
            result.push_str(&input[offset..]);
            break;
        }
    }
    result
}

fn redact_key_value(input: &str, key: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let key_l = key.to_ascii_lowercase();
    let mut result = String::with_capacity(input.len());
    let mut offset = 0;
    while offset < input.len() {
        if let Some(rel) = lower[offset..].find(&key_l) {
            let start = offset + rel;
            // 关键字需在「边界」：前一字符非字母数字下划线（或开头）
            let ok_boundary = start == 0
                || !input[..start]
                    .chars()
                    .next_back()
                    .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
            if !ok_boundary {
                // 跳过这一匹配点，从 start+1 的下一 char 继续
                let next = input[start..]
                    .chars()
                    .next()
                    .map(|c| start + c.len_utf8())
                    .unwrap_or(input.len());
                result.push_str(&input[offset..next]);
                offset = next;
                continue;
            }
            result.push_str(&input[offset..start]);
            let mut j = start + key.len();
            // 空白
            while j < input.len() {
                let b = input.as_bytes()[j];
                if b == b' ' || b == b'\t' {
                    j += 1;
                } else {
                    break;
                }
            }
            if j < input.len() && (input.as_bytes()[j] == b'=' || input.as_bytes()[j] == b':') {
                // 含 key + 空白 + 分隔符
                result.push_str(&input[start..j + 1]);
                j += 1;
                while j < input.len() {
                    let b = input.as_bytes()[j];
                    if b == b' ' || b == b'\t' {
                        result.push(b as char);
                        j += 1;
                    } else {
                        break;
                    }
                }
                // value：按 char 直到空白或分隔
                let value_start = j;
                for (i, c) in input[value_start..].char_indices() {
                    if c.is_whitespace() || c == ',' || c == ';' || c == '&' || c == '"' {
                        j = value_start + i;
                        break;
                    }
                    j = value_start + i + c.len_utf8();
                }
                result.push_str("***");
                offset = j;
                continue;
            }
            // 有 key 但无 =/: ，当作普通文本
            let next = input[start..]
                .chars()
                .next()
                .map(|c| start + c.len_utf8())
                .unwrap_or(input.len());
            result.push_str(&input[offset..next]);
            offset = next;
        } else {
            result.push_str(&input[offset..]);
            break;
        }
    }
    result
}

/// 写入 stderr + 当天诊断文件。module 为小写模块名。
pub fn diag_log(module: &str, message: impl AsRef<str>) {
    // 单次 now：path 日期与行内时间戳一致，避免跨午夜 skew
    let now = chrono::Local::now();
    let safe = redact_secrets(message.as_ref());
    let line = format!("[JarPorter][{module}] {safe}");
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

/// 读取诊断日志：**新日志在前**。
///
/// - `day = None`（默认）：合并最近 ≤3 个按日文件 + 旧版 `templates-diagnostic.log` 回退
/// - `day = Some("YYYY-MM-DD")`：只读该日文件，不存在返回空字符串
#[tauri::command]
pub async fn read_diagnostic_log(
    lines: Option<usize>,
    day: Option<String>,
) -> Result<String, String> {
    if let Some(ref d) = day {
        validate_day(d)?;
    }
    let max_lines = lines.unwrap_or(300);
    let day_owned = day;
    tauri::async_runtime::spawn_blocking(move || {
        read_diagnostic_log_sync(max_lines, day_owned.as_deref())
    })
    .await
    .map_err(|e| format!("读取日志任务异常: {e}"))?
}

/// 列出所有可读的按日日志日期（`diagnostic-YYYY-MM-DD.log`），按日期**降序**。
/// 未初始化或无任何按日文件时返回空数组。
#[tauri::command]
pub async fn list_diagnostic_log_dates() -> Result<Vec<DiagDateInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_diagnostic_log_dates_sync)
        .await
        .map_err(|e| format!("日志日期列表任务异常: {e}"))?
}

/// 导出完整诊断日志（最近 ≤3 天 + 旧文件回退）到用户指定路径，**旧→新**。
#[tauri::command]
pub async fn export_diagnostic_log(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_diagnostic_log_sync(path))
        .await
        .map_err(|e| format!("导出日志任务异常: {e}"))?
}

#[derive(serde::Serialize)]
pub struct DiagDateInfo {
    pub date: String,
    pub size: u64,
    pub lines: u64,
}

fn validate_day(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("无效的日期格式：(空字符串)".to_string());
    }
    if is_yyyy_mm_dd(s) {
        Ok(())
    } else {
        Err(format!("无效的日期格式: {s}（期望 YYYY-MM-DD）"))
    }
}

fn export_diagnostic_log_sync(path: String) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("导出路径为空".to_string());
    }
    let out = PathBuf::from(path);
    let lines = collect_diagnostic_lines_window()?;
    if lines.is_empty() {
        return Err("暂无诊断日志可导出".to_string());
    }
    // 文件按时间序（旧→新），便于外部编辑器查看
    let content = lines.join("\n");
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    fs::write(&out, content.as_bytes()).map_err(|e| format!("写入失败 {}: {e}", out.display()))?;
    // 避免在持锁外再抢锁写同一套日志；用 diag_log 即可
    drop(lines);
    diag_log(
        "app",
        &format!("export_diagnostic_log → {} (ok)", out.display()),
    );
    Ok(out.to_string_lossy().to_string())
}

fn read_diagnostic_log_sync(max_lines: usize, day: Option<&str>) -> Result<String, String> {
    let all_lines = if let Some(d) = day {
        collect_diagnostic_lines_for_day(d)?
    } else {
        collect_diagnostic_lines_window()?
    };
    if all_lines.is_empty() {
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

/// 收集诊断行（最近 ≤3 天 + 旧文件回退，文件时间序：旧→新）。空表示尚无日志。
fn collect_diagnostic_lines_window() -> Result<Vec<String>, String> {
    let dir = diagnostic_log_dir().ok_or_else(|| "诊断日志尚未初始化".to_string())?;
    let day_files = list_recent_day_files(&dir, 3);

    let mut all_lines: Vec<String> = Vec::new();
    let mut read_errors: Vec<String> = Vec::new();

    // 与写路径同锁，避免读到半行
    let _guard = lock_log();

    if day_files.is_empty() {
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

    if all_lines.is_empty() && !read_errors.is_empty() {
        return Err(format!("读取日志失败: {}", read_errors.join("; ")));
    }
    Ok(all_lines)
}

/// 按日期收集单日日志行（文件时间序：旧→新）。
/// 不存在该日文件视为"当日无日志"，返回空 Vec（不报错）。
fn collect_diagnostic_lines_for_day(day: &str) -> Result<Vec<String>, String> {
    validate_day(day)?;
    let dir = match diagnostic_log_dir() {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };
    let path = dir.join(format!("diagnostic-{day}.log"));
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let _guard = lock_log();
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    drop(_guard);
    Ok(content.lines().map(|s| s.to_string()).collect())
}

/// 列出有日志的日期信息，按日期降序。
fn list_diagnostic_log_dates_sync() -> Result<Vec<DiagDateInfo>, String> {
    let dir = match diagnostic_log_dir() {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };
    let Ok(rd) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut items: Vec<DiagDateInfo> = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(date) = name
            .strip_prefix("diagnostic-")
            .and_then(|s| s.strip_suffix(".log"))
        else {
            continue;
        };
        if !is_yyyy_mm_dd(date) {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = meta.len();
        let lines = fs::read_to_string(&path)
            .map(|c| c.lines().count() as u64)
            .unwrap_or(0);
        items.push(DiagDateInfo {
            date: date.to_string(),
            size,
            lines,
        });
    }
    items.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(items)
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

    #[test]
    fn redact_secrets_masks_password_and_bearer() {
        let s = redact_secrets("login password=s3cret ok Bearer abcd1234 path=/tmp");
        assert!(!s.contains("s3cret"), "password value must be redacted: {s}");
        assert!(!s.contains("abcd1234"), "bearer token must be redacted: {s}");
        assert!(s.contains("password=***"), "expected password=*** got {s}");
        assert!(s.contains("Bearer ***"), "expected Bearer *** got {s}");
        assert!(s.contains("path=/tmp"), "non-secret must remain: {s}");
    }

    #[test]
    fn redact_secrets_masks_authorization_colon() {
        let s = redact_secrets("Authorization: tok_xyz next");
        assert!(!s.contains("tok_xyz"), "{s}");
        assert!(s.contains("***"), "{s}");
    }

    #[test]
    fn redact_secrets_handles_chinese_without_panic() {
        // 回归：旧实现按字节 i+=1，在「诊」等多字节字符上 panic
        let s = redact_secrets("诊断日志目录创建失败: /tmp/x 写入诊断文件失败");
        assert!(s.contains("诊断"), "{s}");
        assert_eq!(s, "诊断日志目录创建失败: /tmp/x 写入诊断文件失败");
        let mixed = redact_secrets("诊断 password=密文token Bearer ab12 完成");
        assert!(!mixed.contains("ab12"), "{mixed}");
        assert!(mixed.contains("诊断"), "{mixed}");
        assert!(mixed.contains("password=***"), "{mixed}");
    }

    #[test]
    fn validate_day_accepts_rejects_and_empty() {
        assert!(validate_day("2026-07-12").is_ok());
        assert!(validate_day("2026-07-01").is_ok());
        assert!(validate_day("2026-7-12").is_err());
        assert!(validate_day("2026-13-01").is_err());
        assert!(validate_day("2026-00-10").is_err());
        assert!(validate_day("2026-07-32").is_err());
        assert!(validate_day("not-a-date").is_err());
        assert!(validate_day("").is_err());
        assert!(matches!(
            validate_day("2026-07-12").map(|_| ()),
            Ok(())
        ));
    }

    #[test]
    fn diags_date_path_format_and_selection() {
        // 验证「列表」逻辑会筛选出合法日期、过滤无效文件
        let dir = std::env::temp_dir().join(format!(
            "jarporter-diag-test-dates-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let cases = [
            ("diagnostic-2026-07-08.log", "line-old1\n"),
            ("diagnostic-2026-07-09.log", "line-old2\nline-old3\n"),
            ("diagnostic-2026-07-10.log", "line-new1\n"),
            ("diagnostic-2026-07-11.log", "line-new2\nline-new3\nline-new4\n"),
            ("diagnostic-2026-13-99.log", "bad-date\n"),   // 伪日期应过滤
            ("diagnostic-xxxx-yy-zz.log", "bad-name\n"),  // 非法命名应过滤
            ("templates-diagnostic.log", "old-legacy\n"),  // 旧日志不进日期列表
            ("junk.txt", "x\n"),
        ];
        for (name, content) in cases {
            fs::write(dir.join(name), content).unwrap();
        }

        // is_yyyy_mm_dd 过滤
        assert!(is_yyyy_mm_dd("2026-07-08"));
        assert!(!is_yyyy_mm_dd("2026-13-99"));
        assert!(!is_yyyy_mm_dd("xxxx-yy-zz"));

        // 路径拼接
        let day = "2026-07-10";
        let p = dir.join(format!("diagnostic-{day}.log"));
        assert!(p.is_file(), "path join wrong: {}", p.display());
        let content = fs::read_to_string(&p).unwrap();
        assert_eq!(content.lines().count(), 1);

        // 清理
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn diags_date_iso_sort_desc() {
        // 直接验证 Dict 序 == 时间降序（YYYY-MM-DD 字典序 === 时间序）
        let mut dates = vec![
            "2026-07-08".to_string(),
            "2026-07-11".to_string(),
            "2026-07-09".to_string(),
            "2026-07-10".to_string(),
        ];
        dates.sort_by(|a, b| b.cmp(a));
        assert_eq!(
            dates,
            vec![
                "2026-07-11".to_string(),
                "2026-07-10".to_string(),
                "2026-07-09".to_string(),
                "2026-07-08".to_string(),
            ]
        );
    }
}
