//! 镜像构建与推送 Tauri 命令：`build_and_push` / `push_local_image` / `list_local_images`。

use crate::build::push_helpers::{
    docker_login_harbor, docker_push_image, docker_rmi_best_effort, require_harbor_config,
    resolve_final_tag,
};
use crate::build::{docker_output, emit_progress, reset_cancel_flag, resolve_harbor_repository};
use crate::config_cmd::load_config_sync;
use crate::docker::{
    prepare_custom_docker_context, prepare_frontend_dist_context, prepare_jar_context,
};
use crate::models::{ArtifactType, DockerBuildContext, NginxLocationBlock};
use crate::utils::{silent_docker_command, CANCEL_FLAG, CURRENT_PID};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::Ordering;

#[tauri::command]
pub async fn build_and_push(
    app: tauri::AppHandle,
    jar_path: String,
    image_name: String,
    image_tag: String,
    artifact_type: Option<String>,
    dockerfile_path: Option<String>,
    dockerfile_context: Option<String>,
    expose_port: Option<String>,
    nginx_locations: Vec<NginxLocationBlock>,
    // 并行推送时区分角色，如 "前端" / "后端"；进度消息会带 [标签]
    progress_label: Option<String>,
) -> Result<String, String> {
    reset_cancel_flag();
    let label = progress_label
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let emit = |app: &tauri::AppHandle, pct: u32, msg: &str, stage: &str| {
        let text = match &label {
            Some(l) => format!("[{}] {}", l, msg),
            None => msg.to_string(),
        };
        emit_progress(app, pct, &text, stage);
    };
    let mut config = load_config_sync()?;
    if let Some(port) = expose_port {
        if !port.trim().is_empty() {
            config.expose_port = port.trim().to_string();
        }
    }
    let artifact_type = ArtifactType::from_option(artifact_type)?;
    require_harbor_config(&config)?;

    let artifact_path = PathBuf::from(&jar_path);
    if !artifact_path.exists() {
        return Err(format!("产物路径不存在: {}", jar_path));
    }

    let final_tag = resolve_final_tag(image_tag);
    let image_name_lower = image_name.to_lowercase();
    let repository = resolve_harbor_repository(&image_name_lower, &config.project)?;
    let full_image = format!("{}/{}:{}", config.harbor_url, repository, final_tag);

    // 步骤1: 准备Docker构建上下文
    emit(&app, 10, "📝 准备 Docker 构建上下文...", "build");

    let build_context = if let Some(ref ctx_path) = dockerfile_context {
        // 有自定义 Dockerfile，使用 worktree 作为构建上下文
        let ctx = PathBuf::from(ctx_path);
        let df = if let Some(ref df_path) = dockerfile_path {
            PathBuf::from(df_path)
        } else {
            ctx.join("Dockerfile")
        };
        if !df.is_file() {
            return Err(format!("自定义Dockerfile不存在: {}", df.display()));
        }
        crate::diag::diag_log(
            "build",
            &format!("使用自定义Dockerfile，构建上下文: {}", ctx_path),
        );
        // worktree 作为构建上下文，Docker 构建完后清理
        DockerBuildContext {
            context_dir: ctx.clone(),
            dockerfile_path: df,
            cleanup_file: None,
            cleanup_dir: Some(ctx),
        }
    } else if let Some(ref df_path) = dockerfile_path {
        let df = PathBuf::from(df_path);
        if df.is_file() {
            let custom_content = fs::read_to_string(&df)
                .map_err(|e| format!("读取自定义Dockerfile失败: {}", e))?;
            crate::diag::diag_log(
                "build",
                &format!("使用自定义Dockerfile (独立上下文): {}", df_path),
            );
            prepare_custom_docker_context(
                &config,
                &artifact_path,
                artifact_type,
                &custom_content,
                &image_name_lower,
                &final_tag,
                &full_image,
                &nginx_locations,
            )?
        } else {
            return Err(format!("自定义Dockerfile不存在: {}", df_path));
        }
    } else {
        match artifact_type {
            ArtifactType::Jar => prepare_jar_context(&config, &artifact_path)?,
            ArtifactType::FrontendDist => prepare_frontend_dist_context(
                &config,
                &artifact_path,
                &image_name_lower,
                &final_tag,
                &full_image,
                &nginx_locations,
            )?,
        }
    };

    // 步骤2: docker build (阻塞操作放到线程池)
    emit(&app, 25, "🔨 构建 Docker 镜像...", "build");

    let df_path_str = build_context.dockerfile_path.to_string_lossy().to_string();
    let context_dir = build_context.context_dir.clone();
    let full_image_clone = full_image.clone();
    let cleanup_file = build_context.cleanup_file.clone();
    let cleanup_dir = build_context.cleanup_dir.clone();

    let build_result = tauri::async_runtime::spawn_blocking(move || {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("构建已取消".to_string());
        }
        let child = silent_docker_command()
            .args([
                "build",
                "--platform",
                "linux/amd64",
                "-f",
                &df_path_str,
                "-t",
                &full_image_clone,
                ".",
            ])
            .current_dir(&context_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker build失败: {}", e))?;

        *CURRENT_PID.lock().unwrap() = Some(child.id());

        let output = child
            .wait_with_output()
            .map_err(|e| format!("docker build失败: {}", e))?;

        *CURRENT_PID.lock().unwrap() = None;

        if let Some(path) = cleanup_file {
            fs::remove_file(path).ok();
        }
        if let Some(path) = cleanup_dir {
            fs::remove_dir_all(path).ok();
        }
        Ok(output)
    })
    .await
    .map_err(|e| format!("构建线程异常: {}", e))?;

    let build_output = build_result?;
    if !build_output.status.success() {
        let stderr = String::from_utf8_lossy(&build_output.stderr);
        let stdout = String::from_utf8_lossy(&build_output.stdout);
        return Err(format!(
            "docker build失败:\n--- stderr ---\n{}\n--- stdout ---\n{}",
            stderr, stdout
        ));
    }

    // 步骤3: docker login（进程内同账号只真正 login 一次）
    emit(&app, 55, "🔐 登录 Harbor 镜像仓库...", "push");
    let did_login = docker_login_harbor(
        config.harbor_url.clone(),
        config.username.clone(),
        config.password.clone(),
    )
    .await?;
    if !did_login {
        emit(&app, 58, "🔐 复用已有 Harbor 登录", "push");
    }

    // 步骤4: docker push
    emit(&app, 75, "📤 推送镜像到 Harbor...", "push");
    docker_push_image(full_image.clone()).await?;

    // 步骤5: 推送成功后删除本地镜像，避免本机堆积历史 tag（失败不影响结果）
    emit(&app, 92, "🧹 清理本地镜像缓存...", "cleanup");
    docker_rmi_best_effort(
        full_image.clone(),
        "本地镜像已删除",
        "本地镜像清理跳过（不影响推送结果）",
    )
    .await;

    emit(&app, 100, "✅ 推送完成!", "done");

    Ok(format!("✅ 镜像推送成功!\n\n完整镜像: {}", full_image))
}

/// 将本地已有的 Docker 镜像推送到 Harbor（跳过构建步骤）
#[tauri::command]
pub async fn push_local_image(
    app: tauri::AppHandle,
    local_image: String,
    image_name: String,
    image_tag: String,
) -> Result<String, String> {
    reset_cancel_flag();
    let config = load_config_sync()?;
    require_harbor_config(&config)?;

    let local_image = local_image.trim().to_string();
    if local_image.is_empty() {
        return Err("请输入本地镜像引用".to_string());
    }

    let image_name_lower = image_name.to_lowercase();
    if image_name_lower.is_empty() {
        return Err("请输入目标镜像名称".to_string());
    }

    let repository = resolve_harbor_repository(&image_name_lower, &config.project)?;
    let final_tag = resolve_final_tag(image_tag);
    let full_image = format!("{}/{}:{}", config.harbor_url, repository, final_tag);

    // 步骤1: docker tag <local_image> <full_image>
    emit_progress(&app, 10, "🏷️ 镜像打标签...", "build");

    let local_image_tag = local_image.clone();
    let full_image_tag = full_image.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("操作已取消".to_string());
        }
        let child = silent_docker_command()
            .args(["tag", &local_image_tag, &full_image_tag])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker tag失败: {}", e))?;

        *CURRENT_PID.lock().unwrap() = Some(child.id());
        let output = child
            .wait_with_output()
            .map_err(|e| format!("docker tag失败: {}", e))?;
        *CURRENT_PID.lock().unwrap() = None;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "docker tag失败: 镜像 \"{}\" 可能不存在\n{}",
                local_image_tag, stderr
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("标签线程异常: {}", e))??;

    // 步骤2: docker login（进程内同账号只真正 login 一次）
    emit_progress(&app, 35, "🔐 登录 Harbor 镜像仓库...", "push");
    let did_login = docker_login_harbor(
        config.harbor_url.clone(),
        config.username.clone(),
        config.password.clone(),
    )
    .await?;
    if !did_login {
        emit_progress(&app, 40, "🔐 复用已有 Harbor 登录", "push");
    }

    // 步骤3: docker push
    emit_progress(&app, 60, "📤 推送镜像到 Harbor...", "push");
    docker_push_image(full_image.clone()).await?;

    // 步骤4: 清理 Harbor 标签副本，不删除原始本地镜像
    emit_progress(&app, 90, "🧹 清理本地标签...", "cleanup");
    docker_rmi_best_effort(
        full_image.clone(),
        "本地标签已删除",
        "本地标签清理跳过（不影响推送结果）",
    )
    .await;

    emit_progress(&app, 100, "✅ 推送完成!", "done");

    Ok(format!("✅ 镜像推送成功!\n\n完整镜像: {}", full_image))
}

/// 列出本地所有 Docker 镜像（格式: repository:tag）
#[tauri::command]
pub fn list_local_images() -> Result<Vec<String>, String> {
    let output = docker_output(&["images", "--format", "{{.Repository}}:{{.Tag}}"])
        .map_err(|e| format!("执行docker images失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker images失败:\n{}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let images: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('<'))
        .collect();
    Ok(images)
}
