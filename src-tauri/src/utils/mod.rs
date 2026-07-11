mod config_io;
mod npm_cache;
mod paths_fs;
mod process_cmd;

use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

pub(crate) static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);
pub(crate) static CURRENT_PID: Mutex<Option<u32>> = Mutex::new(None);

pub(crate) use config_io::*;
pub(crate) use npm_cache::*;
pub(crate) use paths_fs::*;
pub(crate) use process_cmd::*;

#[cfg(test)]
mod tests {
    use crate::models::HarborConfig;
    use std::path::Path;

    fn utils_src(file_name: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/utils")
            .join(file_name);
        std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!("read {}: {}", path.display(), e)
        })
    }


    #[test]
    fn normalize_config_does_not_persist_ops_authorization() {
        let mut config = HarborConfig::default();
        config.ops_authorization = Some("secret-token".to_string());

        let normalized = super::normalize_config(config);
        let serialized = serde_json::to_string(&normalized).expect("serialize config");

        assert!(
            normalized.ops_authorization.is_none(),
            "loaded config should not expose a saved ops Authorization token"
        );
        assert!(
            !serialized.contains("ops_authorization"),
            "saved config should not include an empty ops Authorization field"
        );
    }

    #[test]
    fn docker_command_helpers_do_not_touch_desktop_gui() {
        let source = utils_src("process_cmd.rs");
        let open_command = ["Command::new(\"", "open", "\")"].concat();
        let osascript_command = ["Command::new(\"", "osascript", "\")"].concat();
        let hide_helper = ["hide", "_docker", "_desktop"].concat();

        assert!(
            !source.contains(&open_command),
            "Docker helpers must not launch Docker Desktop via macOS open"
        );
        assert!(
            !source.contains(&osascript_command),
            "Docker helpers must not manipulate Docker Desktop via AppleScript"
        );
        assert!(
            !source.contains(&hide_helper),
            "Docker helpers must not hide or refocus Docker Desktop"
        );
    }

    #[test]
    fn windows_child_processes_use_no_window_helper() {
        let source = utils_src("process_cmd.rs");
        let helper_name = ["pub(crate) fn ", "silent", "_command", "("].concat();
        let flag_name = ["CREATE", "_NO", "_WINDOW"].concat();
        let flag_call = ["creation_flags(", &flag_name, ")"].concat();
        assert!(
            source.contains(&helper_name),
            "utils should expose one helper for hidden child processes"
        );
        assert!(
            source.contains(&flag_name) && source.contains(&flag_call),
            "silent_command should set CREATE_NO_WINDOW on Windows"
        );

        for file_name in [
            "build/package.rs",
            "build/package_worktree.rs",
            "build/detect.rs",
            "commit.rs",
            "git.rs",
            "landing/mod.rs",
        ] {
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join(file_name);
            if !path.is_file() {
                // 并行拆分期间路径可能短暂变化
                continue;
            }
            let module_source = std::fs::read_to_string(&path).unwrap_or_else(|e| {
                panic!("read {}: {}", path.display(), e)
            });
            // package.rs 可能仅为编排、无子进程；有 spawn 的文件须走 silent_command
            if file_name == "build/package.rs" && !module_source.contains("Command::") {
                continue;
            }
            assert!(
                module_source.contains("silent_command("),
                "{file_name} should route Windows-visible child processes through silent_command"
            );
        }
    }

    #[test]
    fn maven_resolution_supports_windows_command_shims() {
        let source = utils_src("process_cmd.rs");
        let windows_cmd_candidate = ["format!(\"{}", ".cmd\", command)"].concat();
        let maven_path_lookup = ["find_command_path(\"", "mvn", "\")"].concat();
        let split_paths = ["std::env::", "split_paths"].concat();
        let windows_shell = ["silent", "_command(\"", "cmd", "\")"].concat();

        assert!(
            source.contains(&windows_cmd_candidate) && source.contains(&maven_path_lookup),
            "Maven lookup should include the Windows command shim"
        );
        assert!(
            source.contains(&split_paths),
            "PATH lookup should use the standard cross-platform path splitter"
        );
        assert!(
            source.contains(&windows_shell),
            "Missing-command fallback should use hidden cmd /C on Windows"
        );
    }
}
