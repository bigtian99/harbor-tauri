//! 安装包内置 Maven + JDK（bundle-tools/resources），配置/环境变量未设置时回退使用。

use crate::diag::diag_log;
use crate::models::APP_CONFIG_DIR;
use crate::utils::maven_home_looks_valid;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const BUNDLE_TOOLS_RESOURCE: &str = "bundle-tools";
const MAVEN_SUBDIR: &str = "maven";
const JDK_SUBDIR: &str = "jdk";

#[derive(Clone, Debug, Default)]
pub(crate) struct BundledToolsPaths {
    pub maven_home: Option<PathBuf>,
    pub java_home: Option<PathBuf>,
}

static BUNDLED_TOOLS: OnceLock<BundledToolsPaths> = OnceLock::new();

fn dev_bundle_tools_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bundle-tools")
}

fn try_load_from_base(base: &Path) -> BundledToolsPaths {
    let maven_home = base.join(MAVEN_SUBDIR);
    let java_home = base.join(JDK_SUBDIR);
    let maven = if maven_home_looks_valid(maven_home.to_string_lossy().as_ref()) {
        Some(maven_home)
    } else {
        None
    };
    let java = if java_bin_exists(&java_home) {
        Some(java_home)
    } else {
        None
    };
    BundledToolsPaths {
        maven_home: maven,
        java_home: java,
    }
}

fn java_bin_exists(java_home: &Path) -> bool {
    #[cfg(windows)]
    {
        java_home.join("bin").join("java.exe").is_file()
    }
    #[cfg(not(windows))]
    {
        java_home.join("bin").join("java").is_file()
    }
}

/// 启动时解析打包资源中的 bundle-tools（与 templates 同一套 resource_dir 规则）。
pub(crate) fn init_bundled_tools(app: &AppHandle) {
    if BUNDLED_TOOLS.get().is_some() {
        return;
    }

    let mut loaded = BundledToolsPaths::default();

    if let Ok(path) = app
        .path()
        .resolve(BUNDLE_TOOLS_RESOURCE, BaseDirectory::Resource)
    {
        loaded = try_load_from_base(&path);
        if loaded.maven_home.is_some() || loaded.java_home.is_some() {
            diag_log(
                "app",
                &format!(
                    "bundled_tools: resource {} maven={} jdk={}",
                    path.display(),
                    loaded.maven_home.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                    loaded.java_home.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                ),
            );
        }
    }

    if loaded.maven_home.is_none() && loaded.java_home.is_none() {
        let dev = dev_bundle_tools_dir();
        if dev.is_dir() {
            loaded = try_load_from_base(&dev);
            if loaded.maven_home.is_some() || loaded.java_home.is_some() {
                diag_log(
                    "app",
                    &format!(
                        "bundled_tools: dev fallback {} maven={} jdk={}",
                        dev.display(),
                        loaded.maven_home.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                        loaded.java_home.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                    ),
                );
            }
        }
    }

    if loaded.maven_home.is_none() && loaded.java_home.is_none() {
        diag_log("app", "bundled_tools: 未找到内置 Maven/JDK（发版构建需先执行 pnpm bundle-tools:download）");
    }

    let _ = BUNDLED_TOOLS.set(loaded);
}

fn paths() -> &'static BundledToolsPaths {
    BUNDLED_TOOLS.get_or_init(BundledToolsPaths::default)
}

pub(crate) fn bundled_maven_home() -> Option<String> {
    paths()
        .maven_home
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}

pub(crate) fn bundled_java_home() -> Option<String> {
    paths()
        .java_home
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}

pub(crate) fn bundled_tools_available() -> bool {
    bundled_maven_home().is_some() && bundled_java_home().is_some()
}

pub(crate) fn is_bundled_maven_home(home: &str) -> bool {
    let Some(bundled) = bundled_maven_home() else {
        return false;
    };
    paths_equal(&bundled, home)
}

/// 内置 Maven 的本地仓库放在可写配置目录，避免写入只读 app bundle。
pub(crate) fn default_bundled_maven_local_repo() -> String {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_CONFIG_DIR)
        .join("maven-repository")
        .to_string_lossy()
        .to_string()
}

fn paths_equal(a: &str, b: &str) -> bool {
    let a = a.trim();
    let b = b.trim();
    if a == b {
        return true;
    }
    Path::new(a).canonicalize().ok()
        == Path::new(b).canonicalize().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_bundled_repo_under_config() {
        let repo = default_bundled_maven_local_repo();
        assert!(repo.contains("jarporter"));
        assert!(repo.contains("maven-repository"));
    }
}
