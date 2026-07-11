use crate::utils::{command_output_text, repo_root_for, silent_command, CANCEL_FLAG, CURRENT_PID};
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
    let repo_path_str = repo_path.trim();
    let branch = branch.trim();
    if repo_path_str.is_empty() || branch.is_empty() {
        return Ok(Vec::new());
    }

    // Git URL 需要先克隆到缓存目录
    let repo_root = if crate::git::is_git_url(repo_path_str) {
        crate::git::ensure_cloned_repo(repo_path_str)?
    } else {
        let p = PathBuf::from(repo_path_str);
        if !p.is_dir() {
            return Err(format!("仓库路径不是目录: {}", p.display()));
        }
        repo_root_for(&p)?
    };

    // 用 git ls-tree 列出指定分支中所有 application-*.yml / application-*.properties 文件
    let output = silent_command("git")
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
pub fn cancel_build() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    // 杀掉当前运行的子进程
    if let Some(pid) = *CURRENT_PID.lock().unwrap() {
        crate::diag::diag_log("build", &format!("🛑 取消构建，终止进程 PID={}", pid));
        let _ = silent_command("kill").arg(pid.to_string()).output();
    }
    Ok(())
}

