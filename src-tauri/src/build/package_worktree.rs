//! 分支打包：worktree 准备（clone/fetch、创建隔离 worktree、项目类型校验）。

use crate::build::emit_progress;
use crate::config_cmd::load_config_sync;
use crate::git::cleanup_worktree;
use crate::models::PackageProjectType;
use crate::utils::{cleanup_old_temp_dirs, command_output_text, repo_root_for, silent_command};
use std::fs;
use std::path::PathBuf;
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
}

/// 解析仓库路径（本地目录或远程 URL 克隆）、清理旧临时目录、创建 worktree。
pub(crate) async fn prepare_worktree(
    app: &AppHandle,
    repo_path: &str,
    branch: &str,
    frontend_dir: &Option<String>,
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

    emit_progress(app, 6, "⬇️ 校验仓库并更新分支代码...", "fetch");

    let repo_path_clone = repo_path.clone();
    let branch_for_git = branch.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let repo_root = repo_root_for(&repo_path_clone)?;

        crate::utils::git_output(&repo_root, &["fetch", "--all", "--prune"])
            .map_err(|e| format!("更新分支代码失败: {}", e))?;

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

    emit_progress(app, 20, "🌿 已更新分支代码，创建隔离 worktree...", "worktree");

    let repo_root_for_worktree = repo_root.clone();
    let worktree_for_add = worktree_path.clone();
    let branch_for_add = branch.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let output = silent_command("git")
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
    })
}

/// 校验 worktree 内是否具备 Maven/npm 构建入口文件；失败时清理 worktree。
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
            cleanup_worktree(&ctx.repo_root, &ctx.worktree_path);
            Err(format!(
                "目标分支缺少 pom.xml\n\n期望路径: {}\n\nworktree 中的文件:\n{}\n\n已清理临时 worktree: {}",
                ctx.actual_build_path.join("pom.xml").display(),
                files_in_worktree,
                ctx.worktree_path.display()
            ))
        }
        PackageProjectType::Npm if !ctx.actual_build_path.join("package.json").is_file() => {
            cleanup_worktree(&ctx.repo_root, &ctx.worktree_path);
            Err(format!(
                "目标分支缺少 package.json，已清理临时 worktree: {}",
                ctx.worktree_path.display()
            ))
        }
        _ => Ok(()),
    }
}
