use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HarborConfig {
    pub harbor_url: String,
    pub username: String,
    pub password: String,
    pub project: String,
    pub base_image: String,
    pub expose_port: String,
}

impl Default for HarborConfig {
    fn default() -> Self {
        Self {
            harbor_url: "dockerhub.kubekey.local".to_string(),
            username: String::new(),
            password: String::new(),
            project: "tksy-admin".to_string(),
            base_image: "eclipse-temurin:21-jre-alpine".to_string(),
            expose_port: "8181".to_string(),
        }
    }
}

fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = config_dir.join("jar-to-harbor");
    fs::create_dir_all(&app_dir).ok();
    app_dir.join("config.json")
}

#[tauri::command]
fn load_config() -> Result<HarborConfig, String> {
    let path = get_config_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(HarborConfig::default())
    }
}

#[tauri::command]
fn save_config(config: HarborConfig) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn build_and_push(app: tauri::AppHandle, jar_path: String, image_name: String, image_tag: String) -> Result<String, String> {
    let config = load_config()?;

    if config.harbor_url.is_empty() || config.username.is_empty() || config.password.is_empty() || config.project.is_empty() {
        return Err("请先配置Harbor信息".to_string());
    }

    let jar_path_buf = PathBuf::from(&jar_path);
    if !jar_path_buf.exists() {
        return Err(format!("JAR文件不存在: {}", jar_path));
    }

    let jar_dir = jar_path_buf.parent().ok_or("无法获取JAR文件目录")?.to_owned();
    let jar_filename = jar_path_buf.file_name().ok_or("无法获取JAR文件名")?.to_string_lossy().to_string();

    // 生成标签: v.YY.MM.DD.HH.MM
    let final_tag = if image_tag.is_empty() || image_tag == "latest" {
        let now = chrono::Local::now();
        now.format("v.%y.%m.%d.%H.%M").to_string()
    } else {
        image_tag
    };

    let image_name_lower = image_name.to_lowercase();
    let full_image = format!("{}/{}/{}:{}", config.harbor_url, config.project, image_name_lower, final_tag);

    // 步骤1: 生成Dockerfile
    app.emit("build-progress", serde_json::json!({
        "percent": 10,
        "message": "📝 生成 Dockerfile..."
    })).ok();

    let dockerfile_content = format!(
        "FROM {}\nCOPY {} /app/app.jar\nWORKDIR /app\nEXPOSE {}\nENTRYPOINT [\"java\", \"-jar\", \"app.jar\"]",
        config.base_image, jar_filename, config.expose_port
    );

    let dockerfile_path = jar_dir.join(".Dockerfile.tmp");
    fs::write(&dockerfile_path, &dockerfile_content).map_err(|e| format!("写入Dockerfile失败: {}", e))?;

    // 步骤2: docker build (阻塞操作放到线程池)
    app.emit("build-progress", serde_json::json!({
        "percent": 25,
        "message": "🔨 构建 Docker 镜像..."
    })).ok();

    let df_path_str = dockerfile_path.to_string_lossy().to_string();
    let jar_dir_clone = jar_dir.clone();
    let full_image_clone = full_image.clone();

    let build_result = tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("docker")
            .args(["build", "--platform", "linux/amd64", "-f", &df_path_str, "-t", &full_image_clone, "."])
            .current_dir(&jar_dir_clone)
            .output();
        // 清理临时Dockerfile
        fs::remove_file(&dockerfile_path).ok();
        output
    }).await.map_err(|e| format!("构建线程异常: {}", e))?;

    let build_output = build_result.map_err(|e| format!("执行docker build失败: {}", e))?;
    if !build_output.status.success() {
        let stderr = String::from_utf8_lossy(&build_output.stderr);
        let stdout = String::from_utf8_lossy(&build_output.stdout);
        return Err(format!("docker build失败:\n{}\n{}", stdout, stderr));
    }

    // 步骤3: docker login (阻塞操作放到线程池)
    app.emit("build-progress", serde_json::json!({
        "percent": 55,
        "message": "🔐 登录 Harbor 镜像仓库..."
    })).ok();

    let harbor_url = config.harbor_url.clone();
    let username = config.username.clone();
    let password = config.password.clone();

    let login_result = tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new("docker")
            .args(["login", &harbor_url, "-u", &username, "--password-stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动docker login失败: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(password.as_bytes()).map_err(|e| e.to_string())?;
        }

        child.wait_with_output().map_err(|e| format!("docker login失败: {}", e))
    }).await.map_err(|e| format!("登录线程异常: {}", e))?;

    let login_output = login_result?;
    if !login_output.status.success() {
        let stderr = String::from_utf8_lossy(&login_output.stderr);
        return Err(format!("docker login失败:\n{}", stderr));
    }

    // 步骤4: docker push (阻塞操作放到线程池)
    app.emit("build-progress", serde_json::json!({
        "percent": 75,
        "message": "📤 推送镜像到 Harbor..."
    })).ok();

    let full_image_push = full_image.clone();
    let push_result = tauri::async_runtime::spawn_blocking(move || {
        Command::new("docker")
            .args(["push", &full_image_push])
            .output()
    }).await.map_err(|e| format!("推送线程异常: {}", e))?;

    let push_output = push_result.map_err(|e| format!("执行docker push失败: {}", e))?;
    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("docker push失败:\n{}", stderr));
    }

    app.emit("build-progress", serde_json::json!({
        "percent": 100,
        "message": "✅ 推送完成!"
    })).ok();

    Ok(format!("✅ 镜像推送成功!\n\n完整镜像: {}", full_image))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            build_and_push
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
