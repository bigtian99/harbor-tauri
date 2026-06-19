use crate::models::{FtpUploadItem, FtpUploadResult, LandingPageResult, SubChannelApiResponse, SubChannelData};
use crate::utils::copy_dir_recursive;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;

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

/// 替换落地页模板内容
pub(crate) fn replace_landing_page_content(
    content: &str,
    sub_channel: &SubChannelData,
) -> String {
    let name = &sub_channel.sub_channel_name;
    let logo = sub_channel.sub_channel_logo.as_deref().unwrap_or("");
    let download_link = sub_channel.sub_channel_link.as_deref().unwrap_or("");

    let mut result = content.to_string();

    // 替换 <title> 标签内容
    if let Some(title_start) = result.find("<title>") {
        if let Some(title_end) = result[title_start..].find("</title>") {
            let new_title = format!("<title>{} - 官方下载</title>", name);
            result.replace_range(title_start..title_start + title_end + "</title>".len(), &new_title);
        }
    }

    // 替换 logo 图片路径
    if !logo.is_empty() {
        result = result
            .replace("src=\"logo.jpg\"", &format!("src=\"{}\"", logo))
            .replace("src=\"白鸽软件库.jpg\"", &format!("src=\"{}\"", logo))
            .replace("src=\"./image/logo.png\"", &format!("src=\"{}\"", logo))
            .replace("src='./image/logo.png'", &format!("src='{}'", logo));
    }

    // 替换 APK 下载链接（替换所有 tiankongshuyu 域名下的 .apk 链接）
    if !download_link.is_empty() {
        result = replace_apk_links(&result, download_link);
    }

    // 替换页面中的名称文本
    let known_names = [
        "白鸽软件库", "游戏库预览链接", "短剧融合影视",
        "短剧影视", "异次元 · 高清动漫阅读", "笔书阁", "Tofai", "漫蛙",
        "白鸽", "游戏库",
    ];
    for known in &known_names {
        // 替换 Nav brand 中的名称
        result = result.replace(&format!(">{}</span>", known), &format!(">{}</span>", name));
        // 替换 vis-card name
        result = result.replace(&format!(">{}</div>", known), &format!(">{}</div>", name));
        // 替换 header-title
        result = result.replace(&format!(">{}</span>", known), &format!(">{}</span>", name));
        // 替换 item-title
        result = result.replace(&format!("<span>{}</span>", known), &format!("<span>{}</span>", name));
        // 替换 H1 中的名称
        result = result.replace(known, name);
    }

    result
}

/// 替换所有 APK 下载链接（匹配 tiankongshuyu 域名 + .apk 后缀）
pub(crate) fn replace_apk_links(content: &str, new_link: &str) -> String {
    // 查找 .apk 链接的特征模式并替换
    let mut result = content.to_string();
    let patterns: &[&str] = &["https://"];
    for pattern in patterns {
        let mut search_start = 0;
        while let Some(pos) = result[search_start..].find(pattern) {
            let abs_pos = search_start + pos;
            let _link_start = abs_pos;
            // 找到链接结束位置（空格、引号、换行等）
            if let Some(link_end) = result[abs_pos..].find(|c: char| c == '"' || c == '\'' || c == ' ' || c == '\n' || c == '>') {
                let link = &result[abs_pos..abs_pos + link_end];
                if link.contains(".apk") {
                    result.replace_range(abs_pos..abs_pos + link_end, new_link);
                    search_start = abs_pos + new_link.len();
                } else {
                    search_start = abs_pos + link_end;
                }
            } else {
                break;
            }
        }
    }
    result
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
        let template_base_path = Path::new(&template_base);
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
                    let new_content = replace_landing_page_content(&content, channel);
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

#[tauri::command]
pub async fn get_bundled_templates_dir() -> Result<String, String> {
    // 开发环境：直接使用项目内的 templates 目录
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("."))
        .join("templates");

    if dev_dir.exists() {
        eprintln!("[JarPorter] 📁 模板目录: {}", dev_dir.display());
        return Ok(dev_dir.to_string_lossy().to_string());
    }

    Err("找不到模板目录".to_string())
}
