use crate::models::{FtpUploadItem, FtpUploadResult, LandingPageResult, SubChannelApiResponse, SubChannelData};
use crate::utils::{copy_dir_recursive, render_template};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

const FTP_HOST: &str = "120.77.204.231";
const FTP_USER: &str = "admin";
const FTP_PASS: &str = "pcm520..";
const FTP_BASE_DIR: &str = "common.tiankongshuyu.fun";

#[tauri::command]
pub async fn fetch_sub_channels(api_url: String, ids: String) -> Result<Vec<SubChannelData>, String> {
    let url = format!("{}/api/sub-channel/list?ids={}", api_url.trim_end_matches('/'), ids);
    eprintln!("[JarPorter] 请求渠道数据: {}", url);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let api_response: SubChannelApiResponse = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if api_response.code != Some(200) {
        return Err(format!(
            "API 返回错误: code={:?}, message={:?}",
            api_response.code, api_response.message
        ));
    }

    Ok(api_response.data.unwrap_or_default())
}

#[tauri::command]
pub async fn generate_landing_pages(
    app: tauri::AppHandle,
    api_url: String,
    ids: String,
    template_base: String,
    output_dir: String,
) -> Result<Vec<LandingPageResult>, String> {
    let mut results: Vec<LandingPageResult> = Vec::new();

    // Step 1: 获取子渠道数据
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 10,
            "message": "📡 获取子渠道数据..."
        }),
    ).ok();

    let sub_channels = match fetch_sub_channels(api_url.clone(), ids.clone()).await {
        Ok(data) => data,
        Err(e) => {
            return Err(format!("获取渠道数据失败: {}", e));
        }
    };

    if sub_channels.is_empty() {
        return Err("未获取到任何渠道数据，请检查 ID 是否正确".to_string());
    }

    let total = sub_channels.len();
    eprintln!("[JarPorter] 开始生成 {} 个落地页", total);
    let gen_base = if template_base.trim().is_empty() {
        templates_root()
    } else {
        PathBuf::from(template_base.trim())
    };
    templates_log(&format!(
        "generate_landing_pages base={} — {}",
        gen_base.display(),
        summarize_templates_dir(&gen_base)
    ));

    // 确保输出目录存在
    let output_base = Path::new(&output_dir);
    fs::create_dir_all(output_base)
        .map_err(|e| format!("创建输出目录失败: {}", e))?;

    for (i, channel) in sub_channels.iter().enumerate() {
        let progress = 20 + ((i as f64 / total as f64) * 70.0) as i32;
        let safe_name = channel.sub_channel_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let channel_output_dir = output_base.join(format!("{}_{}", safe_name, channel.id));
        let channel_output_str = channel_output_dir.display().to_string();

        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": progress,
                "message": format!("📝 [{}/{}] 生成落地页: {}", i + 1, total, channel.sub_channel_name),
            }),
        ).ok();

        // 查找所有匹配的模板目录（以 type_code 开头的目录）
        let base = if template_base.trim().is_empty() {
            templates_root()
        } else {
            PathBuf::from(template_base.trim())
        };
        let template_base_path = base.as_path();
        let mut template_dirs: Vec<PathBuf> = Vec::new();
        if let Ok(entries) = fs::read_dir(template_base_path) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == channel.type_code || name.starts_with(&format!("{}-", channel.type_code)) {
                    if entry.path().is_dir() {
                        template_dirs.push(entry.path());
                    }
                }
            }
        }
        template_dirs.sort();

        if template_dirs.is_empty() {
            let available = list_template_subdirs(template_base_path);
            templates_log(&format!(
                "生成失败 channel={} type_code={} base={} — 无匹配模板；当前 base 下可用: [{}]",
                channel.sub_channel_name,
                channel.type_code,
                template_base_path.display(),
                if available.is_empty() {
                    "无".to_string()
                } else {
                    available.join(", ")
                }
            ));
            results.push(LandingPageResult {
                id: channel.id.clone(),
                type_code: channel.type_code.clone(),
                name: channel.sub_channel_name.clone(),
                output_dir: channel_output_str,
                status: "error".to_string(),
                message: format!("没有找到 {} 类型的模板目录", channel.type_code),
                template_dirs: Vec::new(),
                current_template_index: 0,
            });
            continue;
        }

        let template_dir_strs: Vec<String> = template_dirs.iter()
            .map(|p| p.display().to_string())
            .collect();

        // 为所有模板创建输出目录并生成
        let mut all_success = true;
        let mut error_message = String::new();
        let mut first_template_output = PathBuf::new();

        for (idx, template) in template_dirs.iter().enumerate() {
            let template_output = channel_output_dir.join(format!("template_{}", idx));
            if idx == 0 {
                first_template_output = template_output.clone();
            }

            eprintln!(
                "[JarPorter] 复制模板 {}: {} -> {}",
                idx, template.display(), template_output.display()
            );

            // 复制模板目录
            if let Err(e) = copy_dir_recursive(template, &template_output) {
                all_success = false;
                error_message = format!("复制模板 {} 失败: {}", idx, e);
                eprintln!("[JarPorter] ❌ {}", error_message);
                break;
            }

            // 验证复制结果
            if template_output.exists() {
                let entries: Vec<String> = fs::read_dir(&template_output)
                    .map(|entries| {
                        entries
                            .flatten()
                            .map(|e| e.file_name().to_string_lossy().to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                eprintln!(
                    "[JarPorter] ✅ 模板 {} 复制完成，内容: {:?}",
                    idx, entries
                );
            }

            // 修改 index.html
            let html_path = template_output.join("index.html");
            if !html_path.exists() {
                all_success = false;
                error_message = format!("模板 {} 中未找到 index.html", idx);
                break;
            }

            match fs::read_to_string(&html_path) {
                Ok(content) => {
                    let new_content = render_template(&content, &[
                        ("NAME", channel.sub_channel_name.clone()),
                        ("LOGO", channel.sub_channel_logo.clone().unwrap_or_default()),
                        ("DOWNLOAD_URL", channel.sub_channel_link.clone().unwrap_or_default()),
                    ]);
                    if let Err(e) = fs::write(&html_path, &new_content) {
                        all_success = false;
                        error_message = format!("写入模板 {} 文件失败: {}", idx, e);
                        break;
                    }
                }
                Err(e) => {
                    all_success = false;
                    error_message = format!("读取模板 {} index.html 失败: {}", idx, e);
                    break;
                }
            }
        }

        if !all_success {
            results.push(LandingPageResult {
                id: channel.id.clone(),
                type_code: channel.type_code.clone(),
                name: channel.sub_channel_name.clone(),
                output_dir: channel_output_str,
                status: "error".to_string(),
                message: error_message,
                template_dirs: template_dir_strs,
                current_template_index: 0,
            });
        } else {
            // 验证生成的文件是否可读
            let verify_index = first_template_output.join("index.html");
            let file_exists = verify_index.exists();
            let file_size = fs::metadata(&verify_index).map(|m| m.len()).unwrap_or(0);
            eprintln!(
                "[JarPorter] ✅ 落地页生成成功: {} | output_dir={} | templates={} | index.html exists={} size={}",
                channel.sub_channel_name, channel_output_str, template_dirs.len(), file_exists, file_size
            );
            results.push(LandingPageResult {
                id: channel.id.clone(),
                type_code: channel.type_code.clone(),
                name: channel.sub_channel_name.clone(),
                output_dir: channel_output_str,
                status: "success".to_string(),
                message: "生成成功".to_string(),
                template_dirs: template_dir_strs,
                current_template_index: 0,
            });
        }
    }

    let success_count = results.iter().filter(|r| r.status == "success").count();
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": format!("✅ 完成! 成功 {} / {}", success_count, total),
        }),
    ).ok();

    Ok(results)
}

// ========== FTP 上传功能 ==========

/// 生成 Python FTP 上传脚本并执行（带重试）
pub(crate) fn run_ftp_upload(
    local_dir: &Path,
    remote_dir: &str,
) -> Result<(), String> {
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        match run_ftp_upload_once(local_dir, remote_dir) {
            Ok(()) => return Ok(()),
            Err(e) => {
                eprintln!("[JarPorter] ⚠️ 上传失败 (第{}次): {}", attempt, e);
                last_error = e;
                if attempt < max_retries {
                    eprintln!("[JarPorter] ⏳ 等待 2 秒后重试...");
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
    }

    Err(format!("上传失败（已重试{}次）: {}", max_retries, last_error))
}

/// 单次上传
fn run_ftp_upload_once(
    local_dir: &Path,
    remote_dir: &str,
) -> Result<(), String> {
    let local_dir_str = local_dir.to_string_lossy().replace('\\', "\\\\");
    let python_script = format!(
        r#"
import os
import sys
from ftplib import FTP

def safe_cwd(ftp, dirname):
    if not dirname or not isinstance(dirname, str):
        return False
    try:
        ftp.cwd(dirname)
        return True
    except Exception:
        return False

def ensure_dir(ftp, dirname):
    if not dirname:
        return
    parts = dirname.split('/')
    for part in parts:
        if not part:
            continue
        if safe_cwd(ftp, part):
            continue
        try:
            ftp.mkd(part)
            safe_cwd(ftp, part)
        except Exception:
            pass

def upload_dir(ftp, local_path, remote_path):
    for name in os.listdir(local_path):
        if not name or name.startswith('.'):
            continue
        local_child = os.path.join(local_path, name)
        if os.path.isdir(local_child):
            ensure_dir(ftp, name)
            upload_dir(ftp, local_child, os.path.join(remote_path, name))
            safe_cwd(ftp, '..')
        elif os.path.isfile(local_child):
            size = os.path.getsize(local_child)
            print('UPLOAD:' + name + ':' + str(size), flush=True)
            with open(local_child, 'rb') as f:
                ftp.storbinary('STOR ' + name, f)
            print('DONE:' + name, flush=True)

try:
    ftp = FTP()
    ftp.connect('{ftp_host}', timeout=10)
    ftp.login('{ftp_user}', '{ftp_pass}')
    print('CONNECTED', flush=True)

    safe_cwd(ftp, '{ftp_base_dir}')
    ensure_dir(ftp, '{remote_dir}')
    upload_dir(ftp, '{local_dir}', '{remote_dir}')
    ftp.quit()
    print('SUCCESS', flush=True)
except Exception as e:
    print('ERROR:' + str(e), flush=True)
    sys.exit(1)
"#,
        ftp_host = FTP_HOST,
        ftp_user = FTP_USER,
        ftp_pass = FTP_PASS,
        ftp_base_dir = FTP_BASE_DIR,
        remote_dir = remote_dir,
        local_dir = local_dir_str,
    );

    let output = Command::new("python3")
        .arg("-c")
        .arg(&python_script)
        .output()
        .map_err(|e| format!("执行 Python 脚本失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    eprintln!("[JarPorter] 🐍 Python 输出:\n{}", stdout);
    if !stderr.is_empty() {
        eprintln!("[JarPorter] 🐍 Python 错误:\n{}", stderr);
    }

    if !output.status.success() {
        return Err(format!("Python FTP 上传失败:\n{}", stdout));
    }

    if stdout.contains("ERROR:") {
        return Err(format!("Python FTP 上传失败:\n{}", stdout));
    }

    Ok(())
}

#[tauri::command]
pub async fn upload_landing_to_ftp(
    app: tauri::AppHandle,
    items: Vec<FtpUploadItem>,
) -> Result<Vec<FtpUploadResult>, String> {
    use std::sync::{Arc, Mutex};

    let total = items.len();

    app.emit("build-progress", serde_json::json!({
        "percent": 0,
        "message": format!("📤 准备上传 {} 个文件...", total)
    })).ok();

    // 并行上传，限制并发数为 3
    let max_concurrent = 3;
    let completed = Arc::new(Mutex::new(0));
    let mut handles: Vec<Option<std::thread::JoinHandle<FtpUploadResult>>> = Vec::new();

    for (_idx, item) in items.iter().enumerate() {
        // 控制并发数：等待一个完成后再启动新的
        if handles.len() >= max_concurrent {
            if let Some(handle) = handles.remove(0) {
                let _ = handle.join();
            }
        }

        let app_clone = app.clone();
        let item_clone = item.clone();
        let total_clone = total;
        let completed_clone = completed.clone();

        let handle = std::thread::spawn(move || {
            let local_dir = PathBuf::from(&item_clone.local_dir);
            if !local_dir.is_dir() {
                eprintln!("[JarPorter] ❌ 本地目录不存在: {}", item_clone.local_dir);
                // 即使失败也更新进度
                let mut c = completed_clone.lock().unwrap();
                *c += 1;
                let progress = ((*c as f64 / total_clone as f64) * 100.0) as i32;
                drop(c);
                app_clone.emit("build-progress", serde_json::json!({
                    "percent": progress,
                    "message": format!("📤 [{}/{}] 完成", *completed_clone.lock().unwrap(), total_clone),
                })).ok();
                return FtpUploadResult {
                    id: item_clone.id.clone(),
                    url: String::new(),
                    status: "error".to_string(),
                    message: format!("本地目录不存在: {}", item_clone.local_dir),
                };
            }

            eprintln!("[JarPorter] 📤 上传: {}", item_clone.remote_dir);

            let result = match run_ftp_upload(&local_dir, &item_clone.remote_dir) {
                Ok(()) => {
                    let url = format!("https://{}/{}/", FTP_BASE_DIR, &item_clone.remote_dir);
                    eprintln!("[JarPorter] ✅ 上传成功: {}", url);
                    FtpUploadResult {
                        id: item_clone.id.clone(),
                        url,
                        status: "success".to_string(),
                        message: "上传成功".to_string(),
                    }
                }
                Err(e) => {
                    eprintln!("[JarPorter] ❌ 上传失败: {}", e);
                    FtpUploadResult {
                        id: item_clone.id.clone(),
                        url: String::new(),
                        status: "error".to_string(),
                        message: e,
                    }
                }
            };

            // 更新完成计数和进度
            let mut c = completed_clone.lock().unwrap();
            *c += 1;
            let progress = ((*c as f64 / total_clone as f64) * 100.0) as i32;
            let current = *c;
            drop(c);
            app_clone.emit("build-progress", serde_json::json!({
                "percent": progress,
                "message": format!("📤 [{}/{}] 完成", current, total_clone),
            })).ok();

            result
        });
        handles.push(Some(handle));
    }

    // 等待剩余线程完成
    let mut results = Vec::new();
    for handle in handles.into_iter().flatten() {
        if let Ok(result) = handle.join() {
            results.push(result);
        }
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ FTP 上传完成！",
        }),
    )
    .ok();

    Ok(results)
}

/// 落地页生成的临时输出根目录。
/// 预览服务器（preview_server）与本命令共用这一处定义，避免根目录出现两个真相源导致 404。
pub(crate) fn landing_temp_root() -> PathBuf {
    std::env::temp_dir().join("jarporter-landing-pages")
}

#[tauri::command]
pub async fn get_temp_dir() -> Result<String, String> {
    Ok(landing_temp_root().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn preview_landing_page(path: String, template_index: Option<usize>) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let template_idx = template_index.unwrap_or(0);
    let mut html_path = path_buf.join(format!("template_{}", template_idx)).join("index.html");

    // 如果指定的模板路径不存在，尝试查找 template_0
    if !html_path.exists() {
        html_path = path_buf.join("template_0").join("index.html");
    }

    // 如果 template_0 也不存在，尝试直接查找 index.html（兼容旧格式）
    if !html_path.exists() {
        html_path = path_buf.join("index.html");
    }

    if !html_path.exists() {
        return Err(format!("文件不存在: {}", html_path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&html_path)
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", &html_path.to_string_lossy()])
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&html_path)
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    Ok(())
}

// ========== 模板目录解析 ==========
//
// 与 tauri.conf.json → bundle.resources 中的 `"../templates/**/*"` 对应；
// 必须通过 PathResolver 解析，禁止按 exe 路径手工猜测。

/// bundle.resources 里声明的模板根路径（与 tauri.conf.json 保持一致）
const BUNDLE_TEMPLATES_RESOURCE: &str = "../templates";

static BUNDLED_TEMPLATES_DIR: OnceLock<PathBuf> = OnceLock::new();
static TEMPLATES_LOG_FILE: OnceLock<PathBuf> = OnceLock::new();
static TEMPLATES_LOG_LOCK: Mutex<()> = Mutex::new(());

/// 打包后 GUI 无控制台，诊断日志同时写入此文件（app_log_dir/templates-diagnostic.log）。
fn init_templates_log_file(app: &AppHandle) -> PathBuf {
    let log_dir = app
        .path()
        .app_log_dir()
        .ok()
        .or_else(|| dirs::config_dir().map(|d| d.join("jarporter").join("logs")))
        .unwrap_or_else(|| std::env::temp_dir().join("jarporter-logs"));

    let _ = fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("templates-diagnostic.log");
    let _ = TEMPLATES_LOG_FILE.set(log_path.clone());
    log_path
}

pub(crate) fn templates_diagnostic_log_path() -> Option<PathBuf> {
    TEMPLATES_LOG_FILE.get().cloned()
}

fn templates_log(message: impl AsRef<str>) {
    let line = format!("[JarPorter][templates] {}", message.as_ref());
    eprintln!("{line}");
    if let Some(path) = TEMPLATES_LOG_FILE.get() {
        if let Ok(_guard) = TEMPLATES_LOG_LOCK.lock() {
            if let Ok(mut file) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
            {
                let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                let _ = writeln!(file, "[{ts}] {line}");
            }
        }
    }
}

fn list_template_subdirs(root: &Path) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    dirs.push(name);
                }
            }
        }
    }
    dirs.sort();
    dirs
}

/// 描述某目录下的模板子目录数量与名称（用于诊断日志）
fn summarize_templates_dir(path: &Path) -> String {
    if !path.exists() {
        return "目录不存在".to_string();
    }
    if !path.is_dir() {
        return format!("存在但不是目录 (is_file={})", path.is_file());
    }
    match fs::read_dir(path) {
        Err(e) => return format!("无法读取目录: {e}"),
        Ok(_) => {}
    }
    let dirs = list_template_subdirs(path);
    if dirs.is_empty() {
        return "目录可读但无模板子目录".to_string();
    }
    let preview: Vec<String> = dirs.iter().take(10).cloned().collect();
    let suffix = if dirs.len() > 10 {
        format!(", ... 共 {} 个", dirs.len())
    } else {
        String::new()
    };
    format!("子目录 {} 个: [{}]{suffix}", dirs.len(), preview.join(", "))
}

fn log_templates_startup_diagnostics(app: &AppHandle) {
    templates_log("========== 启动诊断 ==========");
    templates_log(&format!(
        "build={} resource_key=\"{}\"",
        if cfg!(debug_assertions) { "debug" } else { "release" },
        BUNDLE_TEMPLATES_RESOURCE
    ));

    match std::env::current_exe() {
        Ok(exe) => templates_log(&format!("current_exe={}", exe.display())),
        Err(e) => templates_log(&format!("current_exe=读取失败: {e}")),
    }

    match app.path().resource_dir() {
        Ok(dir) => templates_log(&format!("resource_dir={}", dir.display())),
        Err(e) => templates_log(&format!("resource_dir=解析失败: {e}")),
    }

    match app
        .path()
        .resolve(BUNDLE_TEMPLATES_RESOURCE, BaseDirectory::Resource)
    {
        Ok(path) => {
            templates_log(&format!(
                "resolve(\"{}\")={} exists={} is_dir={}",
                BUNDLE_TEMPLATES_RESOURCE,
                path.display(),
                path.exists(),
                path.is_dir()
            ));
            templates_log(&format!("  → {}", summarize_templates_dir(&path)));
        }
        Err(e) => templates_log(&format!(
            "resolve(\"{}\")=失败: {e}",
            BUNDLE_TEMPLATES_RESOURCE
        )),
    }

    let dev = dev_templates_dir();
    templates_log(&format!(
        "dev_fallback={} exists={} is_dir={}",
        dev.display(),
        dev.exists(),
        dev.is_dir()
    ));
    if dev.exists() {
        templates_log(&format!("  → {}", summarize_templates_dir(&dev)));
    }

    let writable = writable_templates_root();
    templates_log(&format!(
        "writable_root={} exists={}",
        writable.display(),
        writable.exists()
    ));
    if writable.exists() {
        templates_log(&format!("  → {}", summarize_templates_dir(&writable)));
    }
}

/// 启动时用 Tauri PathResolver 解析 bundle.resources（与打包器同一套规则）。
pub fn init_bundled_templates_dir(app: &AppHandle) {
    if BUNDLED_TEMPLATES_DIR.get().is_some() {
        templates_log("init 跳过：模板目录已初始化");
        return;
    }

    let log_path = init_templates_log_file(app);
    templates_log(&format!(
        "诊断日志文件: {}（打包版无控制台时可打开此文件排查）",
        log_path.display()
    ));

    log_templates_startup_diagnostics(app);

    match app
        .path()
        .resolve(BUNDLE_TEMPLATES_RESOURCE, BaseDirectory::Resource)
    {
        Ok(path) if dir_has_template_subdirs(&path) => {
            let summary = summarize_templates_dir(&path);
            let _ = BUNDLED_TEMPLATES_DIR.set(path.clone());
            templates_log(&format!(
                "✅ 使用打包模板: {} (resolve \"{}\")",
                path.display(),
                BUNDLE_TEMPLATES_RESOURCE
            ));
            templates_log(&format!("  → {summary}"));
        }
        Ok(path) => {
            templates_log(&format!(
                "⚠️ resolve 成功但无可用模板: {} — {}",
                path.display(),
                summarize_templates_dir(&path)
            ));
            try_dev_templates_fallback();
        }
        Err(e) => {
            templates_log(&format!(
                "⚠️ resolve 失败 (key=\"{}\"): {e}",
                BUNDLE_TEMPLATES_RESOURCE
            ));
            try_dev_templates_fallback();
        }
    }

    match BUNDLED_TEMPLATES_DIR.get() {
        Some(path) => templates_log(&format!("init 结果: OK → {}", path.display())),
        None => templates_log(
            "init 结果: FAILED — 未找到模板目录；请检查 tauri.conf.json bundle.resources 与安装包内资源文件",
        ),
    }
    templates_log("========== 诊断结束 ==========");
}

/// 仅 debug 构建：回退到源码树 templates/（cargo tauri dev 场景，非运行时猜路径）。
fn try_dev_templates_fallback() {
    if !cfg!(debug_assertions) {
        templates_log("dev 回退跳过：release 构建不使用源码 templates");
        return;
    }
    let dev = dev_templates_dir();
    if dir_has_template_subdirs(&dev) {
        let _ = BUNDLED_TEMPLATES_DIR.set(dev.clone());
        templates_log(&format!(
            "✅ dev 回退成功: {} — {}",
            dev.display(),
            summarize_templates_dir(&dev)
        ));
    } else {
        templates_log(&format!(
            "dev 回退失败: {} — {}",
            dev.display(),
            summarize_templates_dir(&dev)
        ));
    }
}

fn dir_has_template_subdirs(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    fs::read_dir(path)
        .map(|entries| {
            entries.flatten().any(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && !e.file_name().to_string_lossy().starts_with('.')
            })
        })
        .unwrap_or(false)
}

fn dev_templates_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("."))
        .join("templates")
}

/// 获取模板可写目录（用于上传、删除等写操作）
fn writable_templates_root() -> PathBuf {
    if cfg!(debug_assertions) {
        let dev = dev_templates_dir();
        if dev.is_dir() {
            return dev;
        }
    }
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(dev_templates_dir)
        .join("jarporter")
        .join("templates")
}

#[tauri::command]
pub async fn get_bundled_templates_dir() -> Result<String, String> {
    if let Some(dir) = BUNDLED_TEMPLATES_DIR.get() {
        templates_log(&format!("get_bundled_templates_dir → {}", dir.display()));
        return Ok(dir.to_string_lossy().to_string());
    }
    templates_log("get_bundled_templates_dir → FAILED（init 未成功或未执行）");
    if let Ok(exe) = std::env::current_exe() {
        templates_log(&format!("  current_exe={}", exe.display()));
    }
    let log_hint = templates_diagnostic_log_path()
        .map(|p| format!("\n诊断日志: {}", p.display()))
        .unwrap_or_default();
    Err(format!(
        "找不到模板目录，请确认 bundle.resources 包含 \"{}\" 并已重新打包。{log_hint}",
        BUNDLE_TEMPLATES_RESOURCE
    ))
}

#[tauri::command]
pub async fn get_templates_diagnostic_log_path() -> Result<String, String> {
    templates_diagnostic_log_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "诊断日志尚未初始化，请重启应用后再试".to_string())
}

// ========== 模板管理功能 ==========

/// 获取打包内置 templates 根目录（只读，由 init_bundled_templates_dir 在 setup 时解析）
pub(crate) fn templates_root() -> PathBuf {
    BUNDLED_TEMPLATES_DIR
        .get()
        .cloned()
        .unwrap_or_else(dev_templates_dir)
}

/// 合并打包模板与用户上传模板目录名（去重）
fn all_template_roots() -> Vec<PathBuf> {
    let mut roots = vec![templates_root()];
    let writable = writable_templates_root();
    if writable != roots[0] && writable.is_dir() {
        roots.push(writable);
    }
    roots
}

#[tauri::command]
pub async fn list_template_dirs() -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut dirs: Vec<String> = Vec::new();
    for root in all_template_roots() {
        for name in list_template_subdirs(&root) {
            if seen.insert(name.clone()) {
                dirs.push(name);
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

/// 单个模板信息：目录名 + 中文分类（来自 index.html 预埋的 `<meta name="template-category">`）
#[derive(serde::Serialize)]
pub struct TemplateInfo {
    pub dir: String,
    pub category: String,
}

/// 去掉文件夹名末尾的 `-数字` 后缀：comic-1 → comic，comic → comic
fn strip_numeric_suffix(name: &str) -> String {
    if let Some(idx) = name.rfind('-') {
        let suffix = &name[idx + 1..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return name[..idx].to_string();
        }
    }
    name.to_string()
}

/// 从单个标签字符串里提取某个属性的值（兼容单/双引号和无引号写法）
fn extract_attr_value(tag: &str, attr: &str) -> Option<String> {
    let key = format!("{}=", attr);
    let idx = tag.find(&key)?;
    let after = &tag[idx + key.len()..];
    let bytes = after.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    match bytes[0] {
        b'"' | b'\'' => {
            let quote = bytes[0] as char;
            let rest = &after[1..];
            let end = rest.find(quote)?;
            Some(rest[..end].to_string())
        }
        _ => {
            // 无引号：取到下一个空白或标签结束符
            let end = after
                .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
                .unwrap_or(after.len());
            Some(after[..end].to_string())
        }
    }
}

/// 从 index.html 中提取 `<meta name="template-category" content="...">` 的值
fn extract_template_category(html: &str) -> Option<String> {
    for pos in html.match_indices("template-category") {
        // 定位「template-category」所在的标签范围 <...>
        let tag_start = html[..pos.0].rfind('<').unwrap_or(0);
        let tag_end = html[tag_start..].find('>').map(|e| tag_start + e + 1)?;
        let tag = &html[tag_start..tag_end];
        // 确认 name 属性确实是 template-category（避免正文里恰好出现该词）
        if extract_attr_value(tag, "name").as_deref() != Some("template-category") {
            continue;
        }
        if let Some(content) = extract_attr_value(tag, "content") {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 读取模板目录下 index.html 预埋的中文分类，缺失或读不到返回 None
fn read_template_category(dir: &Path) -> Option<String> {
    let html = fs::read_to_string(dir.join("index.html")).ok()?;
    extract_template_category(&html)
}

/// 列出所有模板目录及其中文分类（前端按 category 折叠分组展示）
#[tauri::command]
pub async fn list_template_infos() -> Result<Vec<TemplateInfo>, String> {
    let mut infos: Vec<TemplateInfo> = Vec::new();
    let mut seen = HashSet::new();
    for root in all_template_roots() {
        templates_log(&format!(
            "list_template_infos 扫描 {} — {}",
            root.display(),
            summarize_templates_dir(&root)
        ));
        match fs::read_dir(&root) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') || !seen.insert(name.clone()) {
                        continue;
                    }
                    let category = read_template_category(&entry.path())
                        .unwrap_or_else(|| strip_numeric_suffix(&name));
                    infos.push(TemplateInfo { dir: name, category });
                }
            }
            Err(e) => templates_log(&format!("list_template_infos 读取失败 {}: {e}", root.display())),
        }
    }
    templates_log(&format!("list_template_infos 合计 {} 个模板", infos.len()));
    infos.sort_by(|a, b| a.category.cmp(&b.category).then_with(|| a.dir.cmp(&b.dir)));
    Ok(infos)
}

#[tauri::command]
pub async fn upload_template_zip(zip_path: String) -> Result<Vec<serde_json::Value>, String> {
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("无法打开 zip 文件: {}", e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("无法解析 zip 文件: {}", e))?;

    let root = writable_templates_root();
    // 确保 templates 目录存在
    fs::create_dir_all(&root).map_err(|e| format!("创建模板目录失败: {}", e))?;

    let mut extracted_dirs: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("读取 zip entry {} 失败: {}", i, e))?;
        let name = entry.name().to_string();

        // 跳过不需要的路径
        let first_component = name.split('/').next().unwrap_or("");
        if first_component.is_empty()
            || first_component == "__MACOSX"
            || first_component.starts_with('.')
        {
            continue;
        }

        let rel_path = if let Some(idx) = name.find('/') {
            &name[(idx + 1)..]
        } else {
            continue; // 跳过根目录 entry（没有文件内容）
        };

        if rel_path.is_empty() {
            continue;
        }

        let dest = root.join(&name);

        if entry.is_dir() {
            fs::create_dir_all(&dest).ok();
        } else {
            // 只解压非排除文件
            let file_name = std::path::Path::new(rel_path)
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            if file_name == "README.md" || file_name == ".DS_Store" {
                continue;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out = fs::File::create(&dest)
                .map_err(|e| format!("创建文件 {} 失败: {}", dest.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("解压文件 {} 失败: {}", dest.display(), e))?;
            *extracted_dirs.entry(first_component.to_string()).or_insert(0) += 1;
        }
    }

    if extracted_dirs.is_empty() {
        return Err("zip 中没有找到有效的模板目录".to_string());
    }

    let results: Vec<serde_json::Value> = extracted_dirs
        .into_iter()
        .map(|(dir_name, file_count)| {
            serde_json::json!({
                "dir_name": dir_name,
                "file_count": file_count,
            })
        })
        .collect();

    eprintln!("[JarPorter] ✅ 模板上传完成: {:?}", results);
    Ok(results)
}

#[tauri::command]
pub async fn delete_template_dir(dir_name: String) -> Result<(), String> {
    let target = writable_templates_root().join(&dir_name);
    if !target.exists() {
        return Err(format!("模板目录 '{}' 不存在", dir_name));
    }
    fs::remove_dir_all(&target)
        .map_err(|e| format!("删除模板目录 '{}' 失败: {}", dir_name, e))?;
    eprintln!("[JarPorter] 🗑 已删除模板: {}", dir_name);
    Ok(())
}
