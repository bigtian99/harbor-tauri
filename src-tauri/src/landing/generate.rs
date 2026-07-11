use crate::models::{LandingPageResult, SubChannelApiResponse, SubChannelData};
use crate::utils::{copy_dir_recursive, render_template};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use super::templates::{list_template_subdirs, summarize_templates_dir, templates_root};

#[tauri::command]
pub async fn fetch_sub_channels(api_url: String, ids: String) -> Result<Vec<SubChannelData>, String> {
    let url = format!("{}/api/sub-channel/list?ids={}", api_url.trim_end_matches('/'), ids);
    crate::diag::diag_log("landing", &format!("请求渠道数据: {}", url));

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
    crate::diag::diag_log("landing", &format!("开始生成 {} 个落地页", total));
    let gen_base = if template_base.trim().is_empty() {
        templates_root()
    } else {
        PathBuf::from(template_base.trim())
    };
    crate::diag::diag_log(
        "landing",
        &format!(
            "generate_landing_pages base={} — {}",
            gen_base.display(),
            summarize_templates_dir(&gen_base)
        ),
    );

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
                let name_lower = name.to_lowercase();
                let tc_lower = channel.type_code.to_lowercase();
                if name_lower == tc_lower || name_lower.starts_with(&format!("{}-", tc_lower)) {
                    if entry.path().is_dir() {
                        template_dirs.push(entry.path());
                    }
                }
            }
        }
        template_dirs.sort();

        if template_dirs.is_empty() {
            let available = list_template_subdirs(template_base_path);
            crate::diag::diag_log(
                "landing",
                &format!(
                    "生成失败 channel={} type_code={} base={} — 无匹配模板；当前 base 下可用: [{}]",
                    channel.sub_channel_name,
                    channel.type_code,
                    template_base_path.display(),
                    if available.is_empty() {
                        "无".to_string()
                    } else {
                        available.join(", ")
                    }
                ),
            );
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

            crate::diag::diag_log(
                "landing",
                &format!(
                    "复制模板 {}: {} -> {}",
                    idx, template.display(), template_output.display()
                ),
            );

            // 复制模板目录
            if let Err(e) = copy_dir_recursive(template, &template_output) {
                all_success = false;
                error_message = format!("复制模板 {} 失败: {}", idx, e);
                crate::diag::diag_log("landing", &format!("❌ {}", error_message));
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
                crate::diag::diag_log(
                    "landing",
                    &format!(
                        "✅ 模板 {} 复制完成，内容: {:?}",
                        idx, entries
                    ),
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
            crate::diag::diag_log(
                "landing",
                &format!(
                    "✅ 落地页生成成功: {} | output_dir={} | templates={} | index.html exists={} size={}",
                    channel.sub_channel_name, channel_output_str, template_dirs.len(), file_exists, file_size
                ),
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
