use crate::models::{AuthorInfo, CommitDiffResult, CommitInfo, CommitListResult, LastCommitInfo};
use crate::utils::{git_output, repo_root_for, silent_command};
use std::path::PathBuf;

/// 将 git remote URL 转换为 commit 页面 URL
pub(crate) fn remote_url_to_commit_url(remote_url: &str, commit_hash: &str) -> Option<String> {
    // 移除 .git 后缀
    let url = remote_url.trim_end_matches(".git");

    // 处理 SSH 格式: git@gitee.com:user/repo.git
    if url.starts_with("git@") {
        let without_prefix = url.strip_prefix("git@")?;
        let parts: Vec<&str> = without_prefix.splitn(2, ':').collect();
        if parts.len() == 2 {
            let host = parts[0];
            let path = parts[1].trim_start_matches('/');
            return Some(format!("https://{}/{}/commit/{}", host, path, commit_hash));
        }
    }

    // 处理 HTTPS 格式: https://gitee.com/user/repo.git
    if url.starts_with("https://") || url.starts_with("http://") {
        let without_protocol = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))?;
        return Some(format!(
            "https://{}/commit/{}",
            without_protocol, commit_hash
        ));
    }

    None
}

#[tauri::command]
pub async fn get_last_commit(
    repo_path: String,
    branch: Option<String>,
) -> Result<LastCommitInfo, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let branch = branch.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let rev = if branch.trim().is_empty() {
            "HEAD".to_string()
        } else {
            branch.trim().to_string()
        };
        let output = git_output(
            &repo_root,
            &["log", "-1", "--format=%H%n%s%n%an%n%ae%n%ai", &rev],
        )?;
        let lines: Vec<&str> = output.lines().collect();
        if lines.len() < 5 {
            return Err("无法解析提交信息".to_string());
        }
        // 将 ISO 8601 日期转换为本地时间格式
        let date_str = lines[4].to_string();
        let formatted_date = chrono::DateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S %z")
            .map(|dt| {
                let local: chrono::DateTime<chrono::Local> = dt.with_timezone(&chrono::Local);
                local.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or(date_str);
        // 获取远程仓库 URL 并生成提交链接
        let commit_url = git_output(&repo_root, &["remote", "get-url", "origin"])
            .ok()
            .and_then(|url| remote_url_to_commit_url(&url.trim(), &lines[0]));
        Ok(LastCommitInfo {
            hash: lines[0].to_string(),
            short_hash: lines[0][..8.min(lines[0].len())].to_string(),
            message: lines[1].to_string(),
            author: lines[2].to_string(),
            date: formatted_date,
            url: commit_url,
        })
    })
    .await
    .map_err(|e| format!("读取提交信息线程异常: {}", e))?
}

#[tauri::command]
pub async fn get_commit_authors(
    repo_path: String,
    branch: Option<String>,
) -> Result<Vec<AuthorInfo>, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let branch = branch.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let rev = if branch.trim().is_empty() {
            "HEAD".to_string()
        } else {
            branch.trim().to_string()
        };

        // 获取所有提交的作者信息（名字和邮箱）
        let output = git_output(&repo_root, &["log", "--format=%an%n%ae", &rev])?;

        // 统计每个 (名字, 邮箱) 的提交次数，取最新的名字
        let mut author_counts: std::collections::HashMap<(String, String), usize> =
            std::collections::HashMap::new();
        let lines: Vec<&str> = output.lines().collect();
        for chunk in lines.chunks(2) {
            if chunk.len() < 2 {
                continue;
            }
            let name = chunk[0].trim().to_string();
            let email = chunk[1].trim().to_string();
            if !name.is_empty() {
                *author_counts.entry((name, email)).or_insert(0) += 1;
            }
        }

        // 转换为 AuthorInfo 列表并按提交次数排序
        let mut authors: Vec<AuthorInfo> = author_counts
            .into_iter()
            .map(|((name, email), count)| AuthorInfo { name, email, count })
            .collect();
        authors.sort_by(|a, b| b.count.cmp(&a.count));

        Ok(authors)
    })
    .await
    .map_err(|e| format!("获取提交者列表线程异常: {}", e))?
}

#[tauri::command]
pub async fn get_commit_list(
    repo_path: String,
    branch: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
    author_filter: Option<String>,
    message_filter: Option<String>,
) -> Result<CommitListResult, String> {
    let repo_path = PathBuf::from(repo_path);
    if !repo_path.is_dir() {
        return Err(format!("仓库路径不是目录: {}", repo_path.display()));
    }

    let branch = branch.unwrap_or_default();
    let author_filter = author_filter.unwrap_or_default();
    let message_filter = message_filter.unwrap_or_default();
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(10).max(1).min(50);

    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let rev = if branch.trim().is_empty() {
            "HEAD".to_string()
        } else {
            branch.trim().to_string()
        };

        // 构建 git log 命令，支持搜索
        let mut git_args = vec![
            "log".to_string(),
            "--format=%H%n%s%n%an%n%ae%n%ai".to_string(),
            rev.clone(),
        ];

        // 添加作者过滤
        if !author_filter.trim().is_empty() {
            git_args.push(format!("--author={}", author_filter.trim()));
        }

        // 添加提交信息过滤
        if !message_filter.trim().is_empty() {
            git_args.push(format!("--grep={}", message_filter.trim()));
        }

        // 获取过滤后的总提交数
        let mut count_args = vec!["rev-list".to_string(), "--count".to_string()];
        count_args.extend(git_args.iter().skip(2).cloned());
        let count_output = git_output(
            &repo_root,
            &count_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        )?;
        let total: usize = count_output.trim().parse().unwrap_or(0);

        // 获取远程仓库 URL
        let remote_url = git_output(&repo_root, &["remote", "get-url", "origin"])
            .ok()
            .map(|u| u.trim().to_string());

        // 添加分页参数
        let skip = (page - 1) * page_size;
        git_args.insert(1, format!("-{}", page_size));
        git_args.insert(2, format!("--skip={}", skip));

        let output = git_output(
            &repo_root,
            &git_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        )?;

        let mut commits = Vec::new();
        let lines: Vec<&str> = output.lines().collect();
        for chunk in lines.chunks(5) {
            if chunk.len() < 5 {
                continue;
            }
            let hash = chunk[0].to_string();
            let short_hash = hash[..8.min(hash.len())].to_string();
            let message = chunk[1].to_string();
            let author = chunk[2].to_string();
            let email = chunk[3].to_string();
            let date_str = chunk[4].to_string();

            let formatted_date =
                chrono::DateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S %z")
                    .map(|dt| {
                        let local: chrono::DateTime<chrono::Local> =
                            dt.with_timezone(&chrono::Local);
                        local.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or(date_str);

            let url = remote_url
                .as_ref()
                .and_then(|u| remote_url_to_commit_url(u, &hash));

            commits.push(CommitInfo {
                hash,
                short_hash,
                message,
                author,
                email,
                date: formatted_date,
                url,
            });
        }

        Ok(CommitListResult {
            commits,
            total,
            page,
            page_size,
        })
    })
    .await
    .map_err(|e| format!("读取提交列表线程异常: {}", e))?
}

/// 列出 source 分支相对 target 分支多出的提交（git log target..source）。
/// 用于分支合并面板展示"合并会带入哪些提交"。最多返回 50 条。
#[tauri::command]
pub async fn list_branch_diff_commits(
    repo_path: String,
    source: String,
    target: String,
) -> Result<Vec<CommitInfo>, String> {
    let repo_path = PathBuf::from(repo_path);
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("源分支和目标分支都不能为空".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        // URL 合并场景可能来自浅克隆缓存仓库。差异提交需要完整历史，否则 target..source
        // 可能少算甚至返回空。这里先确保远程引用和历史完整。
        let is_shallow = git_output(&repo_root, &["rev-parse", "--is-shallow-repository"])
            .map(|s| s.trim() == "true")
            .unwrap_or(false);
        let fetch_args = if is_shallow {
            vec!["fetch", "--all", "--prune", "--unshallow"]
        } else {
            vec!["fetch", "--all", "--prune"]
        };
        let _ = silent_command("git")
            .args(fetch_args)
            .current_dir(&repo_root)
            .output();

        let rev_range = format!("{target}..{source}");
        let output = git_output(
            &repo_root,
            &["log", "-50", "--format=%H%n%s%n%an%n%ae%n%ai", &rev_range],
        )?;
        let remote_url = git_output(&repo_root, &["remote", "get-url", "origin"])
            .ok()
            .map(|u| u.trim().to_string());

        let mut commits = Vec::new();
        let lines: Vec<&str> = output.lines().collect();
        for chunk in lines.chunks(5) {
            if chunk.len() < 5 {
                continue;
            }
            let hash = chunk[0].to_string();
            let short_hash = hash[..8.min(hash.len())].to_string();
            let message = chunk[1].to_string();
            let author = chunk[2].to_string();
            let email = chunk[3].to_string();
            let date_str = chunk[4].to_string();
            let formatted_date =
                chrono::DateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S %z")
                    .map(|dt| {
                        let local: chrono::DateTime<chrono::Local> = dt.with_timezone(&chrono::Local);
                        local.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or(date_str);
            let url = remote_url
                .as_ref()
                .and_then(|u| remote_url_to_commit_url(u, &hash));
            commits.push(CommitInfo {
                hash,
                short_hash,
                message,
                author,
                email,
                date: formatted_date,
                url,
            });
        }
        Ok(commits)
    })
    .await
    .map_err(|e| format!("读取分支差异提交线程异常: {e}"))?
}

#[tauri::command]
pub async fn get_commit_diff(
    repo_path: String,
    commit_hash: String,
) -> Result<CommitDiffResult, String> {
    let repo_path = PathBuf::from(repo_path);
    let commit_hash = commit_hash.trim().to_string();
    if commit_hash.is_empty() {
        return Err("提交 hash 不能为空".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = repo_root_for(&repo_path)?;
        let verified = git_output(
            &repo_root,
            &["rev-parse", "--verify", &format!("{commit_hash}^{{commit}}")],
        )?;
        let hash = verified.trim().to_string();
        let diff = git_output(
            &repo_root,
            &[
                "show",
                "--format=",
                "--find-renames",
                "--patch",
                "--no-ext-diff",
                "--no-color",
                &hash,
            ],
        )?;
        Ok(CommitDiffResult { hash, diff })
    })
    .await
    .map_err(|e| format!("读取提交 diff 线程异常: {e}"))?
}
