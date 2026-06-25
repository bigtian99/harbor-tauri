use crate::models::{GitBranchOption, LocalMergeCheck};
use crate::utils::{git_output, repo_root_for};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn list_known_git_branches(repo_root: &Path) -> Result<Vec<GitBranchOption>, String> {
    let output = git_output(
        repo_root,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/remotes",
        ],
    )?;
    let mut branches = output
        .lines()
        .map(str::trim)
        .filter_map(|line| {
            // 形如 refs/remotes/origin/master
            // refs/remotes/origin/HEAD 是指向默认分支的 symbolic ref，非真实分支，需剔除
            let name = line.strip_prefix("refs/remotes/")?;
            if name.is_empty() || name.ends_with("/HEAD") {
                return None;
            }
            Some(name.to_string())
        })
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

// ========== 本地分支合并 ==========

/// 列出远程分支（refs/remotes/*，含 origin/ 前缀），用于远程分支合并的源/目标选择。
/// 先 fetch 同步远程引用，再复用 list_known_git_branches。
#[tauri::command]
pub async fn list_remote_branches(repo_path: String) -> Result<Vec<GitBranchOption>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        // 先 fetch 获取远程最新分支
        let _ = Command::new("git")
            .args(["fetch", "--all", "--prune"])
            .current_dir(&repo_root)
            .output();
        list_known_git_branches(&repo_root)
    })
    .await
    .map_err(|e| format!("读取远程分支线程异常: {e}"))?
}

/// 在仓库目录执行 git 命令，捕获 stdout/stderr 与退出码。
fn run_git_capture(repo_root: &PathBuf, args: &[&str]) -> (bool, String, String) {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output();
    match out {
        Ok(o) => (
            o.status.success(),
            String::from_utf8_lossy(&o.stdout).to_string(),
            String::from_utf8_lossy(&o.stderr).to_string(),
        ),
        Err(e) => (false, String::new(), format!("启动 git 失败: {e}")),
    }
}

/// 预检把远程 source 合并进远程 target 是否会冲突。不改动工作区。
///
/// source / target 形如 `origin/feature`、`origin/master`。用 `git merge-tree --write-tree target source`
/// （Git ≥ 2.38）直接对远程引用求值：
/// - 无冲突：退出码 0，stdout 输出 tree SHA。
/// - 有冲突：退出码 1，stdout 依次输出 tree SHA、空行、冲突文件列表。
///
/// 对老版本 Git（不识别 --write-tree），回退到 `git merge-tree $(git merge-base target source) target source`，
/// 解析输出中是否含冲突标记来判定。
#[tauri::command]
pub async fn check_remote_merge(
    repo_path: String,
    source: String,
    target: String,
) -> Result<LocalMergeCheck, String> {
    let repo_path = PathBuf::from(repo_path);
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("源分支和目标分支都不能为空".to_string());
    }
    if source == target {
        return Err("源分支和目标分支不能相同".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;

        // 优先用新语法 --write-tree，直接对远程引用求值
        let (ok, stdout, stderr) = run_git_capture(
            &repo_root,
            &["merge-tree", "--write-tree", "--no-messages", &target, &source],
        );
        if stderr.contains("unknown option") || stderr.contains("usage:") {
            // 老版本回退
            let (base_ok, base_out, _) = run_git_capture(&repo_root, &["merge-base", &target, &source]);
            if !base_ok {
                return Ok(LocalMergeCheck {
                    can_merge: false,
                    conflict_files: Vec::new(),
                    message: format!("无法计算 {} 与 {} 的共同祖先", target, source),
                });
            }
            let base = base_out.trim();
            let (_, tree_out, _) = run_git_capture(&repo_root, &["merge-tree", base, &target, &source]);
            let has_conflict = tree_out.contains("<<<<<<<") || tree_out.contains("=======") || tree_out.contains(">>>>>>>");
            return Ok(LocalMergeCheck {
                can_merge: !has_conflict,
                conflict_files: Vec::new(),
                message: if has_conflict {
                    "存在冲突".to_string()
                } else {
                    "无冲突，可直接合并".to_string()
                },
            });
        }

        if ok {
            Ok(LocalMergeCheck {
                can_merge: true,
                conflict_files: Vec::new(),
                message: "无冲突，可直接合并".to_string(),
            })
        } else {
            let conflict_files = parse_merge_tree_conflicts(&stdout);
            let message = if conflict_files.is_empty() {
                "存在冲突".to_string()
            } else {
                format!("存在冲突，涉及 {} 个文件", conflict_files.len())
            };
            Ok(LocalMergeCheck {
                can_merge: false,
                conflict_files,
                message,
            })
        }
    })
    .await
    .map_err(|e| format!("合并预检线程异常: {e}"))?
}

/// 解析 `git merge-tree --write-tree` 有冲突时的 stdout，提取冲突文件路径。
fn parse_merge_tree_conflicts(stdout: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut past_tree = false;
    for line in stdout.lines() {
        let line = line.trim_end();
        if !past_tree {
            past_tree = true;
            continue;
        }
        if let Some(pos) = line.rfind('\t') {
            let path = line[pos + 1..].trim().to_string();
            if !path.is_empty() && !files.contains(&path) {
                files.push(path);
            }
        }
    }
    files
}

/// 把远程 source 合并进远程 target。
///
/// target 形如 `origin/master`。从 target 提取本地分支名（去掉 `origin/` 前缀），
/// checkout 该本地分支（不存在则 git 自动从 origin/target 建跟踪分支，已存在则 pull 同步），
/// 然后 `git merge --no-ff origin/source`。冲突时 abort 回滚；成功按需 push 本地分支到远程。
#[tauri::command]
pub async fn merge_remote_branches(
    repo_path: String,
    source: String,
    target: String,
    push: bool,
) -> Result<String, String> {
    let repo_path = PathBuf::from(repo_path);
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("源分支和目标分支都不能为空".to_string());
    }
    if source == target {
        return Err("源分支和目标分支不能相同".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;

        // target 形如 origin/master，取本地分支名 master
        let local_target = target
            .strip_prefix("origin/")
            .unwrap_or(&target)
            .to_string();

        // checkout 本地目标分支。若本地不存在，git 会自动从 origin/<target> 创建跟踪分支。
        let (co_ok, _, co_err) = run_git_capture(&repo_root, &["checkout", &local_target]);
        if !co_ok {
            // 本地无该分支时，尝试显式从远程创建跟踪分支
            let (track_ok, _, track_err) = run_git_capture(
                &repo_root,
                &["checkout", "-b", &local_target, "--track", &target],
            );
            if !track_ok {
                return Err(format!(
                    "切换到目标分支 {} 失败：{}{}",
                    local_target,
                    co_err.trim(),
                    if track_err.trim().is_empty() { String::new() } else { format!("\n{}", track_err.trim()) }
                ));
            }
        } else {
            // 已存在本地分支，pull 同步到远程最新
            let _ = run_git_capture(&repo_root, &["pull", "--ff-only", "origin", &local_target]);
        }

        // 合并远程源分支（--no-ff 保留合并节点）
        let (m_ok, m_out, m_err) = run_git_capture(&repo_root, &["merge", "--no-ff", "--no-edit", &source]);
        if !m_ok {
            // 冲突或失败：abort 回滚，保持工作区干净
            let _ = Command::new("git")
                .args(["merge", "--abort"])
                .current_dir(&repo_root)
                .output();
            let detail = if m_err.contains("CONFLICT") || m_err.contains("conflict") {
                format!("合并 {} → {} 存在冲突，已自动中止合并。\n{}", source, target, m_err.trim())
            } else {
                format!("合并失败：{}", m_err.trim())
            };
            let conflicts: Vec<&str> = m_err.lines().filter(|l| l.contains("CONFLICT")).collect();
            let extra = if conflicts.is_empty() {
                String::new()
            } else {
                format!("\n冲突详情：\n{}", conflicts.join("\n"))
            };
            return Err(format!("{}{}", detail, extra));
        }

        let mut log = format!("✅ 已将 {} 合并进 {}\n{}", source, target, m_out.trim());

        // 可选：推送本地目标分支到远程
        if push {
            let (p_ok, _, p_err) = run_git_capture(&repo_root, &["push", "origin", &local_target]);
            if p_ok {
                log.push_str(&format!("\n\n📤 已推送 {} 到远程 origin", local_target));
            } else {
                log.push_str(&format!("\n\n⚠️ 本地合并成功，但推送到远程失败：{}", p_err.trim()));
            }
        }

        Ok(log)
    })
    .await
    .map_err(|e| format!("合并线程异常: {e}"))?
}
