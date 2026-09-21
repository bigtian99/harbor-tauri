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
    migrate_harbors(&mut config);
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

/// 旧版单 Harbor 字段 → harbors 列表；并修正三个面板的记忆位。
fn migrate_harbors(config: &mut HarborConfig) {
    use crate::models::HarborEnv;
    if config.harbors.is_empty() {
        // 判据刻意不含 harbor_url：它有默认值 dockerhub.kubekey.local，
        // 一旦纳入，全新安装也会凭空生出一个空环境。
        // 其余三项任一非空即算「配过」，这样只填了 地址+项目 的老配置也迁移过来，
        // 由 HarborEnv::validate 提示补全，而不是被静默丢弃。
        let has_legacy = !config.username.trim().is_empty()
            || !config.password.is_empty()
            || !config.project.trim().is_empty();
        if has_legacy {
            config.harbors.push(HarborEnv {
                id: "default".to_string(),
                name: "默认".to_string(),
                url: if config.harbor_url.trim().is_empty() {
                    HarborConfig::default().harbor_url
                } else {
                    config.harbor_url.clone()
                },
                username: config.username.clone(),
                password: config.password.clone(),
                project: config.project.clone(),
            });
        }
    }
    for (idx, env) in config.harbors.iter_mut().enumerate() {
        if env.id.trim().is_empty() {
            env.id = format!("harbor-{}", idx + 1);
        }
        if env.name.trim().is_empty() {
            env.name = format!("环境{}", idx + 1);
        }
    }
    let ids: Vec<String> = config.harbors.iter().map(|e| e.id.clone()).collect();
    let fallback = ids.first().cloned().unwrap_or_default();
    for slot in [
        &mut config.last_harbor_upload,
        &mut config.last_harbor_branch,
        &mut config.last_harbor_push,
    ] {
        if slot.trim().is_empty() || !ids.iter().any(|id| id == slot) {
            *slot = fallback.clone();
        }
    }
}

/// 按 id 取 Harbor 环境：id 为空取第一个，找不到报错。
pub(crate) fn resolve_harbor(
    config: &HarborConfig,
    harbor_id: &str,
) -> Result<crate::models::HarborEnv, String> {
    if config.harbors.is_empty() {
        return Err("请先在设置中配置 Harbor 环境".to_string());
    }
    let id = harbor_id.trim();
    if id.is_empty() {
        return Ok(config.harbors[0].clone());
    }
    config
        .harbors
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| format!("Harbor 环境不存在: {id}"))
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
                    String::new()
                } else {
                    config.ks_console.clone()
                },
                username: if config.ks_username.trim().is_empty() {
                    "admin".to_string()
                } else {
                    config.ks_username.clone()
                },
                password: config.ks_password.clone(),
                default_namespace: String::new(),
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

    #[test]
    fn empty_environments_without_legacy_stay_empty() {
        // default() 现在带预配置 KS 环境；旧版测试语义是「无遗留凭证时不自动迁移」
        // 改为验证：手动清空后 normalize 不会再塞回来
        let mut config = HarborConfig::default();
        config.ks_environments.clear();
        config.ks_username.clear();
        config.ks_password.clear();
        let config = normalize_config(config);
        assert!(config.ks_environments.is_empty());
        assert!(config.ks_username.is_empty());
        assert!(config.ks_password.is_empty());
    }

    #[test]
    fn migrate_legacy_harbor_into_one_env() {
        let mut config = HarborConfig::default();
        config.harbor_url = "harbor.dev.local".to_string();
        config.username = "admin".to_string();
        config.password = "pwd".to_string();
        config.project = "library".to_string();
        config.harbors.clear();
        let config = normalize_config(config);
        assert_eq!(config.harbors.len(), 1);
        assert_eq!(config.harbors[0].id, "default");
        assert_eq!(config.harbors[0].url, "harbor.dev.local");
        assert_eq!(config.harbors[0].project, "library");
        // 三个面板记忆位落回唯一环境
        assert_eq!(config.last_harbor_upload, "default");
        assert_eq!(config.last_harbor_branch, "default");
        assert_eq!(config.last_harbor_push, "default");
    }

    #[test]
    fn empty_harbors_without_credentials_stay_empty() {
        // 现在 default() 带一个预配置环境；旧版测试语义是「无遗留凭证时不自动迁移」
        // 改为验证：手动清空 harbors 后，normalize 不会因默认值再塞回来
        let mut config = HarborConfig::default();
        config.harbors.clear();
        config.username.clear();
        config.password.clear();
        config.project.clear();
        let config = normalize_config(config);
        assert!(config.harbors.is_empty());
        assert!(config.last_harbor_upload.is_empty());
    }

    #[test]
    fn migrate_legacy_harbor_with_only_url_and_project() {
        // 只填过 地址+项目、从没填账号的老配置：应迁移出来交给 validate 提示补全，
        // 而不是被静默丢弃（且不能因 harbor_url 的默认值误判为新装）
        let mut config = HarborConfig::default();
        config.harbor_url = "harbor.legacy.local".to_string();
        config.project = "legacy-proj".to_string();
        config.harbors.clear();
        let config = normalize_config(config);
        assert_eq!(config.harbors.len(), 1);
        assert_eq!(config.harbors[0].url, "harbor.legacy.local");
        assert_eq!(config.harbors[0].project, "legacy-proj");
        // 缺账号 → validate 必须报错，供 UI 提示
        assert!(config.harbors[0].validate().is_err());
    }

    #[test]
    fn resolve_harbor_by_id_empty_id_and_missing_id() {
        use crate::utils::resolve_harbor;
        let mut config = HarborConfig::default();
        config.harbors = vec![
            crate::models::HarborEnv {
                id: "dev".to_string(),
                name: "开发".to_string(),
                url: "harbor.dev.local".to_string(),
                ..Default::default()
            },
            crate::models::HarborEnv {
                id: "prod".to_string(),
                name: "生产".to_string(),
                url: "harbor.prod.local".to_string(),
                ..Default::default()
            },
        ];
        assert_eq!(resolve_harbor(&config, "prod").unwrap().url, "harbor.prod.local");
        assert_eq!(resolve_harbor(&config, "").unwrap().id, "dev");
        assert_eq!(resolve_harbor(&config, "  ").unwrap().id, "dev");
        assert!(resolve_harbor(&config, "nope").is_err());

        // 手动构造空列表（default() 现在带预配置）
        let mut empty = HarborConfig::default();
        empty.harbors.clear();
        assert!(resolve_harbor(&empty, "").is_err());
    }

    #[test]
    fn stale_harbor_memory_falls_back_to_first_env() {
        let mut config = HarborConfig::default();
        config.harbors = vec![crate::models::HarborEnv {
            id: "prod".to_string(),
            ..Default::default()
        }];
        config.last_harbor_upload = "已删除的环境".to_string();
        let config = normalize_config(config);
        assert_eq!(config.last_harbor_upload, "prod");
    }

    #[test]
    fn save_roundtrip_keeps_quick_merge_branches() {
        let mut config = HarborConfig::default();
        config.quick_merge_source = "origin/rc-master".to_string();
        config.quick_merge_target = "origin/master".to_string();
        let json = serde_json::to_string(&config).expect("serialize");
        let loaded: HarborConfig = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(loaded.quick_merge_source, "origin/rc-master");
        assert_eq!(loaded.quick_merge_target, "origin/master");
    }
}
