//! Docker login / push / rmi 等推送共享步骤。

use crate::build::docker_output;
use crate::models::HarborConfig;
use crate::utils::silent_docker_command;
use std::io::Write;
use std::sync::Mutex;

/// 进程内已成功 login 的 Harbor 会话（url|user|password），避免并行推重复 docker login。
// ponytail: 全局一份；改密码/账号后 key 变会重新 login
static HARBOR_LOGIN_SESSION: Mutex<Option<String>> = Mutex::new(None);

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

fn harbor_session_key(harbor_url: &str, username: &str, password: &str) -> String {
    format!("{harbor_url}\0{username}\0{password}")
}

/// `docker login` Harbor（password-stdin）。
/// 返回 `true` 表示本次真正执行了 login；`false` 表示本进程已登录过同一账号，直接跳过。
pub(crate) async fn docker_login_harbor(
    harbor_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    let session_key = harbor_session_key(&harbor_url, &username, &password);

    let login_result: Result<bool, String> = tauri::async_runtime::spawn_blocking(move || {
        // 持锁贯穿「查会话 → login → 记会话」，并行推时只会有一个真正 login
        let mut session = HARBOR_LOGIN_SESSION
            .lock()
            .map_err(|_| "Harbor 登录锁异常".to_string())?;
        if session.as_ref() == Some(&session_key) {
            crate::diag::diag_log(
                "docker",
                &format!("跳过 docker login（会话内已登录）: {}", harbor_url),
            );
            return Ok(false);
        }

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
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker login失败:\n{}", stderr));
        }

        *session = Some(session_key);
        crate::diag::diag_log("docker", &format!("docker login 成功: {}", harbor_url));
        Ok(true)
    })
    .await
    .map_err(|e| format!("登录线程异常: {}", e))?;

    login_result
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
