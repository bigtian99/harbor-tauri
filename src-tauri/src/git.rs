use crate::models::{GitBranchOption, LocalMergeCheck, RemoteBranchListResult};
use crate::utils::{create_temp_worktree_path, git_output, repo_root_for, silent_command};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

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
    silent_command("git")
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
        silent_command("git")
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
        let output = silent_command("git")
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
    tauri::async_runtime::spawn_blocking(move || ensure_cloned_repo(&url).map(|p| p.to_string_lossy().to_string()))
        .await
        .map_err(|e| format!("克隆线程异常: {}", e))?
}

/// 同步版：确保远程 URL 对应的本地缓存仓库存在（存在则 fetch 更新，不存在则浅克隆），返回缓存目录。
pub(crate) fn ensure_cloned_repo(url: &str) -> Result<PathBuf, String> {
    let name = repo_name_from_url(url);
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("jarporter")
        .join("repos")
        .join(&name);

    if cache_dir.exists() {
        silent_command("git")
            .args(["fetch", "--all", "--prune"])
            .current_dir(&cache_dir)
            .output()
            .map_err(|e| format!("git fetch 失败: {}", e))?;
    } else {
        let output = silent_command("git")
            .args(["clone", "--depth", "1", "--no-single-branch", url])
            .arg(&cache_dir)
            .output()
            .map_err(|e| format!("git clone 失败: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("克隆仓库失败: {}", stderr.trim()));
        }
    }
    Ok(cache_dir)
}

// ========== 本地分支合并 ==========

/// 把用户输入（本地目录或 Git URL）解析成本地仓库根路径。
/// - Git URL：调 ensure_cloned_repo 克隆/更新到缓存目录后返回。
/// - 本地目录：直接 repo_root_for。
fn resolve_repo_root(input: &str) -> Result<PathBuf, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("仓库路径不能为空".to_string());
    }
    if is_git_url(input) {
        return ensure_cloned_repo(input);
    }
    let path = PathBuf::from(input);
    if !path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", path.display()));
    }
    repo_root_for(&path)
}

/// 列出远程分支（refs/remotes/*，含 origin/ 前缀），用于远程分支合并的源/目标选择。
///
/// 支持两种输入：
/// - 本地仓库目录：直接在该目录 fetch 后列分支。
/// - Git URL：自动克隆到缓存目录（存在则 fetch 更新），返回缓存路径与分支列表。
///
/// 返回 RemoteBranchListResult，其中 repo_path 为实际使用的本地路径，
/// 前端后续 check/merge 操作应使用该路径（URL 输入时是缓存目录，不是原始 URL）。
#[tauri::command]
pub async fn list_remote_branches(repo_path: String) -> Result<RemoteBranchListResult, String> {
    let repo_root = tauri::async_runtime::spawn_blocking(move || resolve_repo_root(&repo_path))
        .await
        .map_err(|e| format!("解析仓库线程异常: {e}"))??;

    tauri::async_runtime::spawn_blocking(move || {
        // fetch 同步远程引用
        let _ = silent_command("git")
            .args(["fetch", "--all", "--prune"])
            .current_dir(&repo_root)
            .output();
        let branches = list_known_git_branches(&repo_root)?;
        Ok(RemoteBranchListResult {
            repo_path: repo_root.to_string_lossy().to_string(),
            branches,
        })
    })
    .await
    .map_err(|e| format!("读取远程分支线程异常: {e}"))?
}

/// 在仓库目录执行 git 命令，捕获 stdout/stderr 与退出码。
fn run_git_capture(repo_root: &PathBuf, args: &[&str]) -> (bool, String, String) {
    let out = silent_command("git")
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
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("源分支和目标分支都不能为空".to_string());
    }
    if source == target {
        return Err("源分支和目标分支不能相同".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = resolve_repo_root(&repo_path)?;

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

/// 获取冲突文件在两个分支中的内容，用于左右对比展示。
#[tauri::command]
pub async fn get_merge_conflict_diff(
    repo_path: String,
    source: String,
    target: String,
    file_path: String,
) -> Result<crate::models::MergeConflictDetail, String> {
    use crate::models::MergeConflictDetail;
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    let file_path = file_path.trim().to_string();
    if source.is_empty() || target.is_empty() || file_path.is_empty() {
        return Err("参数不能为空".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = resolve_repo_root(&repo_path)?;

        let get_content = |git_ref: &str| -> String {
            let (ok, stdout, _) = run_git_capture(
                &repo_root,
                &["show", &format!("{}:{}", git_ref, file_path)],
            );
            if ok { stdout } else { String::from("(文件不存在)") }
        };

        let target_content = get_content(&target);
        let source_content = get_content(&source);

        let (_, diff, _) = run_git_capture(
            &repo_root,
            &["diff", &target, &source, "--", &file_path],
        );

        Ok(MergeConflictDetail {
            file_path,
            target_content,
            source_content,
            diff,
        })
    })
    .await
    .map_err(|e| format!("获取冲突文件内容线程异常: {e}"))?
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

/// 向前端发送合并进度（居中遮罩展示，不携带文件明细）。
fn emit_merge_progress(app: &tauri::AppHandle, percent: u8, message: &str) {
    let _ = app.emit(
        "merge-progress",
        serde_json::json!({
            "percent": percent,
            "message": message,
        }),
    );
}

/// 把远程 source 合并进远程 target，全程基于远程引用，不切换主仓库当前工作区分支。
///
/// 在隔离 worktree 中检出 target（如 `origin/master`），执行
/// `git merge --no-ff source`（如 `origin/feature`），再按需 push 到远程目标分支。
/// 冲突时 abort 并清理 worktree；主仓库 HEAD 与未提交改动保持不变。
#[tauri::command]
pub async fn merge_remote_branches(
    app: tauri::AppHandle,
    repo_path: String,
    source: String,
    target: String,
    push: bool,
) -> Result<String, String> {
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("源分支和目标分支都不能为空".to_string());
    }
    if source == target {
        return Err("源分支和目标分支不能相同".to_string());
    }
    let app_for_merge = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        emit_merge_progress(&app_for_merge, 5, "同步远程分支...");

        let repo_root = resolve_repo_root(&repo_path)?;

        let (fetch_ok, _, fetch_err) = run_git_capture(&repo_root, &["fetch", "--all", "--prune"]);
        if !fetch_ok {
            return Err(format!("拉取远程分支失败：{}", fetch_err.trim()));
        }

        emit_merge_progress(&app_for_merge, 20, "创建隔离合并环境...");

        let remote_target_branch = target
            .strip_prefix("origin/")
            .unwrap_or(&target)
            .to_string();

        let worktree_path = create_temp_worktree_path()?;
        let worktree_path_str = worktree_path
            .to_str()
            .ok_or_else(|| "临时 worktree 路径无效".to_string())?
            .to_string();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("生成临时分支名失败: {e}"))?
            .as_millis();
        let temp_branch = format!("jarporter-merge-{}-{}", std::process::id(), now);

        let (wt_ok, _, wt_err) = run_git_capture(
            &repo_root,
            &[
                "worktree",
                "add",
                "-B",
                &temp_branch,
                &worktree_path_str,
                &target,
            ],
        );
        if !wt_ok {
            fs::remove_dir_all(&worktree_path).ok();
            return Err(format!("创建合并环境失败：{}", wt_err.trim()));
        }

        emit_merge_progress(
            &app_for_merge,
            40,
            &format!("正在合并 {source} → {target}..."),
        );

        let merge_result: Result<String, String> = (|| {
            let (m_ok, _, m_err) = run_git_capture(
                &worktree_path,
                &["merge", "--no-ff", "--no-edit", &source],
            );
            if !m_ok {
                let _ = silent_command("git")
                    .args(["merge", "--abort"])
                    .current_dir(&worktree_path)
                    .output();
                if m_err.contains("CONFLICT") || m_err.contains("conflict") {
                    let conflict_count = m_err.lines().filter(|l| l.contains("CONFLICT")).count();
                    let count_hint = if conflict_count > 0 {
                        format!("（约 {} 处）", conflict_count)
                    } else {
                        String::new()
                    };
                    return Err(format!(
                        "合并 {source} → {target} 存在冲突{count_hint}，已自动中止"
                    ));
                }
                let first_line = m_err
                    .lines()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("未知错误")
                    .trim()
                    .to_string();
                return Err(format!("合并失败：{first_line}"));
            }

            let (head_ok, head_out, _) = run_git_capture(&worktree_path, &["rev-parse", "HEAD"]);
            let merge_sha = if head_ok {
                head_out.trim().to_string()
            } else {
                String::new()
            };

            if push {
                emit_merge_progress(
                    &app_for_merge,
                    75,
                    &format!("推送到 origin/{remote_target_branch}..."),
                );
                let push_ref = format!("HEAD:refs/heads/{remote_target_branch}");
                let (p_ok, _, p_err) =
                    run_git_capture(&worktree_path, &["push", "origin", &push_ref]);
                if p_ok {
                    let _ = run_git_capture(
                        &repo_root,
                        &["fetch", "origin", &remote_target_branch],
                    );
                    Ok(format!(
                        "已将 {source} 合并进 origin/{remote_target_branch} 并推送到远程"
                    ))
                } else {
                    let first_line = p_err
                        .lines()
                        .find(|l| !l.trim().is_empty())
                        .unwrap_or("推送失败")
                        .trim()
                        .to_string();
                    Err(format!("合并完成，但推送失败：{first_line}"))
                }
            } else if !merge_sha.is_empty() {
                emit_merge_progress(&app_for_merge, 75, "更新本地分支引用...");
                let _ = run_git_capture(
                    &repo_root,
                    &["branch", "-f", &remote_target_branch, &merge_sha],
                );
                Ok(format!(
                    "已将 {source} 合并进 {target}（未推送远程）"
                ))
            } else {
                Ok(format!("已将 {source} 合并进 {target}"))
            }
        })();

        emit_merge_progress(&app_for_merge, 90, "清理临时环境...");

        cleanup_worktree(&repo_root, &worktree_path);
        let _ = run_git_capture(&repo_root, &["branch", "-D", &temp_branch]);

        if merge_result.is_ok() {
            emit_merge_progress(&app_for_merge, 100, "合并完成");
        }

        merge_result
    })
    .await
    .map_err(|e| format!("合并线程异常: {e}"))?
}
