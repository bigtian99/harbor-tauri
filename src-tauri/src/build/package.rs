use crate::build::{emit_progress, reset_cancel_flag};
use crate::config_cmd::load_config_sync;
use crate::git::{cleanup_worktree, find_maven_artifact, find_npm_artifact};
use crate::history::save_build_record_direct;
use crate::models::{BuildRecord, PackageFromBranchResult, PackageProjectType};
use crate::utils::{
    cleanup_old_temp_dirs, command_output_text, copy_artifact_to_output_internal,
    detect_npm_build_script, git_output, lock_file_hash, repo_root_for, run_command,
    save_node_modules_to_cache, silent_command, try_restore_node_modules,
};
use std::fs;
use std::path::PathBuf;

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

    crate::diag::diag_log("build", &format!("Worktree 路径: {} (输出目录: {})",
        worktree_path.display(),
        output_base.display()));

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

    emit_progress(&app, 6, "⬇️ 校验仓库并更新分支代码...", "fetch");

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

    emit_progress(&app, 20, "🌿 已更新分支代码，创建隔离 worktree...", "worktree");

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

    emit_progress(&app, 35, "🧪 校验项目类型...", "build");

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
    emit_progress(&app, 50, package_message, "build");

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
                            emit_progress(&app_for_build, 55, "📦 前端安装依赖... | ☕ 后端并行打包中", "build");
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
                                emit_progress(&app_for_build, 52, &msg, "build");
                                logs.push(msg);
                                true
                            }
                            Ok(false) => {
                                let msg = format!("❓ 缓存未命中 (hash={})，执行 {} install...", &key[..12], pm);
                                emit_progress(&app_for_build, 52, &msg, "build");
                                logs.push(format!("cache miss (hash={})", key));
                                false
                            }
                            Err(e) => {
                                let msg = format!("⚠️ 缓存恢复失败: {}，重新 install", e);
                                emit_progress(&app_for_build, 52, &msg, "build");
                                logs.push(msg);
                                false
                            }
                        }
                    } else {
                        let msg = "📦 未找到 lock 文件，执行 install...".to_string();
                        emit_progress(&app_for_build, 52, &msg, "build");
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
                        emit_progress(&app_for_build, 55, install_msg, "build");
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
                            emit_progress(&app_for_build, 60, format!("💾 保存 node_modules 到缓存 (hash={})...", &key[..12]), "build");
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
                    emit_progress(&app_for_build, 65, build_msg, "build");
                    logs.push(run_command(
                        &worktree_for_build,
                        &pm,
                        &["run", &script_name],
                    )?);
                    let artifact_path = find_npm_artifact(&worktree_for_build)?;

                    // 等待后端构建完成（如果有）
                    let backend_artifact: Option<String> = if let Some(handle) = backend_handle {
                        emit_progress(&app_for_build, 68, "✅ 前端构建完成，⏳ 等待后端 Maven 打包...", "build");
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

    emit_progress(&app, 85, "📋 复制产物到输出目录...", "build");

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
            crate::diag::diag_log("build", &format!("✅ 产物已输出到: {}", copied_path));
            copied_path
        }
        Err(e) => {
            crate::diag::diag_log("build", &format!("❌ 产物复制失败: {}", e));
            artifact_path.to_string_lossy().to_string()
        }
    };

    // 复制后端产物到输出目录
    let backend_final_path: Option<String> = if let Some(ref backend_src) = backend_artifact_path {
        let backend_src_path = PathBuf::from(backend_src);
        match copy_artifact_to_output_internal(&backend_src_path, &artifact_dir) {
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
                    crate::diag::diag_log("build", &format!("📄 检测到自定义 Dockerfile: {}", df_in_worktree.display()));
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
            crate::diag::diag_log("build", &format!("未检测到自定义 Dockerfile（已检查: {:?}）", search_dirs));
        }
        (found_df_path, found_df_context)
    };

    if dockerfile_context.is_some() {
        // 有自定义 Dockerfile，保留 worktree 作为构建上下文
        emit_progress(&app, 95, "📄 检测到自定义 Dockerfile，保留 worktree 作为构建上下文...", "cleanup");
        crate::diag::diag_log("build", &format!("保留 worktree 用于 Docker 构建: {}", worktree_path.display()));
    } else {
        // 没有自定义 Dockerfile，正常清理 worktree
        emit_progress(&app, 95, "🧹 清理 worktree 源码...", "cleanup");
        cleanup_worktree(&repo_root, &worktree_path);
        crate::diag::diag_log("build", &format!("Worktree 已清理: {}", worktree_path.display()));
    }

    emit_progress(&app, 100, "✅ 打包完成！产物已输出", "done");

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
    let (author, email) = repo_root_for(&repo_path)
        .ok()
        .and_then(|root| {
            git_output(&root, &["log", "-1", "--format=%an%n%ae", &branch]).ok()
        })
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
        author,
        email,
    };

    if let Err(e) = save_build_record_direct(record) {
        crate::diag::diag_log("build", &format!("保存构建记录失败: {}", e));
    } else {
        crate::diag::diag_log("build", "构建记录已保存");
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

