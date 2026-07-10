use crate::models::{ArtifactType, DockerBuildContext, HarborConfig, NginxLocationBlock};
use crate::utils::{copy_dir_contents, create_temp_build_dir, docker_json_string, find_project_nginx, render_template};
use std::fs;
use std::path::Path;

fn render_nginx_locations(locations: &[NginxLocationBlock]) -> String {
    if locations.is_empty() {
        return String::new();
    }
    locations.iter().fold(String::new(), |mut acc, loc| {
        use std::fmt::Write;
        let _ = writeln!(acc);
        let _ = writeln!(acc, "    location {} {{", loc.path);
        let _ = writeln!(acc, "        proxy_pass {};", loc.proxy_pass);
        if !loc.host.is_empty() {
            let _ = writeln!(acc, "        proxy_set_header Host {};", loc.host);
        }
        let _ = writeln!(acc, "        proxy_set_header X-Real-IP $remote_addr;");
        let _ = writeln!(acc, "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
        let _ = writeln!(acc, "        proxy_set_header X-Forwarded-Proto $scheme;");
        let _ = writeln!(acc, "    }}");
        acc
    })
}

fn inject_nginx_locations(mut nginx_content: String, locations: &[NginxLocationBlock]) -> String {
    let rendered = render_nginx_locations(locations);
    if rendered.is_empty() {
        return nginx_content;
    }
    if nginx_content.contains("{{CUSTOM_LOCATIONS}}") {
        return nginx_content.replace("{{CUSTOM_LOCATIONS}}", &rendered);
    }
    // 没有占位符，注入到 server block 最后一个 } 之前
    if let Some(last_brace) = nginx_content.rfind('}') {
        nginx_content.insert_str(last_brace, &rendered);
    }
    nginx_content
}

/// 拼接 tools 的 --build-context 片段（如 `--build-context tools=/path/tools`），未配置则返回空
#[allow(dead_code)]
pub(crate) fn tools_dir_build_args(custom_docker_extras_dir: &str) -> Vec<String> {
    let trimmed = custom_docker_extras_dir.trim();
    if trimmed.is_empty() {
        Vec::new()
    } else {
        vec!["--build-context".to_string(), format!("tools={}", trimmed)]
    }
}

pub(crate) fn prepare_custom_docker_context(
    config: &HarborConfig,
    artifact_path: &Path,
    artifact_type: ArtifactType,
    dockerfile_content: &str,
    image_name: &str,
    image_tag: &str,
    full_image: &str,
    nginx_locations: &[NginxLocationBlock],
) -> Result<DockerBuildContext, String> {
    let context_dir = create_temp_build_dir()?;

    let replacements = [
        ("BASE_IMAGE", config.base_image.clone()),
        ("EXPOSE_PORT", config.expose_port.clone()),
        ("FRONTEND_BASE_IMAGE", config.frontend_base_image.clone()),
        ("FRONTEND_EXPOSE_PORT", config.frontend_expose_port.clone()),
        ("IMAGE_NAME", image_name.to_string()),
        ("IMAGE_TAG", image_tag.to_string()),
        ("FULL_IMAGE", full_image.to_string()),
    ];

    match artifact_type {
        ArtifactType::Jar => {
            // 复制 JAR 到构建上下文目录
            let jar_name = artifact_path
                .file_name()
                .ok_or("无法获取JAR文件名")?
                .to_string_lossy()
                .to_string();
            let dest_jar = context_dir.join(&jar_name);
            fs::copy(artifact_path, &dest_jar)
                .map_err(|e| format!("复制JAR到构建上下文失败: {}", e))?;

            // 渲染自定义 Dockerfile，支持 {{JAR_FILE}} 占位符
            let mut rendered = render_template(dockerfile_content, &replacements);
            // 替换 JAR 文件名占位符
            rendered = rendered.replace("{{JAR_FILE}}", &jar_name);
            let df_path = context_dir.join("Dockerfile");
            fs::write(&df_path, rendered)
                .map_err(|e| format!("写入Dockerfile失败: {}", e))?;

            Ok(DockerBuildContext {
                context_dir: context_dir.clone(),
                dockerfile_path: df_path,
                cleanup_file: None,
                cleanup_dir: Some(context_dir),
            })
        }
        ArtifactType::FrontendDist => {
            // 复制 dist 内容到 public/ 目录
            let public_dir = context_dir.join("public");
            copy_dir_contents(artifact_path, &public_dir)?;

            // 生成 nginx 配置
            let nginx_path = context_dir.join("nginx.conf");
            // nginx.conf 优先级：项目自带 > 兜底模板
            let nginx_content = find_project_nginx(artifact_path)
                .unwrap_or_else(|| render_template(&config.frontend_nginx_template, &replacements));
            let nginx_content = inject_nginx_locations(nginx_content, nginx_locations);
            fs::write(&nginx_path, nginx_content)
                .map_err(|e| format!("写入nginx配置失败: {}", e))?;

            // 渲染并写入自定义 Dockerfile
            let rendered = render_template(dockerfile_content, &replacements);
            let df_path = context_dir.join("Dockerfile");
            fs::write(&df_path, rendered)
                .map_err(|e| format!("写入Dockerfile失败: {}", e))?;

            Ok(DockerBuildContext {
                context_dir: context_dir.clone(),
                dockerfile_path: df_path,
                cleanup_file: None,
                cleanup_dir: Some(context_dir),
            })
        }
    }
}

pub(crate) fn prepare_jar_context(
    config: &HarborConfig,
    artifact_path: &Path,
) -> Result<DockerBuildContext, String> {
    if !artifact_path.is_file() {
        return Err(format!("JAR路径不是文件: {}", artifact_path.display()));
    }

    if artifact_path.extension().and_then(|ext| ext.to_str()) != Some("jar") {
        return Err(format!("请选择 .jar 文件: {}", artifact_path.display()));
    }

    let jar_dir = artifact_path
        .parent()
        .ok_or("无法获取JAR文件目录")?
        .to_owned();
    let jar_filename = artifact_path
        .file_name()
        .ok_or("无法获取JAR文件名")?
        .to_string_lossy()
        .to_string();
    let dockerfile_path = jar_dir.join(".Dockerfile.tmp");
    let escaped_jar_filename = docker_json_string(&jar_filename);
    let dockerfile_content = format!(
        "FROM {}\nCOPY [\"{}\", \"/app/app.jar\"]\nWORKDIR /app\nEXPOSE {}\nENTRYPOINT [\"java\", \"-jar\", \"app.jar\", \"--server.port={}\"]",
        config.base_image, escaped_jar_filename, config.expose_port, config.expose_port
    );

    fs::write(&dockerfile_path, dockerfile_content)
        .map_err(|e| format!("写入Dockerfile失败: {}", e))?;

    Ok(DockerBuildContext {
        context_dir: jar_dir,
        dockerfile_path: dockerfile_path.clone(),
        cleanup_file: Some(dockerfile_path),
        cleanup_dir: None,
    })
}

pub(crate) fn prepare_frontend_dist_context(
    config: &HarborConfig,
    artifact_path: &Path,
    image_name: &str,
    image_tag: &str,
    full_image: &str,
    nginx_locations: &[NginxLocationBlock],
) -> Result<DockerBuildContext, String> {
    if !artifact_path.is_dir() {
        return Err(format!(
            "前端 dist 路径不是目录: {}",
            artifact_path.display()
        ));
    }

    let index_path = artifact_path.join("index.html");
    if !index_path.exists() {
        return Err(format!(
            "前端 dist 目录缺少 index.html: {}",
            artifact_path.display()
        ));
    }

    let context_dir = create_temp_build_dir()?;
    let public_dir = context_dir.join("public");
    if let Err(error) = copy_dir_contents(artifact_path, &public_dir) {
        fs::remove_dir_all(&context_dir).ok();
        return Err(error);
    }

    let nginx_conf_path = "/etc/nginx/conf.d/default.conf";
    let dist_dir = "public";
    let replacements = [
        ("BASE_IMAGE", config.frontend_base_image.clone()),
        ("EXPOSE_PORT", config.frontend_expose_port.clone()),
        ("NGINX_CONF_PATH", nginx_conf_path.to_string()),
        ("DIST_DIR", dist_dir.to_string()),
        ("IMAGE_NAME", image_name.to_string()),
        ("IMAGE_TAG", image_tag.to_string()),
        ("FULL_IMAGE", full_image.to_string()),
    ];

    let dockerfile_path = context_dir.join("Dockerfile");
    let nginx_path = context_dir.join("nginx.conf");
    let dockerfile_content = render_template(&config.frontend_dockerfile_template, &replacements);

    // nginx.conf 优先级：项目自带 > 兜底模板
    let nginx_content = find_project_nginx(artifact_path)
        .unwrap_or_else(|| {
            render_template(&config.frontend_nginx_template, &replacements)
        });
    let nginx_content = inject_nginx_locations(nginx_content, nginx_locations);

    if let Err(error) = fs::write(&dockerfile_path, dockerfile_content) {
        fs::remove_dir_all(&context_dir).ok();
        return Err(format!("写入前端Dockerfile失败: {}", error));
    }
    if let Err(error) = fs::write(&nginx_path, nginx_content) {
        fs::remove_dir_all(&context_dir).ok();
        return Err(format!("写入nginx配置失败: {}", error));
    }

    Ok(DockerBuildContext {
        context_dir: context_dir.clone(),
        dockerfile_path,
        cleanup_file: None,
        cleanup_dir: Some(context_dir),
    })
}
