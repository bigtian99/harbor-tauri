//! 分支打包：worktree 准备（clone/fetch、持久 `_pack` worktree 复用/重置、项目类型校验）。

use crate::build::emit_progress;
use crate::config_cmd::load_config_sync;
use crate::git::cleanup_worktree;
use crate::models::PackageProjectType;
use crate::utils::{cleanup_old_temp_dirs, command_output_text, pack_worktree_dir_with_slot, repo_root_for, silent_command};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

/// 打包前准备好的路径与元信息。
pub(crate) struct WorktreeContext {
    pub repo_path: PathBuf,
    pub repo_root: PathBuf,
    pub worktree_path: PathBuf,
    pub actual_build_path: PathBuf,
    pub output_base: PathBuf,
    pub repo_name: String,
    pub branch_slug: String,
    pub build_timestamp: String,
    /// 持有至本轮打包结束，保证同仓库 `_pack` 互斥（仅靠 Drop 释放，无需读字段）。
    #[allow(dead_code)]
    pub pack_guard: PackRepoGuard,
}

/// 解析仓库路径（本地目录或远程 URL 克隆）、清理旧临时目录、创建 worktree。
pub(crate) async fn prepare_worktree(
    app: &AppHandle,
    repo_path: &str,
    branch: &str,
    frontend_dir: &Option<String>,
    pack_slot: &Option<String>,
) -> Result<WorktreeContext, String> {
    // 如果是 URL，先克隆到本地缓存目录
    let repo_path_str = repo_path.trim().to_string();
    let repo_path = if crate::git::is_git_url(&repo_path_str) {
        let local = crate::git::clone_repo(repo_path_str).await?;
        PathBuf::from(local)
    } else {
        let p = PathBuf::from(&repo_path_str);
        if !p.is_dir() {
            return Err(format!("仓库路径不是目录: {}", p.display()));
        }
        p
    };

    // 每次打包前清理之前的临时 worktree/build 残留目录
    cleanup_old_temp_dirs();

    // 提前加载配置，获取输出目录
    let config = load_config_sync().unwrap_or_default();

    // 提取仓库名，用于组织输出目录结构
    let repo_name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 确定基础输出目录：优先使用用户配置，为空则回退到桌面
    let output_base = if !config.artifact_output_dir.trim().is_empty() {
        PathBuf::from(&config.artifact_output_dir)
    } else {
        dirs::desktop_dir().unwrap_or_else(|| std::env::temp_dir())
    };

    // 同 worktree 路径串行（不同 pack_slot 可并行）
    let worktree_path = pack_worktree_dir_with_slot(
        &output_base,
        &repo_name,
        pack_slot.as_deref(),
    );
    let pack_guard = PackRepoGuard::try_acquire(&worktree_path.to_string_lossy())?;

    // 生成时间戳，用于产物目录命名
    let build_timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let branch_slug = branch.replace('/', "_");

    // 确保父目录存在
    fs::create_dir_all(worktree_path.parent().unwrap())
        .map_err(|e| format!("创建 _pack 父目录失败: {}", e))?;

    crate::diag::diag_log(
        "build",
        &format!(
            "Worktree 路径: {} (输出目录: {})",
            worktree_path.display(),
            output_base.display()
        ),
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

    emit_progress(app, 6, "⬇️ 校验仓库并更新目标分支...", "fetch");

    let repo_path_clone = repo_path.clone();
    let branch_for_git = branch.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let repo_root = repo_root_for(&repo_path_clone)?;

        fetch_target_branch(&repo_root, &branch_for_git)?;

        crate::utils::git_output(
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

    emit_progress(app, 20, "🌿 准备打包目录 (_pack)...", "worktree");

    let repo_root_for_pack = repo_root.clone();
    let worktree_for_pack = worktree_path.clone();
    let branch_for_pack = branch.to_string();
    let mode = tauri::async_runtime::spawn_blocking(move || {
        ensure_pack_worktree(&repo_root_for_pack, &worktree_for_pack, &branch_for_pack)
    })
    .await
    .map_err(|e| format!("准备 _pack 线程异常: {}", e))??;

    let msg = if mode == "reuse" {
        "🌿 已复用 _pack 并更新到目标分支"
    } else {
        "🌿 已创建 _pack 打包目录"
    };
    emit_progress(app, 22, msg, "worktree");

    // 确定实际构建目录
    let actual_build_path = if let Some(ref dir) = build_dir {
        worktree_path.join(dir)
    } else {
        worktree_path.clone()
    };

    Ok(WorktreeContext {
        repo_path,
        repo_root,
        worktree_path,
        actual_build_path,
        output_base,
        repo_name,
        branch_slug,
        build_timestamp,
        pack_guard,
    })
}

/// 校验 worktree 内是否具备 Maven/npm 构建入口文件；失败时保留 `_pack`（不删除）。
pub(crate) fn validate_project_in_worktree(
    project_type: PackageProjectType,
    ctx: &WorktreeContext,
) -> Result<(), String> {
    match project_type {
        PackageProjectType::Maven if !ctx.actual_build_path.join("pom.xml").is_file() => {
            let files_in_worktree = fs::read_dir(&ctx.actual_build_path)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| format!("  - {}", e.file_name().to_string_lossy()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_else(|e| format!("  无法读取目录: {}", e));
            Err(format!(
                "目标分支缺少 pom.xml\n\n期望路径: {}\n\nworktree 中的文件:\n{}\n\n已保留 _pack（未删除）: {}",
                ctx.actual_build_path.join("pom.xml").display(),
                files_in_worktree,
                ctx.worktree_path.display()
            ))
        }
        PackageProjectType::Npm if !ctx.actual_build_path.join("package.json").is_file() => {
            Err(format!(
                "目标分支缺少 package.json，已保留 _pack（未删除）: {}",
                ctx.worktree_path.display()
            ))
        }
        _ => Ok(()),
    }
}

static PACK_BUSY: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

pub(crate) struct PackRepoGuard {
    lock_key: String,
}

impl PackRepoGuard {
    pub(crate) fn try_acquire(lock_key: &str) -> Result<Self, String> {
        let map_lock = PACK_BUSY.get_or_init(|| Mutex::new(HashMap::new()));
        let mut map = map_lock
            .lock()
            .map_err(|_| "打包目录锁异常".to_string())?;
        let busy = map.entry(lock_key.to_string()).or_insert(false);
        if *busy {
            return Err(format!(
                "打包目录「{lock_key}」正在被其他任务使用，请稍后再试"
            ));
        }
        *busy = true;
        Ok(Self {
            lock_key: lock_key.to_string(),
        })
    }
}

impl Drop for PackRepoGuard {
    fn drop(&mut self) {
        if let Some(map_lock) = PACK_BUSY.get() {
            if let Ok(mut map) = map_lock.lock() {
                if let Some(busy) = map.get_mut(&self.lock_key) {
                    *busy = false;
                }
            }
        }
    }
}

/// 持久打包 worktree 路径（默认槽位 `_pack`；多模块并行用 `pack_worktree_dir_with_slot`）
pub(crate) fn pack_worktree_dir(output_base: &Path, repo_name: &str) -> PathBuf {
    pack_worktree_dir_with_slot(output_base, repo_name, None)
}

fn is_git_worktree_dir(path: &Path) -> bool {
    path.join(".git").exists()
}

fn reset_pack_to_ref(pack_dir: &Path, branch_ref: &str) -> Result<(), String> {
    crate::diag::diag_log(
        "build",
        &format!("pack_reset path={} ref={}", pack_dir.display(), branch_ref),
    );
    crate::utils::git_output(pack_dir, &["checkout", "--detach", branch_ref])
        .map_err(|e| format!("切换打包目录到 {branch_ref} 失败: {e}"))?;
    crate::utils::git_output(pack_dir, &["reset", "--hard", branch_ref])
        .map_err(|e| format!("重置打包目录到 {branch_ref} 失败: {e}"))?;
    Ok(())
}

fn create_pack_worktree(
    repo_root: &Path,
    pack_dir: &Path,
    branch_ref: &str,
) -> Result<(), String> {
    cleanup_worktree(repo_root, pack_dir);
    if pack_dir.exists() {
        let _ = fs::remove_dir_all(pack_dir);
    }
    if let Some(parent) = pack_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 _pack 父目录失败: {e}"))?;
    }
    let output = silent_command("git")
        .args(["worktree", "add", "--detach"])
        .arg(pack_dir)
        .arg(branch_ref)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("创建 _pack worktree 失败: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_dir_all(pack_dir);
        return Err(format!(
            "创建 _pack worktree 失败:\n{}",
            command_output_text(&output)
        ));
    }
    Ok(())
}

fn ensure_pack_worktree(
    repo_root: &Path,
    pack_dir: &Path,
    branch_ref: &str,
) -> Result<&'static str, String> {
    if is_git_worktree_dir(pack_dir) {
        match reset_pack_to_ref(pack_dir, branch_ref) {
            Ok(()) => {
                crate::diag::diag_log(
                    "build",
                    &format!(
                        "pack_reuse path={} branch={}",
                        pack_dir.display(),
                        branch_ref
                    ),
                );
                return Ok("reuse");
            }
            Err(e) => {
                crate::diag::diag_log(
                    "build",
                    &format!("pack_reuse failed, recreate: {e}"),
                );
                cleanup_worktree(repo_root, pack_dir);
                let _ = fs::remove_dir_all(pack_dir);
            }
        }
    } else if pack_dir.exists() {
        let _ = fs::remove_dir_all(pack_dir);
    }

    create_pack_worktree(repo_root, pack_dir, branch_ref)?;
    crate::diag::diag_log(
        "build",
        &format!(
            "pack_create path={} branch={}",
            pack_dir.display(),
            branch_ref
        ),
    );
    Ok("create")
}

/// 将 UI 传入的远程跟踪引用拆成 `(remote, branch)`。
/// 例如 `origin/master`、`origin/feature/x`；纯本地名返回 `None`。
pub(crate) fn split_remote_tracking_ref(branch_ref: &str) -> Option<(&str, &str)> {
    let branch_ref = branch_ref.trim();
    let (remote, name) = branch_ref.split_once('/')?;
    if remote.is_empty() || name.is_empty() {
        return None;
    }
    Some((remote, name))
}

/// 只拉取目标分支，避免 `fetch --all` 扫全远程。
///
/// - `origin/feature/x` → `git fetch origin +refs/heads/feature/x:refs/remotes/origin/feature/x`
/// - 本地名 `main` → 尝试 `git fetch origin main`（失败则仅记日志，由后续 rev-parse 判断）
fn fetch_target_branch(repo_root: &std::path::Path, branch_ref: &str) -> Result<(), String> {
    let branch_ref = branch_ref.trim();
    if branch_ref.is_empty() {
        return Err("目标分支为空".into());
    }

    if let Some((remote, name)) = split_remote_tracking_ref(branch_ref) {
        let refspec = format!("+refs/heads/{name}:refs/remotes/{remote}/{name}");
        crate::diag::diag_log(
            "git",
            &format!(
                "fetch_target_branch remote={remote} branch={name} refspec={refspec}"
            ),
        );
        crate::utils::git_output(repo_root, &["fetch", remote, &refspec]).map_err(|e| {
            format!("更新目标分支失败（{remote}/{name}）: {e}")
        })?;
        return Ok(());
    }

    crate::diag::diag_log(
        "git",
        &format!("fetch_target_branch local-like ref={branch_ref}, try origin"),
    );
    match crate::utils::git_output(repo_root, &["fetch", "origin", branch_ref]) {
        Ok(_) => Ok(()),
        Err(e) => {
            crate::diag::diag_log(
                "git",
                &format!(
                    "fetch_target_branch skip origin fetch for local ref={branch_ref}: {e}"
                ),
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_git_worktree_dir, pack_worktree_dir, split_remote_tracking_ref, PackRepoGuard,
    };
    use std::path::Path;

    #[test]
    fn pack_worktree_dir_joins_repo_and_pack() {
        let p = pack_worktree_dir(Path::new("/out"), "my-service");
        assert_eq!(p, Path::new("/out/my-service/_pack"));
    }

    #[test]
    fn split_origin_master() {
        assert_eq!(
            split_remote_tracking_ref("origin/master"),
            Some(("origin", "master"))
        );
    }

    #[test]
    fn split_origin_nested_feature() {
        assert_eq!(
            split_remote_tracking_ref("origin/feature/x"),
            Some(("origin", "feature/x"))
        );
    }

    #[test]
    fn split_local_name_has_no_remote() {
        assert_eq!(split_remote_tracking_ref("main"), None);
        assert_eq!(split_remote_tracking_ref(""), None);
    }

    #[test]
    fn is_git_worktree_dir_false_for_missing() {
        assert!(!is_git_worktree_dir(Path::new("/tmp/jarporter-no-such-pack-dir")));
    }

    #[test]
    fn pack_repo_guard_rejects_second_acquire_same_slot() {
        let key = "/tmp/jarporter-pack-slot-a";
        let g1 = PackRepoGuard::try_acquire(key).unwrap();
        assert!(PackRepoGuard::try_acquire(key).is_err());
        drop(g1);
        assert!(PackRepoGuard::try_acquire(key).is_ok());
    }

    #[test]
    fn pack_repo_guard_allows_different_slots() {
        let g1 = PackRepoGuard::try_acquire("/tmp/jarporter-pack-a").unwrap();
        let g2 = PackRepoGuard::try_acquire("/tmp/jarporter-pack-b").unwrap();
        drop(g1);
        drop(g2);
    }
}

