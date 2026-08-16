use crate::models::{
    HarborConfig, LEGACY_FRONTEND_DOCKERFILE_TEMPLATE, LEGACY_FRONTEND_NGINX_TEMPLATE,
    APP_CONFIG_DIR,
};
use std::fs;
use std::path::PathBuf;

pub(crate) fn matches_default_template(value: &str, default_template: &str) -> bool {
    let value = value.trim();
    value.is_empty() || value == default_template.trim()
}

pub(crate) fn normalize_config(mut config: HarborConfig) -> HarborConfig {
    use crate::models::{
        DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE, DEFAULT_FRONTEND_NGINX_TEMPLATE,
    };
    if config.frontend_base_image.trim().is_empty() {
        config.frontend_base_image = HarborConfig::default().frontend_base_image;
    }
    if config.frontend_expose_port.trim().is_empty() {
        config.frontend_expose_port = HarborConfig::default().frontend_expose_port;
    }
    if matches_default_template(
        &config.frontend_dockerfile_template,
        LEGACY_FRONTEND_DOCKERFILE_TEMPLATE,
    ) {
        config.frontend_dockerfile_template = DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE.to_string();
    }
    if matches_default_template(
        &config.frontend_nginx_template,
        LEGACY_FRONTEND_NGINX_TEMPLATE,
    ) {
        config.frontend_nginx_template = DEFAULT_FRONTEND_NGINX_TEMPLATE.to_string();
    }
    config.ops_authorization = None;
    // 旧配置缺字段时补上同名 JAR 消歧默认项（不覆盖用户已写的键）
    for (jar, id) in crate::models::HarborConfig::default().bt_jar_project_ids {
        config.bt_jar_project_ids.entry(jar).or_insert(id);
    }
    config
}

pub(crate) fn config_path_for(dir_name: &str) -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    config_dir.join(dir_name).join("config.json")
}

pub(crate) fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join(APP_CONFIG_DIR);
    fs::create_dir_all(&app_dir).ok();
    app_dir.join("config.json")
}

#[cfg(test)]
mod tests {
    use super::matches_default_template;

    #[test]
    fn matches_default_template_treats_empty_as_default() {
        assert!(matches_default_template("", "DEFAULT"));
        assert!(matches_default_template("  ", "DEFAULT"));
        assert!(matches_default_template("DEFAULT", "DEFAULT"));
        assert!(matches_default_template(" DEFAULT ", "DEFAULT"));
        assert!(!matches_default_template("custom", "DEFAULT"));
    }
}
