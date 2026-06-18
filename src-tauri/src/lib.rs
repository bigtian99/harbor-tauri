use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);
static CURRENT_PID: Mutex<Option<u32>> = Mutex::new(None);

const APP_CONFIG_DIR: &str = "jarporter";
const LEGACY_CONFIG_DIR: &str = "jar-to-harbor";
const DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE: &str = r#"FROM {{BASE_IMAGE}}
COPY nginx.conf {{NGINX_CONF_PATH}}
COPY {{DIST_DIR}}/ /usr/share/nginx/html/
EXPOSE {{EXPOSE_PORT}}
CMD ["nginx", "-g", "daemon off;"]
"#;
const DEFAULT_FRONTEND_NGINX_TEMPLATE: &str = r#"server {
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
const LEGACY_FRONTEND_DOCKERFILE_TEMPLATE: &str = r#"FROM {{BASE_IMAGE}}
COPY nginx.conf {{NGINX_CONF_PATH}}
COPY {{DIST_DIR}}/ /usr/share/nginx/html/
EXPOSE {{EXPOSE_PORT}}
"#;
const LEGACY_FRONTEND_NGINX_TEMPLATE: &str = r#"server {
    listen {{EXPOSE_PORT}};
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
"#;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArtifactType {
    Jar,
    FrontendDist,
}

struct DockerBuildContext {
    context_dir: PathBuf,
    dockerfile_path: PathBuf,
    cleanup_file: Option<PathBuf>,
    cleanup_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PackageProjectType {
    Maven,
    Npm,
}

#[derive(Debug, Serialize)]
struct PackageFromBranchResult {
    artifact_path: String,
    backend_artifact_path: Option<String>,
    worktree_path: String,
    build_script: String,
    log: String,
    dockerfile_path: Option<String>,
    dockerfile_context: Option<String>,
}

#[derive(Debug, Serialize)]
struct GitBranchOption {
    name: String,
}

#[derive(Debug, Serialize)]
struct LastCommitInfo {
    hash: String,
    short_hash: String,
    message: String,
    author: String,
    date: String,
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CommitInfo {
    hash: String,
    short_hash: String,
    message: String,
    author: String,
    date: String,
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CommitListResult {
    commits: Vec<CommitInfo>,
    total: usize,
    page: usize,
    page_size: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuildRecord {
    id: String,
    timestamp: String,
    repo_path: String,
    branch: String,
    project_type: String,
    artifact_path: String,
    backend_artifact_path: Option<String>,
    image_name: Option<String>,
    image_tag: Option<String>,
    build_command: String,
    // 打包配置
    frontend_dir: Option<String>,
    package_manager: Option<String>,
    spring_profile: Option<String>,
    package_with_backend: bool,
    duration_ms: u64,
    status: String,
    log_summary: String,
    full_log: String,
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
    pub repo_path_history: Vec<String>,
    pub npm_package_manager: String,
    pub npm_registry: String,
    // 打包产物输出目录
    pub artifact_output_dir: String,
    // 历史打包记录
    pub build_history: Vec<BuildRecord>,
}

impl Default for HarborConfig {
    fn default() -> Self {
        let default_output_dir = dirs::desktop_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .to_string_lossy()
            .to_string();
        Self {
            harbor_url: "dockerhub.kubekey.local".to_string(),
            username: String::new(),
            password: String::new(),
            project: "tksy-admin".to_string(),
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
            repo_path_history: Vec::new(),
            npm_package_manager: "npm".to_string(),
            npm_registry: String::new(),
            // 打包产物输出目录默认为桌面
            artifact_output_dir: default_output_dir,
            // 历史打包记录默认为空
            build_history: Vec::new(),
        }
    }
}

// ========== 落地页生成相关数据结构 ==========

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SubChannelApiResponse {
    code: Option<i32>,
    message: Option<String>,
    data: Option<Vec<SubChannelData>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SubChannelData {
    id: String,
    #[serde(rename = "typeCode")]
    type_code: String,
    #[serde(rename = "subChannelName")]
    sub_channel_name: String,
    #[serde(rename = "subChannelLogo")]
    sub_channel_logo: Option<String>,
    #[serde(rename = "subChannelLink")]
    sub_channel_link: Option<String>,
    #[serde(rename = "productName")]
    product_name: Option<String>,
    #[serde(rename = "typeName")]
    type_name: Option<String>,
    #[serde(rename = "channelName")]
    channel_name: Option<String>,
    #[serde(rename = "subChannelDomain")]
    sub_channel_domain: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct LandingPageResult {
    id: String,
    type_code: String,
    name: String,
    output_dir: String,
    status: String,
    message: String,
}

impl ArtifactType {
    fn from_option(value: Option<String>) -> Result<Self, String> {
        match value.as_deref().unwrap_or("jar") {
            "jar" => Ok(Self::Jar),
            "frontend_dist" => Ok(Self::FrontendDist),
            other => Err(format!("不支持的产物类型: {}", other)),
        }
    }
}

impl PackageProjectType {
    fn from_string(value: String) -> Result<Self, String> {
        match value.as_str() {
            "maven" => Ok(Self::Maven),
            "npm" => Ok(Self::Npm),
            other => Err(format!("不支持的项目类型: {}", other)),
        }
    }
}

fn matches_default_template(value: &str, default_template: &str) -> bool {
    let value = value.trim();
    value.is_empty() || value == default_template.trim()
}

fn normalize_config(mut config: HarborConfig) -> HarborConfig {
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
    config
}

fn config_path_for(dir_name: &str) -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    config_dir.join(dir_name).join("config.json")
}

fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join(APP_CONFIG_DIR);
    fs::create_dir_all(&app_dir).ok();
    app_dir.join("config.json")
}

fn render_template(template: &str, replacements: &[(&str, String)]) -> String {
    replacements
        .iter()
        .fold(template.to_string(), |content, (key, value)| {
            content.replace(&format!("{{{{{}}}}}", key), value)
        })
}

fn docker_json_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 清理临时目录中所有 jarporter-worktree- 和 jarporter-build- 前缀的残留目录
fn cleanup_old_temp_dirs() {
    let temp = std::env::temp_dir();
    let prefixes = ["jarporter-worktree-", "jarporter-build-"];
    if let Ok(entries) = fs::read_dir(&temp) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if prefixes.iter().any(|p| name_str.starts_with(p)) {
                fs::remove_dir_all(entry.path()).ok();
            }
        }
    }
}

fn create_temp_build_dir() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成临时目录失败: {}", e))?
        .as_millis();
    let dir = std::env::temp_dir().join(format!("jarporter-build-{}-{}", std::process::id(), now));
    fs::create_dir_all(&dir).map_err(|e| format!("创建临时构建目录失败: {}", e))?;
    Ok(dir)
}

fn create_temp_worktree_path() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成临时 worktree 路径失败: {}", e))?
        .as_millis();
    Ok(std::env::temp_dir().join(format!("jarporter-worktree-{}-{}", std::process::id(), now)))
}

fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let target_path = dst.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;

        if file_type.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path)
                .map_err(|e| format!("复制文件失败 {}: {}", source_path.display(), e))?;
        }
    }

    Ok(())
}

/// 清理 ANSI 转义序列（颜色码等），让终端输出在日志中可读
fn strip_ansi_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' && chars.peek() == Some(&'[') {
            // 跳过整个 ANSI 转义序列 \x1b[...m
            chars.next(); // skip '['
            while let Some(&c) = chars.peek() {
                if c.is_ascii_alphabetic() {
                    chars.next(); // skip the terminating letter
                    break;
                }
                chars.next();
            }
        } else {
            result.push(ch);
        }
    }
    result
}

fn command_output_text(output: &std::process::Output) -> String {
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    [stdout.trim().to_string(), stderr.trim().to_string()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn detect_npm_build_script(project_dir: &Path) -> Result<String, String> {
    let package_json_path = project_dir.join("package.json");
    if !package_json_path.is_file() {
        return Err("package.json 不存在".to_string());
    }

    let content = fs::read_to_string(&package_json_path)
        .map_err(|e| format!("读取 package.json 失败: {}", e))?;

    let package_json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 package.json 失败: {}", e))?;

    let scripts = package_json
        .get("scripts")
        .and_then(|s| s.as_object())
        .ok_or_else(|| "package.json 中没有 scripts 字段".to_string())?;

    // 第一优先：精确匹配常见构建命令名
    let exact_candidates = ["build", "compile", "dist", "production", "release"];
    for candidate in &exact_candidates {
        if scripts.contains_key(*candidate) {
            return Ok(candidate.to_string());
        }
    }

    // 第二优先：以 build 开头的脚本（如 build:prod、build:test），优先选 prod/production
    let build_prefixed: Vec<String> = scripts
        .keys()
        .filter(|k| k.starts_with("build") && k.len() > 5)
        .cloned()
        .collect();

    if !build_prefixed.is_empty() {
        // 优先 prod/production，其次任意一个
        let preferred = [
            "build:prod",
            "build:production",
            "build-prod",
            "build-production",
        ];
        for candidate in &preferred {
            if build_prefixed.iter().any(|s| s == candidate) {
                return Ok(candidate.to_string());
            }
        }
        return Ok(build_prefixed[0].clone());
    }

    // 列出所有可用的 scripts
    let available_scripts: Vec<String> = scripts.keys().cloned().collect();
    Err(format!(
        "package.json 中没有找到构建命令 (build/compile/dist/build:prod/build:test 等)\n可用的 scripts: {}",
        available_scripts.join(", ")
    ))
}

// ── node_modules 缓存 ──────────────────────────────────────────────

/// 最多保留的缓存条目数
const MAX_CACHE_ENTRIES: usize = 5;

fn npm_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("jarporter")
        .join("npm-cache")
}

/// 根据 lock 文件内容生成 hash 作为缓存 key
fn lock_file_hash(build_dir: &Path) -> Option<String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let lock_files = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
    let lock_path = lock_files
        .iter()
        .map(|f| build_dir.join(f))
        .find(|p| p.is_file())?;

    let content = fs::read(&lock_path).ok()?;
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    Some(format!("{:016x}", hasher.finish()))
}

/// 尝试从缓存恢复 node_modules，返回 true 表示成功
/// 优先使用硬链接 (cp -al)，同文件系统下几乎瞬时完成（0.1s vs 30s）
fn try_restore_node_modules(build_dir: &Path, cache_key: &str) -> Result<bool, String> {
    let cache_path = npm_cache_dir().join(cache_key).join("node_modules");
    let target = build_dir.join("node_modules");

    if !cache_path.is_dir() {
        return Ok(false);
    }

    // 清理已有 node_modules
    if target.exists() {
        fs::remove_dir_all(&target).ok();
    }

    // 优先尝试硬链接 (cp -al)，同文件系统下 100K+ 文件几乎瞬时完成
    // npm install 对已安装的包会跳过，不修改硬链接文件；需要更新时会先删除再写入，不会污染缓存
    let link_output = Command::new("cp")
        .args([
            "-al",
            cache_path.to_str().unwrap(),
            target.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("cp 命令执行失败: {}", e))?;

    if !link_output.status.success() {
        // 硬链接失败（跨文件系统），回退到复制
        eprintln!(
            "[JarPorter] 硬链接恢复失败，回退到复制: {}",
            String::from_utf8_lossy(&link_output.stderr).trim()
        );
        let copy_output = Command::new("cp")
            .args(["-a", cache_path.to_str().unwrap(), target.to_str().unwrap()])
            .output()
            .map_err(|e| format!("cp 命令执行失败: {}", e))?;

        if !copy_output.status.success() {
            return Err(format!(
                "缓存恢复失败: {}",
                String::from_utf8_lossy(&copy_output.stderr)
            ));
        }
    }

    // 校验缓存恢复是否成功：检查 node_modules 是否有内容（至少一个子目录）
    let has_content = fs::read_dir(&target)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    if !has_content {
        fs::remove_dir_all(&target).ok();
        return Err("缓存恢复后 node_modules 为空".to_string());
    }

    Ok(true)
}

/// 将 node_modules 保存到缓存（LRU 策略，最多保留 MAX_CACHE_ENTRIES 个条目）
fn save_node_modules_to_cache(build_dir: &Path, cache_key: &str) {
    let cache_dir = npm_cache_dir();
    let cache_base = cache_dir.join(cache_key);
    let cache_path = cache_base.join("node_modules");
    let source = build_dir.join("node_modules");

    if !source.is_dir() {
        return;
    }

    // 如果缓存已存在（相同 key），更新其修改时间即可
    if cache_path.is_dir() {
        // touch 更新 mtime，标记为最近使用
        Command::new("touch").arg(&cache_base).output().ok();
        return;
    }

    // LRU 淘汰：超过上限时删除最旧的条目
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| {
                let mtime = e.metadata().ok()?.modified().ok()?;
                Some((mtime, e.path()))
            })
            .collect();

        // 按修改时间排序，最旧的在前
        dirs.sort_by_key(|(mtime, _)| *mtime);

        // 删除超出上限的旧条目
        let to_remove = dirs
            .len()
            .saturating_sub(MAX_CACHE_ENTRIES.saturating_sub(1));
        for (_, path) in dirs.iter().take(to_remove) {
            eprintln!("[JarPorter] 淘汰旧缓存: {}", path.display());
            fs::remove_dir_all(path).ok();
        }
    }

    // 准备目录
    if cache_path.exists() {
        fs::remove_dir_all(&cache_path).ok();
    }
    fs::create_dir_all(&cache_base).ok();

    // 优先硬链接，跨文件系统时回退到复制
    let link_result = Command::new("cp")
        .args([
            "-al",
            source.to_str().unwrap(),
            cache_path.to_str().unwrap(),
        ])
        .output();

    match link_result {
        Ok(output) if output.status.success() => {
            eprintln!("[JarPorter] 硬链接保存缓存成功 (hash={})", cache_key);
        }
        _ => {
            // 硬链接失败，回退到复制
            eprintln!(
                "[JarPorter] 硬链接保存失败，回退到复制 (hash={})",
                cache_key
            );
            Command::new("cp")
                .args(["-a", source.to_str().unwrap(), cache_path.to_str().unwrap()])
                .output()
                .ok();
        }
    }
}

/// 查找 Maven 可执行文件路径
fn find_maven_path() -> Option<String> {
    // 1. 检查环境变量
    if let Ok(m2_home) = std::env::var("M2_HOME") {
        let path = PathBuf::from(m2_home).join("bin/mvn");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    if let Ok(maven_home) = std::env::var("MAVEN_HOME") {
        let path = PathBuf::from(maven_home).join("bin/mvn");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    // 2. 检查用户 home 目录下的常见安装位置
    if let Some(home) = dirs::home_dir() {
        // SDKMAN
        let sdkman_mvn = home.join(".sdkman/candidates/maven/current/bin/mvn");
        if sdkman_mvn.exists() {
            return Some(sdkman_mvn.to_string_lossy().to_string());
        }
        // Homebrew (Apple Silicon)
        let brew_arm = PathBuf::from("/opt/homebrew/bin/mvn");
        if brew_arm.exists() {
            return Some(brew_arm.to_string_lossy().to_string());
        }
        // Homebrew (Intel)
        let brew_intel = PathBuf::from("/usr/local/bin/mvn");
        if brew_intel.exists() {
            return Some(brew_intel.to_string_lossy().to_string());
        }
    }

    // 3. 检查 IntelliJ IDEA 内置 Maven
    if let Some(home) = dirs::home_dir() {
        let idea_dir = home.join("Library/Application Support/JetBrains");
        if idea_dir.exists() {
            // 按版本倒序，优先使用最新版本
            if let Ok(entries) = fs::read_dir(&idea_dir) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with("IntelliJIdea"))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                versions.sort_by(|a, b| b.cmp(a)); // 倒序

                for version in versions {
                    let mvn_path = idea_dir
                        .join(&version)
                        .join("plugins/maven/lib/maven3/bin/mvn");
                    if mvn_path.exists() {
                        return Some(mvn_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    None
}

fn run_command(current_dir: &Path, command: &str, args: &[&str]) -> Result<String, String> {
    if CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("构建已取消".to_string());
    }

    // 对 mvn 命令特殊处理，查找完整路径
    let actual_command = if command == "mvn" {
        find_maven_path().unwrap_or_else(|| "mvn".to_string())
    } else {
        command.to_string()
    };

    // 使用 spawn 替代 output，以便追踪 PID 支持取消
    let mut child = match Command::new(&actual_command)
        .args(args)
        .current_dir(current_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => {
            *CURRENT_PID.lock().unwrap() = Some(c.id());
            c
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 通过 login shell 执行，确保加载 nvm/pyenv 等环境
            let full_cmd = format!("{} {}", actual_command, args.join(" "));
            match Command::new("sh")
                .args(["-l", "-c", &full_cmd])
                .current_dir(current_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(c) => {
                    *CURRENT_PID.lock().unwrap() = Some(c.id());
                    c
                }
                Err(e2) => return Err(format!("启动命令失败 {}: {}", actual_command, e2)),
            }
        }
        Err(e) => return Err(format!("启动命令失败 {}: {}", actual_command, e)),
    };

    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待命令结束失败: {}", e))?;

    *CURRENT_PID.lock().unwrap() = None;

    if CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("构建已取消".to_string());
    }

    let details = command_output_text(&output);

    if output.status.success() {
        Ok(details)
    } else if details.is_empty() {
        Err(format!("命令执行失败: {} {}", command, args.join(" ")))
    } else {
        Err(format!(
            "命令执行失败: {} {}\n{}",
            command,
            args.join(" "),
            details
        ))
    }
}

fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    run_command(repo_path, "git", args)
}

fn repo_root_for(repo_path: &Path) -> Result<PathBuf, String> {
    git_output(repo_path, &["rev-parse", "--show-toplevel"])
        .map(|output| PathBuf::from(output.trim()))
        .map_err(|e| format!("不是有效的 Git 仓库: {}", e))
}

fn list_known_git_branches(repo_root: &Path) -> Result<Vec<GitBranchOption>, String> {
    let output = git_output(
        repo_root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut branches = output
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !name.ends_with("/HEAD"))
        .map(|name| name.to_string())
        .collect::<Vec<_>>();
    branches.sort();
    branches.dedup();
    Ok(branches
        .into_iter()
        .map(|name| GitBranchOption { name })
        .collect())
}

fn cleanup_worktree(repo_path: &Path, worktree_path: &Path) {
    Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(worktree_path)
        .current_dir(repo_path)
        .output()
        .ok();
    fs::remove_dir_all(worktree_path).ok();
}

fn find_maven_artifact(worktree_path: &Path) -> Result<PathBuf, String> {
    let target_dir = worktree_path.join("target");
    if !target_dir.is_dir() {
        return Err(format!(
            "Maven 打包完成但未找到 target 目录: {}",
            target_dir.display()
        ));
    }

    let mut candidates = Vec::new();
    for entry in fs::read_dir(&target_dir)
        .map_err(|e| format!("读取 target 目录失败 {}: {}", target_dir.display(), e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("jar") {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if filename.ends_with("-sources.jar")
            || filename.ends_with("-javadoc.jar")
            || filename.starts_with("original-")
        {
            continue;
        }

        candidates.push(path);
    }

    match candidates.len() {
        0 => Err(format!(
            "Maven 打包完成但未找到可用 JAR: {}",
            target_dir.display()
        )),
        1 => Ok(candidates.remove(0)),
        _ => {
            let list = candidates
                .iter()
                .map(|path| format!("- {}", path.display()))
                .collect::<Vec<_>>()
                .join("\n");
            Err(format!("Maven 打包产生多个 JAR，请手动处理:\n{}", list))
        }
    }
}

fn find_npm_artifact(worktree_path: &Path) -> Result<PathBuf, String> {
    let dist_dir = worktree_path.join("dist");
    let index_path = dist_dir.join("index.html");
    if dist_dir.is_dir() && index_path.is_file() {
        Ok(dist_dir)
    } else {
        Err(format!(
            "npm 打包完成但未找到 dist/index.html: {}",
            index_path.display()
        ))
    }
}

fn prepare_custom_docker_context(
    config: &HarborConfig,
    artifact_path: &Path,
    artifact_type: ArtifactType,
    dockerfile_content: &str,
    image_name: &str,
    image_tag: &str,
    full_image: &str,
) -> Result<DockerBuildContext, String> {
    let context_dir = create_temp_build_dir()?;

    let replacements = [
        ("BASE_IMAGE", config.base_image.clone()),
        ("EXPOSE_PORT", config.expose_port.clone()),
        ("FRONTEND_BASE_IMAGE", config.frontend_base_image.clone()),
        ("FRONTEND_EXPOSE_PORT", config.frontend_expose_port.clone()),
        ("IMAGE_NAME", image_name.to_string()),
        ("IMAGE_TAG", image_tag.to_string()),
        ("FULL_IMAGE", full_image.to_string()),
    ];

    match artifact_type {
        ArtifactType::Jar => {
            // 复制 JAR 到构建上下文目录
            let jar_name = artifact_path
                .file_name()
                .ok_or("无法获取JAR文件名")?
                .to_string_lossy()
                .to_string();
            let dest_jar = context_dir.join(&jar_name);
            fs::copy(artifact_path, &dest_jar)
                .map_err(|e| format!("复制JAR到构建上下文失败: {}", e))?;

            // 渲染自定义 Dockerfile，支持 {{JAR_FILE}} 占位符
            let mut rendered = render_template(dockerfile_content, &replacements);
            // 替换 JAR 文件名占位符
            rendered = rendered.replace("{{JAR_FILE}}", &jar_name);
            let df_path = context_dir.join("Dockerfile");
            fs::write(&df_path, rendered)
                .map_err(|e| format!("写入Dockerfile失败: {}", e))?;

            Ok(DockerBuildContext {
                context_dir: context_dir.clone(),
                dockerfile_path: df_path,
                cleanup_file: None,
                cleanup_dir: Some(context_dir),
            })
        }
        ArtifactType::FrontendDist => {
            // 复制 dist 内容到 public/ 目录
            let public_dir = context_dir.join("public");
            copy_dir_contents(artifact_path, &public_dir)?;

            // 生成 nginx 配置
            let nginx_path = context_dir.join("nginx.conf");
            let nginx_content = render_template(&config.frontend_nginx_template, &replacements);
            fs::write(&nginx_path, nginx_content)
                .map_err(|e| format!("写入nginx配置失败: {}", e))?;

            // 渲染并写入自定义 Dockerfile
            let rendered = render_template(dockerfile_content, &replacements);
            let df_path = context_dir.join("Dockerfile");
            fs::write(&df_path, rendered)
                .map_err(|e| format!("写入Dockerfile失败: {}", e))?;

            Ok(DockerBuildContext {
                context_dir: context_dir.clone(),
                dockerfile_path: df_path,
                cleanup_file: None,
                cleanup_dir: Some(context_dir),
            })
        }
    }
}

fn prepare_jar_context(
    config: &HarborConfig,
    artifact_path: &Path,
) -> Result<DockerBuildContext, String> {
    if !artifact_path.is_file() {
        return Err(format!("JAR路径不是文件: {}", artifact_path.display()));
    }

    if artifact_path.extension().and_then(|ext| ext.to_str()) != Some("jar") {
        return Err(format!("请选择 .jar 文件: {}", artifact_path.display()));
    }

    let jar_dir = artifact_path
        .parent()
        .ok_or("无法获取JAR文件目录")?
        .to_owned();
    let jar_filename = artifact_path
        .file_name()
        .ok_or("无法获取JAR文件名")?
        .to_string_lossy()
        .to_string();
    let dockerfile_path = jar_dir.join(".Dockerfile.tmp");
    let escaped_jar_filename = docker_json_string(&jar_filename);
    let dockerfile_content = format!(
        "FROM {}\nCOPY [\"{}\", \"/app/app.jar\"]\nWORKDIR /app\nEXPOSE {}\nENTRYPOINT [\"java\", \"-jar\", \"app.jar\"]",
        config.base_image, escaped_jar_filename, config.expose_port
    );

    fs::write(&dockerfile_path, dockerfile_content)
        .map_err(|e| format!("写入Dockerfile失败: {}", e))?;

    Ok(DockerBuildContext {
        context_dir: jar_dir,
        dockerfile_path: dockerfile_path.clone(),
        cleanup_file: Some(dockerfile_path),
        cleanup_dir: None,
    })
}

fn prepare_frontend_dist_context(
    config: &HarborConfig,
    artifact_path: &Path,
    image_name: &str,
    image_tag: &str,
    full_image: &str,
) -> Result<DockerBuildContext, String> {
    if !artifact_path.is_dir() {
        return Err(format!(
            "前端 dist 路径不是目录: {}",
            artifact_path.display()
        ));
    }

    let index_path = artifact_path.join("index.html");
    if !index_path.exists() {
        return Err(format!(
            "前端 dist 目录缺少 index.html: {}",
            artifact_path.display()
        ));
    }

    let context_dir = create_temp_build_dir()?;
    let public_dir = context_dir.join("public");
    if let Err(error) = copy_dir_contents(artifact_path, &public_dir) {
        fs::remove_dir_all(&context_dir).ok();
        return Err(error);
    }

    let nginx_conf_path = "/etc/nginx/conf.d/default.conf";
    let dist_dir = "public";
    let replacements = [
        ("BASE_IMAGE", config.frontend_base_image.clone()),
        ("EXPOSE_PORT", config.frontend_expose_port.clone()),
        ("NGINX_CONF_PATH", nginx_conf_path.to_string()),
        ("DIST_DIR", dist_dir.to_string()),
        ("IMAGE_NAME", image_name.to_string()),
        ("IMAGE_TAG", image_tag.to_string()),
        ("FULL_IMAGE", full_image.to_string()),
    ];

    let dockerfile_path = context_dir.join("Dockerfile");
    let nginx_path = context_dir.join("nginx.conf");
    let dockerfile_content = render_template(&config.frontend_dockerfile_template, &replacements);
    let nginx_content = render_template(&config.frontend_nginx_template, &replacements);

    if let Err(error) = fs::write(&dockerfile_path, dockerfile_content) {
        fs::remove_dir_all(&context_dir).ok();
        return Err(format!("写入前端Dockerfile失败: {}", error));
    }
    if let Err(error) = fs::write(&nginx_path, nginx_content) {
        fs::remove_dir_all(&context_dir).ok();
        return Err(format!("写入nginx配置失败: {}", error));
    }

    Ok(DockerBuildContext {
        context_dir: context_dir.clone(),
        dockerfile_path,
        cleanup_file: None,
        cleanup_dir: Some(context_dir),
    })
}

#[tauri::command]
fn load_config() -> Result<HarborConfig, String> {
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
fn save_config(mut config: HarborConfig) -> Result<(), String> {
    let path = get_config_path();
    let legacy_path = config_path_for(LEGACY_CONFIG_DIR);
    if path.exists() || legacy_path.exists() {
        if let Ok(existing_config) = load_config() {
            config.build_history = existing_config.build_history;
        }
    }
    let config = normalize_config(config);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_git_branches(repo_path: String) -> Result<Vec<GitBranchOption>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        // 先执行 git fetch 获取远程最新分支信息
        Command::new("git")
            .args(["fetch", "--all", "--prune"])
            .current_dir(&repo_root)
            .output()
            .ok(); // 忽略 fetch 错误，继续获取分支列表
        list_known_git_branches(&repo_root)
    })
    .await
    .map_err(|e| format!("读取分支线程异常: {}", e))?
}

#[tauri::command]
async fn get_last_commit(
    repo_path: String,
    branch: Option<String>,
) -> Result<LastCommitInfo, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let branch = branch.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let rev = if branch.trim().is_empty() {
            "HEAD".to_string()
        } else {
            branch.trim().to_string()
        };
        let output = git_output(
            &repo_root,
            &["log", "-1", "--format=%H%n%s%n%an%n%ai", &rev],
        )?;
        let lines: Vec<&str> = output.lines().collect();
        if lines.len() < 4 {
            return Err("无法解析提交信息".to_string());
        }
        // 将 ISO 8601 日期转换为本地时间格式
        let date_str = lines[3].to_string();
        let formatted_date = chrono::DateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S %z")
            .map(|dt| {
                let local: chrono::DateTime<chrono::Local> = dt.with_timezone(&chrono::Local);
                local.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or(date_str);
        // 获取远程仓库 URL 并生成提交链接
        let commit_url = git_output(&repo_root, &["remote", "get-url", "origin"])
            .ok()
            .and_then(|url| remote_url_to_commit_url(&url.trim(), &lines[0]));
        Ok(LastCommitInfo {
            hash: lines[0].to_string(),
            short_hash: lines[0][..8.min(lines[0].len())].to_string(),
            message: lines[1].to_string(),
            author: lines[2].to_string(),
            date: formatted_date,
            url: commit_url,
        })
    })
    .await
    .map_err(|e| format!("读取提交信息线程异常: {}", e))?
}

/// 将 git remote URL 转换为 commit 页面 URL
fn remote_url_to_commit_url(remote_url: &str, commit_hash: &str) -> Option<String> {
    // 移除 .git 后缀
    let url = remote_url.trim_end_matches(".git");

    // 处理 SSH 格式: git@gitee.com:user/repo.git
    if url.starts_with("git@") {
        let without_prefix = url.strip_prefix("git@")?;
        let parts: Vec<&str> = without_prefix.splitn(2, ':').collect();
        if parts.len() == 2 {
            let host = parts[0];
            let path = parts[1].trim_start_matches('/');
            return Some(format!("https://{}/{}/commit/{}", host, path, commit_hash));
        }
    }

    // 处理 HTTPS 格式: https://gitee.com/user/repo.git
    if url.starts_with("https://") || url.starts_with("http://") {
        let without_protocol = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))?;
        return Some(format!(
            "https://{}/commit/{}",
            without_protocol, commit_hash
        ));
    }

    None
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AuthorInfo {
    name: String,
    count: usize,
}

#[tauri::command]
async fn get_commit_authors(
    repo_path: String,
    branch: Option<String>,
) -> Result<Vec<AuthorInfo>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let branch = branch.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let rev = if branch.trim().is_empty() {
            "HEAD".to_string()
        } else {
            branch.trim().to_string()
        };

        // 获取所有提交的作者信息
        let output = git_output(&repo_root, &["log", "--format=%an", &rev])?;

        // 统计每个作者的提交次数
        let mut author_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for line in output.lines() {
            let author = line.trim().to_string();
            if !author.is_empty() {
                *author_counts.entry(author).or_insert(0) += 1;
            }
        }

        // 转换为 AuthorInfo 列表并按提交次数排序
        let mut authors: Vec<AuthorInfo> = author_counts
            .into_iter()
            .map(|(name, count)| AuthorInfo { name, count })
            .collect();
        authors.sort_by(|a, b| b.count.cmp(&a.count));

        Ok(authors)
    })
    .await
    .map_err(|e| format!("获取提交者列表线程异常: {}", e))?
}

#[tauri::command]
async fn get_commit_list(
    repo_path: String,
    branch: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
    author_filter: Option<String>,
    message_filter: Option<String>,
) -> Result<CommitListResult, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let branch = branch.unwrap_or_default();
    let author_filter = author_filter.unwrap_or_default();
    let message_filter = message_filter.unwrap_or_default();
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(10).max(1).min(50);

    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let rev = if branch.trim().is_empty() {
            "HEAD".to_string()
        } else {
            branch.trim().to_string()
        };

        // 构建 git log 命令，支持搜索
        let mut git_args = vec![
            "log".to_string(),
            "--format=%H%n%s%n%an%n%ai".to_string(),
            rev.clone(),
        ];

        // 添加作者过滤
        if !author_filter.trim().is_empty() {
            git_args.push(format!("--author={}", author_filter.trim()));
        }

        // 添加提交信息过滤
        if !message_filter.trim().is_empty() {
            git_args.push(format!("--grep={}", message_filter.trim()));
        }

        // 获取过滤后的总提交数
        let mut count_args = vec!["rev-list".to_string(), "--count".to_string()];
        count_args.extend(git_args.iter().skip(2).cloned());
        let count_output = git_output(
            &repo_root,
            &count_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        )?;
        let total: usize = count_output.trim().parse().unwrap_or(0);

        // 获取远程仓库 URL
        let remote_url = git_output(&repo_root, &["remote", "get-url", "origin"])
            .ok()
            .map(|u| u.trim().to_string());

        // 添加分页参数
        let skip = (page - 1) * page_size;
        git_args.insert(1, format!("-{}", page_size));
        git_args.insert(2, format!("--skip={}", skip));

        let output = git_output(
            &repo_root,
            &git_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        )?;

        let mut commits = Vec::new();
        let lines: Vec<&str> = output.lines().collect();
        for chunk in lines.chunks(4) {
            if chunk.len() < 4 {
                continue;
            }
            let hash = chunk[0].to_string();
            let short_hash = hash[..8.min(hash.len())].to_string();
            let message = chunk[1].to_string();
            let author = chunk[2].to_string();
            let date_str = chunk[3].to_string();

            let formatted_date =
                chrono::DateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S %z")
                    .map(|dt| {
                        let local: chrono::DateTime<chrono::Local> =
                            dt.with_timezone(&chrono::Local);
                        local.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or(date_str);

            let url = remote_url
                .as_ref()
                .and_then(|u| remote_url_to_commit_url(u, &hash));

            commits.push(CommitInfo {
                hash,
                short_hash,
                message,
                author,
                date: formatted_date,
                url,
            });
        }

        Ok(CommitListResult {
            commits,
            total,
            page,
            page_size,
        })
    })
    .await
    .map_err(|e| format!("读取提交列表线程异常: {}", e))?
}

#[tauri::command]
async fn save_build_record(_app: tauri::AppHandle, record: BuildRecord) -> Result<(), String> {
    let mut config = load_config()?;
    config.build_history.insert(0, record);
    // 最多保留10条记录
    config.build_history.truncate(10);
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_build_history() -> Result<Vec<BuildRecord>, String> {
    let config = load_config()?;
    Ok(config.build_history)
}

#[tauri::command]
async fn clear_build_history() -> Result<(), String> {
    let mut config = load_config()?;
    config.build_history.clear();
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_build_record(record_id: String) -> Result<(), String> {
    let mut config = load_config()?;
    config.build_history.retain(|r| r.id != record_id);
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 删除产物文件或目录
#[tauri::command]
async fn delete_artifact_path(path: String) -> Result<(), String> {
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
async fn update_build_record_image(image_name: String, image_tag: String) -> Result<(), String> {
    let mut config = load_config()?;
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

fn copy_artifact_to_output_internal(src: &Path, dst_dir: &Path) -> Result<String, String> {
    if !src.exists() {
        return Err(format!("产物路径不存在: {}", src.display()));
    }

    fs::create_dir_all(dst_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let file_name = src.file_name().ok_or("无法获取文件名")?;
    let dst = dst_dir.join(file_name);

    if src.is_dir() {
        // 递归复制目录
        copy_dir_recursive(src, &dst).map_err(|e| format!("复制产物目录失败: {}", e))?;
    } else {
        // 复制文件
        fs::copy(src, &dst).map_err(|e| format!("复制产物文件失败: {}", e))?;
    }

    Ok(dst.to_string_lossy().to_string())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn copy_artifact_to_output(
    artifact_path: String,
    output_dir: String,
) -> Result<String, String> {
    let src = PathBuf::from(&artifact_path);
    let dst_dir = PathBuf::from(&output_dir);
    copy_artifact_to_output_internal(&src, &dst_dir)
}

#[tauri::command]
async fn list_npm_scripts(
    repo_path: String,
    frontend_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let worktree_path = create_temp_worktree_path()?;
    let repo_root = tauri::async_runtime::spawn_blocking(move || repo_root_for(&repo_path))
        .await
        .map_err(|e| format!("读取仓库线程异常: {}", e))??;

    // 创建临时 worktree 来读取 package.json
    let branch = "HEAD";
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let output = Command::new("git")
            .args(["worktree", "add", "--detach"])
            .arg(&worktree_path)
            .arg(branch)
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("创建 worktree 失败: {}", e))?;

        if !output.status.success() {
            fs::remove_dir_all(&worktree_path).ok();
            return Err(format!(
                "创建 worktree 失败:\n{}",
                command_output_text(&output)
            ));
        }

        // 确定 package.json 路径
        let pkg_path = if let Some(ref dir) = frontend_dir {
            if !dir.trim().is_empty() {
                worktree_path.join(dir.trim()).join("package.json")
            } else {
                worktree_path.join("package.json")
            }
        } else {
            worktree_path.join("package.json")
        };

        let scripts = if pkg_path.is_file() {
            let content = fs::read_to_string(&pkg_path)
                .map_err(|e| format!("读取 package.json 失败: {}", e))?;
            let package_json: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| format!("解析 package.json 失败: {}", e))?;
            package_json
                .get("scripts")
                .and_then(|s| s.as_object())
                .map(|m| m.keys().cloned().collect::<Vec<String>>())
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // 清理临时 worktree
        let _ = Command::new("git")
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_path)
            .current_dir(&repo_root)
            .output();

        Ok(scripts)
    })
    .await
    .map_err(|e| format!("读取 scripts 线程异常: {}", e))?
}

#[tauri::command]
async fn detect_frontend_dir(repo_path: String) -> Result<Option<String>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    // 先检查根目录
    if repo_path.join("package.json").is_file() {
        return Ok(None);
    }

    // 常见前端目录名，按优先级排序
    let candidates = ["frontend", "front-end", "web", "ui", "client", "app"];

    // 搜索一级子目录
    if let Ok(entries) = fs::read_dir(&repo_path) {
        // 优先匹配常见目录名
        for candidate in &candidates {
            let path = repo_path.join(candidate);
            if path.is_dir() && path.join("package.json").is_file() {
                return Ok(Some(candidate.to_string()));
            }
        }

        // 其次检查所有子目录（排除隐藏目录和常见非前端目录）
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || name == "node_modules"
                || name == "target"
                || name == "dist"
                || name == "build"
                || candidates.contains(&name.as_str())
            {
                continue;
            }
            if entry.path().join("package.json").is_file() {
                return Ok(Some(name));
            }
        }
    }

    Ok(None)
}

#[tauri::command]
async fn open_directory(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }

    let target = if path.is_file() {
        path.parent().unwrap_or(&path)
    } else {
        &path
    };

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(target)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn get_temp_dir() -> Result<String, String> {
    let temp_dir = std::env::temp_dir()
        .join("jarporter-landing-pages")
        .to_string_lossy()
        .to_string();
    Ok(temp_dir)
}

#[tauri::command]
async fn preview_landing_page(path: String) -> Result<(), String> {
    let html_path = PathBuf::from(&path).join("index.html");
    if !html_path.exists() {
        return Err(format!("文件不存在: {}", html_path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&html_path)
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", &html_path.to_string_lossy()])
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&html_path)
            .output()
            .map_err(|e| format!("打开预览失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn check_dockerfile(repo_path: String, branch: String) -> Result<bool, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Ok(false);
    }

    let repo_path_clone = repo_path.clone();
    let branch_clone = branch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path_clone)?;
        // 用 git show 检查分支上是否有 Dockerfile（大小写都试）
        for name in &["Dockerfile", "dockerfile"] {
            let ref_name = format!("{}:{}", branch_clone, name);
            let output = Command::new("git")
                .args(["show", &ref_name])
                .current_dir(&repo_root)
                .output()
                .map_err(|e| format!("git show 失败: {}", e))?;
            if output.status.success() {
                return Ok(true);
            }
        }
        Ok(false)
    })
    .await
    .map_err(|e| format!("检测线程异常: {}", e))?
}

#[tauri::command]
async fn package_from_branch(
    app: tauri::AppHandle,
    repo_path: String,
    branch: String,
    project_type: String,
    frontend_dir: Option<String>,
    build_script: Option<String>,
    package_manager: Option<String>,
    spring_profile: Option<String>,
    package_with_backend: Option<bool>,
) -> Result<PackageFromBranchResult, String> {
    reset_cancel_flag();
    let project_type = PackageProjectType::from_string(project_type)?;
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("请输入目标分支".to_string());
    }

    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    // 每次打包前清理之前的临时 worktree/build 残留目录
    cleanup_old_temp_dirs();

    // 提前加载配置，获取输出目录和包管理器设置
    let config = load_config().unwrap_or_default();

    // 提取仓库名，用于组织输出目录结构
    let repo_name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 生成时间戳，用于输出目录命名
    let build_timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let branch_slug = branch.replace('/', "_");

    // 确定基础输出目录：优先使用用户配置，为空则回退到桌面
    let output_base = if !config.artifact_output_dir.trim().is_empty() {
        PathBuf::from(&config.artifact_output_dir)
    } else {
        dirs::desktop_dir().unwrap_or_else(|| std::env::temp_dir())
    };

    // worktree 放在输出目录下（和产物同一目录，构建完清理只留产物）
    let worktree_path = output_base
        .join(&repo_name)
        .join(format!("_{}_{}", &branch_slug, &build_timestamp));

    // 确保父目录存在
    fs::create_dir_all(worktree_path.parent().unwrap())
        .map_err(|e| format!("创建 worktree 父目录失败: {}", e))?;

    eprintln!(
        "[JarPorter] Worktree 路径: {} (输出目录: {})",
        worktree_path.display(),
        output_base.display()
    );

    // 处理前端子目录路径
    let build_dir = if let Some(ref dir) = frontend_dir {
        if !dir.trim().is_empty() {
            Some(dir.trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    // 记录开始时间
    let start_time = std::time::Instant::now();

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 6,
            "message": "⬇️ 校验仓库并更新分支代码..."
        }),
    )
    .ok();

    let repo_path_clone = repo_path.clone();
    let branch_for_git = branch.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let repo_root = repo_root_for(&repo_path_clone)?;

        git_output(&repo_root, &["fetch", "--all", "--prune"])
            .map_err(|e| format!("更新分支代码失败: {}", e))?;

        git_output(
            &repo_root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{}^{{commit}}", branch_for_git),
            ],
        )
        .map_err(|_| format!("目标分支或引用不存在: {}", branch_for_git))?;

        Ok(repo_root)
    })
    .await
    .map_err(|e| format!("Git 校验线程异常: {}", e))?;

    let repo_root = result?;

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 20,
            "message": "🌿 已更新分支代码，创建隔离 worktree..."
        }),
    )
    .ok();

    let repo_root_for_worktree = repo_root.clone();
    let worktree_for_add = worktree_path.clone();
    let branch_for_add = branch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("git")
            .args(["worktree", "add", "--detach"])
            .arg(&worktree_for_add)
            .arg(&branch_for_add)
            .current_dir(&repo_root_for_worktree)
            .output()
            .map_err(|e| format!("创建 worktree 失败: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            fs::remove_dir_all(&worktree_for_add).ok();
            Err(format!(
                "创建 worktree 失败:\n{}",
                command_output_text(&output)
            ))
        }
    })
    .await
    .map_err(|e| format!("创建 worktree 线程异常: {}", e))??;

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 35,
            "message": "🧪 校验项目类型..."
        }),
    )
    .ok();

    // 确定实际构建目录
    let actual_build_path = if let Some(ref dir) = build_dir {
        worktree_path.join(dir)
    } else {
        worktree_path.clone()
    };

    match project_type {
        PackageProjectType::Maven if !actual_build_path.join("pom.xml").is_file() => {
            // 列出 worktree 中的文件帮助诊断
            let files_in_worktree = fs::read_dir(&actual_build_path)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| format!("  - {}", e.file_name().to_string_lossy()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_else(|e| format!("  无法读取目录: {}", e));
            cleanup_worktree(&repo_root, &worktree_path);
            return Err(format!(
                "目标分支缺少 pom.xml\n\n期望路径: {}\n\nworktree 中的文件:\n{}\n\n已清理临时 worktree: {}",
                actual_build_path.join("pom.xml").display(),
                files_in_worktree,
                worktree_path.display()
            ));
        }
        PackageProjectType::Npm if !actual_build_path.join("package.json").is_file() => {
            cleanup_worktree(&repo_root, &worktree_path);
            return Err(format!(
                "目标分支缺少 package.json，已清理临时 worktree: {}",
                worktree_path.display()
            ));
        }
        _ => {}
    }

    let package_message = match project_type {
        PackageProjectType::Maven => "☕ 执行 Maven 打包...".to_string(),
        PackageProjectType::Npm => "📦 执行 npm install...".to_string(),
    };
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 50,
            "message": package_message
        }),
    )
    .ok();

    let worktree_for_build = actual_build_path.clone();
    let worktree_root_for_backend = worktree_path.clone();
    let user_build_script = build_script.clone();
    // 使用用户指定的包管理器，默认 npm
    let pm = package_manager
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if config.npm_package_manager.trim().is_empty() {
                "npm".to_string()
            } else {
                config.npm_package_manager.clone()
            }
        });
    let npm_registry = config.npm_registry.clone();
    let app_for_build = app.clone();
    // 克隆配置用于闭包
    let spring_profile_clone = spring_profile.clone();
    let build_result = tauri::async_runtime::spawn_blocking(
        move || -> Result<(PathBuf, String, Vec<String>, Option<String>), String> {
            let mut logs = Vec::new();
            let build_script_used;

            match project_type {
                PackageProjectType::Maven => {
                    let mut mvn_args = vec!["clean", "package", "-DskipTests"];
                    let profile_arg;
                    if let Some(ref profile) = spring_profile_clone {
                        if !profile.trim().is_empty() {
                            profile_arg = format!("-Dspring.profiles.active={}", profile.trim());
                            mvn_args.push(&profile_arg);
                        }
                    }
                    build_script_used = format!("mvn {}", mvn_args.join(" "));
                    logs.push(run_command(&worktree_for_build, "mvn", &mvn_args)?);
                    let artifact_path = find_maven_artifact(&worktree_for_build)?;
                    Ok((artifact_path, build_script_used, logs, None))
                }
                PackageProjectType::Npm => {
                    // 如果用户勾选了"同时打包后端"，先检查 pom.xml 是否存在，若存在则启动并行构建
                    let backend_handle: Option<std::thread::JoinHandle<Result<(String, String), String>>> =
                        if package_with_backend.unwrap_or(false) && worktree_root_for_backend.join("pom.xml").is_file() {
                            let root = worktree_root_for_backend.clone();
                            logs.push("☕ 启动后端并行构建: mvn clean package -DskipTests".to_string());
                            app_for_build.emit(
                                "build-progress",
                                serde_json::json!({
                                    "percent": 55,
                                    "message": "📦 前端安装依赖... | ☕ 后端并行打包中"
                                }),
                            ).ok();
                            Some(std::thread::spawn(move || {
                                let mvn_log = run_command(&root, "mvn", &["clean", "package", "-DskipTests"])
                                    .map_err(|e| format!("后端 Maven 打包失败: {}", e))?;
                                let jar = find_maven_artifact(&root)?;
                                Ok((jar.to_string_lossy().to_string(), mvn_log))
                            }))
                        } else if package_with_backend.unwrap_or(false) {
                            logs.push("⚠️ 勾选了同时打包后端，但 worktree 根目录未找到 pom.xml，跳过后端打包".to_string());
                            None
                        } else {
                            None
                        };

                    // 前端构建（与后端并行进行）
                    // 检查缓存，依赖未变则跳过 install
                    let cached = if let Some(key) = lock_file_hash(&worktree_for_build) {
                        match try_restore_node_modules(&worktree_for_build, &key) {
                            Ok(true) => {
                                let msg = format!("✅ 命中缓存 (hash={})，跳过 {} install", &key[..12], pm);
                                app_for_build.emit(
                                    "build-progress",
                                    serde_json::json!({
                                        "percent": 52,
                                        "message": &msg
                                    }),
                                ).ok();
                                logs.push(msg);
                                true
                            }
                            Ok(false) => {
                                let msg = format!("❓ 缓存未命中 (hash={})，执行 {} install...", &key[..12], pm);
                                app_for_build.emit(
                                    "build-progress",
                                    serde_json::json!({
                                        "percent": 52,
                                        "message": &msg
                                    }),
                                ).ok();
                                logs.push(format!("cache miss (hash={})", key));
                                false
                            }
                            Err(e) => {
                                let msg = format!("⚠️ 缓存恢复失败: {}，重新 install", e);
                                app_for_build.emit(
                                    "build-progress",
                                    serde_json::json!({
                                        "percent": 52,
                                        "message": &msg
                                    }),
                                ).ok();
                                logs.push(msg);
                                false
                            }
                        }
                    } else {
                        let msg = "📦 未找到 lock 文件，执行 install...".to_string();
                        app_for_build.emit(
                            "build-progress",
                            serde_json::json!({
                                "percent": 52,
                                "message": &msg
                            }),
                        ).ok();
                        logs.push("未找到 lock 文件，跳过缓存".to_string());
                        false
                    };
                    if !cached {
                        // npm install 进度
                        let install_msg = if backend_handle.is_some() {
                            format!("📦 执行 {} install... | ☕ 后端并行打包中", pm)
                        } else {
                            format!("📦 执行 {} install（首次下载依赖，可能需要几分钟）...", pm)
                        };
                        app_for_build.emit(
                            "build-progress",
                            serde_json::json!({
                                "percent": 55,
                                "message": install_msg
                            }),
                        ).ok();
                        // 支持自定义 registry
                        if npm_registry.trim().is_empty() {
                            logs.push(run_command(&worktree_for_build, &pm, &["install"])?);
                        } else {
                            logs.push(run_command(
                                &worktree_for_build,
                                &pm,
                                &["install", "--registry", npm_registry.trim()],
                            )?);
                        }
                        if let Some(key) = lock_file_hash(&worktree_for_build) {
                            app_for_build.emit(
                                "build-progress",
                                serde_json::json!({
                                    "percent": 60,
                                    "message": format!("💾 保存 node_modules 到缓存 (hash={})...", &key[..12])
                                }),
                            ).ok();
                            save_node_modules_to_cache(&worktree_for_build, &key);
                            logs.push(format!("💾 node_modules 已缓存 (hash={})", key));
                        }
                    }
                    // 使用用户选择的构建命令，如果没有则自动检测
                    let script_name = if let Some(ref s) = user_build_script {
                        if !s.trim().is_empty() {
                            s.trim().to_string()
                        } else {
                            detect_npm_build_script(&worktree_for_build)?
                        }
                    } else {
                        detect_npm_build_script(&worktree_for_build)?
                    };
                    build_script_used = format!("{} run {}", pm, script_name);
                    let build_msg = if backend_handle.is_some() {
                        format!("🔨 前端构建: {} run {} | ☕ 后端并行打包中", pm, script_name)
                    } else {
                        format!("🔨 执行构建: {} run {}", pm, script_name)
                    };
                    app_for_build.emit(
                        "build-progress",
                        serde_json::json!({
                            "percent": 65,
                            "message": build_msg
                        }),
                    ).ok();
                    logs.push(run_command(
                        &worktree_for_build,
                        &pm,
                        &["run", &script_name],
                    )?);
                    let artifact_path = find_npm_artifact(&worktree_for_build)?;

                    // 等待后端构建完成（如果有）
                    let backend_artifact: Option<String> = if let Some(handle) = backend_handle {
                        app_for_build.emit(
                            "build-progress",
                            serde_json::json!({
                                "percent": 68,
                                "message": "✅ 前端构建完成，⏳ 等待后端 Maven 打包..."
                            }),
                        ).ok();
                        match handle.join() {
                            Ok(Ok((jar_path, mvn_log))) => {
                                logs.push(format!("☕ 后端 Maven 打包:\n{}", mvn_log));
                                logs.push(format!("✅ 后端打包成功: {}", jar_path));
                                Some(jar_path)
                            }
                            Ok(Err(e)) => {
                                logs.push(format!("❌ {}", e));
                                return Err(e);
                            }
                            Err(_) => {
                                logs.push("❌ 后端打包线程异常".to_string());
                                return Err("后端打包线程异常".to_string());
                            }
                        }
                    } else {
                        None
                    };

                    Ok((artifact_path, build_script_used, logs, backend_artifact))
                }
            }
        },
    )
    .await
    .map_err(|e| format!("打包线程异常: {}", e))?;

    let (artifact_path, build_script, logs, backend_artifact_path) = build_result?;

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 85,
            "message": "📋 复制产物到输出目录..."
        }),
    )
    .ok();

    let log = logs
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    // 产物输出目录 — worktree 同级的干净目录
    // worktree:  <output_base>/<repo_name>/_{branch}_{timestamp}/   (构建后清理)
    // artifact: <output_base>/<repo_name>/<branch>_<timestamp>/     (最终输出)
    let artifact_dir = output_base
        .join(&repo_name)
        .join(format!("{}_{}", &branch_slug, &build_timestamp));

    // 复制产物到输出目录
    let final_artifact_path = match copy_artifact_to_output_internal(&artifact_path, &artifact_dir)
    {
        Ok(copied_path) => {
            eprintln!("[JarPorter] ✅ 产物已输出到: {}", copied_path);
            copied_path
        }
        Err(e) => {
            eprintln!("[JarPorter] ❌ 产物复制失败: {}", e);
            artifact_path.to_string_lossy().to_string()
        }
    };

    // 复制后端产物到输出目录
    let backend_final_path: Option<String> = if let Some(ref backend_src) = backend_artifact_path {
        let backend_src_path = PathBuf::from(backend_src);
        match copy_artifact_to_output_internal(&backend_src_path, &artifact_dir) {
            Ok(copied) => {
                eprintln!("[JarPorter] ✅ 后端产物已输出到: {}", copied);
                Some(copied)
            }
            Err(e) => {
                eprintln!("[JarPorter] ❌ 后端产物复制失败: {}", e);
                Some(backend_src.clone())
            }
        }
    } else {
        None
    };

    // 清理 worktree — 只保留产物，删除源码
    // 清理前先检查是否有自定义 Dockerfile（支持大小写，检查 worktree 根目录和构建子目录）
    // 如果找到自定义 Dockerfile，保留 worktree 作为 Docker 构建上下文
    let (dockerfile_path, dockerfile_context): (Option<String>, Option<String>) = {
        let dockerfile_names = ["Dockerfile", "dockerfile"];
        let search_dirs = vec![worktree_path.clone(), actual_build_path.clone()];
        let mut found_df_path = None;
        let mut found_df_context = None;

        for search_dir in &search_dirs {
            for name in &dockerfile_names {
                let df_in_worktree = search_dir.join(name);
                if df_in_worktree.is_file() {
                    eprintln!("[JarPorter] 📄 检测到自定义 Dockerfile: {}", df_in_worktree.display());
                    // 使用 worktree 作为 Docker 构建上下文（包含 Dockerfile、JAR、tools/ 等）
                    found_df_path = Some(df_in_worktree.to_string_lossy().to_string());
                    found_df_context = Some(worktree_path.to_string_lossy().to_string());
                    break;
                }
            }
            if found_df_path.is_some() {
                break;
            }
        }
        if found_df_path.is_none() {
            eprintln!("[JarPorter] 未检测到自定义 Dockerfile（已检查: {:?}）", search_dirs);
        }
        (found_df_path, found_df_context)
    };

    if dockerfile_context.is_some() {
        // 有自定义 Dockerfile，保留 worktree 作为构建上下文
        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": 95,
                "message": "📄 检测到自定义 Dockerfile，保留 worktree 作为构建上下文..."
            }),
        )
        .ok();
        eprintln!("[JarPorter] 保留 worktree 用于 Docker 构建: {}", worktree_path.display());
    } else {
        // 没有自定义 Dockerfile，正常清理 worktree
        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": 95,
                "message": "🧹 清理 worktree 源码..."
            }),
        )
        .ok();
        cleanup_worktree(&repo_root, &worktree_path);
        eprintln!("[JarPorter] Worktree 已清理: {}", worktree_path.display());
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ 打包完成！产物已输出"
        }),
    )
    .ok();

    // 保存构建记录
    let record_id = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let log_summary = log.lines().take(3).collect::<Vec<_>>().join(" ");
    let duration_ms = start_time.elapsed().as_millis() as u64;

    let record = BuildRecord {
        id: record_id,
        timestamp,
        repo_path: repo_path.to_string_lossy().to_string(),
        branch: branch.clone(),
        project_type: format!("{:?}", project_type),
        artifact_path: final_artifact_path.clone(),
        backend_artifact_path: backend_final_path.clone(),
        image_name: None,
        image_tag: None,
        build_command: build_script.clone(),
        // 打包配置
        frontend_dir: frontend_dir.clone(),
        package_manager: package_manager.clone(),
        spring_profile: spring_profile.clone(),
        package_with_backend: package_with_backend.unwrap_or(false),
        duration_ms,
        status: "success".to_string(),
        log_summary,
        full_log: log.clone(),
    };

    if let Err(e) = save_build_record_direct(record) {
        eprintln!("[JarPorter] 保存构建记录失败: {}", e);
    } else {
        eprintln!("[JarPorter] 构建记录已保存");
    }

    Ok(PackageFromBranchResult {
        artifact_path: final_artifact_path,
        backend_artifact_path: backend_final_path,
        // 返回产物输出目录（worktree 已清理，或保留为 Docker 构建上下文）
        worktree_path: artifact_dir.to_string_lossy().to_string(),
        build_script,
        log,
        dockerfile_path,
        dockerfile_context,
    })
}

fn save_build_record_direct(record: BuildRecord) -> Result<(), String> {
    let mut config = load_config()?;
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
async fn detect_spring_profiles(repo_path: String, branch: String) -> Result<Vec<String>, String> {
    let repo_path = PathBuf::from(&repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let repo_root = repo_root_for(&repo_path)?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Ok(Vec::new());
    }

    // 用 git ls-tree 列出指定分支中所有 application-*.yml / application-*.properties 文件
    let output = Command::new("git")
        .args(["ls-tree", "-r", "--name-only", branch])
        .current_dir(&repo_root)
        .output()
        .map_err(|e| format!("执行 git ls-tree 失败: {}", e))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut profiles = Vec::new();

    for line in stdout.lines() {
        let file_name = line.rsplit('/').next().unwrap_or(line);

        // 匹配 application-{profile}.yml 或 application-{profile}.properties
        let prefix = "application-";
        if file_name.starts_with(prefix) {
            let rest = &file_name[prefix.len()..];
            // 去掉扩展名
            let profile = if let Some(pos) = rest.rfind('.') {
                &rest[..pos]
            } else {
                rest
            };
            // 过滤：不能为空、不能包含路径分隔符、不能是纯数字
            if !profile.is_empty()
                && !profile.contains('/')
                && !profile.contains('\\')
                && profile
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
                && !profiles.contains(&profile.to_string())
            {
                profiles.push(profile.to_string());
            }
        }
    }

    profiles.sort();
    Ok(profiles)
}

#[tauri::command]
fn cancel_build() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    // 杀掉当前运行的子进程
    if let Some(pid) = *CURRENT_PID.lock().unwrap() {
        eprintln!("[JarPorter] 🛑 取消构建，终止进程 PID={}", pid);
        let _ = Command::new("kill").arg(pid.to_string()).output();
    }
    Ok(())
}

fn reset_cancel_flag() {
    CANCEL_FLAG.store(false, Ordering::SeqCst);
    *CURRENT_PID.lock().unwrap() = None;
}

#[tauri::command]
async fn build_and_push(
    app: tauri::AppHandle,
    jar_path: String,
    image_name: String,
    image_tag: String,
    artifact_type: Option<String>,
    dockerfile_path: Option<String>,
    dockerfile_context: Option<String>,
) -> Result<String, String> {
    reset_cancel_flag();
    let config = load_config()?;
    let artifact_type = ArtifactType::from_option(artifact_type)?;

    if config.harbor_url.is_empty()
        || config.username.is_empty()
        || config.password.is_empty()
        || config.project.is_empty()
    {
        return Err("请先配置Harbor信息".to_string());
    }

    let artifact_path = PathBuf::from(&jar_path);
    if !artifact_path.exists() {
        return Err(format!("产物路径不存在: {}", jar_path));
    }

    // 生成标签: v.YY.MM.DD.HH.MM
    let final_tag = if image_tag.is_empty() || image_tag == "latest" {
        let now = chrono::Local::now();
        now.format("v.%y.%m.%d.%H.%M").to_string()
    } else {
        image_tag
    };

    let image_name_lower = image_name.to_lowercase();
    let full_image = format!(
        "{}/{}/{}:{}",
        config.harbor_url, config.project, image_name_lower, final_tag
    );

    // 步骤1: 准备Docker构建上下文
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 10,
            "message": "📝 准备 Docker 构建上下文..."
        }),
    )
    .ok();

    let build_context = if let Some(ref ctx_path) = dockerfile_context {
        // 有自定义 Dockerfile，使用 worktree 作为构建上下文
        let ctx = PathBuf::from(ctx_path);
        let df = if let Some(ref df_path) = dockerfile_path {
            PathBuf::from(df_path)
        } else {
            ctx.join("Dockerfile")
        };
        if !df.is_file() {
            return Err(format!("自定义Dockerfile不存在: {}", df.display()));
        }
        eprintln!("[JarPorter] 使用自定义Dockerfile，构建上下文: {}", ctx_path);
        // worktree 作为构建上下文，Docker 构建完后清理
        DockerBuildContext {
            context_dir: ctx.clone(),
            dockerfile_path: df,
            cleanup_file: None,
            cleanup_dir: Some(ctx),
        }
    } else if let Some(ref df_path) = dockerfile_path {
        let df = PathBuf::from(df_path);
        if df.is_file() {
            let custom_content = fs::read_to_string(&df)
                .map_err(|e| format!("读取自定义Dockerfile失败: {}", e))?;
            eprintln!("[JarPorter] 使用自定义Dockerfile (独立上下文): {}", df_path);
            prepare_custom_docker_context(
                &config,
                &artifact_path,
                artifact_type,
                &custom_content,
                &image_name_lower,
                &final_tag,
                &full_image,
            )?
        } else {
            return Err(format!("自定义Dockerfile不存在: {}", df_path));
        }
    } else {
        match artifact_type {
            ArtifactType::Jar => prepare_jar_context(&config, &artifact_path)?,
            ArtifactType::FrontendDist => prepare_frontend_dist_context(
                &config,
                &artifact_path,
                &image_name_lower,
                &final_tag,
                &full_image,
            )?,
        }
    };

    // 步骤2: docker build (阻塞操作放到线程池)
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 25,
            "message": "🔨 构建 Docker 镜像..."
        }),
    )
    .ok();

    let df_path_str = build_context.dockerfile_path.to_string_lossy().to_string();
    let context_dir = build_context.context_dir.clone();
    let full_image_clone = full_image.clone();
    let cleanup_file = build_context.cleanup_file.clone();
    let cleanup_dir = build_context.cleanup_dir.clone();

    let build_result = tauri::async_runtime::spawn_blocking(move || {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("构建已取消".to_string());
        }
        let mut child = Command::new("docker")
            .args([
                "build",
                "--platform",
                "linux/amd64",
                "-f",
                &df_path_str,
                "-t",
                &full_image_clone,
                ".",
            ])
            .current_dir(&context_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker build失败: {}", e))?;

        *CURRENT_PID.lock().unwrap() = Some(child.id());

        let output = child
            .wait_with_output()
            .map_err(|e| format!("docker build失败: {}", e))?;

        *CURRENT_PID.lock().unwrap() = None;

        if let Some(path) = cleanup_file {
            fs::remove_file(path).ok();
        }
        if let Some(path) = cleanup_dir {
            fs::remove_dir_all(path).ok();
        }
        Ok(output)
    })
    .await
    .map_err(|e| format!("构建线程异常: {}", e))?;

    let build_output = build_result?;
    if !build_output.status.success() {
        let stderr = String::from_utf8_lossy(&build_output.stderr);
        let stdout = String::from_utf8_lossy(&build_output.stdout);
        return Err(format!(
            "docker build失败:\n--- stderr ---\n{}\n--- stdout ---\n{}",
            stderr, stdout
        ));
    }

    // 步骤3: docker login (阻塞操作放到线程池)
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 55,
            "message": "🔐 登录 Harbor 镜像仓库..."
        }),
    )
    .ok();

    let harbor_url = config.harbor_url.clone();
    let username = config.username.clone();
    let password = config.password.clone();

    let login_result = tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new("docker")
            .args(["login", &harbor_url, "-u", &username, "--password-stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker login失败: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(password.as_bytes())
                .map_err(|e| e.to_string())?;
        }

        child
            .wait_with_output()
            .map_err(|e| format!("docker login失败: {}", e))
    })
    .await
    .map_err(|e| format!("登录线程异常: {}", e))?;

    let login_output = login_result?;
    if !login_output.status.success() {
        let stderr = String::from_utf8_lossy(&login_output.stderr);
        return Err(format!("docker login失败:\n{}", stderr));
    }

    // 步骤4: docker push (阻塞操作放到线程池)
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 75,
            "message": "📤 推送镜像到 Harbor..."
        }),
    )
    .ok();

    let full_image_push = full_image.clone();
    let push_result = tauri::async_runtime::spawn_blocking(move || {
        Command::new("docker")
            .args(["push", &full_image_push])
            .output()
    })
    .await
    .map_err(|e| format!("推送线程异常: {}", e))?;

    let push_output = push_result.map_err(|e| format!("执行docker push失败: {}", e))?;
    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("docker push失败:\n{}", stderr));
    }

    // 步骤5: 推送成功后删除本地镜像，避免本机堆积历史 tag（失败不影响结果）
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 92,
            "message": "🧹 清理本地镜像缓存..."
        }),
    )
    .ok();

    let full_image_remove = full_image.clone();
    let remove_result = tauri::async_runtime::spawn_blocking(move || {
        Command::new("docker")
            .args(["rmi", &full_image_remove])
            .output()
    })
    .await;

    // docker rmi 失败是常见情况（多 tag 共享、被其他镜像依赖等），不影响推送结果
    match remove_result {
        Ok(Ok(output)) if output.status.success() => {
            eprintln!("[JarPorter] 本地镜像已删除: {}", full_image);
        }
        _ => {
            eprintln!(
                "[JarPorter] 本地镜像清理跳过（不影响推送结果）: {}",
                full_image
            );
        }
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ 推送完成!"
        }),
    )
    .ok();

    Ok(format!("✅ 镜像推送成功!\n\n完整镜像: {}", full_image))
}

// ========== 落地页生成命令 ==========

#[tauri::command]
async fn fetch_sub_channels(api_url: String, ids: String) -> Result<Vec<SubChannelData>, String> {
    let url = format!("{}/api/sub-channel/list?ids={}", api_url.trim_end_matches('/'), ids);
    eprintln!("[JarPorter] 请求渠道数据: {}", url);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let api_response: SubChannelApiResponse = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if api_response.code != Some(200) {
        return Err(format!(
            "API 返回错误: code={:?}, message={:?}",
            api_response.code, api_response.message
        ));
    }

    Ok(api_response.data.unwrap_or_default())
}

/// 替换落地页模板内容
fn replace_landing_page_content(
    content: &str,
    sub_channel: &SubChannelData,
) -> String {
    let name = &sub_channel.sub_channel_name;
    let logo = sub_channel.sub_channel_logo.as_deref().unwrap_or("");
    let download_link = sub_channel.sub_channel_link.as_deref().unwrap_or("");

    let mut result = content.to_string();

    // 替换 <title> 标签内容
    if let Some(title_start) = result.find("<title>") {
        if let Some(title_end) = result[title_start..].find("</title>") {
            let new_title = format!("<title>{} - 官方下载</title>", name);
            result.replace_range(title_start..title_start + title_end + "</title>".len(), &new_title);
        }
    }

    // 替换 logo 图片路径
    if !logo.is_empty() {
        result = result
            .replace("src=\"logo.jpg\"", &format!("src=\"{}\"", logo))
            .replace("src=\"白鸽软件库.jpg\"", &format!("src=\"{}\"", logo))
            .replace("src=\"./image/logo.png\"", &format!("src=\"{}\"", logo))
            .replace("src='./image/logo.png'", &format!("src='{}'", logo));
    }

    // 替换 APK 下载链接（替换所有 tiankongshuyu 域名下的 .apk 链接）
    if !download_link.is_empty() {
        result = replace_apk_links(&result, download_link);
    }

    // 替换页面中的名称文本
    let known_names = [
        "白鸽软件库", "游戏库预览链接", "短剧融合影视",
        "短剧影视", "异次元 · 高清动漫阅读", "笔书阁", "Tofai", "漫蛙",
        "白鸽", "游戏库",
    ];
    for known in &known_names {
        // 替换 Nav brand 中的名称
        result = result.replace(&format!(">{}</span>", known), &format!(">{}</span>", name));
        // 替换 vis-card name
        result = result.replace(&format!(">{}</div>", known), &format!(">{}</div>", name));
        // 替换 header-title
        result = result.replace(&format!(">{}</span>", known), &format!(">{}</span>", name));
        // 替换 item-title
        result = result.replace(&format!("<span>{}</span>", known), &format!("<span>{}</span>", name));
        // 替换 H1 中的名称
        result = result.replace(known, name);
    }

    result
}

/// 替换所有 APK 下载链接（匹配 tiankongshuyu 域名 + .apk 后缀）
fn replace_apk_links(content: &str, new_link: &str) -> String {
    // 查找 .apk 链接的特征模式并替换
    let mut result = content.to_string();
    let patterns: &[&str] = &["https://"];
    for pattern in patterns {
        let mut search_start = 0;
        while let Some(pos) = result[search_start..].find(pattern) {
            let abs_pos = search_start + pos;
            let _link_start = abs_pos;
            // 找到链接结束位置（空格、引号、换行等）
            if let Some(link_end) = result[abs_pos..].find(|c: char| c == '"' || c == '\'' || c == ' ' || c == '\n' || c == '>') {
                let link = &result[abs_pos..abs_pos + link_end];
                if link.contains(".apk") {
                    result.replace_range(abs_pos..abs_pos + link_end, new_link);
                    search_start = abs_pos + new_link.len();
                } else {
                    search_start = abs_pos + link_end;
                }
            } else {
                break;
            }
        }
    }
    result
}

#[tauri::command]
async fn generate_landing_pages(
    app: tauri::AppHandle,
    api_url: String,
    ids: String,
    template_base: String,
    output_dir: String,
) -> Result<Vec<LandingPageResult>, String> {
    let mut results: Vec<LandingPageResult> = Vec::new();

    // Step 1: 获取子渠道数据
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 10,
            "message": "📡 获取子渠道数据..."
        }),
    ).ok();

    let sub_channels = match fetch_sub_channels(api_url.clone(), ids.clone()).await {
        Ok(data) => data,
        Err(e) => {
            return Err(format!("获取渠道数据失败: {}", e));
        }
    };

    if sub_channels.is_empty() {
        return Err("未获取到任何渠道数据，请检查 ID 是否正确".to_string());
    }

    let total = sub_channels.len();
    eprintln!("[JarPorter] 开始生成 {} 个落地页", total);

    // 确保输出目录存在
    let output_base = Path::new(&output_dir);
    fs::create_dir_all(output_base)
        .map_err(|e| format!("创建输出目录失败: {}", e))?;

    for (i, channel) in sub_channels.iter().enumerate() {
        let progress = 20 + ((i as f64 / total as f64) * 70.0) as i32;
        let safe_name = channel.sub_channel_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let channel_output_dir = output_base.join(format!("{}_{}", safe_name, channel.id));
        let channel_output_str = channel_output_dir.display().to_string();

        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": progress,
                "message": format!("📝 [{}/{}] 生成落地页: {}", i + 1, total, channel.sub_channel_name),
            }),
        ).ok();

        // 查找模板目录
        let template_dir = Path::new(&template_base).join(&channel.type_code);
        if !template_dir.exists() || !template_dir.is_dir() {
            results.push(LandingPageResult {
                id: channel.id.clone(),
                type_code: channel.type_code.clone(),
                name: channel.sub_channel_name.clone(),
                output_dir: channel_output_str,
                status: "error".to_string(),
                message: format!("模板目录不存在: {}", template_dir.display()),
            });
            continue;
        }

        // 复制模板目录
        if let Err(e) = copy_dir_recursive(&template_dir, &channel_output_dir) {
            results.push(LandingPageResult {
                id: channel.id.clone(),
                type_code: channel.type_code.clone(),
                name: channel.sub_channel_name.clone(),
                output_dir: channel_output_str,
                status: "error".to_string(),
                message: format!("复制模板失败: {}", e),
            });
            continue;
        }

        // 修改 index.html
        let html_path = channel_output_dir.join("index.html");
        if !html_path.exists() {
            results.push(LandingPageResult {
                id: channel.id.clone(),
                type_code: channel.type_code.clone(),
                name: channel.sub_channel_name.clone(),
                output_dir: channel_output_str,
                status: "error".to_string(),
                message: "模板中未找到 index.html".to_string(),
            });
            continue;
        }

        match fs::read_to_string(&html_path) {
            Ok(content) => {
                let new_content = replace_landing_page_content(&content, channel);
                if let Err(e) = fs::write(&html_path, &new_content) {
                    results.push(LandingPageResult {
                        id: channel.id.clone(),
                        type_code: channel.type_code.clone(),
                        name: channel.sub_channel_name.clone(),
                        output_dir: channel_output_str,
                        status: "error".to_string(),
                        message: format!("写入文件失败: {}", e),
                    });
                } else {
                    // 验证生成的文件是否可读
                    let verify_index = channel_output_dir.join("index.html");
                    let file_exists = verify_index.exists();
                    let file_size = fs::metadata(&verify_index).map(|m| m.len()).unwrap_or(0);
                    eprintln!(
                        "[JarPorter] ✅ 落地页生成成功: {} | output_dir={} | index.html exists={} size={}",
                        channel.sub_channel_name, channel_output_str, file_exists, file_size
                    );
                    results.push(LandingPageResult {
                        id: channel.id.clone(),
                        type_code: channel.type_code.clone(),
                        name: channel.sub_channel_name.clone(),
                        output_dir: channel_output_str,
                        status: "success".to_string(),
                        message: "生成成功".to_string(),
                    });
                }
            }
            Err(e) => {
                results.push(LandingPageResult {
                    id: channel.id.clone(),
                    type_code: channel.type_code.clone(),
                    name: channel.sub_channel_name.clone(),
                    output_dir: channel_output_str,
                    status: "error".to_string(),
                    message: format!("读取 index.html 失败: {}", e),
                });
            }
        }
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

// ========== FTP 上传功能 ==========

#[derive(Debug, Serialize, Clone)]
struct FtpUploadResult {
    id: String,
    url: String,
    status: String,
    message: String,
}

#[derive(Debug, Deserialize, Clone)]
struct FtpUploadItem {
    id: String,
    local_dir: String,
    remote_dir: String,
}

const FTP_HOST: &str = "120.77.204.231";
const FTP_USER: &str = "admin";
const FTP_PASS: &str = "pcm520..";
const FTP_BASE_DIR: &str = "common.tiankongshuyu.fun";

/// 生成 Python FTP 上传脚本并执行（Python ftplib 已验证稳定可靠）
fn run_python_ftp_upload(
    local_dir: &Path,
    remote_dir: &str,
) -> Result<(), String> {
    let python_script = format!(
        r#"
import os
import sys
from ftplib import FTP

def upload_dir(ftp, local_path, remote_path):
    """递归上传目录到 FTP"""
    for name in os.listdir(local_path):
        local_child = os.path.join(local_path, name)
        if os.path.isdir(local_child):
            # 创建并进入远程子目录
            try:
                ftp.cwd(name)
            except:
                ftp.mkd(name)
                ftp.cwd(name)
            upload_dir(ftp, local_child, os.path.join(remote_path, name))
            ftp.cwd('..')
        elif os.path.isfile(local_child):
            size = os.path.getsize(local_child)
            print(f'UPLOAD:{{name}}:{{size}}', flush=True)
            with open(local_child, 'rb') as f:
                ftp.storbinary(f'STOR {{name}}', f)
            print(f'DONE:{{name}}', flush=True)

try:
    ftp = FTP()
    ftp.connect('{ftp_host}', timeout=10)
    ftp.login('{ftp_user}', '{ftp_pass}')
    print('CONNECTED', flush=True)

    ftp.cwd('{ftp_base_dir}')
    print(f'CD:{{ftp.cwd()}}', flush=True)

    # 进入目标目录（不存在则创建）
    try:
        ftp.cwd('{remote_dir}')
    except:
        ftp.mkd('{remote_dir}')
        ftp.cwd('{remote_dir}')

    upload_dir(ftp, '{local_dir}', '{remote_dir}')
    ftp.quit()
    print('SUCCESS', flush=True)
except Exception as e:
    print(f'ERROR:{{e}}', flush=True)
    sys.exit(1)
"#,
        ftp_host = FTP_HOST,
        ftp_user = FTP_USER,
        ftp_pass = FTP_PASS,
        ftp_base_dir = FTP_BASE_DIR,
        remote_dir = remote_dir,
        local_dir = local_dir.to_string_lossy().replace('\\', "\\\\"),
    );

    let output = Command::new("python3")
        .arg("-c")
        .arg(&python_script)
        .output()
        .map_err(|e| format!("执行 Python 脚本失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    eprintln!("[JarPorter] 🐍 Python 输出:\n{}", stdout);
    if !stderr.is_empty() {
        eprintln!("[JarPorter] 🐍 Python 错误:\n{}", stderr);
    }

    if !output.status.success() {
        return Err(format!("Python FTP 上传失败:\n{}", stdout));
    }

    if stdout.contains("ERROR:") {
        return Err(format!("Python FTP 上传失败:\n{}", stdout));
    }

    Ok(())
}

#[tauri::command]
async fn upload_landing_to_ftp(
    app: tauri::AppHandle,
    items: Vec<FtpUploadItem>,
) -> Result<Vec<FtpUploadResult>, String> {
    let total = items.len();

    app.emit("build-progress", serde_json::json!({
        "percent": 5,
        "message": "📡 连接 FTP 服务器..."
    })).ok();

    let mut results = Vec::new();

    for (idx, item) in items.iter().enumerate() {
        let base_progress = 10 + ((idx as f64 / total as f64) * 80.0) as i32;
        eprintln!(
            "[JarPorter] 📤 开始上传 [{}/{}]: {} -> {}",
            idx + 1, total, item.local_dir, item.remote_dir
        );
        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": base_progress,
                "message": format!("📤 [{}/{}] 上传 {}...", idx + 1, total, item.remote_dir),
            }),
        )
        .ok();

        let local_dir = PathBuf::from(&item.local_dir);
        if !local_dir.is_dir() {
            eprintln!("[JarPorter] ❌ 本地目录不存在: {}", item.local_dir);
            results.push(FtpUploadResult {
                id: item.id.clone(),
                url: String::new(),
                status: "error".to_string(),
                message: format!("本地目录不存在: {}", item.local_dir),
            });
            continue;
        }

        match run_python_ftp_upload(&local_dir, &item.remote_dir) {
            Ok(()) => {
                let url = format!("https://{}/{}/", FTP_BASE_DIR, &item.remote_dir);
                eprintln!("[JarPorter] ✅ 上传成功: {}", url);
                results.push(FtpUploadResult {
                    id: item.id.clone(),
                    url,
                    status: "success".to_string(),
                    message: "上传成功".to_string(),
                });
            }
            Err(e) => {
                eprintln!("[JarPorter] ❌ 上传失败: {}", e);
                results.push(FtpUploadResult {
                    id: item.id.clone(),
                    url: String::new(),
                    status: "error".to_string(),
                    message: e,
                });
            }
        }

        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": base_progress + 70,
                "message": format!("✅ [{}/{}] {} 上传完成", idx + 1, total, item.remote_dir),
            }),
        )
        .ok();
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ FTP 上传完成！",
        }),
    )
    .ok();

    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_git_branches,
            get_last_commit,
            get_commit_list,
            get_commit_authors,
            list_npm_scripts,
            detect_frontend_dir,
            detect_spring_profiles,
            check_dockerfile,
            cancel_build,
            package_from_branch,
            build_and_push,
            open_directory,
            save_build_record,
            get_build_history,
            clear_build_history,
            delete_build_record,
            update_build_record_image,
            copy_artifact_to_output,
            delete_artifact_path,
            fetch_sub_channels,
            generate_landing_pages,
            upload_landing_to_ftp,
            get_temp_dir,
            preview_landing_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
