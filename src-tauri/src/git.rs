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
