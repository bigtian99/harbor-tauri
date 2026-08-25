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
    if config.ks_console.trim().is_empty() {
        config.ks_console = HarborConfig::default().ks_console;
    }
    migrate_ks_environments(&mut config);
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
    // Maven：配置为空时用环境变量 MAVEN_HOME/M2_HOME 预填；本地仓库空则由 Home 推导
    if config.maven_home.trim().is_empty() {
        let env_home = crate::utils::maven_home_from_env();
        if !env_home.is_empty() {
            config.maven_home = env_home;
        }
    }
    if config.maven_local_repo.trim().is_empty() && !config.maven_home.trim().is_empty() {
        config.maven_local_repo = crate::utils::derive_maven_local_repo(&config.maven_home);
    }
    config
}

fn migrate_ks_environments(config: &mut HarborConfig) {
    if config.ks_environments.is_empty() {
        let has_legacy =
            !config.ks_username.trim().is_empty() || !config.ks_password.trim().is_empty();
        if has_legacy {
            config.ks_environments.push(crate::models::KsEnvironment {
                id: "legacy".to_string(),
                name: "dev".to_string(),
                console: if config.ks_console.trim().is_empty() {
                    crate::models::HarborConfig::default().ks_console
                } else {
                    config.ks_console.clone()
                },
                username: if config.ks_username.trim().is_empty() {
                    "admin".to_string()
                } else {
                    config.ks_username.clone()
                },
                password: config.ks_password.clone(),
            });
        }
    }
    for env in &mut config.ks_environments {
        if env.id.trim().is_empty() {
            env.id = format!("ks-{}", env.name.trim().to_lowercase().replace(' ', "-"));
            if env.id == "ks-" {
                env.id = "ks-env".to_string();
            }
        }
        if env.name.trim().is_empty() {
            env.name = "dev".to_string();
        }
        if env.console.trim().is_empty() {
            env.console = crate::models::HarborConfig::default().ks_console;
        }
    }
    if config.ks_last_env_id.trim().is_empty()
        || !config
            .ks_environments
            .iter()
            .any(|e| e.id == config.ks_last_env_id)
    {
        config.ks_last_env_id = config
            .ks_environments
            .first()
            .map(|e| e.id.clone())
            .unwrap_or_default();
    }
    if let Some(current) = config
        .ks_environments
        .iter()
        .find(|e| e.id == config.ks_last_env_id)
        .cloned()
        .or_else(|| config.ks_environments.first().cloned())
    {
        config.ks_console = current.console;
        config.ks_username = current.username;
        config.ks_password = current.password;
    }
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
    use super::{matches_default_template, normalize_config};
    use crate::models::HarborConfig;

    #[test]
    fn matches_default_template_treats_empty_as_default() {
        assert!(matches_default_template("", "DEFAULT"));
        assert!(matches_default_template("  ", "DEFAULT"));
        assert!(matches_default_template("DEFAULT", "DEFAULT"));
        assert!(matches_default_template(" DEFAULT ", "DEFAULT"));
        assert!(!matches_default_template("custom", "DEFAULT"));
    }

    #[test]
    fn migrate_legacy_ks_fields_into_environments() {
        let mut config = HarborConfig::default();
        config.ks_console = "http://ks-dev:30880".to_string();
        config.ks_username = "admin".to_string();
        config.ks_password = "secret".to_string();
        config.ks_environments.clear();
        let config = normalize_config(config);
        assert_eq!(config.ks_environments.len(), 1);
        assert_eq!(config.ks_environments[0].name, "dev");
        assert_eq!(config.ks_environments[0].console, "http://ks-dev:30880");
        assert_eq!(config.ks_last_env_id, config.ks_environments[0].id);
    }

    #[test]
    fn keep_existing_ks_environments() {
        let mut config = HarborConfig::default();
        config.ks_username = "old".to_string();
        config.ks_password = "oldpass".to_string();
        config.ks_environments = vec![crate::models::KsEnvironment {
            id: "prod".to_string(),
            name: "prod".to_string(),
            console: "http://ks-prod:30880".to_string(),
            username: "ops".to_string(),
            password: "p".to_string(),
        }];
        config.ks_last_env_id = "prod".to_string();
        let config = normalize_config(config);
        assert_eq!(config.ks_environments.len(), 1);
        assert_eq!(config.ks_environments[0].name, "prod");
        assert_eq!(config.ks_username, "ops");
    }
}
