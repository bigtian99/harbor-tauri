//! 分支打包 Tauri 命令编排：`package_from_branch`。

use crate::build::package_build::{run_project_build, BuildParams};
use crate::build::package_finish::{finish_package, FinishPackageParams};
use crate::build::package_worktree::{prepare_worktree, validate_project_in_worktree};
use crate::build::{emit_progress, reset_cancel_flag};
use crate::config_cmd::load_config_sync;
use crate::models::{PackageFromBranchResult, PackageProjectType};

#[tauri::command]
pub async fn package_from_branch(
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

    let ctx = prepare_worktree(&app, &repo_path, &branch, &frontend_dir).await?;

    emit_progress(&app, 35, "🧪 校验项目类型...", "build");
    validate_project_in_worktree(project_type, &ctx)?;

    let package_message = match project_type {
        PackageProjectType::Maven => "☕ 执行 Maven 打包...".to_string(),
        PackageProjectType::Npm => "📦 执行 npm install...".to_string(),
    };
    emit_progress(&app, 50, package_message, "build");

    let config = load_config_sync().unwrap_or_default();
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

    let start_time = std::time::Instant::now();
    let worktree_for_build = ctx.actual_build_path.clone();
    let worktree_root_for_backend = ctx.worktree_path.clone();
    let user_build_script = build_script.clone();
    let npm_registry = config.npm_registry.clone();
    let app_for_build = app.clone();
    let spring_profile_clone = spring_profile.clone();
    let package_with_backend_clone = package_with_backend;

    let build_result = tauri::async_runtime::spawn_blocking(move || {
        run_project_build(
            &app_for_build,
            BuildParams {
                project_type,
                worktree_for_build,
                worktree_root_for_backend,
                user_build_script,
                package_manager: pm,
                npm_registry,
                spring_profile: spring_profile_clone,
                package_with_backend: package_with_backend_clone,
            },
        )
    })
    .await
    .map_err(|e| format!("打包线程异常: {}", e))?;

    let (artifact_path, build_script_used, logs, backend_artifact_path) = build_result?;

    Ok(finish_package(FinishPackageParams {
        app: &app,
        ctx: &ctx,
        branch: &branch,
        project_type,
        artifact_path,
        build_script: build_script_used,
        logs,
        backend_artifact_path,
        frontend_dir,
        package_manager,
        spring_profile,
        package_with_backend: package_with_backend.unwrap_or(false),
        start_time,
    }))
}
