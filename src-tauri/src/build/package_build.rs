//! 分支打包：Maven / npm 构建步骤（含并行后端与 npm 缓存）。

use crate::build::emit_progress;
use crate::git::{find_maven_artifact, find_npm_artifact};
use crate::models::PackageProjectType;
use crate::utils::{
    detect_npm_build_script, lock_file_hash, run_command, save_node_modules_to_cache,
    try_restore_node_modules,
};
use std::path::PathBuf;
use tauri::AppHandle;

/// (artifact_path, build_script_used, logs, backend_artifact_path)
pub(crate) type BuildOutcome = (PathBuf, String, Vec<String>, Option<String>);

pub(crate) struct BuildParams {
    pub project_type: PackageProjectType,
    pub worktree_for_build: PathBuf,
    pub worktree_root_for_backend: PathBuf,
    pub user_build_script: Option<String>,
    pub package_manager: String,
    pub npm_registry: String,
    pub spring_profile: Option<String>,
    pub package_with_backend: Option<bool>,
}

/// 在阻塞线程中执行 Maven 或 npm 打包（含可选并行后端）。
pub(crate) fn run_project_build(app: &AppHandle, params: BuildParams) -> Result<BuildOutcome, String> {
    let mut logs = Vec::new();
    let build_script_used;

    match params.project_type {
        PackageProjectType::Maven => {
            let mut mvn_args = vec!["clean", "package", "-DskipTests"];
            let profile_arg;
            if let Some(ref profile) = params.spring_profile {
                if !profile.trim().is_empty() {
                    profile_arg = format!("-Dspring.profiles.active={}", profile.trim());
                    mvn_args.push(&profile_arg);
                }
            }
            build_script_used = format!("mvn {}", mvn_args.join(" "));
            logs.push(run_command(&params.worktree_for_build, "mvn", &mvn_args)?);
            let artifact_path = find_maven_artifact(&params.worktree_for_build)?;
            Ok((artifact_path, build_script_used, logs, None))
        }
        PackageProjectType::Npm => {
            run_npm_build(app, params, &mut logs)
        }
    }
}

fn run_npm_build(
    app: &AppHandle,
    params: BuildParams,
    logs: &mut Vec<String>,
) -> Result<BuildOutcome, String> {
    let pm = &params.package_manager;
    let worktree_for_build = &params.worktree_for_build;
    let spring_profile_clone = params.spring_profile.clone();

    // 如果用户勾选了"同时打包后端"，先检查 pom.xml 是否存在，若存在则启动并行构建
    let backend_handle: Option<std::thread::JoinHandle<Result<(String, String), String>>> =
        if params.package_with_backend.unwrap_or(false)
            && params.worktree_root_for_backend.join("pom.xml").is_file()
        {
            let root = params.worktree_root_for_backend.clone();
            let sp = spring_profile_clone
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            if let Some(ref profile) = sp {
                logs.push(format!("☕ Spring Profile: {}", profile));
            }
            let mvn_base = if let Some(ref profile) = sp {
                format!(
                    "clean package -DskipTests -Dspring.profiles.active={}",
                    profile
                )
            } else {
                "clean package -DskipTests".to_string()
            };
            logs.push(format!("☕ 启动后端并行构建: mvn {}", mvn_base));
            emit_progress(
                app,
                55,
                "📦 前端安装依赖... | ☕ 后端并行打包中",
                "build",
            );
            Some(std::thread::spawn(move || {
                let mvn_args: Vec<&str> = mvn_base.split_whitespace().collect();
                let mvn_log = run_command(&root, "mvn", &mvn_args)
                    .map_err(|e| format!("后端 Maven 打包失败: {}", e))?;
                let jar = find_maven_artifact(&root)?;
                Ok((jar.to_string_lossy().to_string(), mvn_log))
            }))
        } else if params.package_with_backend.unwrap_or(false) {
            logs.push(
                "⚠️ 勾选了同时打包后端，但 worktree 根目录未找到 pom.xml，跳过后端打包"
                    .to_string(),
            );
            None
        } else {
            None
        };

    // 前端构建（与后端并行进行）
    // 检查缓存，依赖未变则跳过 install
    let cached = if let Some(key) = lock_file_hash(worktree_for_build) {
        match try_restore_node_modules(worktree_for_build, &key) {
            Ok(true) => {
                let msg = format!("✅ 命中缓存 (hash={})，跳过 {} install", &key[..12], pm);
                emit_progress(app, 52, &msg, "build");
                logs.push(msg);
                true
            }
            Ok(false) => {
                let msg = format!(
                    "❓ 缓存未命中 (hash={})，执行 {} install...",
                    &key[..12],
                    pm
                );
                emit_progress(app, 52, &msg, "build");
                logs.push(format!("cache miss (hash={})", key));
                false
            }
            Err(e) => {
                let msg = format!("⚠️ 缓存恢复失败: {}，重新 install", e);
                emit_progress(app, 52, &msg, "build");
                logs.push(msg);
                false
            }
        }
    } else {
        let msg = "📦 未找到 lock 文件，执行 install...".to_string();
        emit_progress(app, 52, &msg, "build");
        logs.push("未找到 lock 文件，跳过缓存".to_string());
        false
    };
    if !cached {
        // npm install 进度
        let install_msg = if backend_handle.is_some() {
            format!("📦 执行 {} install... | ☕ 后端并行打包中", pm)
        } else {
            format!(
                "📦 执行 {} install（首次下载依赖，可能需要几分钟）...",
                pm
            )
        };
        emit_progress(app, 55, install_msg, "build");
        // 支持自定义 registry
        if params.npm_registry.trim().is_empty() {
            logs.push(run_command(worktree_for_build, pm, &["install"])?);
        } else {
            logs.push(run_command(
                worktree_for_build,
                pm,
                &["install", "--registry", params.npm_registry.trim()],
            )?);
        }
        if let Some(key) = lock_file_hash(worktree_for_build) {
            emit_progress(
                app,
                60,
                format!("💾 保存 node_modules 到缓存 (hash={})...", &key[..12]),
                "build",
            );
            save_node_modules_to_cache(worktree_for_build, &key);
            logs.push(format!("💾 node_modules 已缓存 (hash={})", key));
        }
    }
    // 使用用户选择的构建命令，如果没有则自动检测
    let script_name = if let Some(ref s) = params.user_build_script {
        if !s.trim().is_empty() {
            s.trim().to_string()
        } else {
            detect_npm_build_script(worktree_for_build)?
        }
    } else {
        detect_npm_build_script(worktree_for_build)?
    };
    let build_script_used = format!("{} run {}", pm, script_name);
    let build_msg = if backend_handle.is_some() {
        format!(
            "🔨 前端构建: {} run {} | ☕ 后端并行打包中",
            pm, script_name
        )
    } else {
        format!("🔨 执行构建: {} run {}", pm, script_name)
    };
    emit_progress(app, 65, build_msg, "build");
    logs.push(run_command(
        worktree_for_build,
        pm,
        &["run", &script_name],
    )?);
    let artifact_path = find_npm_artifact(worktree_for_build)?;

    // 等待后端构建完成（如果有）
    let backend_artifact: Option<String> = if let Some(handle) = backend_handle {
        emit_progress(
            app,
            68,
            "✅ 前端构建完成，⏳ 等待后端 Maven 打包...",
            "build",
        );
        match handle.join() {
            Ok(Ok((jar_path, mvn_log))) => {
                logs.push(format!("☕ 后端 Maven 打包:\n{}", mvn_log));
                logs.push(format!("✅ 后端打包成功: {}", jar_path));
                Some(jar_path)
            }
            Ok(Err(e)) => {
                logs.push(format!("❌ {}", e));
                return Err(e);
            }
            Err(_) => {
                logs.push("❌ 后端打包线程异常".to_string());
                return Err("后端打包线程异常".to_string());
            }
        }
    } else {
        None
    };

    Ok((
        artifact_path,
        build_script_used,
        logs.clone(),
        backend_artifact,
    ))
}
