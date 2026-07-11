//! 落地页生成、预览与 FTP 上传。
//!
//! 模块划分：
//! - [`generate`] — 渠道/马甲拉取与落地页生成
//! - [`ftp`] — 原生 FTP 客户端与上传
//! - [`templates`] — 模板目录解析与管理
//!
//! 不变量（见 CLAUDE.md）：
//! - 临时输出根目录单一真相源：[`landing_temp_root`]
//! - 预览只读，不改写生成结果
//! - 预览服务器仅绑 127.0.0.1（见 `preview_server`）

mod generate;
mod ftp;
mod templates;

pub use generate::{
    fetch_sub_channels, fetch_vest_data, generate_landing_pages, generate_vest_landing_pages,
};
pub use ftp::upload_landing_to_ftp;
pub use templates::{
    delete_template_dir, get_bundled_templates_dir, init_bundled_templates_dir, list_template_dirs,
    list_template_infos, upload_template_zip,
};
pub(crate) use templates::templates_root;
/// 兼容：`crate::landing::templates_log` ≡ `diag_log("templates", …)`
#[allow(unused_imports)]
pub(crate) use templates::templates_log;

use crate::utils::silent_command;
use std::path::PathBuf;

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
        silent_command("open")
            .arg(&html_path)
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        silent_command("cmd")
            .args(["/c", "start", "", &html_path.to_string_lossy()])
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        silent_command("xdg-open")
            .arg(&html_path)
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    Ok(())
}

