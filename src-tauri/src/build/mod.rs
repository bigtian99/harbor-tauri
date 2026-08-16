//! 构建 / 推送 / 检测相关 Tauri 命令（OPT-013 拆分）。

mod bt_deploy;
mod detect;
mod package;
mod package_build;
mod package_finish;
mod package_worktree;
mod push;
mod push_helpers;

pub use bt_deploy::{
    cancel_bt_java_deploy, list_bt_java_projects, list_bt_php_sites, restart_bt_java_project,
    upload_and_restart_bt_java_project, upload_bt_java_jar, warmup_bt_ftp,
};
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

/// 可取消构建的生命周期守卫：进入时清标志，结束（成功/失败/取消）时再清一次，
/// 避免「构建已取消」滞留污染后续 git 选仓等非构建命令。
pub(crate) struct CancelFlagGuard;

impl Drop for CancelFlagGuard {
    fn drop(&mut self) {
        reset_cancel_flag();
    }
}

pub(crate) fn begin_cancellable_operation() -> CancelFlagGuard {
    reset_cancel_flag();
    CancelFlagGuard
}

#[cfg(test)]
mod tests {
    use super::{begin_cancellable_operation, reset_cancel_flag};
    use crate::utils::{repo_root_for, run_command, CANCEL_FLAG};
    use std::path::Path;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn cancel_flag_lifecycle_for_merge_after_cancel() {
        let _lock = TEST_LOCK.lock().unwrap();
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri parent");

        // 1) 构建命令仍尊重取消标志
        CANCEL_FLAG.store(true, Ordering::SeqCst);
        let err = run_command(Path::new("."), "true", &[]).expect_err("build cmds must honor cancel");
        assert_eq!(err, "构建已取消");

        // 2) 选仓校验不被滞留取消标志误伤（合并面板选本项目）
        let root = repo_root_for(repo).expect("选仓校验不应被构建取消标志误伤");
        assert!(root.is_dir(), "repo root should be a directory: {}", root.display());

        // 3) 可取消操作结束时必须清标志，避免污染后续 git UI
        CANCEL_FLAG.store(true, Ordering::SeqCst);
        {
            let _guard = begin_cancellable_operation();
            assert!(
                !CANCEL_FLAG.load(Ordering::SeqCst),
                "begin should clear stale cancel flag"
            );
            CANCEL_FLAG.store(true, Ordering::SeqCst);
            let err = run_command(Path::new("."), "true", &[]).expect_err("should see cancel");
            assert_eq!(err, "构建已取消");
        }
        assert!(
            !CANCEL_FLAG.load(Ordering::SeqCst),
            "drop must clear cancel flag so merge/git UI can run again"
        );
        reset_cancel_flag();
    }
}
