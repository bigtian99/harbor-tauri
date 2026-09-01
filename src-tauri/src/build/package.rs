//! 分支打包 Tauri 命令编排：`package_from_branch`。

use crate::build::package_build::{run_project_build, BuildParams};
use crate::build::package_finish::{finish_package, FinishPackageParams};
use crate::build::package_worktree::{prepare_worktree, validate_project_in_worktree};
use crate::build::{begin_cancellable_operation, emit_progress};
use crate::config_cmd::load_config_sync;
use crate::models::{PackageFromBranchResult, PackageProjectType};

use crate::utils::resolve_maven_module;

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
    deployment_hint: Option<String>,
    pack_slot: Option<String>,
) -> Result<PackageFromBranchResult, String> {
    let _cancel_guard = begin_cancellable_operation();
    let project_type = PackageProjectType::from_string(project_type)?;
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("请输入目标分支".to_string());
    }

    crate::diag::diag_log(
        "build",
        &format!(
            "package_from_branch repo={} branch={} deployment_hint={:?} pack_slot={:?}",
            repo_path, branch, deployment_hint, pack_slot
        ),
    );

    let ctx = prepare_worktree(
        &app,
        &repo_path,
        &branch,
        &frontend_dir,
        &pack_slot,
    )
    .await?;

    emit_progress(&app, 35, "🧪 校验项目类型...", "build");
    validate_project_in_worktree(project_type, &ctx)?;

    let (maven_pl_module, maven_artifact_dir) = if matches!(project_type, PackageProjectType::Maven) {
        let hint = deployment_hint.as_deref();
        match resolve_maven_module(&ctx.worktree_path, hint)? {
            Some(m) => {
                let msg = format!(
                    "☕ Maven 模块: {} (artifactId={}, deployment={})",
                    if m.rel_path.is_empty() {
                        "根目录".to_string()
                    } else {
                        m.rel_path.clone()
                    },
                    m.artifact_id,
                    hint.unwrap_or("-")
                );
                crate::diag::diag_log("build", &format!("resolve_maven_module ok {msg}"));
                emit_progress(&app, 48, &msg, "build");
                let artifact_dir = if m.rel_path.is_empty() {
                    ctx.worktree_path.clone()
                } else {
                    ctx.worktree_path.join(&m.rel_path)
                };
                let pl = if m.rel_path.is_empty() {
                    None
                } else {
                    Some(m.rel_path)
                };
                (pl, artifact_dir)
            }
            None => (None, ctx.worktree_path.clone()),
        }
    } else {
        (None, ctx.worktree_path.clone())
    };

    let package_message = match project_type {
        PackageProjectType::Maven => {
            if let Some(ref pl) = maven_pl_module {
                format!("☕ 执行 Maven 打包 (-pl {pl} -am)...")
            } else {
                "☕ 执行 Maven 打包...".to_string()
            }
        }
        PackageProjectType::Npm => "📦 准备前端依赖...".to_string(),
    };
    emit_progress(&app, 50, package_message, "build");

    let config = load_config_sync().unwrap_or_default();
    let (maven_home, maven_local_repo) =
        crate::utils::resolve_maven_paths(&config.maven_home, &config.maven_local_repo);
    crate::diag::diag_log(
        "build",
        &format!(
            "package_from_branch maven_home={} local_repo={}",
            maven_home, maven_local_repo
        ),
    );
    if matches!(project_type, PackageProjectType::Maven)
        || package_with_backend.unwrap_or(false)
    {
        if maven_home.trim().is_empty()
            || !crate::utils::maven_home_looks_valid(&maven_home)
        {
            return Err(
                "未配置有效的 Maven Home（也未检测到 MAVEN_HOME/M2_HOME 或安装包内置 Maven）。请到「系统设置 → JAR 打包」填写 Maven 安装目录后再打包。"
                    .to_string(),
            );
        }
    }
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
                maven_home,
                maven_local_repo,
                maven_pl_module,
                maven_artifact_dir,
            },
        )
    })
    .await
    .map_err(|e| format!("打包线程异常: {}", e))?;

    let (artifact_path, build_script_used, logs, backend_artifact_path) = build_result?;

    // 收尾含 worktree 清理 / FTP / 面板 HTTP，必须在 blocking 线程，避免卡住 async 运行时导致进度不刷新
    let app_finish = app.clone();
    let branch_finish = branch.clone();
    let frontend_dir_finish = frontend_dir.clone();
    let package_manager_finish = package_manager.clone();
    let spring_profile_finish = spring_profile.clone();
    let package_with_backend_finish = package_with_backend.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        finish_package(FinishPackageParams {
            app: &app_finish,
            ctx: &ctx,
            branch: &branch_finish,
            project_type,
            artifact_path,
            build_script: build_script_used,
            logs,
            backend_artifact_path,
            frontend_dir: frontend_dir_finish,
            package_manager: package_manager_finish,
            spring_profile: spring_profile_finish,
            package_with_backend: package_with_backend_finish,
            start_time,
        })
    })
    .await
    .map_err(|e| format!("打包收尾线程异常: {}", e))
}
