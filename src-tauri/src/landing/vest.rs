use crate::models::{LandingData, LandingPageResult, VestApiResponse};
use crate::utils::{copy_dir_recursive, render_template};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use super::templates::{summarize_templates_dir, templates_root};

#[tauri::command]
pub async fn fetch_vest_data(
    api_url: String,
    ids: String,
    authorization: String,
) -> Result<Vec<LandingData>, String> {
    let id_list: Vec<String> = ids
        .split([',', ' ', '\n', ';', '，'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if id_list.is_empty() {
        return Err("请输入马甲包 ID".to_string());
    }

    let auth = authorization.trim().to_string();
    if auth.is_empty() {
        return Err("请先配置 Authorization".to_string());
    }

    // 并行请求
    let client = std::sync::Arc::new(reqwest::Client::new());
    let mut handles: Vec<tauri::async_runtime::JoinHandle<Result<LandingData, String>>> = Vec::new();

    for id in &id_list {
        let url = format!("{}/pack/vest/{}", api_url.trim_end_matches('/'), id);
        let auth = auth.clone();
        let client = std::sync::Arc::clone(&client);
        let id = id.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let response = client
                .get(&url)
                .header("Authorization", &auth)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(|e| format!("请求 vest/{} 失败: {}", id, e))?;
            let body: VestApiResponse = response
                .json()
                .await
                .map_err(|e| format!("解析 vest/{} 响应失败: {}", id, e))?;
            if body.code != Some(200) {
                return Err(format!(
                    "vest/{} API 错误: code={:?}, message={:?}",
                    id, body.code, body.message
                ));
            }
            let item = body.data.ok_or_else(|| format!("vest/{} 无数据", id))?;
            Ok(LandingData {
                id: item.id,
                name: item.app_name.unwrap_or_else(|| format!("vest_{}", id)),
                logo: item.icon_path.unwrap_or_default(),
                download_url: item.short_url
                    .or_else(|| item.current_build_url.clone())
                    .unwrap_or_default(),
            })
        }));
    }

    let mut results: Vec<LandingData> = Vec::new();
    for handle in handles {
        results.push(handle.await.map_err(|e| format!("请求失败: {}", e))??);
    }

    if results.is_empty() {
        return Err("未获取到任何马甲包数据".to_string());
    }
    Ok(results)
}

#[tauri::command]
pub async fn generate_vest_landing_pages(
    app: tauri::AppHandle,
    api_url: String,
    ids: String,
    authorization: String,
    template_base: String,
    output_dir: String,
) -> Result<Vec<LandingPageResult>, String> {
    // Step 1: 获取马甲包数据
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 10,
            "message": "📡 获取马甲包数据..."
        }),
    ).ok();

    let vest_items = match fetch_vest_data(api_url, ids, authorization).await {
        Ok(data) => data,
        Err(e) => return Err(format!("获取马甲包数据失败: {}", e)),
    };

    let total = vest_items.len();
    crate::diag::diag_log("landing", &format!("马甲包 开始生成 {} 个落地页", total));

    let gen_base = if template_base.trim().is_empty() {
        templates_root()
    } else {
        PathBuf::from(template_base.trim())
    };
    crate::diag::diag_log(
        "landing",
        &format!(
            "generate_vest_landing_pages base={} — {}",
            gen_base.display(),
            summarize_templates_dir(&gen_base)
        ),
    );

    // 收集所有模板目录
    let mut all_template_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(gen_base.as_path()) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                all_template_dirs.push(entry.path());
            }
        }
    }
    all_template_dirs.sort();

    if all_template_dirs.is_empty() {
        return Err(format!("模板目录为空: {}", gen_base.display()));
    }

    let template_dir_strs: Vec<String> = all_template_dirs
        .iter()
        .map(|p| p.display().to_string())
        .collect();

    let output_base = Path::new(&output_dir);
    fs::create_dir_all(output_base)
        .map_err(|e| format!("创建输出目录失败: {}", e))?;

    let mut results: Vec<LandingPageResult> = Vec::new();

    for (i, item) in vest_items.iter().enumerate() {
        let progress = 20 + ((i as f64 / total as f64) * 70.0) as i32;
        let safe_name = item.name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let output_dir_path = output_base.join(format!("vest_{}_{}", safe_name, item.id));
        let output_dir_str = output_dir_path.display().to_string();

        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": progress,
                "message": format!("📝 [{}/{}] 生成落地页: {}", i + 1, total, item.name),
            }),
        ).ok();

        let mut all_success = true;
        let mut error_message = String::new();
        for (idx, template) in all_template_dirs.iter().enumerate() {
            let template_output = output_dir_path.join(format!("template_{}", idx));

            if let Err(e) = copy_dir_recursive(template, &template_output) {
                all_success = false;
                error_message = format!("复制模板 {} 失败: {}", idx, e);
                break;
            }

            let html_path = template_output.join("index.html");
            if !html_path.exists() {
                all_success = false;
                error_message = format!("模板 {} 中未找到 index.html", idx);
                break;
            }

            match fs::read_to_string(&html_path) {
                Ok(content) => {
                    let new_content = render_template(&content, &[
                        ("NAME", item.name.clone()),
                        ("LOGO", item.logo.clone()),
                        ("DOWNLOAD_URL", item.download_url.clone()),
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

        results.push(LandingPageResult {
            id: item.id.clone(),
            type_code: "vest".to_string(),
            name: item.name.clone(),
            output_dir: output_dir_str,
            status: if all_success { "success" } else { "error" }.to_string(),
            message: if all_success { "生成成功".to_string() } else { error_message },
            template_dirs: template_dir_strs.clone(),
            current_template_index: 0,
        });
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
