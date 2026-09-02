use crate::diag::diag_log;
use crate::models::{HarborConfig, LEGACY_CONFIG_DIR};
use crate::utils::{
    config_path_for, derive_maven_local_repo, get_config_path, maven_home_from_env,
    maven_home_looks_valid, maven_home_source, normalize_config, resolve_maven_paths,
    bundled_java_home, bundled_maven_home, bundled_tools_available,
};
use serde::Serialize;
use std::fs;

/// 同步版本的 load_config，供内部调用使用
pub(crate) fn load_config_sync() -> Result<HarborConfig, String> {
    let path = get_config_path();
    let legacy_path = config_path_for(LEGACY_CONFIG_DIR);
    let readable_path = if path.exists() {
        Some(path)
    } else if legacy_path.exists() {
        Some(legacy_path)
    } else {
        None
    };

    let Some(readable_path) = readable_path else {
        return Ok(HarborConfig::default());
    };

    let content = fs::read_to_string(&readable_path).map_err(|e| e.to_string())?;
    let config = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(normalize_config(config))
}

#[tauri::command]
pub fn load_config() -> Result<HarborConfig, String> {
    load_config_sync()
}

#[derive(Debug, Serialize)]
pub struct MavenSettingsInfo {
    /// 配置文件中的 Maven Home
    pub config_home: String,
    /// 环境变量 MAVEN_HOME / M2_HOME
    pub env_home: String,
    /// 最终生效的 Home（配置优先，否则环境变量）
    pub effective_home: String,
    /// 最终生效的本地仓库（显式配置或由 Home 推导的 repository）
    pub effective_local_repo: String,
    pub home_valid: bool,
    pub source: String, // config | env | bundled | path | none
    /// 安装包内置 Maven Home（未配置时可能作为 effective_home）
    pub bundled_home: String,
    /// 安装包内置 JDK Home（mvn 执行时优先 JAVA_HOME，否则可能用此项）
    pub bundled_java_home: String,
    pub bundled_available: bool,
}

/// 供前端在打包前检查 / 设置页展示环境变量探测结果。
#[tauri::command]
pub fn resolve_maven_settings(config: Option<HarborConfig>) -> Result<MavenSettingsInfo, String> {
    let disk = load_config_sync().unwrap_or_default();
    let mut cfg = match config {
        Some(c) => c,
        None => disk.clone(),
    };
    // 内存 config 可能未含已保存的 Maven 字段（如仅改了其它项就触发检查），以磁盘为底再覆盖非空入参
    if cfg.maven_home.trim().is_empty() && !disk.maven_home.trim().is_empty() {
        cfg.maven_home = disk.maven_home.clone();
    }
    if cfg.maven_local_repo.trim().is_empty() && !disk.maven_local_repo.trim().is_empty() {
        cfg.maven_local_repo = disk.maven_local_repo.clone();
    }
    let cfg = normalize_config(cfg);
    let env_home = maven_home_from_env();
    let (effective_home, effective_local_repo) =
        resolve_maven_paths(&cfg.maven_home, &cfg.maven_local_repo);
    let source = maven_home_source(&cfg.maven_home, &effective_home).to_string();
    let home_valid = maven_home_looks_valid(&effective_home);
    let bundled_home = bundled_maven_home().unwrap_or_default();
    let bundled_java = bundled_java_home().unwrap_or_default();
    let bundled_available = bundled_tools_available();
    diag_log(
        "config",
        &format!(
            "resolve_maven_settings source={} home={} repo={} valid={} bundled={}",
            source, effective_home, effective_local_repo, home_valid, bundled_available
        ),
    );
    Ok(MavenSettingsInfo {
        config_home: cfg.maven_home.trim().to_string(),
        env_home,
        effective_home,
        effective_local_repo,
        home_valid,
        source,
        bundled_home,
        bundled_java_home: bundled_java,
        bundled_available,
    })
}

/// 根据 Maven Home 推导默认本地仓库路径（`{home}/repository`）。
#[tauri::command]
pub fn derive_maven_repo_from_home(maven_home: String) -> String {
    derive_maven_local_repo(&maven_home)
}

#[tauri::command]
pub fn save_config(mut config: HarborConfig) -> Result<(), String> {
    let path = get_config_path();
    let legacy_path = config_path_for(LEGACY_CONFIG_DIR);
    if path.exists() || legacy_path.exists() {
        if let Ok(existing_config) = load_config_sync() {
            config.build_history = existing_config.build_history;
        }
    }
    let config = normalize_config(config);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    diag_log(
        "config",
        &format!(
            "save_config: path={}, ks_publish_maps={}, ks_environments={}",
            path.display(),
            config.ks_publish_maps.len(),
            config.ks_environments.len(),
        ),
    );
    Ok(())
}

/// 清空 Git 相关本地记忆：仓库路径历史、分支记忆与按仓库的高级设置。
#[tauri::command]
pub fn clear_git_records() -> Result<HarborConfig, String> {
    let mut config = load_config_sync()?;
    let repo_history_count = config.repo_path_history.len();
    let branch_settings_count = config.branch_repo_settings.len();

    config.last_repo_path.clear();
    config.last_branch.clear();
    config.last_frontend_dir.clear();
    config.last_build_script.clear();
    config.last_project_type = "maven".to_string();
    config.last_auto_push_image = false;
    config.last_package_with_backend = false;
    config.last_spring_profile.clear();
    config.last_expose_port.clear();
    config.repo_path_history.clear();
    config.branch_repo_settings.clear();

    let path = get_config_path();
    let config = normalize_config(config);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;

    diag_log(
        "config",
        &format!(
            "clear_git_records: repo_path_history={repo_history_count}, branch_repo_settings={branch_settings_count}"
        ),
    );

    Ok(config)
}
