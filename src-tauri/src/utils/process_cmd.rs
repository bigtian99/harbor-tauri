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
    find_maven_path_from("")
}

/// `maven_home` 非空时优先用 `{home}/bin/mvn`
pub(crate) fn find_maven_path_from(maven_home: &str) -> Option<String> {
    let home = maven_home.trim();
    if !home.is_empty() {
        if let Some(path) = find_command_in_dir(&PathBuf::from(home).join("bin"), "mvn") {
            return Some(path);
        }
    }
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

/// Maven 打包用 JDK：优先环境变量 JAVA_HOME；否则在 macOS 上优先选 21 / 17。
/// 避免 Homebrew mvn 默认挂到过新的 OpenJDK（如 26）导致 Lombok `TypeTag :: UNKNOWN`。
pub(crate) fn resolve_maven_java_home() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if java_bin_exists(&path) {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for ver in ["21", "17"] {
            let output = silent_command("/usr/libexec/java_home")
                .args(["-v", ver])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output();
            if let Ok(output) = output {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        let home = PathBuf::from(&path);
                        if java_bin_exists(&home) {
                            return Some(home);
                        }
                    }
                }
            }
        }
    }

    None
}

fn apply_maven_java_home(command: &mut Command) {
    let Some(java_home) = resolve_maven_java_home() else {
        return;
    };
    crate::diag::diag_log(
        "build",
        &format!("mvn using JAVA_HOME={}", java_home.display()),
    );
    command.env("JAVA_HOME", &java_home);
    let java_bin = java_home.join("bin");
    if let Some(bin) = java_bin.to_str() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let new_path = match std::env::var_os("PATH") {
            Some(old) => {
                let old_s = old.to_string_lossy();
                format!("{bin}{sep}{old_s}")
            }
            None => bin.to_string(),
        };
        command.env("PATH", new_path);
    }
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
    run_command_inner(current_dir, command, args, true, "")
}

/// `-Dmaven.repo.local` / `-s {maven_home}/conf/settings.xml`
pub(crate) fn maven_invoke_prefix(maven_home: &str, local_repo: &str) -> Vec<String> {
    let mut extra = Vec::new();
    let repo = local_repo.trim();
    if !repo.is_empty() {
        extra.push(format!("-Dmaven.repo.local={repo}"));
    }
    let home = maven_home.trim();
    if !home.is_empty() {
        let settings = PathBuf::from(home).join("conf").join("settings.xml");
        if settings.is_file() {
            extra.push("-s".to_string());
            extra.push(settings.to_string_lossy().to_string());
        }
    }
    extra
}

/// 按配置的 Maven Home / 本地仓库执行 mvn。
pub(crate) fn run_maven(
    current_dir: &Path,
    args: &[&str],
    maven_home: &str,
    local_repo: &str,
) -> Result<String, String> {
    let prefix = maven_invoke_prefix(maven_home, local_repo);
    let prefix_refs: Vec<&str> = prefix.iter().map(String::as_str).collect();
    let mut all_args = prefix_refs;
    all_args.extend_from_slice(args);
    let bin = find_maven_path_from(maven_home).unwrap_or_else(|| "mvn".to_string());
    crate::diag::diag_log(
        "build",
        &format!(
            "run_maven bin={} home={} local_repo={} args={}",
            bin,
            maven_home.trim(),
            local_repo.trim(),
            all_args.join(" ")
        ),
    );
    run_command_inner(current_dir, "mvn", &all_args, true, maven_home)
}

/// 不受构建取消标志影响的命令执行（选仓、列分支等 UI 读操作）。
pub(crate) fn run_command_no_cancel(
    current_dir: &Path,
    command: &str,
    args: &[&str],
) -> Result<String, String> {
    run_command_inner(current_dir, command, args, false, "")
}

fn run_command_inner(
    current_dir: &Path,
    command: &str,
    args: &[&str],
    check_cancel: bool,
    maven_home: &str,
) -> Result<String, String> {
    if check_cancel && CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("构建已取消".to_string());
    }

    // 对 mvn 命令特殊处理，查找完整路径
    let actual_command = if command == "mvn" {
        if maven_home.trim().is_empty() {
            find_maven_path()
        } else {
            find_maven_path_from(maven_home)
        }
        .unwrap_or_else(|| "mvn".to_string())
    } else {
        find_command_path(command).unwrap_or_else(|| command.to_string())
    };

    // 使用 spawn 替代 output，以便追踪 PID 支持取消
    let mut cmd = silent_command(&actual_command);
    cmd.args(args)
        .current_dir(current_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if command == "mvn" {
        apply_maven_java_home(&mut cmd);
    }

    let child = match cmd.spawn()
    {
        Ok(c) => {
            *CURRENT_PID.lock().unwrap() = Some(c.id());
            c
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let full_cmd = format!("{} {}", actual_command, args.join(" "));

            #[cfg(windows)]
            let fallback = {
                let mut fallback_cmd = silent_command("cmd");
                fallback_cmd
                    .args(["/C", &full_cmd])
                    .current_dir(current_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                if command == "mvn" {
                    apply_maven_java_home(&mut fallback_cmd);
                }
                fallback_cmd.spawn()
            };

            #[cfg(not(windows))]
            let fallback = {
                let mut fallback_cmd = silent_command("sh");
                fallback_cmd
                    .args(["-l", "-c", &full_cmd])
                    .current_dir(current_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                if command == "mvn" {
                    apply_maven_java_home(&mut fallback_cmd);
                }
                fallback_cmd.spawn()
            };

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

    if check_cancel && CANCEL_FLAG.load(Ordering::SeqCst) {
        return Err("构建已取消".to_string());
    }

    let details = command_output_text(&output);

    if output.status.success() {
        Ok(details)
    } else if details.is_empty() {
        Err(format!("命令执行失败: {} {}", command, args.join(" ")))
    } else {
        let mut msg = format!(
            "命令执行失败: {} {}\n{}",
            command,
            args.join(" "),
            details
        );
        if command == "mvn" && details.contains("TypeTag :: UNKNOWN") {
            msg.push_str(
                "\n\n提示: Lombok 与当前 JDK 不兼容（常见于 Homebrew 默认 OpenJDK 22+）。\
请安装 JDK 21，或设置 JAVA_HOME 指向 JDK 21/17 后重试。",
            );
        }
        Err(msg)
    }
}

pub(crate) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    run_command(repo_path, "git", args)
}

pub(crate) fn git_output_no_cancel(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    run_command_no_cancel(repo_path, "git", args)
}

pub(crate) fn repo_root_for(repo_path: &Path) -> Result<PathBuf, String> {
    // 选仓/校验仓库是 UI 读操作，不能被上一次「构建已取消」标志误伤
    git_output_no_cancel(repo_path, &["rev-parse", "--show-toplevel"])
        .map(|output| PathBuf::from(output.trim()))
        .map_err(|e| format!("不是有效的 Git 仓库: {}", e))
}

#[cfg(test)]
mod maven_config_tests {
    use super::{find_maven_path_from, maven_invoke_prefix};
    use std::path::PathBuf;

    #[test]
    fn maven_invoke_prefix_adds_local_repo() {
        let prefix = maven_invoke_prefix("", "/tmp/custom-repo");
        assert_eq!(
            prefix,
            vec!["-Dmaven.repo.local=/tmp/custom-repo".to_string()]
        );
    }

    #[test]
    fn maven_invoke_prefix_adds_settings_when_home_has_conf() {
        let home = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // 用本仓库不存在的路径时不应加 -s；用用户机器上的真实 Maven 才加
        let prefix = maven_invoke_prefix(home.to_str().unwrap(), "");
        assert!(prefix.is_empty() || !prefix.contains(&"-s".to_string()) || {
            // 若碰巧有 conf/settings.xml 则允许
            home.join("conf").join("settings.xml").is_file()
        });
    }

    #[test]
    fn find_maven_path_from_prefers_configured_home() {
        let home = "/Users/daijunxiong/app/apache-maven-3.9.9";
        if PathBuf::from(home).join("bin").join("mvn").is_file() {
            let found = find_maven_path_from(home).expect("should find configured mvn");
            assert!(found.contains("apache-maven-3.9.9"));
        }
    }
}

