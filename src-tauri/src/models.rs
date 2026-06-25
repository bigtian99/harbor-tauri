use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub(crate) const APP_CONFIG_DIR: &str = "jarporter";
pub(crate) const LEGACY_CONFIG_DIR: &str = "jar-to-harbor";
pub(crate) const DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE: &str = r#"FROM {{BASE_IMAGE}}
COPY nginx.conf {{NGINX_CONF_PATH}}
COPY {{DIST_DIR}}/ /usr/share/nginx/html/
EXPOSE {{EXPOSE_PORT}}
CMD ["nginx", "-g", "daemon off;"]
"#;
pub(crate) const DEFAULT_FRONTEND_NGINX_TEMPLATE: &str = r#"server {
    listen       {{EXPOSE_PORT}};
    server_name  _;

    root   /usr/share/nginx/html;
    index  index.html;

    gzip on;
    gzip_min_length 1k;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;
    gzip_vary on;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|woff2?|eot|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
"#;
pub(crate) const LEGACY_FRONTEND_DOCKERFILE_TEMPLATE: &str = r#"FROM {{BASE_IMAGE}}
COPY nginx.conf {{NGINX_CONF_PATH}}
COPY {{DIST_DIR}}/ /usr/share/nginx/html/
EXPOSE {{EXPOSE_PORT}}
"#;
pub(crate) const LEGACY_FRONTEND_NGINX_TEMPLATE: &str = r#"server {
    listen {{EXPOSE_PORT}};
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
"#;

/// 最多保留的缓存条目数
pub(crate) const MAX_CACHE_ENTRIES: usize = 5;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ArtifactType {
    Jar,
    FrontendDist,
}

pub(crate) struct DockerBuildContext {
    pub(crate) context_dir: PathBuf,
    pub(crate) dockerfile_path: PathBuf,
    pub(crate) cleanup_file: Option<PathBuf>,
    pub(crate) cleanup_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PackageProjectType {
    Maven,
    Npm,
}

#[derive(Debug, Serialize)]
pub(crate) struct PackageFromBranchResult {
    pub(crate) artifact_path: String,
    pub(crate) backend_artifact_path: Option<String>,
    pub(crate) worktree_path: String,
    pub(crate) build_script: String,
    pub(crate) log: String,
    pub(crate) dockerfile_path: Option<String>,
    pub(crate) dockerfile_context: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct GitBranchOption {
    pub(crate) name: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct LastCommitInfo {
    pub(crate) hash: String,
    pub(crate) short_hash: String,
    pub(crate) message: String,
    pub(crate) author: String,
    pub(crate) date: String,
    pub(crate) url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct CommitInfo {
    pub(crate) hash: String,
    pub(crate) short_hash: String,
    pub(crate) message: String,
    pub(crate) author: String,
    pub(crate) date: String,
    pub(crate) url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct CommitListResult {
    pub(crate) commits: Vec<CommitInfo>,
    pub(crate) total: usize,
    pub(crate) page: usize,
    pub(crate) page_size: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthorInfo {
    pub(crate) name: String,
    pub(crate) count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuildRecord {
    pub(crate) id: String,
    pub(crate) timestamp: String,
    pub(crate) repo_path: String,
    pub(crate) branch: String,
    pub(crate) project_type: String,
    pub(crate) artifact_path: String,
    pub(crate) backend_artifact_path: Option<String>,
    pub(crate) image_name: Option<String>,
    pub(crate) image_tag: Option<String>,
    pub(crate) build_command: String,
    // 打包配置
    pub(crate) frontend_dir: Option<String>,
    pub(crate) package_manager: Option<String>,
    pub(crate) spring_profile: Option<String>,
    pub(crate) package_with_backend: bool,
    pub(crate) duration_ms: u64,
    pub(crate) status: String,
    pub(crate) log_summary: String,
    pub(crate) full_log: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct HarborConfig {
    pub harbor_url: String,
    pub username: String,
    pub password: String,
    pub project: String,
    pub base_image: String,
    pub expose_port: String,
    pub frontend_base_image: String,
    pub frontend_expose_port: String,
    pub frontend_dockerfile_template: String,
    pub frontend_nginx_template: String,
    // 分支打包记忆配置
    pub remember_branch_settings: bool,
    pub last_repo_path: String,
    pub last_branch: String,
    pub last_frontend_dir: String,
    pub last_build_script: String,
    pub last_project_type: String,
    pub last_auto_push_image: bool,
    pub last_package_with_backend: bool,
    pub last_spring_profile: String,
    pub last_expose_port: String,
    pub repo_path_history: Vec<String>,
    pub npm_package_manager: String,
    pub npm_registry: String,
    // 打包产物输出目录
    pub artifact_output_dir: String,
    // 自定义 Dockerfile 构建时，额外通过 --build-context tools= 注入的目录
    pub custom_docker_extras_dir: String,
    // 历史打包记录
    pub build_history: Vec<BuildRecord>,
}

impl Default for HarborConfig {
    fn default() -> Self {
        let default_output_dir = dirs::desktop_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("tksy")
            .to_string_lossy()
            .to_string();
        Self {
            harbor_url: "dockerhub.kubekey.local".to_string(),
            username: String::new(),
            password: String::new(),
            project: String::new(),
            base_image: "eclipse-temurin:21-jre-alpine".to_string(),
            expose_port: "8181".to_string(),
            frontend_base_image: "nginx:alpine".to_string(),
            frontend_expose_port: "80".to_string(),
            frontend_dockerfile_template: DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE.to_string(),
            frontend_nginx_template: DEFAULT_FRONTEND_NGINX_TEMPLATE.to_string(),
            // 分支打包记忆配置默认值
            remember_branch_settings: false,
            last_repo_path: String::new(),
            last_branch: String::new(),
            last_frontend_dir: String::new(),
            last_build_script: String::new(),
            last_project_type: "maven".to_string(),
            last_auto_push_image: false,
            last_package_with_backend: false,
            last_spring_profile: String::new(),
            last_expose_port: String::new(),
            repo_path_history: Vec::new(),
            npm_package_manager: "npm".to_string(),
            npm_registry: String::new(),
            // 打包产物输出目录默认为桌面
            artifact_output_dir: default_output_dir,
            // 自定义 Dockerfile 附加目录默认为空
            custom_docker_extras_dir: String::new(),
            // 历史打包记录默认为空
            build_history: Vec::new(),
        }
    }
}

// ========== 落地页生成相关数据结构 ==========

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SubChannelApiResponse {
    pub(crate) code: Option<i32>,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<Vec<SubChannelData>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SubChannelData {
    pub(crate) id: String,
    #[serde(rename = "typeCode")]
    pub(crate) type_code: String,
    #[serde(rename = "subChannelName")]
    pub(crate) sub_channel_name: String,
    #[serde(rename = "subChannelLogo")]
    pub(crate) sub_channel_logo: Option<String>,
    #[serde(rename = "subChannelLink")]
    pub(crate) sub_channel_link: Option<String>,
    #[serde(rename = "productName")]
    pub(crate) product_name: Option<String>,
    #[serde(rename = "typeName")]
    pub(crate) type_name: Option<String>,
    #[serde(rename = "channelName")]
    pub(crate) channel_name: Option<String>,
    #[serde(rename = "subChannelDomain")]
    pub(crate) sub_channel_domain: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct LandingPageResult {
    pub(crate) id: String,
    pub(crate) type_code: String,
    pub(crate) name: String,
    pub(crate) output_dir: String,
    pub(crate) status: String,
    pub(crate) message: String,
    pub(crate) template_dirs: Vec<String>,
    pub(crate) current_template_index: usize,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct FtpUploadResult {
    pub(crate) id: String,
    pub(crate) url: String,
    pub(crate) status: String,
    pub(crate) message: String,
}

#[derive(Debug, Deserialize, Clone)]
pub(crate) struct FtpUploadItem {
    pub(crate) id: String,
    pub(crate) local_dir: String,
    pub(crate) remote_dir: String,
}

impl ArtifactType {
    pub(crate) fn from_option(value: Option<String>) -> Result<Self, String> {
        match value.as_deref().unwrap_or("jar") {
            "jar" => Ok(Self::Jar),
            "frontend_dist" => Ok(Self::FrontendDist),
            other => Err(format!("不支持的产物类型: {}", other)),
        }
    }
}

impl PackageProjectType {
    pub(crate) fn from_string(value: String) -> Result<Self, String> {
        match value.as_str() {
            "maven" => Ok(Self::Maven),
            "npm" => Ok(Self::Npm),
            other => Err(format!("不支持的项目类型: {}", other)),
        }
    }
}

// ========== 本地分支合并 ==========

/// 本地合并预检结果：能否干净合并 + 冲突文件列表。
#[derive(Debug, Serialize, Clone)]
pub(crate) struct LocalMergeCheck {
    /// true 表示无冲突可直接合并
    pub(crate) can_merge: bool,
    /// 冲突文件路径列表（无冲突时为空）
    pub(crate) conflict_files: Vec<String>,
    /// 中文提示
    pub(crate) message: String,
}
