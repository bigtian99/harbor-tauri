//! test 打包后：FTP 覆盖宝塔 Java 项目 JAR 并 restart_project。

use crate::landing::run_ftp_upload_dir_auth_with_progress;
use crate::landing::run_ftp_upload_file_with_progress;
use crate::landing::run_ftp_upload_file_with_progress_cancel;
use crate::models::{HarborConfig, PackageProjectType};
use md5::{Digest, Md5};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

/// Java 项目页上传/部署取消标志（与构建 CANCEL_FLAG 独立）
static BT_JAVA_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BtJavaProject {
    pub id: String,
    pub name: String,
    pub project_jar: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MatchResult {
    One(BtJavaProject),
    None,
    Ambiguous(usize),
}

/// 官方签名：`request_token = md5(request_time + md5(api_sk))`
pub(crate) fn bt_request_token(api_sk: &str, request_time: &str) -> String {
    let inner = hex_md5(api_sk.as_bytes());
    let mut combined = String::with_capacity(request_time.len() + inner.len());
    combined.push_str(request_time);
    combined.push_str(&inner);
    hex_md5(combined.as_bytes())
}

fn hex_md5(bytes: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn normalize_name(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace('_', "-")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect()
}

/// 按 JAR basename 匹配；多条时用仓库名与远程父目录消歧。
/// `id_overrides`：JAR 文件名 → 项目 id，优先于自动匹配。
pub(crate) fn match_java_project_with_overrides(
    projects: &[BtJavaProject],
    local_jar_name: &str,
    repo_name: &str,
    id_overrides: &std::collections::HashMap<String, String>,
) -> MatchResult {
    let local = local_jar_name.trim();
    if local.is_empty() {
        return MatchResult::None;
    }

    if let Some(forced_id) = lookup_jar_project_id(id_overrides, local) {
        if let Some(p) = projects.iter().find(|p| p.id.trim() == forced_id) {
            return MatchResult::One(p.clone());
        }
        crate::diag::diag_log(
            "build",
            &format!(
                "bt jar override id={} for {} 未在 project_list 中找到，回退自动匹配",
                forced_id, local
            ),
        );
    }

    let hits: Vec<&BtJavaProject> = projects
        .iter()
        .filter(|p| {
            Path::new(&p.project_jar)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n == local)
                .unwrap_or(false)
        })
        .collect();

    match hits.len() {
        0 => MatchResult::None,
        1 => MatchResult::One(hits[0].clone()),
        n => {
            let repo_n = normalize_name(repo_name);
            if repo_n.is_empty() {
                return MatchResult::Ambiguous(n);
            }
            let narrowed: Vec<&BtJavaProject> = hits
                .iter()
                .copied()
                .filter(|p| {
                    let parent = Path::new(&p.project_jar)
                        .parent()
                        .and_then(|d| d.file_name())
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    let parent_n = normalize_name(parent);
                    parent_n == repo_n
                        || parent_n.contains(&repo_n)
                        || repo_n.contains(&parent_n)
                        || normalize_name(&p.name) == repo_n
                        || normalize_name(&p.name).contains(&repo_n)
                })
                .collect();
            match narrowed.len() {
                1 => MatchResult::One(narrowed[0].clone()),
                0 => MatchResult::Ambiguous(n),
                m => MatchResult::Ambiguous(m),
            }
        }
    }
}

fn lookup_jar_project_id<'a>(
    overrides: &'a std::collections::HashMap<String, String>,
    jar_name: &str,
) -> Option<&'a str> {
    if let Some(id) = overrides.get(jar_name) {
        let id = id.trim();
        if !id.is_empty() {
            return Some(id);
        }
    }
    overrides.iter().find_map(|(k, v)| {
        if k.eq_ignore_ascii_case(jar_name) {
            let id = v.trim();
            if id.is_empty() {
                None
            } else {
                Some(id)
            }
        } else {
            None
        }
    })
}

fn is_test_profile(profile: &Option<String>) -> bool {
    profile
        .as_ref()
        .map(|s| s.trim().eq_ignore_ascii_case("test"))
        .unwrap_or(false)
}

/// npm 脚本含 test 且不含 prod 时视为测试前端构建（如 build:test）
fn is_test_npm_script(build_script: &str) -> bool {
    let s = build_script.trim().to_lowercase();
    if s.is_empty() {
        return false;
    }
    s.contains("test") && !s.contains("prod")
}

fn is_jar_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jar"))
        .unwrap_or(false)
}

fn is_dist_dir(path: &str) -> bool {
    let p = Path::new(path);
    p.is_dir()
}

fn panel_client(config: &HarborConfig) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .danger_accept_invalid_certs(config.bt_panel_insecure)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

fn panel_post(
    client: &reqwest::blocking::Client,
    config: &HarborConfig,
    path: &str,
    action: Option<&str>,
    extra: &[(&str, String)],
) -> Result<Value, String> {
    let base = config.bt_panel_url.trim().trim_end_matches('/');
    let mut url = format!("{}/{}", base, path.trim_start_matches('/'));
    if let Some(a) = action {
        if !a.is_empty() {
            url.push_str(&format!("?action={}", a));
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let request_time = now.to_string();
    let request_token = bt_request_token(&config.bt_panel_secret, &request_time);

    let mut form: Vec<(&str, String)> = vec![
        ("request_time", request_time),
        ("request_token", request_token),
    ];
    form.extend_from_slice(extra);

    crate::diag::diag_log(
        "build",
        &format!("bt_panel POST {} action={:?} extras={}", path, action, extra.len()),
    );

    let resp = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .map_err(|e| format!("面板请求失败 {}: {}", path, e))?;

    let status = resp.status();
    let text = resp
        .text()
        .map_err(|e| format!("读取面板响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!(
            "面板 HTTP {} {}: {}",
            status.as_u16(),
            path,
            text.chars().take(300).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| {
        format!(
            "面板响应非 JSON {}: {} | body={}",
            e,
            path,
            text.chars().take(200).collect::<String>()
        )
    })
}

fn parse_project_list(json: &Value) -> Vec<BtJavaProject> {
    let rows = json
        .get("data")
        .and_then(|d| {
            if d.is_array() {
                Some(d)
            } else {
                d.get("data")
            }
        })
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::new();
    for row in rows {
        let id = row
            .get("id")
            .map(|v| match v {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            })
            .unwrap_or_default();
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let jar = row
            .pointer("/project_config/project_jar")
            .or_else(|| row.get("project_jar"))
            .or_else(|| row.get("path"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if jar.trim().is_empty() || !jar.to_lowercase().ends_with(".jar") {
            continue;
        }
        out.push(BtJavaProject {
            id,
            name,
            project_jar: jar,
        });
    }
    out
}

fn list_java_projects(client: &reqwest::blocking::Client, config: &HarborConfig) -> Result<Vec<BtJavaProject>, String> {
    let json = panel_post(
        client,
        config,
        "/mod/java/project/project_list/stype",
        None,
        &[
            ("p", "1".to_string()),
            ("limit", "100".to_string()),
            ("tojs", "jarporter".to_string()),
        ],
    )?;
    Ok(parse_project_list(&json))
}

fn restart_project(
    client: &reqwest::blocking::Client,
    config: &HarborConfig,
    project: &BtJavaProject,
) -> Result<(), String> {
    // 先按官方 project_name，失败再试 id
    let by_name = panel_post(
        client,
        config,
        "/mod/java/project/restart_project/stype",
        None,
        &[("project_name", project.name.clone())],
    );
    match by_name {
        Ok(json) if json.get("status").and_then(|s| s.as_bool()) == Some(true) => Ok(()),
        Ok(json) => {
            let msg = json
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("重启失败");
            crate::diag::diag_log(
                "build",
                &format!(
                    "bt restart by project_name failed name={} msg={}；改试 id={}",
                    project.name, msg, project.id
                ),
            );
            if project.id.trim().is_empty() {
                return Err(msg.to_string());
            }
            let by_id = panel_post(
                client,
                config,
                "/mod/java/project/restart_project/stype",
                None,
                &[("id", project.id.clone())],
            )?;
            if by_id.get("status").and_then(|s| s.as_bool()) == Some(true) {
                Ok(())
            } else {
                Err(by_id
                    .get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("重启失败")
                    .to_string())
            }
        }
        Err(e) => {
            crate::diag::diag_log(
                "build",
                &format!(
                    "bt restart by project_name error name={} err={}；改试 id={}",
                    project.name, e, project.id
                ),
            );
            if project.id.trim().is_empty() {
                return Err(e);
            }
            let by_id = panel_post(
                client,
                config,
                "/mod/java/project/restart_project/stype",
                None,
                &[("id", project.id.clone())],
            )?;
            if by_id.get("status").and_then(|s| s.as_bool()) == Some(true) {
                Ok(())
            } else {
                Err(by_id
                    .get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("重启失败")
                    .to_string())
            }
        }
    }
}

fn deploy_one_jar(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    config: &HarborConfig,
    projects: &[BtJavaProject],
    local_jar: &str,
    repo_name: &str,
) -> String {
    let path = PathBuf::from(local_jar);
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n.to_string(),
        None => return format!("❌ 无效 JAR 路径: {}", local_jar),
    };

    match match_java_project_with_overrides(
        projects,
        &file_name,
        repo_name,
        &config.bt_jar_project_ids,
    ) {
        MatchResult::None => {
            let msg = format!("⚠️ 未匹配到宝塔 Java 项目: {}", file_name);
            crate::diag::diag_log("build", &msg);
            msg
        }
        MatchResult::Ambiguous(n) => {
            let msg = format!(
                "⚠️ JAR {} 匹配到 {} 个宝塔项目，已跳过（请消歧）",
                file_name, n
            );
            crate::diag::diag_log("build", &msg);
            msg
        }
        MatchResult::One(project) => {
            crate::build::emit_progress(
                app,
                93,
                format!("📤 连接 FTP 上传 {} → {}", file_name, project.project_jar),
                "build",
            );
            crate::diag::diag_log(
                "build",
                &format!(
                    "bt deploy match name={} id={} jar={}",
                    project.name, project.id, project.project_jar
                ),
            );

            let file_name_for_cb = file_name.clone();
            let app_for_cb = app.clone();
            let mut last_pct_bucket: u32 = 0;
            let on_progress = |sent: u64, total: u64| {
                if total == 0 {
                    return;
                }
                let pct = ((sent as f64 / total as f64) * 100.0).floor() as u32;
                // 进度条映射到 93–96；文案每 5% 更新一次，避免刷屏
                let bucket = pct / 5;
                if bucket == last_pct_bucket && sent < total {
                    return;
                }
                last_pct_bucket = bucket;
                let bar = 93 + ((pct as f64 / 100.0) * 3.0).floor() as u32;
                let bar = bar.min(96);
                let msg = format!(
                    "📤 FTP 上传 {} {}% ({:.1}/{:.1} MB)",
                    file_name_for_cb,
                    pct.min(100),
                    sent as f64 / (1024.0 * 1024.0),
                    total as f64 / (1024.0 * 1024.0),
                );
                crate::build::emit_progress(&app_for_cb, bar, msg, "build");
            };

            if let Err(e) = run_ftp_upload_file_with_progress(
                &path,
                &project.project_jar,
                &config.bt_ftp_host,
                &config.bt_ftp_user,
                &config.bt_ftp_pass,
                "build",
                Some(on_progress),
            ) {
                let msg = format!("❌ FTP 上传失败 {}: {}", file_name, e);
                crate::diag::diag_log("build", &msg);
                return msg;
            }

            crate::build::emit_progress(
                app,
                96,
                format!("✅ FTP 上传完成 {}", file_name),
                "build",
            );
            crate::build::emit_progress(
                app,
                97,
                format!("🔄 重启宝塔项目 {}", project.name),
                "build",
            );
            match restart_project(client, config, &project) {
                Ok(()) => {
                    let msg = format!(
                        "✅ 已部署并重启: {} → {}",
                        file_name, project.project_jar
                    );
                    crate::diag::diag_log("build", &msg);
                    crate::build::emit_progress(app, 98, msg.clone(), "build");
                    msg
                }
                Err(e) => {
                    let msg = format!(
                        "⚠️ JAR 已上传但重启失败 {}: {}",
                        project.name, e
                    );
                    crate::diag::diag_log("build", &msg);
                    crate::build::emit_progress(app, 98, msg.clone(), "build");
                    msg
                }
            }
        }
    }
}

/// 打包成功后可选部署；任何错误只汇总文案，不向上抛。
/// - Maven / 后端 JAR：Profile=test → FTP 覆盖 + 重启
/// - npm dist：构建脚本为 test（如 build:test）→ FTP 上传 dist 内容到配置目录
/// - 前后端同时打包时：前端 dist 与 JAR 部署并行执行
pub(crate) fn maybe_deploy_test_jars(
    app: &AppHandle,
    config: &HarborConfig,
    spring_profile: &Option<String>,
    repo_name: &str,
    artifact_path: &str,
    backend_artifact_path: &Option<String>,
    project_type: PackageProjectType,
    build_script: &str,
) -> Option<String> {
    if !config.bt_auto_deploy_test {
        crate::diag::diag_log("build", "bt_auto_deploy_test=false，跳过宝塔部署");
        return None;
    }

    let deploy_frontend = matches!(project_type, PackageProjectType::Npm)
        && is_test_npm_script(build_script)
        && is_dist_dir(artifact_path);

    let mut jars: Vec<String> = Vec::new();
    if is_test_profile(spring_profile) {
        if is_jar_path(artifact_path) {
            jars.push(artifact_path.to_string());
        }
        if let Some(backend) = backend_artifact_path {
            if is_jar_path(backend) && !jars.iter().any(|j| j == backend) {
                jars.push(backend.clone());
            }
        }
    }

    let deploy_jars = !jars.is_empty();
    if is_test_profile(spring_profile) && !deploy_jars && !deploy_frontend {
        crate::diag::diag_log("build", "profile=test 但无 JAR/前端产物，跳过宝塔部署");
        return None;
    }
    if !deploy_frontend && !deploy_jars {
        return None;
    }

    // JAR 部署需要面板密钥；缺密钥时仍可只做前端 FTP
    let jar_secret_missing = deploy_jars && config.bt_panel_secret.trim().is_empty();
    let run_jars = deploy_jars && !jar_secret_missing;

    if jar_secret_missing {
        let msg = "ℹ️ 未配置宝塔 API 密钥，跳过 JAR 自动部署".to_string();
        crate::diag::diag_log("build", &msg);
        crate::build::emit_progress(app, 90, msg.clone(), "build");
        if !deploy_frontend {
            return Some(msg);
        }
    }

    if deploy_frontend && run_jars {
        crate::build::emit_progress(
            app,
            90,
            "⚡ 并行上传：前端 dist + 后端 JAR…",
            "build",
        );
        crate::diag::diag_log(
            "build",
            &format!(
                "bt deploy parallel frontend={} jars={}",
                artifact_path,
                jars.len()
            ),
        );

        let app_fe = app.clone();
        let cfg_fe = config.clone();
        let dist = artifact_path.to_string();
        let app_jar = app.clone();
        let cfg_jar = config.clone();
        let repo = repo_name.to_string();
        let jars_owned = jars.clone();

        let (fe_msg, jar_msg) = std::thread::scope(|s| {
            let fe = s.spawn(move || deploy_frontend_dist(&app_fe, &cfg_fe, &dist));
            let jar = s.spawn(move || deploy_jars_with_panel(&app_jar, &cfg_jar, &repo, &jars_owned));
            let fe_msg = fe.join().unwrap_or_else(|_| "❌ 前端部署线程异常".to_string());
            let jar_msg = match jar.join() {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => e,
                Err(_) => "❌ JAR 部署线程异常".to_string(),
            };
            (fe_msg, jar_msg)
        });

        return Some(format!("{}\n{}", fe_msg, jar_msg));
    }

    let mut lines: Vec<String> = Vec::new();
    if deploy_frontend {
        lines.push(deploy_frontend_dist(app, config, artifact_path));
    }
    if jar_secret_missing {
        lines.push("ℹ️ 未配置宝塔 API 密钥，跳过 JAR 自动部署".to_string());
    } else if run_jars {
        match deploy_jars_with_panel(app, config, repo_name, &jars) {
            Ok(summary) => lines.push(summary),
            Err(e) => lines.push(e),
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn deploy_frontend_dist(app: &AppHandle, config: &HarborConfig, dist_path: &str) -> String {
    let remote = if config.bt_frontend_remote_dir.trim().is_empty() {
        "/www/wwwroot/pcm.shengyeshudong.cn".to_string()
    } else {
        config.bt_frontend_remote_dir.trim().to_string()
    };
    crate::build::emit_progress(
        app,
        90,
        format!("📤 FTP 上传前端 dist → {}", remote),
        "build",
    );
    crate::diag::diag_log(
        "build",
        &format!("bt frontend deploy dist={} remote={}", dist_path, remote),
    );

    let app_for_cb = app.clone();
    let mut last_pct_bucket: u32 = 0;
    let on_progress = |sent: u64, total: u64| {
        if total == 0 {
            return;
        }
        let pct = ((sent as f64 / total as f64) * 100.0).floor() as u32;
        let bucket = pct / 5;
        if bucket == last_pct_bucket && sent < total {
            return;
        }
        last_pct_bucket = bucket;
        let bar = 90 + ((pct as f64 / 100.0) * 6.0).floor() as u32;
        let bar = bar.min(96);
        let msg = format!(
            "📤 FTP 上传前端 dist {}% ({:.1}/{:.1} MB)",
            pct.min(100),
            sent as f64 / (1024.0 * 1024.0),
            total as f64 / (1024.0 * 1024.0),
        );
        crate::build::emit_progress(&app_for_cb, bar, msg, "build");
    };

    match run_ftp_upload_dir_auth_with_progress(
        Path::new(dist_path),
        &remote,
        &config.bt_ftp_host,
        &config.bt_ftp_user,
        &config.bt_ftp_pass,
        "build",
        Some(on_progress),
    ) {
        Ok(()) => {
            let msg = format!("✅ 前端 dist 已上传到 {}", remote);
            crate::diag::diag_log("build", &msg);
            crate::build::emit_progress(app, 96, msg.clone(), "build");
            msg
        }
        Err(e) => {
            let msg = format!("❌ 前端 dist FTP 上传失败: {}", e);
            crate::diag::diag_log("build", &msg);
            crate::build::emit_progress(app, 96, msg.clone(), "build");
            msg
        }
    }
}

fn deploy_jars_with_panel(
    app: &AppHandle,
    config: &HarborConfig,
    repo_name: &str,
    jars: &[String],
) -> Result<String, String> {
    crate::build::emit_progress(
        app,
        90,
        format!("🔗 连接宝塔面板拉取 Java 项目列表… ({})", config.bt_panel_url),
        "build",
    );
    crate::diag::diag_log(
        "build",
        &format!(
            "bt deploy start repo={} jars={} panel={}",
            repo_name,
            jars.len(),
            config.bt_panel_url
        ),
    );

    let client = panel_client(config).map_err(|e| {
        let msg = format!("❌ {}", e);
        crate::diag::diag_log("build", &msg);
        crate::build::emit_progress(app, 96, msg.clone(), "build");
        msg
    })?;

    crate::build::emit_progress(app, 91, "📋 正在请求 project_list…", "build");
    let projects = match list_java_projects(&client, config) {
        Ok(p) => {
            crate::diag::diag_log("build", &format!("bt project_list count={}", p.len()));
            crate::build::emit_progress(
                app,
                92,
                format!("📋 已获取 {} 个 Java 项目，开始匹配上传…", p.len()),
                "build",
            );
            p
        }
        Err(e) => {
            let msg = format!("❌ 拉取宝塔 Java 项目列表失败: {}", e);
            crate::diag::diag_log("build", &msg);
            crate::build::emit_progress(app, 96, msg.clone(), "build");
            return Err(msg);
        }
    };

    let lines: Vec<String> = jars
        .iter()
        .map(|jar| deploy_one_jar(app, &client, config, &projects, jar, repo_name))
        .collect();
    Ok(lines.join("\n"))
}

// ========== 面板项目列表 UI（与宝塔保持一致）==========

#[derive(Debug, Clone, Serialize)]
pub struct BtJavaProjectInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub status_text: String,
    pub port: String,
    pub project_jar: String,
    pub path: String,
    /// 面板返回的添加/更新时间（优先 update_*，否则 addtime）
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BtPhpSiteInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    pub status_text: String,
    pub php_version: String,
    pub ps: String,
    pub updated_at: String,
}

fn json_id(v: &Value) -> String {
    match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

fn status_text(status: &str) -> String {
    match status.trim() {
        "1" => "运行中".to_string(),
        "0" => "已停止".to_string(),
        other if other.is_empty() => "-".to_string(),
        other => other.to_string(),
    }
}

/// 从行数据取「最后时间」：优先更新类字段，再回退 addtime。
fn parse_updated_at(row: &Value) -> String {
    const KEYS: &[&str] = &[
        "update_time",
        "uptime",
        "modify_time",
        "mtime",
        "addtime",
        "add_time",
    ];
    for key in KEYS {
        let Some(v) = row.get(*key) else { continue };
        let raw = match v {
            Value::Number(n) => {
                let Some(secs) = n.as_i64() else { continue };
                if secs <= 0 {
                    continue;
                }
                // 毫秒时间戳
                let secs = if secs > 10_000_000_000 {
                    secs / 1000
                } else {
                    secs
                };
                format_unix_secs(secs)
            }
            Value::String(s) => s.trim().to_string(),
            _ => continue,
        };
        if raw.is_empty() || raw == "0000-00-00" || raw.starts_with("0000-00-00") {
            continue;
        }
        return raw;
    }
    String::new()
}

fn format_unix_secs(secs: i64) -> String {
    use chrono::{Local, TimeZone};
    match Local.timestamp_opt(secs, 0).single() {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => secs.to_string(),
    }
}

fn parse_java_project_infos(json: &Value) -> Vec<BtJavaProjectInfo> {
    let rows = json
        .get("data")
        .and_then(|d| {
            if d.is_array() {
                Some(d)
            } else {
                d.get("data")
            }
        })
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::new();
    for row in rows {
        let id = row.get("id").map(json_id).unwrap_or_default();
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.trim().is_empty() {
            continue;
        }
        let status = row
            .get("status")
            .map(|v| match v {
                Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            })
            .unwrap_or_default();
        let port = row
            .get("port")
            .or_else(|| row.pointer("/project_config/port"))
            .map(|v| match v {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            })
            .unwrap_or_default();
        // 未运行时不展示端口，便于「重启后等到端口出现」
        let port = if status.trim() == "1" {
            port
        } else {
            String::new()
        };
        let project_jar = row
            .pointer("/project_config/project_jar")
            .or_else(|| row.get("project_jar"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let path = row
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated_at = parse_updated_at(&row);
        out.push(BtJavaProjectInfo {
            id,
            name,
            status: status.clone(),
            status_text: status_text(&status),
            port,
            project_jar,
            path,
            updated_at,
        });
    }
    out
}

fn parse_php_site_infos(json: &Value) -> Vec<BtPhpSiteInfo> {
    let rows = json
        .get("data")
        .and_then(|d| {
            if d.is_array() {
                Some(d)
            } else {
                d.get("data")
            }
        })
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::new();
    for row in rows {
        let php_version = row
            .get("php_version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        // 与 bt-gateway 一致：排除无 PHP 版本或「静态」
        if php_version.is_empty() || php_version == "静态" {
            continue;
        }
        let id = row.get("id").map(json_id).unwrap_or_default();
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.trim().is_empty() {
            continue;
        }
        let status = row
            .get("status")
            .map(|v| match v {
                Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => String::new(),
            })
            .unwrap_or_default();
        let path = row
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ps = row
            .get("ps")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated_at = parse_updated_at(&row);
        out.push(BtPhpSiteInfo {
            id,
            name,
            path,
            status: status.clone(),
            status_text: status_text(&status),
            php_version,
            ps,
            updated_at,
        });
    }
    out
}

fn require_bt_config(config: &HarborConfig) -> Result<(), String> {
    if config.bt_panel_url.trim().is_empty() {
        return Err("请先在设置 → 宝塔部署中填写面板地址".to_string());
    }
    if config.bt_panel_secret.trim().is_empty() {
        return Err("请先在设置 → 宝塔部署中填写面板 API 密钥".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_bt_java_projects() -> Result<Vec<BtJavaProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<BtJavaProjectInfo>, String> {
        let config = crate::config_cmd::load_config_sync().unwrap_or_default();
        require_bt_config(&config)?;
        crate::diag::diag_log("build", "list_bt_java_projects");
        let client = panel_client(&config)?;
        let json = panel_post(
            &client,
            &config,
            "/mod/java/project/project_list/stype",
            None,
            &[
                ("p", "1".to_string()),
                ("limit", "100".to_string()),
                ("tojs", "jarporter".to_string()),
            ],
        )?;
        let list = parse_java_project_infos(&json);
        crate::diag::diag_log("build", &format!("list_bt_java_projects ok count={}", list.len()));
        // 列表成功后后台预连 FTP，拖入 JAR 时可直接复用
        let host = config.bt_ftp_host.clone();
        let user = config.bt_ftp_user.clone();
        let pass = config.bt_ftp_pass.clone();
        std::thread::spawn(move || {
            let _ = crate::landing::warmup_bt_ftp_session(&host, &user, &pass, "build");
        });
        Ok(list)
    })
    .await
    .map_err(|e| format!("拉取 Java 项目线程异常: {}", e))?
}

/// 主动预连接宝塔 FTP（进入 Java 页时可先调，拖入时更快开传）。
#[tauri::command]
pub async fn warmup_bt_ftp() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        let config = crate::config_cmd::load_config_sync().unwrap_or_default();
        if config.bt_ftp_host.trim().is_empty() || config.bt_ftp_user.trim().is_empty() {
            return Err("请先在设置中配置宝塔 FTP".to_string());
        }
        crate::landing::warmup_bt_ftp_session(
            &config.bt_ftp_host,
            &config.bt_ftp_user,
            &config.bt_ftp_pass,
            "build",
        )?;
        Ok("FTP 已预连接".to_string())
    })
    .await
    .map_err(|e| format!("FTP 预连接线程异常: {}", e))?
}

#[tauri::command]
pub async fn list_bt_php_sites() -> Result<Vec<BtPhpSiteInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<BtPhpSiteInfo>, String> {
        let config = crate::config_cmd::load_config_sync().unwrap_or_default();
        require_bt_config(&config)?;
        crate::diag::diag_log("build", "list_bt_php_sites");
        let client = panel_client(&config)?;
        let json = panel_post(
            &client,
            &config,
            "/data",
            Some("getData"),
            &[
                ("table", "sites".to_string()),
                ("limit", "200".to_string()),
                ("tojs", "jarporter".to_string()),
            ],
        )?;
        let list = parse_php_site_infos(&json);
        crate::diag::diag_log("build", &format!("list_bt_php_sites ok count={}", list.len()));
        Ok(list)
    })
    .await
    .map_err(|e| format!("拉取 PHP 站点线程异常: {}", e))?
}

#[tauri::command]
pub async fn restart_bt_java_project(
    project_name: String,
    project_id: String,
) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let config = crate::config_cmd::load_config_sync().unwrap_or_default();
        require_bt_config(&config)?;
        crate::diag::diag_log(
            "build",
            &format!(
                "restart_bt_java_project name={} id={}",
                project_name, project_id
            ),
        );
        let client = panel_client(&config)?;
        let project = BtJavaProject {
            id: project_id,
            name: project_name.clone(),
            project_jar: String::new(),
        };
        restart_project(&client, &config, &project)?;
        crate::diag::diag_log(
            "build",
            &format!("restart_bt_java_project ok name={}", project_name),
        );
        Ok(format!("已重启：{}", project_name))
    })
    .await
    .map_err(|e| format!("重启线程异常: {}", e))?;
    result
}

#[tauri::command]
pub async fn cancel_bt_java_deploy() -> Result<(), String> {
    BT_JAVA_CANCEL.store(true, Ordering::SeqCst);
    crate::diag::diag_log("build", "cancel_bt_java_deploy");
    Ok(())
}

/// 拖拽 JAR：仅 FTP 覆盖远程 project_jar（不重启、不拉列表）。
#[tauri::command]
pub async fn upload_bt_java_jar(
    app: AppHandle,
    local_jar: String,
    project_name: String,
    project_id: String,
    remote_jar: String,
    project_path: String,
) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        BT_JAVA_CANCEL.store(false, Ordering::SeqCst);
        let config = crate::config_cmd::load_config_sync().unwrap_or_default();
        require_bt_config(&config)?;

        let local = PathBuf::from(local_jar.trim());
        if !local.is_file() {
            return Err(format!("本地文件不存在: {}", local.display()));
        }
        let local_name = local
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if !local_name.to_lowercase().ends_with(".jar") {
            return Err("请拖入 .jar 文件".to_string());
        }

        let mut remote = remote_jar.trim().to_string();
        if remote.is_empty() {
            let base = project_path.trim().trim_end_matches('/');
            if base.is_empty() {
                return Err("该项目缺少 JAR 路径与目录，无法上传".to_string());
            }
            remote = format!("{}/{}", base, local_name);
        }

        crate::diag::diag_log(
            "build",
            &format!(
                "upload_bt_java_jar name={} id={} local={} remote={}",
                project_name,
                project_id,
                local.display(),
                remote
            ),
        );

        emit_bt_java_progress(
            &app,
            &project_id,
            &project_name,
            0.0,
            &format!("开始上传 {} → {}", local_name, remote),
            "upload",
        );

        let app_cb = app.clone();
        let pid = project_id.clone();
        let pname = project_name.clone();
        let fname = local_name.clone();
        // 整个上传任务内已传字节只增不减，避免重试/乱序把 UI 打回去
        let mut last_sent: u64 = 0;
        let mut on_progress = move |sent: u64, total: u64| {
            if total == 0 {
                return;
            }
            if sent < last_sent {
                return;
            }
            last_sent = sent;
            let ratio = (sent as f64 / total as f64).clamp(0.0, 1.0);
            let pct = (ratio * 100.0 * 10.0).floor() / 10.0;
            let msg = format!(
                "FTP 上传 {} ({:.1}/{:.1} MB)",
                fname,
                sent as f64 / (1024.0 * 1024.0),
                total as f64 / (1024.0 * 1024.0),
            );
            emit_bt_java_progress(&app_cb, &pid, &pname, pct, &msg, "upload");
        };

        let app_st = app.clone();
        let pid_st = project_id.clone();
        let pname_st = project_name.clone();
        let mut on_status = move |msg: &str| {
            emit_bt_java_progress(&app_st, &pid_st, &pname_st, 0.0, msg, "upload");
        };
        let mut on_status_opt: Option<&mut dyn FnMut(&str)> = Some(&mut on_status);

        if let Err(e) = run_ftp_upload_file_with_progress_cancel(
            &local,
            &remote,
            &config.bt_ftp_host,
            &config.bt_ftp_user,
            &config.bt_ftp_pass,
            "build",
            Some(&mut on_progress),
            &mut on_status_opt,
            Some(&BT_JAVA_CANCEL),
        ) {
            let stage = if e == "已取消" { "cancelled" } else { "error" };
            emit_bt_java_progress(
                &app,
                &project_id,
                &project_name,
                0.0,
                &if e == "已取消" {
                    "已取消上传".to_string()
                } else {
                    format!("上传失败: {}", e)
                },
                stage,
            );
            return Err(e);
        }

        if BT_JAVA_CANCEL.load(Ordering::SeqCst) {
            emit_bt_java_progress(
                &app,
                &project_id,
                &project_name,
                0.0,
                "已取消上传",
                "cancelled",
            );
            return Err("已取消".to_string());
        }

        emit_bt_java_progress(
            &app,
            &project_id,
            &project_name,
            100.0,
            "上传完成",
            "upload_done",
        );
        crate::diag::diag_log(
            "build",
            &format!(
                "upload_bt_java_jar ok name={} local={} remote={}",
                project_name,
                local.display(),
                remote
            ),
        );

        Ok(format!("已上传：{} → {}", local_name, remote))
    })
    .await
    .map_err(|e| format!("上传线程异常: {}", e))?;
    result
}

/// @deprecated 兼容旧前端：上传后重启。新流程请用 upload_bt_java_jar + restart_bt_java_project。
#[tauri::command]
pub async fn upload_and_restart_bt_java_project(
    app: AppHandle,
    local_jar: String,
    project_name: String,
    project_id: String,
    remote_jar: String,
    project_path: String,
) -> Result<String, String> {
    let uploaded = upload_bt_java_jar(
        app.clone(),
        local_jar,
        project_name.clone(),
        project_id.clone(),
        remote_jar,
        project_path,
    )
    .await?;
    emit_bt_java_progress(&app, &project_id, &project_name, 100.0, "上传完成，正在重启…", "restart");
    let restarted = restart_bt_java_project(project_name.clone(), project_id.clone()).await?;
    emit_bt_java_progress(&app, &project_id, &project_name, 100.0, "已重启，等待端口…", "wait_port");
    Ok(format!("{}；{}", uploaded, restarted))
}

fn emit_bt_java_progress(
    app: &AppHandle,
    project_id: &str,
    project_name: &str,
    percent: f64,
    message: &str,
    stage: &str,
) {
    use tauri::Emitter;
    let percent = percent.clamp(0.0, 100.0);
    // 上传过程：系统日志只记整十里程碑，避免刷屏；其它阶段全量记录
    let should_diag = if stage == "upload" {
        let whole = percent.floor() as u32;
        percent == 0.0 || percent >= 100.0 || (whole % 10 == 0 && (percent - whole as f64).abs() < 0.15)
    } else {
        true
    };
    if should_diag {
        crate::diag::diag_log(
            "build",
            &format!(
                "bt_java_progress name={} stage={} {:.1}% {}",
                project_name, stage, percent, message
            ),
        );
    }
    let _ = app.emit(
        "bt-java-deploy-progress",
        serde_json::json!({
            "project_id": project_id,
            "project_name": project_name,
            "percent": percent,
            "message": message,
            "stage": stage,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_token_matches_official_demo() {
        let secret = "4vKENa5oEo8ZoNBuN7Rt6QGtlgB0Bo5i";
        let now = "1700000000";
        let expected_inner = hex_md5(secret.as_bytes());
        let expected = hex_md5(format!("{}{}", now, expected_inner).as_bytes());
        assert_eq!(bt_request_token(secret, now), expected);
        assert_eq!(hex_md5(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    fn match_single_and_ambiguous() {
        let projects = vec![
            BtJavaProject {
                id: "19".into(),
                name: "中台二期".into(),
                project_jar: "/www/wwwroot/pcm2/tksy-backend-1.0.0.jar".into(),
            },
            BtJavaProject {
                id: "32".into(),
                name: "rc-admin".into(),
                project_jar: "/www/wwwroot/rc-admin/tksy-backend-1.0.0.jar".into(),
            },
            BtJavaProject {
                id: "52".into(),
                name: "vpn-1".into(),
                project_jar: "/www/wwwroot/vpn/vpn-1.0.0.jar".into(),
            },
        ];

        let empty = std::collections::HashMap::new();
        assert!(matches!(
            match_java_project_with_overrides(&projects, "vpn-1.0.0.jar", "vpn", &empty),
            MatchResult::One(_)
        ));
        assert!(matches!(
            match_java_project_with_overrides(&projects, "missing.jar", "x", &empty),
            MatchResult::None
        ));

        match match_java_project_with_overrides(&projects, "tksy-backend-1.0.0.jar", "pcm2", &empty) {
            MatchResult::One(p) => assert_eq!(p.id, "19"),
            other => panic!("expected pcm2 match, got {:?}", other),
        }

        assert!(matches!(
            match_java_project_with_overrides(
                &projects,
                "tksy-backend-1.0.0.jar",
                "unknown-repo",
                &empty
            ),
            MatchResult::Ambiguous(2)
        ));

        let mut overrides = std::collections::HashMap::new();
        overrides.insert("tksy-backend-1.0.0.jar".into(), "19".into());
        match match_java_project_with_overrides(
            &projects,
            "tksy-backend-1.0.0.jar",
            "tksy-admin",
            &overrides,
        ) {
            MatchResult::One(p) => assert_eq!(p.id, "19"),
            other => panic!("expected override id=19, got {:?}", other),
        }
    }

    #[test]
    fn parse_nested_data_list() {
        let json: Value = serde_json::json!({
            "status": true,
            "data": {
                "data": [{
                    "id": 52,
                    "name": "vpn-1",
                    "path": "/www/wwwroot/vpn",
                    "project_config": {
                        "project_jar": "/www/wwwroot/vpn/vpn-1.0.0.jar"
                    }
                }]
            }
        });
        let list = parse_project_list(&json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "52");
        assert_eq!(list[0].project_jar, "/www/wwwroot/vpn/vpn-1.0.0.jar");
    }

    #[test]
    fn npm_test_script_detection() {
        assert!(is_test_npm_script("build:test"));
        assert!(is_test_npm_script("test"));
        assert!(!is_test_npm_script("build:prod"));
        assert!(!is_test_npm_script("build"));
        assert!(!is_test_npm_script(""));
    }

    #[test]
    fn parse_java_infos_and_php_filter() {
        let java: Value = serde_json::json!({
            "data": {
                "data": [{
                    "id": 52,
                    "name": "vpn-1",
                    "status": 1,
                    "path": "/www/wwwroot/vpn",
                    "addtime": "2026-01-15 10:20:30",
                    "project_config": {
                        "port": 8080,
                        "project_jar": "/www/wwwroot/vpn/vpn-1.0.0.jar"
                    }
                }]
            }
        });
        let j = parse_java_project_infos(&java);
        assert_eq!(j.len(), 1);
        assert_eq!(j[0].port, "8080");
        assert_eq!(j[0].status_text, "运行中");
        assert_eq!(j[0].updated_at, "2026-01-15 10:20:30");

        let stopped: Value = serde_json::json!({
            "data": {
                "data": [{
                    "id": 53,
                    "name": "down",
                    "status": 0,
                    "path": "/www/wwwroot/down",
                    "project_config": {
                        "port": 8080,
                        "project_jar": "/www/wwwroot/down/a.jar"
                    }
                }]
            }
        });
        let s = parse_java_project_infos(&stopped);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].port, "", "stopped project must hide port");
        assert_eq!(s[0].status_text, "已停止");

        let php: Value = serde_json::json!({
            "data": [{
                "id": 1,
                "name": "a.com",
                "path": "/www/wwwroot/a",
                "status": "1",
                "php_version": "74",
                "ps": "note",
                "addtime": "2025-08-01 12:00:00"
            }, {
                "id": 2,
                "name": "static.com",
                "path": "/www/wwwroot/s",
                "status": "1",
                "php_version": "静态",
                "ps": ""
            }, {
                "id": 3,
                "name": "empty.com",
                "path": "/www/wwwroot/e",
                "status": "0",
                "php_version": "",
                "ps": ""
            }]
        });
        let p = parse_php_site_infos(&php);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].name, "a.com");
        assert_eq!(p[0].php_version, "74");
        assert_eq!(p[0].updated_at, "2025-08-01 12:00:00");
    }
}
