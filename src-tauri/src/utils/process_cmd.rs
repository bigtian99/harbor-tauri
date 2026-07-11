use super::{CANCEL_FLAG, CURRENT_PID};
use super::paths_fs::strip_ansi_codes;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;

pub(crate) fn command_output_text(output: &std::process::Output) -> String {
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    [stdout.trim().to_string(), stderr.trim().to_string()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn command_candidates(command: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        let lower = command.to_ascii_lowercase();
        if lower.ends_with(".exe") || lower.ends_with(".cmd") || lower.ends_with(".bat") {
            return vec![command.to_string()];
        }
        return vec![
            format!("{}.exe", command),
            format!("{}.cmd", command),
            format!("{}.bat", command),
            command.to_string(),
        ];
    }

    #[cfg(not(windows))]
    {
        vec![command.to_string()]
    }
}

fn find_command_in_dir(dir: &Path, command: &str) -> Option<String> {
    command_candidates(command)
        .into_iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
}

pub(crate) fn find_command_path(command: &str) -> Option<String> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }

    let direct = PathBuf::from(command);
    if direct.is_file() {
        return Some(direct.to_string_lossy().to_string());
    }
    if command.contains('/') || command.contains('\\') || direct.is_absolute() {
        if let (Some(parent), Some(name)) = (direct.parent(), direct.file_name()) {
            return find_command_in_dir(parent, &name.to_string_lossy());
        }
        return None;
    }

    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .find_map(|dir| find_command_in_dir(&dir, command))
}

/// 查找 Maven 可执行文件路径
pub(crate) fn find_maven_path() -> Option<String> {
    // 1. 检查环境变量
    if let Some(m2_home) = std::env::var_os("M2_HOME") {
        if let Some(path) = find_command_in_dir(&PathBuf::from(m2_home).join("bin"), "mvn") {
            return Some(path);
        }
    }
    if let Some(maven_home) = std::env::var_os("MAVEN_HOME") {
        if let Some(path) = find_command_in_dir(&PathBuf::from(maven_home).join("bin"), "mvn") {
            return Some(path);
        }
    }

    // 2. PATH 查找，Windows 下会覆盖 mvn.cmd / mvn.bat
    if let Some(path) = find_command_path("mvn") {
        return Some(path);
    }

    // 3. 检查用户 home 目录下的常见安装位置
    if let Some(home) = dirs::home_dir() {
        // SDKMAN
        if let Some(path) =
            find_command_in_dir(&home.join(".sdkman/candidates/maven/current/bin"), "mvn")
        {
            return Some(path);
        }
        // Homebrew (Apple Silicon)
        if let Some(path) = find_command_in_dir(Path::new("/opt/homebrew/bin"), "mvn") {
            return Some(path);
        }
        // Homebrew (Intel)
        if let Some(path) = find_command_in_dir(Path::new("/usr/local/bin"), "mvn") {
            return Some(path);
        }
    }

    // 4. 检查 IntelliJ IDEA 内置 Maven
    if let Some(home) = dirs::home_dir() {
        let idea_dir = home.join("Library/Application Support/JetBrains");
        if idea_dir.exists() {
            // 按版本倒序，优先使用最新版本
            if let Ok(entries) = fs::read_dir(&idea_dir) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with("IntelliJIdea"))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                versions.sort_by(|a, b| b.cmp(a)); // 倒序

                for version in versions {
                    let mvn_dir = idea_dir
                        .join(&version)
                        .join("plugins/maven/lib/maven3/bin");
                    if let Some(path) = find_command_in_dir(&mvn_dir, "mvn") {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

/// 查找 Docker 可执行文件路径
pub(crate) fn find_docker_path() -> Option<String> {
    // 1. 直接从 PATH 查找（终端启动时有效）
    if let Some(path) = find_command_path("docker") {
        return Some(path);
    }

    // 2. Homebrew (Apple Silicon)
    let brew_arm = PathBuf::from("/opt/homebrew/bin/docker");
    if brew_arm.exists() {
        return Some(brew_arm.to_string_lossy().to_string());
    }
    // 3. Homebrew (Intel)
    let brew_intel = PathBuf::from("/usr/local/bin/docker");
    if brew_intel.exists() {
        return Some(brew_intel.to_string_lossy().to_string());
    }
    // 4. Docker.app bundle 内部路径
    let bundle = PathBuf::from("/Applications/Docker.app/Contents/Resources/bin/docker");
    if bundle.exists() {
        return Some(bundle.to_string_lossy().to_string());
    }

    None
}

pub(crate) fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

pub(crate) fn silent_docker_command() -> Command {
    let docker_bin = find_docker_path().unwrap_or_else(|| "docker".to_string());

    let mut command = silent_command(docker_bin);
    command
        .env("DOCKER_CLI_HINTS", "false")
        .env("DOCKER_SCAN_SUGGEST", "false");
    command
}

pub(crate) fn run_command(current_dir: &Path, command: &str, args: &[&str]) -> Result<String, String> {
    if CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("构建已取消".to_string());
    }

    // 对 mvn 命令特殊处理，查找完整路径
    let actual_command = if command == "mvn" {
        find_maven_path().unwrap_or_else(|| "mvn".to_string())
    } else {
        find_command_path(command).unwrap_or_else(|| command.to_string())
    };

    // 使用 spawn 替代 output，以便追踪 PID 支持取消
    let child = match silent_command(&actual_command)
        .args(args)
        .current_dir(current_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => {
            *CURRENT_PID.lock().unwrap() = Some(c.id());
            c
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let full_cmd = format!("{} {}", actual_command, args.join(" "));

            #[cfg(windows)]
            let fallback = silent_command("cmd")
                .args(["/C", &full_cmd])
                .current_dir(current_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();

            #[cfg(not(windows))]
            let fallback = silent_command("sh")
                .args(["-l", "-c", &full_cmd])
                .current_dir(current_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();

            match fallback {
                Ok(c) => {
                    *CURRENT_PID.lock().unwrap() = Some(c.id());
                    c
                }
                Err(e2) => return Err(format!("启动命令失败 {}: {}", actual_command, e2)),
            }
        }
        Err(e) => return Err(format!("启动命令失败 {}: {}", actual_command, e)),
    };

    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待命令结束失败: {}", e))?;

    *CURRENT_PID.lock().unwrap() = None;

    if CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("构建已取消".to_string());
    }

    let details = command_output_text(&output);

    if output.status.success() {
        Ok(details)
    } else if details.is_empty() {
        Err(format!("命令执行失败: {} {}", command, args.join(" ")))
    } else {
        Err(format!(
            "命令执行失败: {} {}\n{}",
            command,
            args.join(" "),
            details
        ))
    }
}

pub(crate) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    run_command(repo_path, "git", args)
}

pub(crate) fn repo_root_for(repo_path: &Path) -> Result<PathBuf, String> {
    git_output(repo_path, &["rev-parse", "--show-toplevel"])
        .map(|output| PathBuf::from(output.trim()))
        .map_err(|e| format!("不是有效的 Git 仓库: {}", e))
}
