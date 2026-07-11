//! 分支打包：产物复制、Dockerfile 探测、worktree 清理、构建历史。

use crate::build::emit_progress;
use crate::git::cleanup_worktree;
use crate::history::save_build_record_direct;
use crate::models::{BuildRecord, PackageFromBranchResult, PackageProjectType};
use crate::utils::{copy_artifact_to_output_internal, git_output, repo_root_for};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::AppHandle;

use super::package_worktree::WorktreeContext;

/// 复制前后端产物到输出目录。
pub(crate) fn copy_package_artifacts(
    artifact_path: &Path,
    backend_artifact_path: &Option<String>,
    artifact_dir: &Path,
) -> (String, Option<String>) {
    let final_artifact_path = match copy_artifact_to_output_internal(artifact_path, artifact_dir) {
        Ok(copied_path) => {
            crate::diag::diag_log("build", &format!("✅ 产物已输出到: {}", copied_path));
            copied_path
        }
        Err(e) => {
            crate::diag::diag_log("build", &format!("❌ 产物复制失败: {}", e));
            artifact_path.to_string_lossy().to_string()
        }
    };

    let backend_final_path: Option<String> = if let Some(ref backend_src) = backend_artifact_path {
        let backend_src_path = PathBuf::from(backend_src);
        match copy_artifact_to_output_internal(&backend_src_path, artifact_dir) {
            Ok(copied) => {
                crate::diag::diag_log("build", &format!("✅ 后端产物已输出到: {}", copied));
                Some(copied)
            }
            Err(e) => {
                crate::diag::diag_log("build", &format!("❌ 后端产物复制失败: {}", e));
                Some(backend_src.clone())
            }
        }
    } else {
        None
    };

    (final_artifact_path, backend_final_path)
}

/// 探测自定义 Dockerfile；无自定义 Dockerfile 时清理 worktree。
/// 返回 (dockerfile_path, dockerfile_context)。
pub(crate) fn detect_dockerfile_and_maybe_cleanup(
    app: &AppHandle,
    ctx: &WorktreeContext,
) -> (Option<String>, Option<String>) {
    let (dockerfile_path, dockerfile_context): (Option<String>, Option<String>) = {
        let dockerfile_names = ["Dockerfile", "dockerfile"];
        let search_dirs = vec![ctx.worktree_path.clone(), ctx.actual_build_path.clone()];
        let mut found_df_path = None;
        let mut found_df_context = None;

        for search_dir in &search_dirs {
            for name in &dockerfile_names {
                let df_in_worktree = search_dir.join(name);
                if df_in_worktree.is_file() {
                    crate::diag::diag_log(
                        "build",
                        &format!("📄 检测到自定义 Dockerfile: {}", df_in_worktree.display()),
                    );
                    // 使用 worktree 作为 Docker 构建上下文（包含 Dockerfile、JAR、tools/ 等）
                    found_df_path = Some(df_in_worktree.to_string_lossy().to_string());
                    found_df_context = Some(ctx.worktree_path.to_string_lossy().to_string());
                    break;
                }
            }
            if found_df_path.is_some() {
                break;
            }
        }
        if found_df_path.is_none() {
            crate::diag::diag_log(
                "build",
                &format!("未检测到自定义 Dockerfile（已检查: {:?}）", search_dirs),
            );
        }
        (found_df_path, found_df_context)
    };

    if dockerfile_context.is_some() {
        // 有自定义 Dockerfile，保留 worktree 作为构建上下文
        emit_progress(
            app,
            95,
            "📄 检测到自定义 Dockerfile，保留 worktree 作为构建上下文...",
            "cleanup",
        );
        crate::diag::diag_log(
            "build",
            &format!("保留 worktree 用于 Docker 构建: {}", ctx.worktree_path.display()),
        );
    } else {
        // 没有自定义 Dockerfile，正常清理 worktree
        emit_progress(app, 95, "🧹 清理 worktree 源码...", "cleanup");
        cleanup_worktree(&ctx.repo_root, &ctx.worktree_path);
        crate::diag::diag_log(
            "build",
            &format!("Worktree 已清理: {}", ctx.worktree_path.display()),
        );
    }

    (dockerfile_path, dockerfile_context)
}

pub(crate) struct FinishPackageParams<'a> {
    pub app: &'a AppHandle,
    pub ctx: &'a WorktreeContext,
    pub branch: &'a str,
    pub project_type: PackageProjectType,
    pub artifact_path: PathBuf,
    pub build_script: String,
    pub logs: Vec<String>,
    pub backend_artifact_path: Option<String>,
    pub frontend_dir: Option<String>,
    pub package_manager: Option<String>,
    pub spring_profile: Option<String>,
    pub package_with_backend: bool,
    pub start_time: Instant,
}

/// 复制产物、探测 Dockerfile/清理、写历史并组装返回值。
pub(crate) fn finish_package(params: FinishPackageParams<'_>) -> PackageFromBranchResult {
    let FinishPackageParams {
        app,
        ctx,
        branch,
        project_type,
        artifact_path,
        build_script,
        logs,
        backend_artifact_path,
        frontend_dir,
        package_manager,
        spring_profile,
        package_with_backend,
        start_time,
    } = params;

    emit_progress(app, 85, "📋 复制产物到输出目录...", "build");

    let log = logs
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    // 产物输出目录 — worktree 同级的干净目录
    // worktree:  <output_base>/<repo_name>/_{branch}_{timestamp}/   (构建后清理)
    // artifact: <output_base>/<repo_name>/<branch>_<timestamp>/     (最终输出)
    let artifact_dir = ctx
        .output_base
        .join(&ctx.repo_name)
        .join(format!("{}_{}", &ctx.branch_slug, &ctx.build_timestamp));

    let (final_artifact_path, backend_final_path) =
        copy_package_artifacts(&artifact_path, &backend_artifact_path, &artifact_dir);

    let (dockerfile_path, dockerfile_context) = detect_dockerfile_and_maybe_cleanup(app, ctx);

    emit_progress(app, 100, "✅ 打包完成！产物已输出", "done");

    // 保存构建记录
    let record_id = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let log_summary = log.lines().take(3).collect::<Vec<_>>().join(" ");
    let duration_ms = start_time.elapsed().as_millis() as u64;

    // 获取最后提交人信息（用于历史记录显示头像）
    let (author, email) = repo_root_for(&ctx.repo_path)
        .ok()
        .and_then(|root| git_output(&root, &["log", "-1", "--format=%an%n%ae", branch]).ok())
        .and_then(|output| {
            let lines: Vec<&str> = output.lines().collect();
            if lines.len() >= 2 {
                Some((lines[0].to_string(), lines[1].to_string()))
            } else {
                None
            }
        })
        .unwrap_or_default();

    let record = BuildRecord {
        id: record_id,
        timestamp,
        repo_path: ctx.repo_path.to_string_lossy().to_string(),
        branch: branch.to_string(),
        project_type: format!("{:?}", project_type),
        artifact_path: final_artifact_path.clone(),
        backend_artifact_path: backend_final_path.clone(),
        image_name: None,
        image_tag: None,
        build_command: build_script.clone(),
        // 打包配置
        frontend_dir,
        package_manager,
        spring_profile,
        package_with_backend,
        duration_ms,
        status: "success".to_string(),
        log_summary,
        full_log: log.clone(),
        author,
        email,
    };

    if let Err(e) = save_build_record_direct(record) {
        crate::diag::diag_log("build", &format!("保存构建记录失败: {}", e));
    } else {
        crate::diag::diag_log("build", "构建记录已保存");
    }

    PackageFromBranchResult {
        artifact_path: final_artifact_path,
        backend_artifact_path: backend_final_path,
        // 返回产物输出目录（worktree 已清理，或保留为 Docker 构建上下文）
        worktree_path: artifact_dir.to_string_lossy().to_string(),
        build_script,
        log,
        dockerfile_path,
        dockerfile_context,
    }
}
