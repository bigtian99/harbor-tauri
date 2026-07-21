//! 构建 / 推送 / 检测相关 Tauri 命令（OPT-013 拆分）。

mod detect;
mod package;
mod package_build;
mod package_finish;
mod package_worktree;
mod push;
mod push_helpers;

pub use detect::{
    cancel_build, check_dockerfile, detect_frontend_dir, detect_spring_profiles, list_npm_scripts,
    open_directory,
};
pub use package::package_from_branch;
pub use push::{build_and_push, list_local_images, push_local_image, remove_local_image};

use crate::utils::{silent_docker_command, CANCEL_FLAG, CURRENT_PID};
use std::process::Stdio;
use std::sync::atomic::Ordering;
use tauri::Emitter;

pub(crate) fn docker_output(args: &[&str]) -> std::io::Result<std::process::Output> {
    let child = silent_docker_command()
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child.wait_with_output()
}

/// 统一 build-progress 事件（OPT-017 / OPT-033）。
///
/// 载荷：`{ percent, message, stage }`。`stage` 为语义字段
///（`fetch` | `worktree` | `build` | `push` | `cleanup` | `done`）；
/// 旧前端只读 percent/message 仍兼容。
pub(crate) fn emit_progress(
    app: &tauri::AppHandle,
    percent: u32,
    message: impl AsRef<str>,
    stage: &str,
) {
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": percent,
            "message": message.as_ref(),
            "stage": stage,
        }),
    )
    .ok();
}

/// 镜像名已含 `/` 则原样使用，否则拼接 `{project}/{image_name}`
pub(crate) fn resolve_harbor_repository(image_name: &str, project: &str) -> Result<String, String> {
    let name = image_name.trim().to_lowercase();
    if name.is_empty() {
        return Err("镜像名称不能为空".to_string());
    }
    if name.contains('/') {
        return Ok(name);
    }
    let project = project.trim().to_lowercase();
    if project.is_empty() {
        return Err("请先在 Harbor 连接中配置项目名称".to_string());
    }
    Ok(format!("{}/{}", project, name))
}

pub(crate) fn reset_cancel_flag() {
    CANCEL_FLAG.store(false, Ordering::SeqCst);
    *CURRENT_PID.lock().unwrap() = None;
}
