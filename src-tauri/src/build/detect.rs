use crate::utils::{command_output_text, repo_root_for, silent_command, CANCEL_FLAG, snapshot_build_pids};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

#[tauri::command]
pub async fn list_npm_scripts(
    repo_path: String,
    frontend_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let worktree_path = crate::utils::create_temp_worktree_path()?;
    let repo_root = tauri::async_runtime::spawn_blocking(move || repo_root_for(&repo_path))
        .await
        .map_err(|e| format!("读取仓库线程异常: {}", e))??;

    // 创建临时 worktree 来读取 package.json
    let branch = "HEAD";
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let output = silent_command("git")
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
        let _ = silent_command("git")
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
pub async fn detect_frontend_dir(repo_path: String) -> Result<Option<String>, String> {
    let repo_path = PathBuf::from(repo_path);
    crate::diag::diag_log(
        "build",
        &format!("detect_frontend_dir: checking {}", repo_path.display()),
    );
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    // 先检查根目录
    if repo_path.join("package.json").is_file() {
        crate::diag::diag_log("build", "detect_frontend_dir: found package.json in root, no subdir");
        return Ok(None);
    }

    // 常见前端目录名，按优先级排序
    let candidates = ["frontend", "front-end", "web", "ui", "client", "app"];

    // 搜索一级子目录
    if let Ok(entries) = fs::read_dir(&repo_path) {
        // 优先匹配常见目录名
        for candidate in &candidates {
            let path = repo_path.join(candidate);
            let has_pkg = path.join("package.json").is_file();
            crate::diag::diag_log(
                "build",
                &format!(
                    "detect_frontend_dir: checking candidate '{}' -> is_dir={} has_package.json={}",
                    candidate,
                    path.is_dir(),
                    has_pkg
                ),
            );
            if path.is_dir() && has_pkg {
                crate::diag::diag_log(
                    "build",
                    &format!("detect_frontend_dir: found frontend dir '{}'", candidate),
                );
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
                crate::diag::diag_log(
                    "build",
                    &format!("detect_frontend_dir: found other frontend dir '{}'", name),
                );
                return Ok(Some(name));
            }
        }
    }

    crate::diag::diag_log("build", "detect_frontend_dir: no frontend dir found");
    Ok(None)
}

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

#[tauri::command]
pub async fn check_dockerfile(repo_path: String, branch: String) -> Result<bool, String> {
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
            let output = silent_command("git")
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
pub async fn detect_spring_profiles(repo_path: String, branch: String) -> Result<Vec<String>, String> {
    let repo_path = repo_path.trim().to_string();
    let branch = branch.trim().to_string();
    if repo_path.is_empty() || branch.is_empty() {
        return Ok(Vec::new());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = crate::git::resolve_repo_root(&repo_path)?;

        // 用 git ls-tree 列出指定分支中所有 application-*.yml / application-*.properties 文件
        let output = silent_command("git")
            .args(["ls-tree", "-r", "--name-only", &branch])
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
    })
    .await
    .map_err(|e| format!("检测 Spring Profile 线程异常: {e}"))?
}

/// 模块 `server.port` 探测结果
#[derive(serde::Serialize)]
pub struct ModuleServerPort {
    pub port: u16,
    pub file: String,
}

/// 从配置文本里取端口：支持 `8081` / `"8081"` / `${SERVER_PORT:8081}`
fn extract_port(raw: &str) -> Option<u16> {
    let s = raw.trim().trim_matches(|c| c == '"' || c == '\'');
    let candidate = if let Some(inner) = s.strip_prefix("${") {
        let body = inner.split('}').next().unwrap_or(inner);
        body.rsplit(':').next().unwrap_or("").trim()
    } else {
        s.split_whitespace().next().unwrap_or("")
    };
    let digits: String = candidate.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u16>().ok().filter(|p| *p > 0)
}

/// 解析 application/boot 配置里的 `server.port`
fn parse_server_port(content: &str, is_properties: bool) -> Option<u16> {
    if is_properties {
        for line in content.lines() {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') || l.starts_with('!') {
                continue;
            }
            if let Some(rest) = l.strip_prefix("server.port") {
                if let Some(v) = rest.trim_start().strip_prefix('=') {
                    return extract_port(v);
                }
            }
        }
        return None;
    }

    // YAML：定位 `server:` 块内的 `port:`（也兼容扁平 `server.port:`）
    let mut in_server = false;
    let mut server_indent = 0usize;
    for line in content.lines() {
        let without_comment = line.split('#').next().unwrap_or("");
        let trimmed = without_comment.trim_end();
        if trimmed.trim().is_empty() {
            continue;
        }
        let indent = trimmed.len() - trimmed.trim_start().len();
        let t = trimmed.trim_start();

        if in_server && indent <= server_indent {
            in_server = false;
        }
        if !in_server {
            if let Some(v) = t.strip_prefix("server.port:") {
                if let Some(p) = extract_port(v) {
                    return Some(p);
                }
            }
            if let Some(v) = t.strip_prefix("server:") {
                if v.trim().is_empty() {
                    in_server = true;
                    server_indent = indent;
                }
            }
            continue;
        }
        if let Some(v) = t.strip_prefix("port:") {
            if let Some(p) = extract_port(v) {
                return Some(p);
            }
        }
    }
    None
}

/// 从指定分支的某个 Maven 模块读取实际 `server.port`（application/boot 配置）。
/// 供「手选打包模块」回填容器端口，避免镜像被强制成全局默认端口。
#[tauri::command]
pub async fn detect_module_server_port(
    repo_path: String,
    branch: String,
    module_rel_path: String,
    spring_profile: Option<String>,
) -> Result<Option<ModuleServerPort>, String> {
    let repo_path = repo_path.trim().to_string();
    let branch = branch.trim().to_string();
    let module = module_rel_path.trim().trim_matches('/').to_string();
    if repo_path.is_empty() || branch.is_empty() {
        return Ok(None);
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<Option<ModuleServerPort>, String> {
        let repo_root = crate::git::resolve_repo_root(&repo_path)?;

        let output = silent_command("git")
            .args(["ls-tree", "-r", "--name-only", &branch])
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("执行 git ls-tree 失败: {e}"))?;
        if !output.status.success() {
            return Ok(None);
        }

        let prefix = if module.is_empty() {
            "src/main/resources/".to_string()
        } else {
            format!("{module}/src/main/resources/")
        };
        let profile = spring_profile.unwrap_or_default().trim().to_string();

        let is_config = |name: &str| {
            (name.starts_with("application") || name.starts_with("bootstrap"))
                && (name.ends_with(".yml")
                    || name.ends_with(".yaml")
                    || name.ends_with(".properties"))
        };
        // 优先级：命中 profile 的文件 > application* > bootstrap*；同组 yml/yaml 优先于 properties
        let rank = |f: &str| -> u8 {
            let name = f.rsplit('/').next().unwrap_or(f);
            let suffix_yaml = name.ends_with(".yml") || name.ends_with(".yaml");
            if !profile.is_empty()
                && (name == format!("application-{profile}.yml")
                    || name == format!("application-{profile}.yaml")
                    || name == format!("application-{profile}.properties")
                    || name == format!("bootstrap-{profile}.yml")
                    || name == format!("bootstrap-{profile}.yaml")
                    || name == format!("bootstrap-{profile}.properties"))
            {
                return if suffix_yaml { 0 } else { 1 };
            }
            let base = if name.starts_with("application") { 2 } else { 4 };
            base + if suffix_yaml { 0 } else { 1 }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut files: Vec<String> = stdout
            .lines()
            .filter(|l| l.starts_with(&prefix))
            .filter(|l| is_config(l.rsplit('/').next().unwrap_or("")))
            .map(|l| l.to_string())
            .collect();
        files.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.cmp(b)));

        for f in files {
            let out = silent_command("git")
                .args(["show", &format!("{branch}:{f}")])
                .current_dir(&repo_root)
                .output()
                .map_err(|e| format!("git show 失败: {e}"))?;
            if !out.status.success() {
                continue;
            }
            let content = String::from_utf8_lossy(&out.stdout);
            if let Some(port) = parse_server_port(&content, f.ends_with(".properties")) {
                crate::diag::diag_log(
                    "build",
                    &format!("detect_module_server_port module={module} file={f} port={port}"),
                );
                return Ok(Some(ModuleServerPort { port, file: f }));
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| format!("检测模块端口线程异常: {e}"))?
}

#[tauri::command]
pub fn cancel_build() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    let pids = snapshot_build_pids();
    crate::diag::diag_log(
        "build",
        &format!(
            "cancel_build: 已置取消标志（覆盖 Maven/npm/Docker build·push/FTP/Harbor），跟踪 PID 数={}",
            pids.len()
        ),
    );
    // 杀掉当前运行的全部子进程（并行 push / 多模块打包时可能不止一个）
    for pid in pids {
        crate::diag::diag_log("build", &format!("🛑 取消构建，终止进程 PID={}", pid));
        #[cfg(unix)]
        {
            let _ = silent_command("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
            std::thread::sleep(std::time::Duration::from_millis(200));
            let _ = silent_command("kill")
                .args(["-KILL", &pid.to_string()])
                .output();
        }
        #[cfg(not(unix))]
        {
            let _ = silent_command("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output();
        }
    }
    Ok(())
}

#[cfg(test)]
mod server_port_tests {
    use super::{extract_port, parse_server_port};

    #[test]
    fn parses_yaml_server_block() {
        let y = "spring:\n  application:\n    name: x\nserver:\n  port: 8081\n";
        assert_eq!(parse_server_port(y, false), Some(8081));
    }

    #[test]
    fn parses_flat_yaml_key() {
        assert_eq!(parse_server_port("server.port: 9090\n", false), Some(9090));
    }

    #[test]
    fn parses_properties() {
        assert_eq!(parse_server_port("server.port=8181\n", true), Some(8181));
        assert_eq!(parse_server_port("server.port = 8182\n", true), Some(8182));
    }

    #[test]
    fn ignores_management_and_context_port() {
        let y = "management:\n  port: 9000\nserver:\n  servlet:\n    context-path: /x\n";
        assert_eq!(parse_server_port(y, false), None);
    }

    #[test]
    fn parses_placeholder_default() {
        assert_eq!(extract_port("${SERVER_PORT:9090}"), Some(9090));
        assert_eq!(parse_server_port("server:\n  port: ${SERVER_PORT:7070}\n", false), Some(7070));
    }

    #[test]
    fn quoted_values() {
        assert_eq!(parse_server_port("server:\n  port: \"8083\"\n", false), Some(8083));
    }
}

