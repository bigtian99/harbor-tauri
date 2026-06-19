use crate::config_cmd::load_config_sync;
use crate::models::BuildRecord;
use crate::utils::{copy_artifact_to_output_internal, get_config_path};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub async fn save_build_record(_app: tauri::AppHandle, record: BuildRecord) -> Result<(), String> {
    let mut config = load_config_sync()?;
    config.build_history.insert(0, record);
    // 最多保留10条记录
    config.build_history.truncate(10);
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_build_history() -> Result<Vec<BuildRecord>, String> {
    let config = load_config_sync()?;
    Ok(config.build_history)
}

#[tauri::command]
pub async fn clear_build_history() -> Result<(), String> {
    let mut config = load_config_sync()?;
    config.build_history.clear();
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_build_record(record_id: String) -> Result<(), String> {
    let mut config = load_config_sync()?;
    config.build_history.retain(|r| r.id != record_id);
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 删除产物文件或目录
#[tauri::command]
pub async fn delete_artifact_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Ok(()); // 不存在就不处理
    }
    if path.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|e| format!("删除目录失败: {} ({})", path.display(), e))?;
    } else if path.is_file() {
        fs::remove_file(&path)
            .map_err(|e| format!("删除文件失败: {} ({})", path.display(), e))?;
    }
    Ok(())
}

/// 更新最新一条构建记录的镜像信息（推送完成后调用）
#[tauri::command]
pub async fn update_build_record_image(image_name: String, image_tag: String) -> Result<(), String> {
    let mut config = load_config_sync()?;
    if let Some(record) = config.build_history.first_mut() {
        record.image_name = Some(image_name);
        record.image_tag = Some(image_tag);
        record.status = "pushed".to_string();
        let path = get_config_path();
        let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn save_build_record_direct(record: BuildRecord) -> Result<(), String> {
    let mut config = load_config_sync()?;
    config.build_history.insert(0, record);
    config.build_history.truncate(10);
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    eprintln!("[JarPorter] 保存构建记录到: {}", path.display());
    eprintln!("[JarPorter] 构建记录数量: {}", config.build_history.len());
    fs::write(&path, &content).map_err(|e| format!("写入配置文件失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn copy_artifact_to_output(
    artifact_path: String,
    output_dir: String,
) -> Result<String, String> {
    let src = PathBuf::from(&artifact_path);
    let dst_dir = PathBuf::from(&output_dir);
    copy_artifact_to_output_internal(&src, &dst_dir)
}
