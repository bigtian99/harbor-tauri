use crate::models::{
    HarborConfig, LEGACY_FRONTEND_DOCKERFILE_TEMPLATE, LEGACY_FRONTEND_NGINX_TEMPLATE,
    MAX_CACHE_ENTRIES, APP_CONFIG_DIR,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);
pub(crate) static CURRENT_PID: Mutex<Option<u32>> = Mutex::new(None);

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

pub(crate) fn render_template(template: &str, replacements: &[(&str, String)]) -> String {
    replacements
        .iter()
        .fold(template.to_string(), |content, (key, value)| {
            content.replace(&format!("{{{{{}}}}}", key), value)
        })
}

pub(crate) fn docker_json_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 清理临时目录中所有 jarporter-worktree- 和 jarporter-build- 前缀的残留目录
pub(crate) fn cleanup_old_temp_dirs() {
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

pub(crate) fn create_temp_build_dir() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成临时目录失败: {}", e))?
        .as_millis();
    let dir = std::env::temp_dir().join(format!("jarporter-build-{}-{}", std::process::id(), now));
    fs::create_dir_all(&dir).map_err(|e| format!("创建临时构建目录失败: {}", e))?;
    Ok(dir)
}

pub(crate) fn create_temp_worktree_path() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成临时 worktree 路径失败: {}", e))?
        .as_millis();
    Ok(std::env::temp_dir().join(format!("jarporter-worktree-{}-{}", std::process::id(), now)))
}

pub(crate) fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
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
pub(crate) fn strip_ansi_codes(text: &str) -> String {
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

pub(crate) fn command_output_text(output: &std::process::Output) -> String {
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    [stdout.trim().to_string(), stderr.trim().to_string()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn detect_npm_build_script(project_dir: &Path) -> Result<String, String> {
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

pub(crate) fn npm_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("jarporter")
        .join("npm-cache")
}

/// 根据 lock 文件内容生成 hash 作为缓存 key
pub(crate) fn lock_file_hash(build_dir: &Path) -> Option<String> {
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
pub(crate) fn try_restore_node_modules(build_dir: &Path, cache_key: &str) -> Result<bool, String> {
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
pub(crate) fn save_node_modules_to_cache(build_dir: &Path, cache_key: &str) {
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
pub(crate) fn find_maven_path() -> Option<String> {
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

/// 查找 Docker 可执行文件路径
pub(crate) fn find_docker_path() -> Option<String> {
    // 1. 直接从 PATH 查找（终端启动时有效）
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let candidate = PathBuf::from(dir).join("docker");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    // 2. Homebrew (Apple Silicon)
    let brew_arm = PathBuf::from("/opt/homebrew/bin/docker");
    if brew_arm.exists() {
        return Some(brew_arm.to_string_lossy().to_string());
    }
    // 3. Homebrew (Intel)
    let brew_intel = PathBuf::from("/usr/local/bin/docker");
    if brew_intel.exists() {
        return Some(brew_intel.to_string_lossy().to_string());
    }
    // 4. Docker.app bundle 内部路径
    let bundle = PathBuf::from("/Applications/Docker.app/Contents/Resources/bin/docker");
    if bundle.exists() {
        return Some(bundle.to_string_lossy().to_string());
    }

    None
}

/// macOS 专用：隐藏 Docker Desktop 窗口，防止弹出抢焦点
/// 在 docker 命令执行前调用，可阻止 Docker Desktop 弹出 UI
#[cfg(target_os = "macos")]
pub(crate) fn hide_docker_desktop() {
    // 先尝试隐藏窗口，再切回 Finder 让 Docker Desktop 不再保持前台
    Command::new("osascript")
        .args(["-e", r#"tell application "System Events" to set visible of process "Docker Desktop" to false"#])
        .output()
        .ok();
    // 让出一瞬间，确保窗口管理器处理完毕
    std::thread::sleep(Duration::from_millis(200));
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn hide_docker_desktop() {
    // 非 macOS 平台无操作
}

/// 从 dist 目录的直接父目录（即项目根目录）查找 nginx.conf
/// 只查一层，避免误用上级目录中宝塔面板等服务器配置
pub(crate) fn find_project_nginx(artifact_path: &Path) -> Option<String> {
    let project_dir = artifact_path.parent()?;
    let candidate = project_dir.join("nginx.conf");
    if candidate.is_file() {
        eprintln!("[JarPorter] 检测到项目 nginx.conf: {}", candidate.display());
        Some(fs::read_to_string(&candidate).ok()?)
    } else {
        None
    }
}

pub(crate) fn run_command(current_dir: &Path, command: &str, args: &[&str]) -> Result<String, String> {
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
    let child = match Command::new(&actual_command)
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

pub(crate) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    run_command(repo_path, "git", args)
}

pub(crate) fn repo_root_for(repo_path: &Path) -> Result<PathBuf, String> {
    git_output(repo_path, &["rev-parse", "--show-toplevel"])
        .map(|output| PathBuf::from(output.trim()))
        .map_err(|e| format!("不是有效的 Git 仓库: {}", e))
}

pub(crate) fn copy_artifact_to_output_internal(src: &Path, dst_dir: &Path) -> Result<String, String> {
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

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // 跳过不需要复制的文件
        if file_name_str == "README.md" || file_name_str == ".DS_Store" {
            continue;
        }

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
