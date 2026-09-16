use crate::utils::silent_command;
use std::path::PathBuf;

/// 在系统文件管理器中打开目录（文件则定位并选中）。
#[tauri::command]
pub async fn open_directory(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        // 文件：Finder 中定位并选中；目录：直接打开
        let mut cmd = silent_command("open");
        if path.is_file() {
            cmd.arg("-R");
        }
        cmd.arg(&path)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        if path.is_file() {
            // explorer /select,"C:\path\to\file"
            let arg = format!("/select,{}", path.to_string_lossy());
            silent_command("explorer")
                .arg(arg)
                .output()
                .map_err(|e| format!("打开目录失败: {}", e))?;
        } else {
            let path_str = path.to_string_lossy().to_string();
            silent_command("cmd")
                .args(["/C", "start", "", &path_str])
                .output()
                .map_err(|e| format!("打开目录失败: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        // 无统一「选中文件」API：目录 xdg-open；文件打开父目录
        let target = if path.is_file() {
            path.parent().unwrap_or(&path)
        } else {
            &path
        };
        silent_command("xdg-open")
            .arg(target)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    Ok(())
}

/// 用系统默认浏览器打开外链（不依赖 opener 插件权限，失败可诊断）。
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        crate::diag::diag_log("utils", &format!("open_external_url reject: {url}"));
        return Err("仅允许打开 http/https 链接".into());
    }
    crate::diag::diag_log("utils", &format!("open_external_url: {url}"));

    #[cfg(target_os = "macos")]
    {
        silent_command("open")
            .arg(&url)
            .output()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        // start 的第一个引号参数是窗口标题，必须留空串
        silent_command("cmd")
            .args(["/C", "start", "", &url])
            .output()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        silent_command("xdg-open")
            .arg(&url)
            .output()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }

    Ok(())
}
