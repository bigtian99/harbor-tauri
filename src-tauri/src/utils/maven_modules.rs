//! Maven 多模块：扫描可执行子模块、Deployment 名匹配（kunlunchuangjie-cli 等）。

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MavenExecutableModule {
    pub rel_path: String,
    pub artifact_id: String,
    pub dir_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MavenModuleMatch {
    pub rel_path: String,
    pub artifact_id: String,
}

fn normalize_deploy_name(name: &str) -> String {
    let mut s = name.trim().to_lowercase();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    s
}

fn score_key_match(name: &str, raw: &str, key: &str) -> i32 {
    let k = normalize_deploy_name(key);
    if k.is_empty() {
        return 0;
    }
    if name == k || raw == key.to_lowercase() {
        return 300 + k.len() as i32;
    }
    if name.ends_with(&format!("-{k}")) || name.starts_with(&format!("{k}-")) {
        return 200 + k.len() as i32;
    }
    if name.contains(&k) && k.len() >= 10 {
        return 100 + k.len() as i32;
    }
    0
}

/// 去掉常见产品前缀，便于 `kunlunchuangjie-system` ↔ `ruoyi-system` 对齐。
fn service_core_name(name: &str) -> String {
    let mut s = normalize_deploy_name(name);
    for prefix in [
        "kunlunchuangjie-",
        "klcj-zt-",
        "klcj-",
        "ruoyi-modules-",
        "ruoyi-visual-",
        "ruoyi-",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            if !rest.is_empty() {
                s = rest.to_string();
                break;
            }
        }
    }
    // 部署名常带 -service 后缀
    if let Some(rest) = s.strip_suffix("-service") {
        if !rest.is_empty() {
            s = rest.to_string();
        }
    }
    s
}

fn score_service_core(deploy: &str, module_key: &str) -> i32 {
    let a = service_core_name(deploy);
    let b = service_core_name(module_key);
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    if a == b {
        return 280 + a.len() as i32;
    }
    if a.ends_with(&format!("-{b}")) || b.ends_with(&format!("-{a}")) {
        return 220 + a.len().min(b.len()) as i32;
    }
    if a.len() >= 4 && (a.contains(&b) || b.contains(&a)) {
        return 140 + a.len().min(b.len()) as i32;
    }
    0
}

fn pom_tag(content: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = content.find(&open)? + open.len();
    let end = content[start..].find(&close)? + start;
    let value = content[start..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// 项目自身的 artifactId（跳过 `<parent>` 内的父模块 id）。
fn pom_project_artifact_id(content: &str) -> Option<String> {
    let without_parent = if let (Some(ps), Some(pe)) =
        (content.find("<parent>"), content.find("</parent>"))
    {
        let pe = pe + "</parent>".len();
        if pe > ps {
            format!("{}{}", &content[..ps], &content[pe..])
        } else {
            content.to_string()
        }
    } else {
        content.to_string()
    };
    pom_tag(&without_parent, "artifactId")
}

fn pom_child_modules(content: &str) -> Vec<String> {
    let Some(start) = content.find("<modules>") else {
        return Vec::new();
    };
    let Some(end) = content[start..].find("</modules>") else {
        return Vec::new();
    };
    let block = &content[start + "<modules>".len()..start + end];
    let mut out = Vec::new();
    let mut rest = block;
    while let Some(i) = rest.find("<module>") {
        rest = &rest[i + "<module>".len()..];
        if let Some(j) = rest.find("</module>") {
            let name = rest[..j].trim();
            if !name.is_empty() {
                out.push(name.to_string());
            }
            rest = &rest[j + "</module>".len()..];
        } else {
            break;
        }
    }
    out
}

fn pom_has_spring_boot_plugin(content: &str) -> bool {
    content.contains("spring-boot-maven-plugin")
}

fn read_pom(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))
}

fn scan_pom_at(
    repo_root: &Path,
    rel: &str,
    out: &mut Vec<MavenExecutableModule>,
) -> Result<(), String> {
    let pom_path = if rel.is_empty() {
        repo_root.join("pom.xml")
    } else {
        repo_root.join(rel).join("pom.xml")
    };
    if !pom_path.is_file() {
        return Ok(());
    }
    let content = read_pom(&pom_path)?;
    let artifact_id = pom_project_artifact_id(&content).unwrap_or_else(|| {
        rel.rsplit('/').next().unwrap_or("unknown").to_string()
    });
    let dir_name = if rel.is_empty() {
        repo_root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| artifact_id.clone())
    } else {
        rel.rsplit('/').next().unwrap_or(&artifact_id).to_string()
    };
    let modules = pom_child_modules(&content);

    if !modules.is_empty() {
        for m in modules {
            let child_rel = if rel.is_empty() {
                m
            } else {
                format!("{rel}/{m}")
            };
            scan_pom_at(repo_root, &child_rel, out)?;
        }
        return Ok(());
    }

    if pom_has_spring_boot_plugin(&content) {
        out.push(MavenExecutableModule {
            rel_path: rel.replace('\\', "/"),
            artifact_id,
            dir_name,
        });
    }

    Ok(())
}

/// 扫描仓库内所有 Spring Boot 可执行模块。
pub fn scan_executable_modules(repo_root: &Path) -> Result<Vec<MavenExecutableModule>, String> {
    if !repo_root.join("pom.xml").is_file() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    scan_pom_at(repo_root, "", &mut out)?;
    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    out.dedup_by(|a, b| a.rel_path == b.rel_path);
    Ok(out)
}

fn score_module(deployment: &str, module: &MavenExecutableModule) -> i32 {
    let name = normalize_deploy_name(deployment);
    let raw = deployment.trim().to_lowercase();
    let path_key = module.rel_path.replace('/', "-");
    [
        score_key_match(&name, &raw, &module.artifact_id),
        score_key_match(&name, &raw, &module.dir_name),
        score_key_match(&name, &raw, &path_key),
        score_service_core(deployment, &module.artifact_id),
        score_service_core(deployment, &module.dir_name),
        score_service_core(deployment, &path_key),
    ]
    .into_iter()
    .max()
    .unwrap_or(0)
}

fn format_module_candidates(modules: &[MavenExecutableModule]) -> String {
    modules
        .iter()
        .take(8)
        .map(|m| {
            if m.rel_path.is_empty() {
                format!("{} (根)", m.artifact_id)
            } else {
                format!("{} → {}", m.artifact_id, m.rel_path)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// 按 Deployment 名解析 Maven 模块；无多模块或未命中时返回 `Ok(None)` / `Err`。
pub fn resolve_maven_module(
    repo_root: &Path,
    deployment_hint: Option<&str>,
) -> Result<Option<MavenModuleMatch>, String> {
    let modules = scan_executable_modules(repo_root)?;
    if modules.is_empty() {
        return Ok(None);
    }
    if modules.len() == 1 {
        let m = &modules[0];
        if let Some(hint) = deployment_hint.filter(|s| !s.trim().is_empty()) {
            let score = score_module(hint, m);
            crate::diag::diag_log(
                "build",
                &format!(
                    "resolve_maven_module single candidate deployment={hint} module={} score={score}",
                    m.rel_path
                ),
            );
            if score < 100 {
                return Err(format!(
                    "Deployment「{hint}」与唯一可执行模块「{}」({}) 匹配度不足；候选: {}",
                    m.artifact_id, m.rel_path, format_module_candidates(&modules)
                ));
            }
        }
        return Ok(Some(MavenModuleMatch {
            rel_path: m.rel_path.clone(),
            artifact_id: m.artifact_id.clone(),
        }));
    }

    let hint = deployment_hint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            format!(
                "该仓库含 {} 个可执行 Maven 模块，请通过 K8s Deployment 指定要打的服务。候选: {}",
                modules.len(),
                format_module_candidates(&modules)
            )
        })?;

    let mut scored: Vec<(i32, &MavenExecutableModule)> = modules
        .iter()
        .map(|m| (score_module(hint, m), m))
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.rel_path.cmp(&b.1.rel_path)));

    let (best_score, best) = scored[0];
    let second_score = scored.get(1).map(|(s, _)| *s).unwrap_or(0);

    crate::diag::diag_log(
        "build",
        &format!(
            "resolve_maven_module deployment={hint} best={} score={best_score} second={second_score}",
            best.rel_path
        ),
    );

    if best_score < 100 {
        return Err(format!(
            "Deployment「{hint}」未匹配到 Maven 模块（最高分 {best_score}）。候选: {}",
            format_module_candidates(&modules)
        ));
    }
    if best_score - second_score < 50 {
        let top: Vec<String> = scored
            .iter()
            .take(3)
            .map(|(s, m)| format!("{} ({}, score={s})", m.artifact_id, m.rel_path))
            .collect();
        return Err(format!(
            "Deployment「{hint}」匹配歧义（{best_score} vs {second_score}），请检查 Deployment 命名。Top: {}",
            top.join("; ")
        ));
    }

    Ok(Some(MavenModuleMatch {
        rel_path: best.rel_path.clone(),
        artifact_id: best.artifact_id.clone(),
    }))
}

/// worktree 子目录名：`_pack` 或 `_pack-{slot}`。
pub fn pack_worktree_dir_with_slot(
    output_base: &Path,
    repo_name: &str,
    pack_slot: Option<&str>,
) -> PathBuf {
    let slot = pack_slot
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(sanitize_pack_slot)
        .filter(|s| !s.is_empty());
    match slot {
        Some(s) => output_base.join(repo_name).join(format!("_pack-{s}")),
        None => output_base.join(repo_name).join("_pack"),
    }
}

pub fn sanitize_pack_slot(raw: &str) -> String {
    let mut s = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    s.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_pom(dir: &Path, name: &str, body: &str) {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join("pom.xml");
        let mut f = fs::File::create(path).unwrap();
        write!(
            f,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<project>
{body}
</project>"#
        )
        .unwrap();
        let _ = name;
    }

    #[test]
    fn sanitize_pack_slot_replaces_slashes() {
        assert_eq!(
            sanitize_pack_slot("ruoyi-modules/ruoyi-system"),
            "ruoyi-modules-ruoyi-system"
        );
    }

    #[test]
    fn pack_dir_with_slot() {
        let p = pack_worktree_dir_with_slot(Path::new("/out"), "cli", Some("ruoyi-gateway"));
        assert_eq!(p, Path::new("/out/cli/_pack-ruoyi-gateway"));
        let p2 = pack_worktree_dir_with_slot(Path::new("/out"), "cli", None);
        assert_eq!(p2, Path::new("/out/cli/_pack"));
    }

    #[test]
    fn scan_cli_like_layout() {
        let base = std::env::temp_dir().join(format!(
            "jarporter-mvn-mod-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&base);
        write_pom(
            &base,
            "root",
            r#"<packaging>pom</packaging><artifactId>ruoyi</artifactId>
<modules><module>ruoyi-gateway</module><module>ruoyi-auth</module><module>ruoyi-modules</module></modules>"#,
        );
        write_pom(
            &base.join("ruoyi-gateway"),
            "gw",
            r#"<artifactId>ruoyi-gateway</artifactId><packaging>jar</packaging>
<build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>"#,
        );
        write_pom(
            &base.join("ruoyi-auth"),
            "auth",
            r#"<artifactId>ruoyi-auth</artifactId><packaging>jar</packaging>
<build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>"#,
        );
        write_pom(
            &base.join("ruoyi-modules"),
            "mods",
            r#"<packaging>pom</packaging><artifactId>ruoyi-modules</artifactId>
<modules><module>ruoyi-system</module></modules>"#,
        );
        write_pom(
            &base.join("ruoyi-modules/ruoyi-system"),
            "sys",
            r#"<artifactId>ruoyi-modules-system</artifactId><packaging>jar</packaging>
<build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>"#,
        );

        let mods = scan_executable_modules(&base).unwrap();
        let paths: Vec<_> = mods.iter().map(|m| m.rel_path.as_str()).collect();
        assert!(paths.contains(&"ruoyi-gateway"));
        assert!(paths.contains(&"ruoyi-auth"));
        assert!(paths.contains(&"ruoyi-modules/ruoyi-system"));
        let sys_mod = mods
            .iter()
            .find(|m| m.rel_path == "ruoyi-modules/ruoyi-system")
            .unwrap();
        assert_eq!(sys_mod.artifact_id, "ruoyi-modules-system");

        let gw = resolve_maven_module(&base, Some("ruoyi-gateway")).unwrap().unwrap();
        assert_eq!(gw.rel_path, "ruoyi-gateway");

        let sys = resolve_maven_module(&base, Some("klcj-zt-system-service"))
            .unwrap()
            .unwrap();
        assert_eq!(sys.rel_path, "ruoyi-modules/ruoyi-system");

        let sys2 = resolve_maven_module(&base, Some("kunlunchuangjie-system"))
            .unwrap()
            .unwrap();
        assert_eq!(sys2.rel_path, "ruoyi-modules/ruoyi-system");

        assert!(resolve_maven_module(&base, None).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn pom_project_artifact_skips_parent() {
        let content = r#"
<project>
  <parent>
    <groupId>com.ruoyi</groupId>
    <artifactId>ruoyi</artifactId>
    <version>3.6.8</version>
  </parent>
  <artifactId>ruoyi-gateway</artifactId>
</project>"#;
        assert_eq!(
            pom_project_artifact_id(content).as_deref(),
            Some("ruoyi-gateway")
        );
    }

    #[test]
    fn service_core_aligns_deploy_aliases() {
        assert_eq!(service_core_name("kunlunchuangjie-system"), "system");
        assert_eq!(service_core_name("ruoyi-modules-system"), "system");
        assert_eq!(service_core_name("ruoyi-system"), "system");
        assert_eq!(service_core_name("klcj-zt-system-service"), "system");
        assert!(score_service_core("kunlunchuangjie-system", "ruoyi-system") >= 280);
    }
}
