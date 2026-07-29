use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

// ========== 模板目录解析 ==========
//
// 与 tauri.conf.json → bundle.resources 中的 `"../templates/**/*"` 对应；
// 必须通过 PathResolver 解析，禁止按 exe 路径手工猜测。

/// bundle.resources 里声明的模板根路径（与 tauri.conf.json 保持一致）
const BUNDLE_TEMPLATES_RESOURCE: &str = "../templates";

static BUNDLED_TEMPLATES_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 兼容转发：本文件与外部 `crate::landing::templates_log` 短暂共存
pub(crate) fn templates_log(message: impl AsRef<str>) {
    crate::diag::diag_log("templates", message);
}

pub(crate) fn list_template_subdirs(root: &Path) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    dirs.push(name);
                }
            }
        }
    }
    dirs.sort();
    dirs
}

/// 描述某目录下的模板子目录数量与名称（用于诊断日志）
pub(crate) fn summarize_templates_dir(path: &Path) -> String {
    if !path.exists() {
        return "目录不存在".to_string();
    }
    if !path.is_dir() {
        return format!("存在但不是目录 (is_file={})", path.is_file());
    }
    match fs::read_dir(path) {
        Err(e) => return format!("无法读取目录: {e}"),
        Ok(_) => {}
    }
    let dirs = list_template_subdirs(path);
    if dirs.is_empty() {
        return "目录可读但无模板子目录".to_string();
    }
    let preview: Vec<String> = dirs.iter().take(10).cloned().collect();
    let suffix = if dirs.len() > 10 {
        format!(", ... 共 {} 个", dirs.len())
    } else {
        String::new()
    };
    format!("子目录 {} 个: [{}]{suffix}", dirs.len(), preview.join(", "))
}

fn log_templates_startup_diagnostics(app: &AppHandle) {
    templates_log("========== 启动诊断 ==========");
    templates_log(&format!(
        "build={} resource_key=\"{}\"",
        if cfg!(debug_assertions) { "debug" } else { "release" },
        BUNDLE_TEMPLATES_RESOURCE
    ));

    match std::env::current_exe() {
        Ok(exe) => templates_log(&format!("current_exe={}", exe.display())),
        Err(e) => templates_log(&format!("current_exe=读取失败: {e}")),
    }

    match app.path().resource_dir() {
        Ok(dir) => templates_log(&format!("resource_dir={}", dir.display())),
        Err(e) => templates_log(&format!("resource_dir=解析失败: {e}")),
    }

    match app
        .path()
        .resolve(BUNDLE_TEMPLATES_RESOURCE, BaseDirectory::Resource)
    {
        Ok(path) => {
            templates_log(&format!(
                "resolve(\"{}\")={} exists={} is_dir={}",
                BUNDLE_TEMPLATES_RESOURCE,
                path.display(),
                path.exists(),
                path.is_dir()
            ));
            templates_log(&format!("  → {}", summarize_templates_dir(&path)));
        }
        Err(e) => templates_log(&format!(
            "resolve(\"{}\")=失败: {e}",
            BUNDLE_TEMPLATES_RESOURCE
        )),
    }

    let dev = dev_templates_dir();
    templates_log(&format!(
        "dev_fallback={} exists={} is_dir={}",
        dev.display(),
        dev.exists(),
        dev.is_dir()
    ));
    if dev.exists() {
        templates_log(&format!("  → {}", summarize_templates_dir(&dev)));
    }

    let writable = writable_templates_root();
    templates_log(&format!(
        "writable_root={} exists={}",
        writable.display(),
        writable.exists()
    ));
    if writable.exists() {
        templates_log(&format!("  → {}", summarize_templates_dir(&writable)));
    }
}

/// 启动时用 Tauri PathResolver 解析 bundle.resources（与打包器同一套规则）。
pub fn init_bundled_templates_dir(app: &AppHandle) {
    if BUNDLED_TEMPLATES_DIR.get().is_some() {
        templates_log("init 跳过：模板目录已初始化");
        return;
    }

    crate::diag::diag_log(
        "templates",
        &format!(
            "诊断日志目录: {:?}（按天文件 diagnostic-YYYY-MM-DD.log）",
            crate::diag::diagnostic_log_dir()
        ),
    );

    log_templates_startup_diagnostics(app);


    match app
        .path()
        .resolve(BUNDLE_TEMPLATES_RESOURCE, BaseDirectory::Resource)
    {
        Ok(path) if dir_has_template_subdirs(&path) => {
            let summary = summarize_templates_dir(&path);
            let _ = BUNDLED_TEMPLATES_DIR.set(path.clone());
            templates_log(&format!(
                "✅ 使用打包模板: {} (resolve \"{}\")",
                path.display(),
                BUNDLE_TEMPLATES_RESOURCE
            ));
            templates_log(&format!("  → {summary}"));
        }
        Ok(path) => {
            templates_log(&format!(
                "⚠️ resolve 成功但无可用模板: {} — {}",
                path.display(),
                summarize_templates_dir(&path)
            ));
            try_dev_templates_fallback();
        }
        Err(e) => {
            templates_log(&format!(
                "⚠️ resolve 失败 (key=\"{}\"): {e}",
                BUNDLE_TEMPLATES_RESOURCE
            ));
            try_dev_templates_fallback();
        }
    }

    match BUNDLED_TEMPLATES_DIR.get() {
        Some(path) => templates_log(&format!("init 结果: OK → {}", path.display())),
        None => templates_log(
            "init 结果: FAILED — 未找到模板目录；请检查 tauri.conf.json bundle.resources 与安装包内资源文件",
        ),
    }
    templates_log("========== 诊断结束 ==========");
}

/// 仅 debug 构建：回退到源码树 templates/（cargo tauri dev 场景，非运行时猜路径）。
fn try_dev_templates_fallback() {
    if !cfg!(debug_assertions) {
        templates_log("dev 回退跳过：release 构建不使用源码 templates");
        return;
    }
    let dev = dev_templates_dir();
    if dir_has_template_subdirs(&dev) {
        let _ = BUNDLED_TEMPLATES_DIR.set(dev.clone());
        templates_log(&format!(
            "✅ dev 回退成功: {} — {}",
            dev.display(),
            summarize_templates_dir(&dev)
        ));
    } else {
        templates_log(&format!(
            "dev 回退失败: {} — {}",
            dev.display(),
            summarize_templates_dir(&dev)
        ));
    }
}

fn dir_has_template_subdirs(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    fs::read_dir(path)
        .map(|entries| {
            entries.flatten().any(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && !e.file_name().to_string_lossy().starts_with('.')
            })
        })
        .unwrap_or(false)
}

fn dev_templates_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(&PathBuf::from("."))
        .join("templates")
}

/// 获取模板可写目录（用于上传、删除等写操作）
pub(crate) fn writable_templates_root() -> PathBuf {
    if cfg!(debug_assertions) {
        let dev = dev_templates_dir();
        if dev.is_dir() {
            return dev;
        }
    }
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(dev_templates_dir)
        .join("jarporter")
        .join("templates")
}

/// 模板扫描根目录：可写优先，再打包/资源目录。
///
/// 关键因：`tauri dev` 下上传写到源码 `templates/`，而 `templates_root()` 指向
/// `target/debug/_up_/templates`（资源副本）。若生成/预览只读后者，上传的模板
/// 会进列表却预览 404、生成也用不到。
pub(crate) fn template_scan_roots() -> Vec<PathBuf> {
    let writable = writable_templates_root();
    let bundled = templates_root();
    let mut roots = Vec::with_capacity(2);
    if writable.is_dir() {
        roots.push(writable.clone());
    }
    if bundled != writable && bundled.is_dir() {
        roots.push(bundled);
    } else if roots.is_empty() {
        roots.push(bundled);
    }
    roots
}

/// 按目录名解析模板路径：可写目录优先，其次打包资源。
pub(crate) fn resolve_template_dir(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    for root in template_scan_roots() {
        let candidate = root.join(name);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

/// 生成/扫描用的根目录列表。
/// - `template_base` 为空，或等于打包资源根：返回可写优先的双根
/// - 否则：仅使用显式传入的目录（自定义路径）
pub(crate) fn generation_template_roots(template_base: &str) -> Vec<PathBuf> {
    let trimmed = template_base.trim();
    if trimmed.is_empty() {
        return template_scan_roots();
    }
    let explicit = PathBuf::from(trimmed);
    if explicit == templates_root() {
        return template_scan_roots();
    }
    vec![explicit]
}

/// 在多个根下按 type_code 匹配模板目录（可写优先，同名去重），按目录名排序。
pub(crate) fn find_matching_template_dirs(type_code: &str, roots: &[PathBuf]) -> Vec<PathBuf> {
    use std::collections::HashSet;
    let tc_lower = type_code.to_lowercase();
    let mut seen = HashSet::new();
    let mut dirs = Vec::new();
    for root in roots {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let name_lower = name.to_lowercase();
                if name_lower != tc_lower && !name_lower.starts_with(&format!("{tc_lower}-")) {
                    continue;
                }
                if !entry.path().is_dir() {
                    continue;
                }
                if seen.insert(name) {
                    dirs.push(entry.path());
                }
            }
        }
    }
    dirs.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    dirs
}

/// 收集多个根下全部模板子目录（可写优先，同名去重），按目录名排序。
pub(crate) fn collect_all_template_dirs(roots: &[PathBuf]) -> Vec<PathBuf> {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    let mut dirs = Vec::new();
    for root in roots {
        for name in list_template_subdirs(root) {
            if seen.insert(name.clone()) {
                dirs.push(root.join(name));
            }
        }
    }
    dirs.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    dirs
}

/// 解析 `__templates__/{dir}/...` 相对路径到真实文件，并返回用于路径穿越校验的根。
pub(crate) fn resolve_template_preview_path(rel: &str) -> Option<(PathBuf, PathBuf)> {
    let rel = rel.trim_start_matches('/');
    if rel.is_empty() {
        return None;
    }
    let path = Path::new(rel);
    let mut comps = path.components();
    let first = match comps.next() {
        Some(std::path::Component::Normal(s)) => s.to_string_lossy().to_string(),
        _ => return None,
    };
    let template_dir = resolve_template_dir(&first)?;
    let rest: PathBuf = comps.as_path().to_path_buf();
    let full = if rest.as_os_str().is_empty() {
        template_dir.clone()
    } else {
        template_dir.join(rest)
    };
    Some((template_dir, full))
}

#[tauri::command]
pub async fn get_bundled_templates_dir() -> Result<String, String> {
    if let Some(dir) = BUNDLED_TEMPLATES_DIR.get() {
        templates_log(&format!("get_bundled_templates_dir → {}", dir.display()));
        return Ok(dir.to_string_lossy().to_string());
    }
    templates_log("get_bundled_templates_dir → FAILED（init 未成功或未执行）");
    if let Ok(exe) = std::env::current_exe() {
        templates_log(&format!("  current_exe={}", exe.display()));
    }
    let log_hint = crate::diag::today_log_path()
        .map(|p| format!("\n诊断日志: {}", p.display()))
        .unwrap_or_default();

    Err(format!(
        "找不到模板目录，请确认 bundle.resources 包含 \"{}\" 并已重新打包。{log_hint}",
        BUNDLE_TEMPLATES_RESOURCE
    ))
}

// 诊断日志命令已迁至 crate::diag（Task 1 为消同名 #[tauri::command] 冲突先挪走注册）
// ========== 模板管理功能 ==========

/// 获取打包内置 templates 根目录（只读，由 init_bundled_templates_dir 在 setup 时解析）
pub(crate) fn templates_root() -> PathBuf {
    BUNDLED_TEMPLATES_DIR
        .get()
        .cloned()
        .unwrap_or_else(dev_templates_dir)
}
