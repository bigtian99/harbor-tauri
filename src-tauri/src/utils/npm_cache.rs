use crate::models::MAX_CACHE_ENTRIES;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn detect_npm_build_script(project_dir: &Path) -> Result<String, String> {
    let package_json_path = project_dir.join("package.json");
    if !package_json_path.is_file() {
        return Err("package.json 不存在".to_string());
    }

    let content = fs::read_to_string(&package_json_path)
        .map_err(|e| format!("读取 package.json 失败: {}", e))?;

    let package_json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 package.json 失败: {}", e))?;

    let scripts = package_json
        .get("scripts")
        .and_then(|s| s.as_object())
        .ok_or_else(|| "package.json 中没有 scripts 字段".to_string())?;

    // 第一优先：精确匹配常见构建命令名
    let exact_candidates = ["build", "compile", "dist", "production", "release"];
    for candidate in &exact_candidates {
        if scripts.contains_key(*candidate) {
            return Ok(candidate.to_string());
        }
    }

    // 第二优先：以 build 开头的脚本（如 build:prod、build:test），优先选 prod/production
    let build_prefixed: Vec<String> = scripts
        .keys()
        .filter(|k| k.starts_with("build") && k.len() > 5)
        .cloned()
        .collect();

    if !build_prefixed.is_empty() {
        // 优先 prod/production，其次任意一个
        let preferred = [
            "build:prod",
            "build:production",
            "build-prod",
            "build-production",
        ];
        for candidate in &preferred {
            if build_prefixed.iter().any(|s| s == candidate) {
                return Ok(candidate.to_string());
            }
        }
        return Ok(build_prefixed[0].clone());
    }

    // 列出所有可用的 scripts
    let available_scripts: Vec<String> = scripts.keys().cloned().collect();
    Err(format!(
        "package.json 中没有找到构建命令 (build/compile/dist/build:prod/build:test 等)\n可用的 scripts: {}",
        available_scripts.join(", ")
    ))
}

// ── node_modules 缓存 ──────────────────────────────────────────────

pub(crate) fn npm_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("jarporter")
        .join("npm-cache")
}

/// 根据 lock 文件内容生成 hash 作为缓存 key。
/// 在 build_dir 找不到时向上找一层（monorepo 根 lock）。
pub(crate) fn lock_file_hash(build_dir: &Path) -> Option<String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let lock_files = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
    let mut candidates = vec![build_dir.to_path_buf()];
    if let Some(parent) = build_dir.parent() {
        candidates.push(parent.to_path_buf());
    }

    let lock_path = candidates.into_iter().find_map(|dir| {
        lock_files
            .iter()
            .map(|f| dir.join(f))
            .find(|p| p.is_file())
    })?;

    let content = fs::read(&lock_path).ok()?;
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());
    crate::diag::diag_log(
        "build",
        &format!(
            "npm 缓存 key={} lock={}",
            &key[..12.min(key.len())],
            lock_path.display()
        ),
    );
    Some(key)
}

/// 尝试从缓存恢复 node_modules，返回 true 表示成功。
/// 策略：macOS clonefile (`cp -cR`) → 硬链接 (`cp -al`) → 完整复制 (`cp -a`)。
pub(crate) fn try_restore_node_modules(build_dir: &Path, cache_key: &str) -> Result<bool, String> {
    let cache_path = npm_cache_dir().join(cache_key).join("node_modules");
    let target = build_dir.join("node_modules");

    if !cache_path.is_dir() {
        crate::diag::diag_log(
            "build",
            &format!("npm 缓存未命中 path={}", cache_path.display()),
        );
        return Ok(false);
    }

    let src = cache_path.to_str().unwrap();
    let dst = target.to_str().unwrap();
    let started = std::time::Instant::now();

    let try_cp = |args: &[&str]| -> bool {
        if target.exists() {
            let _ = fs::remove_dir_all(&target);
        }
        super::silent_command("cp")
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    // 1) macOS APFS clone  2) 硬链接  3) 完整复制
    let method = if cfg!(target_os = "macos") && try_cp(&["-cR", src, dst]) {
        "clone"
    } else if try_cp(&["-al", src, dst]) {
        "hardlink"
    } else {
        crate::diag::diag_log("build", "硬链接恢复失败，回退完整复制");
        if !try_cp(&["-a", src, dst]) {
            return Err("缓存恢复失败: clone/hardlink/copy 均未成功".to_string());
        }
        "copy"
    };

    let has_content = fs::read_dir(&target)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    if !has_content {
        fs::remove_dir_all(&target).ok();
        return Err("缓存恢复后 node_modules 为空".to_string());
    }

    crate::diag::diag_log(
        "build",
        &format!(
            "npm 缓存命中 hash={} method={} cost_ms={}",
            &cache_key[..12.min(cache_key.len())],
            method,
            started.elapsed().as_millis()
        ),
    );
    Ok(true)
}

/// 将 node_modules 保存到缓存（LRU 策略，最多保留 MAX_CACHE_ENTRIES 个条目）
pub(crate) fn save_node_modules_to_cache(build_dir: &Path, cache_key: &str) {
    let cache_dir = npm_cache_dir();
    let cache_base = cache_dir.join(cache_key);
    let cache_path = cache_base.join("node_modules");
    let source = build_dir.join("node_modules");

    if !source.is_dir() {
        return;
    }

    // 如果缓存已存在（相同 key），更新其修改时间即可
    if cache_path.is_dir() {
        // touch 更新 mtime，标记为最近使用
        super::silent_command("touch").arg(&cache_base).output().ok();
        return;
    }

    // LRU 淘汰：超过上限时删除最旧的条目
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| {
                let mtime = e.metadata().ok()?.modified().ok()?;
                Some((mtime, e.path()))
            })
            .collect();

        // 按修改时间排序，最旧的在前
        dirs.sort_by_key(|(mtime, _)| *mtime);

        // 删除超出上限的旧条目
        let to_remove = dirs
            .len()
            .saturating_sub(MAX_CACHE_ENTRIES.saturating_sub(1));
        for (_, path) in dirs.iter().take(to_remove) {
            crate::diag::diag_log("utils", &format!("淘汰旧缓存: {}", path.display()));
            fs::remove_dir_all(path).ok();
        }
    }

    // 准备目录
    if cache_path.exists() {
        fs::remove_dir_all(&cache_path).ok();
    }
    fs::create_dir_all(&cache_base).ok();

    // 优先硬链接，跨文件系统时回退到复制
    let link_result = super::silent_command("cp")
        .args([
            "-al",
            source.to_str().unwrap(),
            cache_path.to_str().unwrap(),
        ])
        .output();

    match link_result {
        Ok(output) if output.status.success() => {
            crate::diag::diag_log(
                "build",
                &format!("npm 缓存已保存(hardlink) hash={}", cache_key),
            );
        }
        _ => {
            crate::diag::diag_log(
                "build",
                &format!("npm 缓存 hardlink 失败，回退复制 hash={}", cache_key),
            );
            let copy = super::silent_command("cp")
                .args(["-a", source.to_str().unwrap(), cache_path.to_str().unwrap()])
                .output();
            match copy {
                Ok(o) if o.status.success() => {
                    crate::diag::diag_log(
                        "build",
                        &format!("npm 缓存已保存(copy) hash={}", cache_key),
                    );
                }
                Ok(o) => {
                    crate::diag::diag_log(
                        "build",
                        &format!(
                            "npm 缓存保存失败: {}",
                            String::from_utf8_lossy(&o.stderr).trim()
                        ),
                    );
                }
                Err(e) => {
                    crate::diag::diag_log("build", &format!("npm 缓存保存失败: {e}"));
                }
            }
        }
    }
}
