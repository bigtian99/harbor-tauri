//! 模板列表 / 上传 / 删除 / 分类元数据。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::resolve::{
    list_template_subdirs, summarize_templates_dir, templates_log, templates_root,
    writable_templates_root,
};

/// 合并打包模板与用户上传模板目录名（去重）
fn all_template_roots() -> Vec<PathBuf> {
    let mut roots = vec![templates_root()];
    let writable = writable_templates_root();
    if writable != roots[0] && writable.is_dir() {
        roots.push(writable);
    }
    roots
}

#[tauri::command]
pub async fn list_template_dirs() -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut dirs: Vec<String> = Vec::new();
    for root in all_template_roots() {
        for name in list_template_subdirs(&root) {
            if seen.insert(name.clone()) {
                dirs.push(name);
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

/// 单个模板信息：目录名 + 中文分类（来自 index.html 预埋的 `<meta name="template-category">`）
#[derive(serde::Serialize)]
pub struct TemplateInfo {
    pub dir: String,
    pub category: String,
}

/// 去掉文件夹名末尾的 `-数字` 后缀：comic-1 → comic，comic → comic
fn strip_numeric_suffix(name: &str) -> String {
    if let Some(idx) = name.rfind('-') {
        let suffix = &name[idx + 1..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return name[..idx].to_string();
        }
    }
    name.to_string()
}

/// 从单个标签字符串里提取某个属性的值（兼容单/双引号和无引号写法）
fn extract_attr_value(tag: &str, attr: &str) -> Option<String> {
    let key = format!("{}=", attr);
    let idx = tag.find(&key)?;
    let after = &tag[idx + key.len()..];
    let bytes = after.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    match bytes[0] {
        b'"' | b'\'' => {
            let quote = bytes[0] as char;
            let rest = &after[1..];
            let end = rest.find(quote)?;
            Some(rest[..end].to_string())
        }
        _ => {
            // 无引号：取到下一个空白或标签结束符
            let end = after
                .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
                .unwrap_or(after.len());
            Some(after[..end].to_string())
        }
    }
}

/// 从 index.html 中提取 `<meta name="template-category" content="...">` 的值
fn extract_template_category(html: &str) -> Option<String> {
    for pos in html.match_indices("template-category") {
        // 定位「template-category」所在的标签范围 <...>
        let tag_start = html[..pos.0].rfind('<').unwrap_or(0);
        let tag_end = html[tag_start..].find('>').map(|e| tag_start + e + 1)?;
        let tag = &html[tag_start..tag_end];
        // 确认 name 属性确实是 template-category（避免正文里恰好出现该词）
        if extract_attr_value(tag, "name").as_deref() != Some("template-category") {
            continue;
        }
        if let Some(content) = extract_attr_value(tag, "content") {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 读取模板目录下 index.html 预埋的中文分类，缺失或读不到返回 None
fn read_template_category(dir: &Path) -> Option<String> {
    let html = fs::read_to_string(dir.join("index.html")).ok()?;
    extract_template_category(&html)
}

/// 列出所有模板目录及其中文分类（前端按 category 折叠分组展示）
#[tauri::command]
pub async fn list_template_infos() -> Result<Vec<TemplateInfo>, String> {
    let mut infos: Vec<TemplateInfo> = Vec::new();
    let mut seen = HashSet::new();
    for root in all_template_roots() {
        templates_log(&format!(
            "list_template_infos 扫描 {} — {}",
            root.display(),
            summarize_templates_dir(&root)
        ));
        match fs::read_dir(&root) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') || !seen.insert(name.clone()) {
                        continue;
                    }
                    let category = read_template_category(&entry.path())
                        .unwrap_or_else(|| strip_numeric_suffix(&name));
                    infos.push(TemplateInfo { dir: name, category });
                }
            }
            Err(e) => templates_log(&format!("list_template_infos 读取失败 {}: {e}", root.display())),
        }
    }
    templates_log(&format!("list_template_infos 合计 {} 个模板", infos.len()));
    infos.sort_by(|a, b| a.category.cmp(&b.category).then_with(|| a.dir.cmp(&b.dir)));
    Ok(infos)
}

#[tauri::command]
pub async fn upload_template_zip(zip_path: String) -> Result<Vec<serde_json::Value>, String> {
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("无法打开 zip 文件: {}", e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("无法解析 zip 文件: {}", e))?;

    let root = writable_templates_root();
    // 确保 templates 目录存在
    fs::create_dir_all(&root).map_err(|e| format!("创建模板目录失败: {}", e))?;

    let mut extracted_dirs: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("读取 zip entry {} 失败: {}", i, e))?;
        let name = entry.name().to_string();

        // 跳过不需要的路径
        let first_component = name.split('/').next().unwrap_or("");
        if first_component.is_empty()
            || first_component == "__MACOSX"
            || first_component.starts_with('.')
        {
            continue;
        }

        let rel_path = if let Some(idx) = name.find('/') {
            &name[(idx + 1)..]
        } else {
            continue; // 跳过根目录 entry（没有文件内容）
        };

        if rel_path.is_empty() {
            continue;
        }

        let dest = root.join(&name);

        if entry.is_dir() {
            fs::create_dir_all(&dest).ok();
        } else {
            // 只解压非排除文件
            let file_name = std::path::Path::new(rel_path)
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            if file_name == "README.md" || file_name == ".DS_Store" {
                continue;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out = fs::File::create(&dest)
                .map_err(|e| format!("创建文件 {} 失败: {}", dest.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("解压文件 {} 失败: {}", dest.display(), e))?;
            *extracted_dirs.entry(first_component.to_string()).or_insert(0) += 1;
        }
    }

    if extracted_dirs.is_empty() {
        return Err("zip 中没有找到有效的模板目录".to_string());
    }

    let results: Vec<serde_json::Value> = extracted_dirs
        .into_iter()
        .map(|(dir_name, file_count)| {
            serde_json::json!({
                "dir_name": dir_name,
                "file_count": file_count,
            })
        })
        .collect();

    templates_log(&format!("✅ 模板上传完成: {:?}", results));
    Ok(results)
}

#[tauri::command]
pub async fn delete_template_dir(dir_name: String) -> Result<(), String> {
    let target = writable_templates_root().join(&dir_name);
    if !target.exists() {
        return Err(format!("模板目录 '{}' 不存在", dir_name));
    }
    fs::remove_dir_all(&target)
        .map_err(|e| format!("删除模板目录 '{}' 失败: {}", dir_name, e))?;
    templates_log(&format!("🗑 已删除模板: {}", dir_name));
    Ok(())
}
