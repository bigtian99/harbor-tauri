//! Docker login / push / rmi 等推送共享步骤。

use crate::build::docker_output;
use crate::models::HarborConfig;
use crate::utils::silent_docker_command;
use std::io::Write;

/// Harbor 必填项校验。
pub(crate) fn require_harbor_config(config: &HarborConfig) -> Result<(), String> {
    if config.harbor_url.is_empty()
        || config.username.is_empty()
        || config.password.is_empty()
        || config.project.is_empty()
    {
        return Err("请先配置Harbor信息".to_string());
    }
    Ok(())
}

/// 空或 `latest` 时生成 `v.YY.MM.DD.HH.MM`，否则原样返回。
pub(crate) fn resolve_final_tag(image_tag: String) -> String {
    if image_tag.is_empty() || image_tag == "latest" {
        let now = chrono::Local::now();
        now.format("v.%y.%m.%d.%H.%M").to_string()
    } else {
        image_tag
    }
}

/// `docker login` Harbor（password-stdin），在阻塞线程中执行。
pub(crate) async fn docker_login_harbor(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let login_result: Result<std::process::Output, String> =
        tauri::async_runtime::spawn_blocking(move || {
            let mut child = silent_docker_command()
                .args(["login", &harbor_url, "-u", &username, "--password-stdin"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("启动docker login失败: {}", e))?;

            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(password.as_bytes())
                    .map_err(|e| e.to_string())?;
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("docker login失败: {}", e))?;
            Ok(output)
        })
        .await
        .map_err(|e| format!("登录线程异常: {}", e))?;

    let login_output = login_result?;
    if !login_output.status.success() {
        let stderr = String::from_utf8_lossy(&login_output.stderr);
        return Err(format!("docker login失败:\n{}", stderr));
    }
    Ok(())
}

/// `docker push`，在阻塞线程中执行。
pub(crate) async fn docker_push_image(full_image: String) -> Result<(), String> {
    let full_image_push = full_image.clone();
    let push_result =
        tauri::async_runtime::spawn_blocking(move || docker_output(&["push", &full_image_push]))
            .await
            .map_err(|e| format!("推送线程异常: {}", e))?;

    let push_output = push_result.map_err(|e| format!("执行docker push失败: {}", e))?;
    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("docker push失败:\n{}", stderr));
    }
    Ok(())
}

/// 尽力删除本地镜像/标签；失败只记日志，不抛错。
pub(crate) async fn docker_rmi_best_effort(full_image: String, success_log: &str, skip_log: &str) {
    let full_image_remove = full_image.clone();
    let remove_result =
        tauri::async_runtime::spawn_blocking(move || docker_output(&["rmi", &full_image_remove]))
            .await;

    match remove_result {
        Ok(Ok(output)) if output.status.success() => {
            crate::diag::diag_log("docker", &format!("{}: {}", success_log, full_image));
        }
        _ => {
            crate::diag::diag_log("docker", &format!("{}: {}", skip_log, full_image));
        }
    }
}
