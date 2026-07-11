use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn render_template(template: &str, replacements: &[(&str, String)]) -> String {
    replacements
        .iter()
        .fold(template.to_string(), |content, (key, value)| {
            content.replace(&format!("{{{{{}}}}}", key), value)
        })
}

pub(crate) fn docker_json_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 清理临时目录中所有 jarporter-worktree- 和 jarporter-build- 前缀的残留目录
pub(crate) fn cleanup_old_temp_dirs() {
    let temp = std::env::temp_dir();
    let prefixes = ["jarporter-worktree-", "jarporter-build-"];
    if let Ok(entries) = fs::read_dir(&temp) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if prefixes.iter().any(|p| name_str.starts_with(p)) {
                fs::remove_dir_all(entry.path()).ok();
            }
        }
    }
}

pub(crate) fn create_temp_build_dir() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成临时目录失败: {}", e))?
        .as_millis();
    let dir = std::env::temp_dir().join(format!("jarporter-build-{}-{}", std::process::id(), now));
    fs::create_dir_all(&dir).map_err(|e| format!("创建临时构建目录失败: {}", e))?;
    Ok(dir)
}

pub(crate) fn create_temp_worktree_path() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成临时 worktree 路径失败: {}", e))?
        .as_millis();
    Ok(std::env::temp_dir().join(format!("jarporter-worktree-{}-{}", std::process::id(), now)))
}

pub(crate) fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let target_path = dst.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;

        if file_type.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path)
                .map_err(|e| format!("复制文件失败 {}: {}", source_path.display(), e))?;
        }
    }

    Ok(())
}

/// 清理 ANSI 转义序列（颜色码等），让终端输出在日志中可读
pub(crate) fn strip_ansi_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' && chars.peek() == Some(&'[') {
            // 跳过整个 ANSI 转义序列 \x1b[...m
            chars.next(); // skip '['
            while let Some(&c) = chars.peek() {
                if c.is_ascii_alphabetic() {
                    chars.next(); // skip the terminating letter
                    break;
                }
                chars.next();
            }
        } else {
            result.push(ch);
        }
    }
    result
}

/// 从 dist 目录的直接父目录（即项目根目录）查找 nginx.conf
/// 只查一层，避免误用上级目录中宝塔面板等服务器配置
pub(crate) fn find_project_nginx(artifact_path: &Path) -> Option<String> {
    let project_dir = artifact_path.parent()?;
    let candidate = project_dir.join("nginx.conf");
    if candidate.is_file() {
        crate::diag::diag_log(
            "utils",
            &format!("检测到项目 nginx.conf: {}", candidate.display()),
        );
        Some(fs::read_to_string(&candidate).ok()?)
    } else {
        None
    }
}

pub(crate) fn copy_artifact_to_output_internal(src: &Path, dst_dir: &Path) -> Result<String, String> {
    if !src.exists() {
        return Err(format!("产物路径不存在: {}", src.display()));
    }

    fs::create_dir_all(dst_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let file_name = src.file_name().ok_or("无法获取文件名")?;
    let dst = dst_dir.join(file_name);

    if src.is_dir() {
        // 递归复制目录
        copy_dir_recursive(src, &dst).map_err(|e| format!("复制产物目录失败: {}", e))?;
    } else {
        // 复制文件
        fs::copy(src, &dst).map_err(|e| format!("复制产物文件失败: {}", e))?;
    }

    Ok(dst.to_string_lossy().to_string())
}

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // 跳过不需要复制的文件
        if file_name_str == "README.md" || file_name_str == ".DS_Store" {
            continue;
        }

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{docker_json_string, render_template, strip_ansi_codes};

    #[test]
    fn render_template_replaces_placeholders() {
        let out = render_template(
            "FROM {{BASE_IMAGE}}\nEXPOSE {{EXPOSE_PORT}}\n# keep {{BASE_IMAGE}} twice",
            &[
                ("BASE_IMAGE", "nginx:alpine".to_string()),
                ("EXPOSE_PORT", "80".to_string()),
            ],
        );
        assert_eq!(
            out,
            "FROM nginx:alpine\nEXPOSE 80\n# keep nginx:alpine twice"
        );
        assert!(!out.contains("{{"));
    }

    #[test]
    fn render_template_leaves_unknown_placeholders() {
        let out = render_template("hello {{NAME}}", &[("OTHER", "x".to_string())]);
        assert_eq!(out, "hello {{NAME}}");
    }

    #[test]
    fn docker_json_string_escapes_backslash_and_quote() {
        assert_eq!(docker_json_string(r#"a\b"c"#), r#"a\\b\"c"#);
        assert_eq!(docker_json_string("plain"), "plain");
        assert_eq!(docker_json_string(r#""""#), r#"\"\""#);
    }

    #[test]
    fn strip_ansi_codes_removes_color_sequences() {
        let colored = "\x1b[31merror\x1b[0m ok";
        assert_eq!(strip_ansi_codes(colored), "error ok");
        assert_eq!(strip_ansi_codes("no-ansi"), "no-ansi");
    }
}
