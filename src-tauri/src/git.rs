use crate::models::GitBranchOption;
use crate::utils::{git_output, repo_root_for};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn list_known_git_branches(repo_root: &Path) -> Result<Vec<GitBranchOption>, String> {
    let output = git_output(
        repo_root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes",
        ],
    )?;
    let mut seen = std::collections::BTreeSet::new();
    for raw in output.lines() {
        let name = raw.trim();
        if name.is_empty() || name.ends_with("/HEAD") {
            continue;
        }
        // 去掉远程前缀（如 origin/develop → develop），多个远程同名分支只保留一个
        let stripped = name.split_once('/').map(|(_, rest)| rest).unwrap_or(name);
        seen.insert(stripped.to_string());
    }
    Ok(seen.into_iter().map(|name| GitBranchOption { name }).collect())
}

pub(crate) fn cleanup_worktree(repo_path: &Path, worktree_path: &Path) {
    Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(worktree_path)
        .current_dir(repo_path)
        .output()
        .ok();
    fs::remove_dir_all(worktree_path).ok();
}

pub(crate) fn find_maven_artifact(worktree_path: &Path) -> Result<PathBuf, String> {
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

pub(crate) fn find_npm_artifact(worktree_path: &Path) -> Result<PathBuf, String> {
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

#[tauri::command]
pub async fn list_git_branches(repo_path: String) -> Result<Vec<GitBranchOption>, String> {
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

/// 判断字符串是否为 Git URL
pub(crate) fn is_git_url(s: &str) -> bool {
    s.starts_with("http://")
        || s.starts_with("https://")
        || s.starts_with("git@")
        || s.ends_with(".git")
}

/// 从 Git URL 提取仓库名（去掉 .git 后缀，取最后一段）
pub(crate) fn repo_name_from_url(url: &str) -> String {
    let last = url.split('/').next_back().unwrap_or("repo");
    last.strip_suffix(".git").unwrap_or(last).to_string()
}

/// 通过 git ls-remote 获取远程仓库的分支列表（无需克隆）
#[tauri::command]
pub async fn list_git_branches_from_url(url: String) -> Result<Vec<GitBranchOption>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("git")
            .args(["ls-remote", "--heads", url.trim()])
            .output()
            .map_err(|e| format!("执行 git ls-remote 失败: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("获取远程分支失败: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut branches: Vec<GitBranchOption> = stdout
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                if parts.len() == 2 {
                    let ref_name = parts[1].trim();
                    // refs/heads/xxx → xxx
                    ref_name.strip_prefix("refs/heads/").map(|name| GitBranchOption {
                        name: name.to_string(),
                    })
                } else {
                    None
                }
            })
            .collect();
        branches.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(branches)
    })
    .await
    .map_err(|e| format!("读取远程分支线程异常: {}", e))?
}

/// 将 Git URL 浅克隆到缓存目录，返回本地路径
#[tauri::command]
pub async fn clone_repo(url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    let name = repo_name_from_url(&url);
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("jarporter")
        .join("repos")
        .join(&name);

    tauri::async_runtime::spawn_blocking(move || {
        if cache_dir.exists() {
            // 已存在，fetch 更新
            Command::new("git")
                .args(["fetch", "--all", "--prune"])
                .current_dir(&cache_dir)
                .output()
                .map_err(|e| format!("git fetch 失败: {}", e))?;
        } else {
            // 浅克隆，包含所有远程分支
            let output = Command::new("git")
                .args(["clone", "--depth", "1", "--no-single-branch", &url])
                .arg(&cache_dir)
                .output()
                .map_err(|e| format!("git clone 失败: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("克隆仓库失败: {}", stderr.trim()));
            }
        }

        Ok(cache_dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("克隆线程异常: {}", e))?
}
