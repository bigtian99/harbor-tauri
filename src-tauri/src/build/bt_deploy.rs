//! test 打包后：FTP 覆盖宝塔 Java 项目 JAR 并 restart_project。

use crate::landing::run_ftp_upload_file_with_progress;
use crate::models::HarborConfig;
use md5::{Digest, Md5};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

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
pub(crate) fn match_java_project(
    projects: &[BtJavaProject],
    local_jar_name: &str,
    repo_name: &str,
) -> MatchResult {
    let local = local_jar_name.trim();
    if local.is_empty() {
        return MatchResult::None;
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

fn is_test_profile(profile: &Option<String>) -> bool {
    profile
        .as_ref()
        .map(|s| s.trim().eq_ignore_ascii_case("test"))
        .unwrap_or(false)
}

fn is_jar_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jar"))
        .unwrap_or(false)
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
    extra: &[(&str, String)],
) -> Result<Value, String> {
    let base = config.bt_panel_url.trim().trim_end_matches('/');
    let url = format!("{}/{}", base, path.trim_start_matches('/'));
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
        &format!("bt_panel POST {} extras={}", path, extra.len()),
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

    match match_java_project(projects, &file_name, repo_name) {
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
pub(crate) fn maybe_deploy_test_jars(
    app: &AppHandle,
    config: &HarborConfig,
    spring_profile: &Option<String>,
    repo_name: &str,
    artifact_path: &str,
    backend_artifact_path: &Option<String>,
) -> Option<String> {
    if !config.bt_auto_deploy_test {
        crate::diag::diag_log("build", "bt_auto_deploy_test=false，跳过宝塔部署");
        return None;
    }
    if !is_test_profile(spring_profile) {
        return None;
    }

    let mut jars: Vec<String> = Vec::new();
    if is_jar_path(artifact_path) {
        jars.push(artifact_path.to_string());
    }
    if let Some(backend) = backend_artifact_path {
        if is_jar_path(backend) && !jars.iter().any(|j| j == backend) {
            jars.push(backend.clone());
        }
    }
    if jars.is_empty() {
        crate::diag::diag_log("build", "profile=test 但产物非 JAR，跳过宝塔部署");
        return None;
    }

    if config.bt_panel_secret.trim().is_empty() {
        let msg = "ℹ️ 未配置宝塔 API 密钥，跳过自动部署".to_string();
        crate::diag::diag_log("build", &msg);
        crate::build::emit_progress(app, 96, msg.clone(), "build");
        return Some(msg);
    }

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

    let client = match panel_client(config) {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("❌ {}", e);
            crate::diag::diag_log("build", &msg);
            crate::build::emit_progress(app, 96, msg.clone(), "build");
            return Some(msg);
        }
    };

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
            return Some(msg);
        }
    };

    let lines: Vec<String> = jars
        .iter()
        .map(|jar| deploy_one_jar(app, &client, config, &projects, jar, repo_name))
        .collect();
    Some(lines.join("\n"))
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

        assert!(matches!(
            match_java_project(&projects, "vpn-1.0.0.jar", "vpn"),
            MatchResult::One(_)
        ));
        assert!(matches!(
            match_java_project(&projects, "missing.jar", "x"),
            MatchResult::None
        ));

        match match_java_project(&projects, "tksy-backend-1.0.0.jar", "pcm2") {
            MatchResult::One(p) => assert_eq!(p.id, "19"),
            other => panic!("expected pcm2 match, got {:?}", other),
        }

        assert!(matches!(
            match_java_project(&projects, "tksy-backend-1.0.0.jar", "unknown-repo"),
            MatchResult::Ambiguous(2)
        ));
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
}
