//! Maven Home / 本地仓库解析：配置 > 环境变量 > 空。

use std::path::{Path, PathBuf};

/// 从环境变量读取 Maven 安装目录（MAVEN_HOME 优先于 M2_HOME）。
pub(crate) fn maven_home_from_env() -> String {
    for key in ["MAVEN_HOME", "M2_HOME"] {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    String::new()
}

/// `{maven_home}/repository`（仅拼接，不检查是否存在）。
pub(crate) fn derive_maven_local_repo(maven_home: &str) -> String {
    let home = maven_home.trim();
    if home.is_empty() {
        return String::new();
    }
    PathBuf::from(home)
        .join("repository")
        .to_string_lossy()
        .to_string()
}

/// 解析最终使用的 Maven Home / 本地仓库。
/// 优先级：配置显式值 > 环境变量 > 内置 bundle-tools > 空；本地仓库未填时由 Home 推导。
pub(crate) fn resolve_maven_paths(config_home: &str, config_local_repo: &str) -> (String, String) {
    let mut home = normalize_maven_home(config_home);
    if home.is_empty() {
        home = normalize_maven_home(&maven_home_from_env());
    }
    if home.is_empty() || !maven_home_looks_valid(&home) {
        if let Some(bundled) = crate::utils::bundled_maven_home() {
            let bundled = normalize_maven_home(&bundled);
            if maven_home_looks_valid(&bundled) {
                home = bundled;
            }
        }
    }
    let mut local = config_local_repo.trim().to_string();
    if local.is_empty() && !home.is_empty() {
        if crate::utils::is_bundled_maven_home(&home) {
            local = crate::utils::default_bundled_maven_local_repo();
        } else {
            local = derive_maven_local_repo(&home);
        }
    }
    (home, local)
}

/// 判断 Maven Home 来源（供设置页展示）。
pub(crate) fn maven_home_source(config_home: &str, effective_home: &str) -> &'static str {
    let cfg = normalize_maven_home(config_home);
    if !cfg.is_empty() && maven_home_looks_valid(&cfg) {
        return "config";
    }
    let env = maven_home_from_env();
    if !env.is_empty() && paths_equal_lossy(&env, effective_home) && maven_home_looks_valid(&env) {
        return "env";
    }
    if crate::utils::is_bundled_maven_home(effective_home) {
        return "bundled";
    }
    if maven_home_looks_valid(effective_home) {
        return "path";
    }
    "none"
}

fn paths_equal_lossy(a: &str, b: &str) -> bool {
    a.trim() == b.trim()
        || Path::new(a.trim())
            .canonicalize()
            .ok()
            .zip(Path::new(b.trim()).canonicalize().ok())
            .map(|(x, y)| x == y)
            .unwrap_or(false)
}

/// 纠正常见误选：bin 目录、mvn 可执行文件路径。
pub(crate) fn normalize_maven_home(home: &str) -> String {
    let home = home.trim();
    if home.is_empty() {
        return String::new();
    }
    let path = Path::new(home);
    if path.file_name().is_some_and(|n| n == "bin") {
        if let Some(parent) = path.parent() {
            return parent.to_string_lossy().to_string();
        }
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name == "mvn" || name == "mvn.cmd" || name == "mvn.bat" {
        if let Some(maven_home) = path.parent().and_then(|p| p.parent()) {
            return maven_home.to_string_lossy().to_string();
        }
    }
    home.to_string()
}

fn maven_bin_candidates(home: &str) -> Vec<PathBuf> {
    let normalized = normalize_maven_home(home);
    if normalized.is_empty() {
        return Vec::new();
    }
    let root = Path::new(&normalized);
    let mut candidates = vec![root.join("bin")];
    if let Ok(canonical) = root.canonicalize() {
        candidates.push(canonical.join("bin"));
    }
    candidates
}

pub(crate) fn maven_home_looks_valid(home: &str) -> bool {
    let normalized = normalize_maven_home(home);
    if normalized.is_empty() {
        return false;
    }
    for bin in maven_bin_candidates(&normalized) {
        #[cfg(windows)]
        {
            if bin.join("mvn.cmd").is_file()
                || bin.join("mvn.bat").is_file()
                || bin.join("mvn").is_file()
            {
                return true;
            }
        }
        #[cfg(not(windows))]
        {
            if bin.join("mvn").is_file() {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_repo_from_home() {
        assert_eq!(
            derive_maven_local_repo("/Users/x/app/apache-maven-3.9.9"),
            "/Users/x/app/apache-maven-3.9.9/repository"
        );
        assert_eq!(derive_maven_local_repo(""), "");
        assert_eq!(derive_maven_local_repo("  "), "");
    }

    #[test]
    fn resolve_prefers_config_then_derives_repo() {
        let (h, r) = resolve_maven_paths("/opt/maven", "");
        assert_eq!(h, "/opt/maven");
        assert_eq!(r, "/opt/maven/repository");
        let (h2, r2) = resolve_maven_paths("/opt/maven", "/custom/repo");
        assert_eq!(h2, "/opt/maven");
        assert_eq!(r2, "/custom/repo");
    }

    #[test]
    fn normalize_maven_home_from_bin_dir() {
        assert_eq!(
            normalize_maven_home("/opt/apache-maven-3.9.9/bin"),
            "/opt/apache-maven-3.9.9"
        );
    }
}
