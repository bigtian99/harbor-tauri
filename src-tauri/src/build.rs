use crate::config_cmd::load_config_sync;
use crate::docker::{prepare_custom_docker_context, prepare_frontend_dist_context, prepare_jar_context};
use crate::git::{cleanup_worktree, find_maven_artifact, find_npm_artifact};
use crate::history::save_build_record_direct;
use crate::models::{ArtifactType, BuildRecord, DockerBuildContext, PackageFromBranchResult, PackageProjectType};
use crate::utils::{
    cleanup_old_temp_dirs, command_output_text, copy_artifact_to_output_internal,
    detect_npm_build_script, lock_file_hash, repo_root_for, run_command,
    save_node_modules_to_cache, silent_command, silent_docker_command, try_restore_node_modules,
    CANCEL_FLAG, CURRENT_PID,
};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use tauri::Emitter;

fn docker_output(args: &[&str]) -> std::io::Result<std::process::Output> {
    let child = silent_docker_command()
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child.wait_with_output()
}

/// 镜像名已含 `/` 则原样使用，否则拼接 `{project}/{image_name}`
fn resolve_harbor_repository(image_name: &str, project: &str) -> Result<String, String> {
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

#[tauri::command]
pub async fn list_npm_scripts(
    repo_path: String,
    frontend_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let worktree_path = crate::utils::create_temp_worktree_path()?;
    let repo_root = tauri::async_runtime::spawn_blocking(move || repo_root_for(&repo_path))
        .await
        .map_err(|e| format!("读取仓库线程异常: {}", e))??;

    // 创建临时 worktree 来读取 package.json
    let branch = "HEAD";
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let output = silent_command("git")
            .args(["worktree", "add", "--detach"])
            .arg(&worktree_path)
            .arg(branch)
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("创建 worktree 失败: {}", e))?;

        if !output.status.success() {
            fs::remove_dir_all(&worktree_path).ok();
            return Err(format!(
                "创建 worktree 失败:\n{}",
                command_output_text(&output)
            ));
        }

        // 确定 package.json 路径
        let pkg_path = if let Some(ref dir) = frontend_dir {
            if !dir.trim().is_empty() {
                worktree_path.join(dir.trim()).join("package.json")
            } else {
                worktree_path.join("package.json")
            }
        } else {
            worktree_path.join("package.json")
        };

        let scripts = if pkg_path.is_file() {
            let content = fs::read_to_string(&pkg_path)
                .map_err(|e| format!("读取 package.json 失败: {}", e))?;
            let package_json: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| format!("解析 package.json 失败: {}", e))?;
            package_json
                .get("scripts")
                .and_then(|s| s.as_object())
                .map(|m| m.keys().cloned().collect::<Vec<String>>())
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // 清理临时 worktree
        let _ = silent_command("git")
            .args(["worktree", "remove", "--force"])
            .arg(&worktree_path)
            .current_dir(&repo_root)
            .output();

        Ok(scripts)
    })
    .await
    .map_err(|e| format!("读取 scripts 线程异常: {}", e))?
}

#[tauri::command]
pub async fn detect_frontend_dir(repo_path: String) -> Result<Option<String>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    // 先检查根目录
    if repo_path.join("package.json").is_file() {
        return Ok(None);
    }

    // 常见前端目录名，按优先级排序
    let candidates = ["frontend", "front-end", "web", "ui", "client", "app"];

    // 搜索一级子目录
    if let Ok(entries) = fs::read_dir(&repo_path) {
        // 优先匹配常见目录名
        for candidate in &candidates {
            let path = repo_path.join(candidate);
            if path.is_dir() && path.join("package.json").is_file() {
                return Ok(Some(candidate.to_string()));
            }
        }

        // 其次检查所有子目录（排除隐藏目录和常见非前端目录）
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || name == "node_modules"
                || name == "target"
                || name == "dist"
                || name == "build"
                || candidates.contains(&name.as_str())
            {
                continue;
            }
            if entry.path().join("package.json").is_file() {
                return Ok(Some(name));
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn open_directory(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }

    let target = if path.is_file() {
        path.parent().unwrap_or(&path)
    } else {
        &path
    };

    #[cfg(target_os = "macos")]
    {
        silent_command("open")
            .arg(target)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // 使用 cmd /c start 避免 explorer 路径解析异常（如跳到文档文件夹）
        let path_str = target.to_string_lossy().to_string();
        silent_command("cmd")
            .args(["/C", "start", "", &path_str])
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        silent_command("xdg-open")
            .arg(target)
            .output()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn check_dockerfile(repo_path: String, branch: String) -> Result<bool, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Ok(false);
    }

    let repo_path_clone = repo_path.clone();
    let branch_clone = branch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path_clone)?;
        // 用 git show 检查分支上是否有 Dockerfile（大小写都试）
        for name in &["Dockerfile", "dockerfile"] {
            let ref_name = format!("{}:{}", branch_clone, name);
            let output = silent_command("git")
                .args(["show", &ref_name])
                .current_dir(&repo_root)
                .output()
                .map_err(|e| format!("git show 失败: {}", e))?;
            if output.status.success() {
                return Ok(true);
            }
        }
        Ok(false)
    })
    .await
    .map_err(|e| format!("检测线程异常: {}", e))?
}

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
) -> Result<PackageFromBranchResult, String> {
    reset_cancel_flag();
    let project_type = PackageProjectType::from_string(project_type)?;
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("请输入目标分支".to_string());
    }

    // 如果是 URL，先克隆到本地缓存目录
    let repo_path_str = repo_path.trim().to_string();
    let repo_path = if crate::git::is_git_url(&repo_path_str) {
        let local = crate::git::clone_repo(repo_path_str).await?;
        PathBuf::from(local)
    } else {
        let p = PathBuf::from(&repo_path_str);
        if !p.is_dir() {
            return Err(format!("仓库路径不是目录: {}", p.display()));
        }
        p
    };

    // 每次打包前清理之前的临时 worktree/build 残留目录
    cleanup_old_temp_dirs();

    // 提前加载配置，获取输出目录和包管理器设置
    let config = load_config_sync().unwrap_or_default();

    // 提取仓库名，用于组织输出目录结构
    let repo_name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 生成时间戳，用于输出目录命名
    let build_timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let branch_slug = branch.replace('/', "_");

    // 确定基础输出目录：优先使用用户配置，为空则回退到桌面
    let output_base = if !config.artifact_output_dir.trim().is_empty() {
        PathBuf::from(&config.artifact_output_dir)
    } else {
        dirs::desktop_dir().unwrap_or_else(|| std::env::temp_dir())
    };

    // worktree 放在输出目录下（和产物同一目录，构建完清理只留产物）
    let worktree_path = output_base
        .join(&repo_name)
        .join(format!("_{}_{}", &branch_slug, &build_timestamp));

    // 确保父目录存在
    fs::create_dir_all(worktree_path.parent().unwrap())
        .map_err(|e| format!("创建 worktree 父目录失败: {}", e))?;

    eprintln!(
        "[JarPorter] Worktree 路径: {} (输出目录: {})",
        worktree_path.display(),
        output_base.display()
    );

    // 处理前端子目录路径
    let build_dir = if let Some(ref dir) = frontend_dir {
        if !dir.trim().is_empty() {
            Some(dir.trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    // 记录开始时间
    let start_time = std::time::Instant::now();

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 6,
            "message": "⬇️ 校验仓库并更新分支代码..."
        }),
    )
    .ok();

    let repo_path_clone = repo_path.clone();
    let branch_for_git = branch.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let repo_root = repo_root_for(&repo_path_clone)?;

        crate::utils::git_output(&repo_root, &["fetch", "--all", "--prune"])
            .map_err(|e| format!("更新分支代码失败: {}", e))?;

        crate::utils::git_output(
            &repo_root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{}^{{commit}}", branch_for_git),
            ],
        )
        .map_err(|_| format!("目标分支或引用不存在: {}", branch_for_git))?;

        Ok(repo_root)
    })
    .await
    .map_err(|e| format!("Git 校验线程异常: {}", e))?;

    let repo_root = result?;

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 20,
            "message": "🌿 已更新分支代码，创建隔离 worktree..."
        }),
    )
    .ok();

    let repo_root_for_worktree = repo_root.clone();
    let worktree_for_add = worktree_path.clone();
    let branch_for_add = branch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let output = silent_command("git")
            .args(["worktree", "add", "--detach"])
            .arg(&worktree_for_add)
            .arg(&branch_for_add)
            .current_dir(&repo_root_for_worktree)
            .output()
            .map_err(|e| format!("创建 worktree 失败: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            fs::remove_dir_all(&worktree_for_add).ok();
            Err(format!(
                "创建 worktree 失败:\n{}",
                command_output_text(&output)
            ))
        }
    })
    .await
    .map_err(|e| format!("创建 worktree 线程异常: {}", e))??;

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 35,
            "message": "🧪 校验项目类型..."
        }),
    )
    .ok();

    // 确定实际构建目录
    let actual_build_path = if let Some(ref dir) = build_dir {
        worktree_path.join(dir)
    } else {
        worktree_path.clone()
    };

    match project_type {
        PackageProjectType::Maven if !actual_build_path.join("pom.xml").is_file() => {
            // 列出 worktree 中的文件帮助诊断
            let files_in_worktree = fs::read_dir(&actual_build_path)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| format!("  - {}", e.file_name().to_string_lossy()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_else(|e| format!("  无法读取目录: {}", e));
            cleanup_worktree(&repo_root, &worktree_path);
            return Err(format!(
                "目标分支缺少 pom.xml\n\n期望路径: {}\n\nworktree 中的文件:\n{}\n\n已清理临时 worktree: {}",
                actual_build_path.join("pom.xml").display(),
                files_in_worktree,
                worktree_path.display()
            ));
        }
        PackageProjectType::Npm if !actual_build_path.join("package.json").is_file() => {
            cleanup_worktree(&repo_root, &worktree_path);
            return Err(format!(
                "目标分支缺少 package.json，已清理临时 worktree: {}",
                worktree_path.display()
            ));
        }
        _ => {}
    }

    let package_message = match project_type {
        PackageProjectType::Maven => "☕ 执行 Maven 打包...".to_string(),
        PackageProjectType::Npm => "📦 执行 npm install...".to_string(),
    };
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 50,
            "message": package_message
        }),
    )
    .ok();

    let worktree_for_build = actual_build_path.clone();
    let worktree_root_for_backend = worktree_path.clone();
    let user_build_script = build_script.clone();
    // 使用用户指定的包管理器，默认 npm
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
    let npm_registry = config.npm_registry.clone();
    let app_for_build = app.clone();
    // 克隆配置用于闭包
    let spring_profile_clone = spring_profile.clone();
    let build_result = tauri::async_runtime::spawn_blocking(
        move || -> Result<(PathBuf, String, Vec<String>, Option<String>), String> {
            let mut logs = Vec::new();
            let build_script_used;

            match project_type {
                PackageProjectType::Maven => {
                    let mut mvn_args = vec!["clean", "package", "-DskipTests"];
                    let profile_arg;
                    if let Some(ref profile) = spring_profile_clone {
                        if !profile.trim().is_empty() {
                            profile_arg = format!("-Dspring.profiles.active={}", profile.trim());
                            mvn_args.push(&profile_arg);
                        }
                    }
                    build_script_used = format!("mvn {}", mvn_args.join(" "));
                    logs.push(run_command(&worktree_for_build, "mvn", &mvn_args)?);
                    let artifact_path = find_maven_artifact(&worktree_for_build)?;
                    Ok((artifact_path, build_script_used, logs, None))
                }
                PackageProjectType::Npm => {
                    // 如果用户勾选了"同时打包后端"，先检查 pom.xml 是否存在，若存在则启动并行构建
                    let backend_handle: Option<std::thread::JoinHandle<Result<(String, String), String>>> =
                        if package_with_backend.unwrap_or(false) && worktree_root_for_backend.join("pom.xml").is_file() {
                            let root = worktree_root_for_backend.clone();
                            let sp = spring_profile_clone.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
                            if let Some(ref profile) = sp {
                                logs.push(format!("☕ Spring Profile: {}", profile));
                            }
                            let mvn_base = if let Some(ref profile) = sp {
                                format!("clean package -DskipTests -Dspring.profiles.active={}", profile)
                            } else {
                                "clean package -DskipTests".to_string()
                            };
                            logs.push(format!("☕ 启动后端并行构建: mvn {}", mvn_base));
                            app_for_build.emit(
                                "build-progress",
                                serde_json::json!({
                                    "percent": 55,
                                    "message": "📦 前端安装依赖... | ☕ 后端并行打包中"
                                }),
                            ).ok();
                            Some(std::thread::spawn(move || {
                                let mvn_args: Vec<&str> = mvn_base.split_whitespace().collect();
                                let mvn_log = run_command(&root, "mvn", &mvn_args)
                                    .map_err(|e| format!("后端 Maven 打包失败: {}", e))?;
                                let jar = find_maven_artifact(&root)?;
                                Ok((jar.to_string_lossy().to_string(), mvn_log))
                            }))
                        } else if package_with_backend.unwrap_or(false) {
                            logs.push("⚠️ 勾选了同时打包后端，但 worktree 根目录未找到 pom.xml，跳过后端打包".to_string());
                            None
                        } else {
                            None
                        };

                    // 前端构建（与后端并行进行）
                    // 检查缓存，依赖未变则跳过 install
                    let cached = if let Some(key) = lock_file_hash(&worktree_for_build) {
                        match try_restore_node_modules(&worktree_for_build, &key) {
                            Ok(true) => {
                                let msg = format!("✅ 命中缓存 (hash={})，跳过 {} install", &key[..12], pm);
                                app_for_build.emit(
                                    "build-progress",
                                    serde_json::json!({
                                        "percent": 52,
                                        "message": &msg
                                    }),
                                ).ok();
                                logs.push(msg);
                                true
                            }
                            Ok(false) => {
                                let msg = format!("❓ 缓存未命中 (hash={})，执行 {} install...", &key[..12], pm);
                                app_for_build.emit(
                                    "build-progress",
                                    serde_json::json!({
                                        "percent": 52,
                                        "message": &msg
                                    }),
                                ).ok();
                                logs.push(format!("cache miss (hash={})", key));
                                false
                            }
                            Err(e) => {
                                let msg = format!("⚠️ 缓存恢复失败: {}，重新 install", e);
                                app_for_build.emit(
                                    "build-progress",
                                    serde_json::json!({
                                        "percent": 52,
                                        "message": &msg
                                    }),
                                ).ok();
                                logs.push(msg);
                                false
                            }
                        }
                    } else {
                        let msg = "📦 未找到 lock 文件，执行 install...".to_string();
                        app_for_build.emit(
                            "build-progress",
                            serde_json::json!({
                                "percent": 52,
                                "message": &msg
                            }),
                        ).ok();
                        logs.push("未找到 lock 文件，跳过缓存".to_string());
                        false
                    };
                    if !cached {
                        // npm install 进度
                        let install_msg = if backend_handle.is_some() {
                            format!("📦 执行 {} install... | ☕ 后端并行打包中", pm)
                        } else {
                            format!("📦 执行 {} install（首次下载依赖，可能需要几分钟）...", pm)
                        };
                        app_for_build.emit(
                            "build-progress",
                            serde_json::json!({
                                "percent": 55,
                                "message": install_msg
                            }),
                        ).ok();
                        // 支持自定义 registry
                        if npm_registry.trim().is_empty() {
                            logs.push(run_command(&worktree_for_build, &pm, &["install"])?);
                        } else {
                            logs.push(run_command(
                                &worktree_for_build,
                                &pm,
                                &["install", "--registry", npm_registry.trim()],
                            )?);
                        }
                        if let Some(key) = lock_file_hash(&worktree_for_build) {
                            app_for_build.emit(
                                "build-progress",
                                serde_json::json!({
                                    "percent": 60,
                                    "message": format!("💾 保存 node_modules 到缓存 (hash={})...", &key[..12])
                                }),
                            ).ok();
                            save_node_modules_to_cache(&worktree_for_build, &key);
                            logs.push(format!("💾 node_modules 已缓存 (hash={})", key));
                        }
                    }
                    // 使用用户选择的构建命令，如果没有则自动检测
                    let script_name = if let Some(ref s) = user_build_script {
                        if !s.trim().is_empty() {
                            s.trim().to_string()
                        } else {
                            detect_npm_build_script(&worktree_for_build)?
                        }
                    } else {
                        detect_npm_build_script(&worktree_for_build)?
                    };
                    build_script_used = format!("{} run {}", pm, script_name);
                    let build_msg = if backend_handle.is_some() {
                        format!("🔨 前端构建: {} run {} | ☕ 后端并行打包中", pm, script_name)
                    } else {
                        format!("🔨 执行构建: {} run {}", pm, script_name)
                    };
                    app_for_build.emit(
                        "build-progress",
                        serde_json::json!({
                            "percent": 65,
                            "message": build_msg
                        }),
                    ).ok();
                    logs.push(run_command(
                        &worktree_for_build,
                        &pm,
                        &["run", &script_name],
                    )?);
                    let artifact_path = find_npm_artifact(&worktree_for_build)?;

                    // 等待后端构建完成（如果有）
                    let backend_artifact: Option<String> = if let Some(handle) = backend_handle {
                        app_for_build.emit(
                            "build-progress",
                            serde_json::json!({
                                "percent": 68,
                                "message": "✅ 前端构建完成，⏳ 等待后端 Maven 打包..."
                            }),
                        ).ok();
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

                    Ok((artifact_path, build_script_used, logs, backend_artifact))
                }
            }
        },
    )
    .await
    .map_err(|e| format!("打包线程异常: {}", e))?;

    let (artifact_path, build_script, logs, backend_artifact_path) = build_result?;

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 85,
            "message": "📋 复制产物到输出目录..."
        }),
    )
    .ok();

    let log = logs
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    // 产物输出目录 — worktree 同级的干净目录
    // worktree:  <output_base>/<repo_name>/_{branch}_{timestamp}/   (构建后清理)
    // artifact: <output_base>/<repo_name>/<branch>_<timestamp>/     (最终输出)
    let artifact_dir = output_base
        .join(&repo_name)
        .join(format!("{}_{}", &branch_slug, &build_timestamp));

    // 复制产物到输出目录
    let final_artifact_path = match copy_artifact_to_output_internal(&artifact_path, &artifact_dir)
    {
        Ok(copied_path) => {
            eprintln!("[JarPorter] ✅ 产物已输出到: {}", copied_path);
            copied_path
        }
        Err(e) => {
            eprintln!("[JarPorter] ❌ 产物复制失败: {}", e);
            artifact_path.to_string_lossy().to_string()
        }
    };

    // 复制后端产物到输出目录
    let backend_final_path: Option<String> = if let Some(ref backend_src) = backend_artifact_path {
        let backend_src_path = PathBuf::from(backend_src);
        match copy_artifact_to_output_internal(&backend_src_path, &artifact_dir) {
            Ok(copied) => {
                eprintln!("[JarPorter] ✅ 后端产物已输出到: {}", copied);
                Some(copied)
            }
            Err(e) => {
                eprintln!("[JarPorter] ❌ 后端产物复制失败: {}", e);
                Some(backend_src.clone())
            }
        }
    } else {
        None
    };

    // 清理 worktree — 只保留产物，删除源码
    // 清理前先检查是否有自定义 Dockerfile（支持大小写，检查 worktree 根目录和构建子目录）
    // 如果找到自定义 Dockerfile，保留 worktree 作为 Docker 构建上下文
    let (dockerfile_path, dockerfile_context): (Option<String>, Option<String>) = {
        let dockerfile_names = ["Dockerfile", "dockerfile"];
        let search_dirs = vec![worktree_path.clone(), actual_build_path.clone()];
        let mut found_df_path = None;
        let mut found_df_context = None;

        for search_dir in &search_dirs {
            for name in &dockerfile_names {
                let df_in_worktree = search_dir.join(name);
                if df_in_worktree.is_file() {
                    eprintln!("[JarPorter] 📄 检测到自定义 Dockerfile: {}", df_in_worktree.display());
                    // 使用 worktree 作为 Docker 构建上下文（包含 Dockerfile、JAR、tools/ 等）
                    found_df_path = Some(df_in_worktree.to_string_lossy().to_string());
                    found_df_context = Some(worktree_path.to_string_lossy().to_string());
                    break;
                }
            }
            if found_df_path.is_some() {
                break;
            }
        }
        if found_df_path.is_none() {
            eprintln!("[JarPorter] 未检测到自定义 Dockerfile（已检查: {:?}）", search_dirs);
        }
        (found_df_path, found_df_context)
    };

    if dockerfile_context.is_some() {
        // 有自定义 Dockerfile，保留 worktree 作为构建上下文
        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": 95,
                "message": "📄 检测到自定义 Dockerfile，保留 worktree 作为构建上下文..."
            }),
        )
        .ok();
        eprintln!("[JarPorter] 保留 worktree 用于 Docker 构建: {}", worktree_path.display());
    } else {
        // 没有自定义 Dockerfile，正常清理 worktree
        app.emit(
            "build-progress",
            serde_json::json!({
                "percent": 95,
                "message": "🧹 清理 worktree 源码..."
            }),
        )
        .ok();
        cleanup_worktree(&repo_root, &worktree_path);
        eprintln!("[JarPorter] Worktree 已清理: {}", worktree_path.display());
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ 打包完成！产物已输出"
        }),
    )
    .ok();

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

    let record = BuildRecord {
        id: record_id,
        timestamp,
        repo_path: repo_path.to_string_lossy().to_string(),
        branch: branch.clone(),
        project_type: format!("{:?}", project_type),
        artifact_path: final_artifact_path.clone(),
        backend_artifact_path: backend_final_path.clone(),
        image_name: None,
        image_tag: None,
        build_command: build_script.clone(),
        // 打包配置
        frontend_dir: frontend_dir.clone(),
        package_manager: package_manager.clone(),
        spring_profile: spring_profile.clone(),
        package_with_backend: package_with_backend.unwrap_or(false),
        duration_ms,
        status: "success".to_string(),
        log_summary,
        full_log: log.clone(),
    };

    if let Err(e) = save_build_record_direct(record) {
        eprintln!("[JarPorter] 保存构建记录失败: {}", e);
    } else {
        eprintln!("[JarPorter] 构建记录已保存");
    }

    Ok(PackageFromBranchResult {
        artifact_path: final_artifact_path,
        backend_artifact_path: backend_final_path,
        // 返回产物输出目录（worktree 已清理，或保留为 Docker 构建上下文）
        worktree_path: artifact_dir.to_string_lossy().to_string(),
        build_script,
        log,
        dockerfile_path,
        dockerfile_context,
    })
}

#[tauri::command]
pub async fn detect_spring_profiles(repo_path: String, branch: String) -> Result<Vec<String>, String> {
    let repo_path_str = repo_path.trim();
    let branch = branch.trim();
    if repo_path_str.is_empty() || branch.is_empty() {
        return Ok(Vec::new());
    }

    // Git URL 需要先克隆到缓存目录
    let repo_root = if crate::git::is_git_url(repo_path_str) {
        crate::git::ensure_cloned_repo(repo_path_str)?
    } else {
        let p = PathBuf::from(repo_path_str);
        if !p.is_dir() {
            return Err(format!("仓库路径不是目录: {}", p.display()));
        }
        repo_root_for(&p)?
    };

    // 用 git ls-tree 列出指定分支中所有 application-*.yml / application-*.properties 文件
    let output = silent_command("git")
        .args(["ls-tree", "-r", "--name-only", branch])
        .current_dir(&repo_root)
        .output()
        .map_err(|e| format!("执行 git ls-tree 失败: {}", e))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut profiles = Vec::new();

    for line in stdout.lines() {
        let file_name = line.rsplit('/').next().unwrap_or(line);

        // 匹配 application-{profile}.yml 或 application-{profile}.properties
        let prefix = "application-";
        if file_name.starts_with(prefix) {
            let rest = &file_name[prefix.len()..];
            // 去掉扩展名
            let profile = if let Some(pos) = rest.rfind('.') {
                &rest[..pos]
            } else {
                rest
            };
            // 过滤：不能为空、不能包含路径分隔符、不能是纯数字
            if !profile.is_empty()
                && !profile.contains('/')
                && !profile.contains('\\')
                && profile
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
                && !profiles.contains(&profile.to_string())
            {
                profiles.push(profile.to_string());
            }
        }
    }

    profiles.sort();
    Ok(profiles)
}

#[tauri::command]
pub fn cancel_build() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    // 杀掉当前运行的子进程
    if let Some(pid) = *CURRENT_PID.lock().unwrap() {
        eprintln!("[JarPorter] 🛑 取消构建，终止进程 PID={}", pid);
        let _ = silent_command("kill").arg(pid.to_string()).output();
    }
    Ok(())
}

pub(crate) fn reset_cancel_flag() {
    CANCEL_FLAG.store(false, Ordering::SeqCst);
    *CURRENT_PID.lock().unwrap() = None;
}

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
) -> Result<String, String> {
    reset_cancel_flag();
    let mut config = load_config_sync()?;
    if let Some(port) = expose_port {
        if !port.trim().is_empty() {
            config.expose_port = port.trim().to_string();
        }
    }
    let artifact_type = ArtifactType::from_option(artifact_type)?;

    if config.harbor_url.is_empty()
        || config.username.is_empty()
        || config.password.is_empty()
        || config.project.is_empty()
    {
        return Err("请先配置Harbor信息".to_string());
    }

    let artifact_path = PathBuf::from(&jar_path);
    if !artifact_path.exists() {
        return Err(format!("产物路径不存在: {}", jar_path));
    }

    // 生成标签: v.YY.MM.DD.HH.MM
    let final_tag = if image_tag.is_empty() || image_tag == "latest" {
        let now = chrono::Local::now();
        now.format("v.%y.%m.%d.%H.%M").to_string()
    } else {
        image_tag
    };

    let image_name_lower = image_name.to_lowercase();
    let repository = resolve_harbor_repository(&image_name_lower, &config.project)?;
    let full_image = format!(
        "{}/{}:{}",
        config.harbor_url, repository, final_tag
    );

    // 步骤1: 准备Docker构建上下文
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 10,
            "message": "📝 准备 Docker 构建上下文..."
        }),
    )
    .ok();

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
        eprintln!("[JarPorter] 使用自定义Dockerfile，构建上下文: {}", ctx_path);
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
            eprintln!("[JarPorter] 使用自定义Dockerfile (独立上下文): {}", df_path);
            prepare_custom_docker_context(
                &config,
                &artifact_path,
                artifact_type,
                &custom_content,
                &image_name_lower,
                &final_tag,
                &full_image,
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
            )?,
        }
    };

    // 步骤2: docker build (阻塞操作放到线程池)
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 25,
            "message": "🔨 构建 Docker 镜像..."
        }),
    )
    .ok();

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

    // 步骤3: docker login (阻塞操作放到线程池)
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 55,
            "message": "🔐 登录 Harbor 镜像仓库..."
        }),
    )
    .ok();

    let harbor_url = config.harbor_url.clone();
    let username = config.username.clone();
    let password = config.password.clone();

    let login_result = tauri::async_runtime::spawn_blocking(move || {
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
            .map_err(|e| format!("docker login失败: {}", e));
        output
    })
    .await
    .map_err(|e| format!("登录线程异常: {}", e))?;

    let login_output = login_result?;
    if !login_output.status.success() {
        let stderr = String::from_utf8_lossy(&login_output.stderr);
        return Err(format!("docker login失败:\n{}", stderr));
    }

    // 步骤4: docker push (阻塞操作放到线程池)
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 75,
            "message": "📤 推送镜像到 Harbor..."
        }),
    )
    .ok();

    let full_image_push = full_image.clone();
    let push_result = tauri::async_runtime::spawn_blocking(move || {
        docker_output(&["push", &full_image_push])
    })
    .await
    .map_err(|e| format!("推送线程异常: {}", e))?;

    let push_output = push_result.map_err(|e| format!("执行docker push失败: {}", e))?;
    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("docker push失败:\n{}", stderr));
    }

    // 步骤5: 推送成功后删除本地镜像，避免本机堆积历史 tag（失败不影响结果）
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 92,
            "message": "🧹 清理本地镜像缓存..."
        }),
    )
    .ok();

    let full_image_remove = full_image.clone();
    let remove_result = tauri::async_runtime::spawn_blocking(move || {
        docker_output(&["rmi", &full_image_remove])
    })
    .await;

    // docker rmi 失败是常见情况（多 tag 共享、被其他镜像依赖等），不影响推送结果
    match remove_result {
        Ok(Ok(output)) if output.status.success() => {
            eprintln!("[JarPorter] 本地镜像已删除: {}", full_image);
        }
        _ => {
            eprintln!(
                "[JarPorter] 本地镜像清理跳过（不影响推送结果）: {}",
                full_image
            );
        }
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ 推送完成!"
        }),
    )
    .ok();

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

    if config.harbor_url.is_empty()
        || config.username.is_empty()
        || config.password.is_empty()
        || config.project.is_empty()
    {
        return Err("请先配置Harbor信息".to_string());
    }

    let local_image = local_image.trim().to_string();
    if local_image.is_empty() {
        return Err("请输入本地镜像引用".to_string());
    }

    let image_name_lower = image_name.to_lowercase();
    if image_name_lower.is_empty() {
        return Err("请输入目标镜像名称".to_string());
    }

    let repository = resolve_harbor_repository(&image_name_lower, &config.project)?;

    let final_tag = if image_tag.is_empty() || image_tag == "latest" {
        let now = chrono::Local::now();
        now.format("v.%y.%m.%d.%H.%M").to_string()
    } else {
        image_tag
    };

    let full_image = format!(
        "{}/{}:{}",
        config.harbor_url, repository, final_tag
    );

    // 步骤1: docker tag <local_image> <full_image>
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 10,
            "message": "🏷️ 镜像打标签..."
        }),
    )
    .ok();

    let local_image_tag = local_image.clone();
    let full_image_tag = full_image.clone();
    let _tag_result = tauri::async_runtime::spawn_blocking(move || {
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

    // 步骤2: docker login
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 35,
            "message": "🔐 登录 Harbor 镜像仓库..."
        }),
    )
    .ok();

    let harbor_url = config.harbor_url.clone();
    let username = config.username.clone();
    let password = config.password.clone();

    let login_result = tauri::async_runtime::spawn_blocking(move || {
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
            .map_err(|e| format!("docker login失败: {}", e));
        output
    })
    .await
    .map_err(|e| format!("登录线程异常: {}", e))?;

    let login_output = login_result?;
    if !login_output.status.success() {
        let stderr = String::from_utf8_lossy(&login_output.stderr);
        return Err(format!("docker login失败:\n{}", stderr));
    }

    // 步骤3: docker push
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 60,
            "message": "📤 推送镜像到 Harbor..."
        }),
    )
    .ok();

    let full_image_push = full_image.clone();
    let push_result = tauri::async_runtime::spawn_blocking(move || {
        docker_output(&["push", &full_image_push])
    })
    .await
    .map_err(|e| format!("推送线程异常: {}", e))?;

    let push_output = push_result.map_err(|e| format!("执行docker push失败: {}", e))?;
    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err(format!("docker push失败:\n{}", stderr));
    }

    // 步骤4: 清理 Harbor 标签副本，不删除原始本地镜像
    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 90,
            "message": "🧹 清理本地标签..."
        }),
    )
    .ok();

    let full_image_remove = full_image.clone();
    let remove_result = tauri::async_runtime::spawn_blocking(move || {
        docker_output(&["rmi", &full_image_remove])
    })
    .await;

    match remove_result {
        Ok(Ok(output)) if output.status.success() => {
            eprintln!("[JarPorter] 本地标签已删除: {}", full_image);
        }
        _ => {
            eprintln!(
                "[JarPorter] 本地标签清理跳过（不影响推送结果）: {}",
                full_image
            );
        }
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ 推送完成!"
        }),
    )
    .ok();

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
