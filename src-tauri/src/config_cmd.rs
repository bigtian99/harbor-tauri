use crate::diag::diag_log;
use crate::models::{HarborConfig, LEGACY_CONFIG_DIR};
use crate::utils::{
    config_path_for, derive_maven_local_repo, get_config_path, maven_home_from_env,
    maven_home_looks_valid, maven_home_source, normalize_config, resolve_maven_paths,
    bundled_java_home, bundled_maven_home, bundled_tools_available,
};
use serde::Serialize;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};

/// OPS 版内置的落地页 / 隐私协议 FTP 参数：运营版开箱即用，设置页不提供修改。
/// 仅在 `OPS_MODE=true` 构建生效；完整版仍从配置读取。
const OPS_LANDING_FTP_HOST: &str = "120.77.204.231";
const OPS_LANDING_FTP_USER: &str = "admin";
const OPS_LANDING_FTP_PASS: &str = "pcm520..";
const OPS_LANDING_FTP_BASE_DIR: &str = "common.tiankongshuyu.fun";
/// 隐私协议与落地页同机；用户/密码复用落地页账号
const OPS_PRIVACY_FTP_HOST: &str = OPS_LANDING_FTP_HOST;

static OPS_FTP_LOGGED: AtomicBool = AtomicBool::new(false);

/// 写入 OPS 版固定 FTP 参数（不依赖编译开关，便于单测）。
fn apply_ops_ftp_values(config: &mut HarborConfig) {
    config.landing_ftp_host = OPS_LANDING_FTP_HOST.to_string();
    config.landing_ftp_user = OPS_LANDING_FTP_USER.to_string();
    config.landing_ftp_pass = OPS_LANDING_FTP_PASS.to_string();
    config.landing_ftp_base_dir = OPS_LANDING_FTP_BASE_DIR.to_string();
    config.privacy_ftp_host = OPS_PRIVACY_FTP_HOST.to_string();
}

/// OPS 版加载 / 保存配置时强制覆盖 FTP 字段，避免运营版依赖手工填写。
fn apply_ops_ftp_overrides(config: &mut HarborConfig) {
    if !crate::is_ops_build() {
        return;
    }
    apply_ops_ftp_values(config);
    if !OPS_FTP_LOGGED.swap(true, Ordering::Relaxed) {
        diag_log(
            "config",
            &format!(
                "OPS 版使用内置 FTP 参数: landing_host={OPS_LANDING_FTP_HOST} user={OPS_LANDING_FTP_USER} base={OPS_LANDING_FTP_BASE_DIR} privacy_host={OPS_PRIVACY_FTP_HOST}"
            ),
        );
    }
}

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
        let mut config = HarborConfig::default();
        apply_ops_ftp_overrides(&mut config);
        return Ok(config);
    };

    let content = fs::read_to_string(&readable_path).map_err(|e| e.to_string())?;
    let config = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut config = normalize_config(config);
    apply_ops_ftp_overrides(&mut config);
    Ok(config)
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
    let mut config = normalize_config(config);
    apply_ops_ftp_overrides(&mut config);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ops_ftp_values_fill_required_fields() {
        let mut config = HarborConfig::default();
        apply_ops_ftp_values(&mut config);

        assert_eq!(config.landing_ftp_host, OPS_LANDING_FTP_HOST);
        assert_eq!(config.landing_ftp_user, OPS_LANDING_FTP_USER);
        assert_eq!(config.landing_ftp_pass, OPS_LANDING_FTP_PASS);
        assert_eq!(config.landing_ftp_base_dir, OPS_LANDING_FTP_BASE_DIR);

        // 隐私与落地页共用主机/账号，且必填项齐全（require_privacy_ftp 会校验 host/user/pass）
        let (privacy_host, privacy_user, privacy_pass) = crate::landing::require_privacy_ftp(&config)
            .expect("OPS 内置隐私 FTP 参数应通过校验");
        assert_eq!(privacy_host, OPS_PRIVACY_FTP_HOST);
        assert_eq!(privacy_user, OPS_LANDING_FTP_USER);
        assert_eq!(privacy_pass, OPS_LANDING_FTP_PASS);
    }
}
