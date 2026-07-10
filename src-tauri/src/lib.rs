mod build;
mod commit;
mod config_cmd;
mod db;
mod docker;
mod git;
mod history;
mod landing;
mod models;
mod ops;
mod preview_server;
mod settlement;
mod updater;
mod utils;

use build::{
    build_and_push, cancel_build, check_dockerfile, detect_frontend_dir, detect_spring_profiles,
    list_npm_scripts, open_directory, package_from_branch, push_local_image, list_local_images,
};
use commit::{get_commit_authors, get_commit_diff, get_commit_list, get_last_commit, list_branch_diff_commits};
use config_cmd::{load_config, save_config};
use git::{list_git_branches, list_git_branches_from_url, clone_repo, list_remote_branches, check_remote_merge, merge_remote_branches, get_merge_conflict_diff};
use history::{
    clear_build_history, delete_artifact_path, delete_build_record,
    get_build_history, save_build_record, update_build_record_image,
};
use landing::{
    fetch_sub_channels, fetch_vest_data, generate_landing_pages, generate_vest_landing_pages,
    get_bundled_templates_dir, get_temp_dir,
    get_templates_diagnostic_log_path, read_diagnostic_log,
    preview_landing_page, upload_landing_to_ftp,
    list_template_dirs, list_template_infos, upload_template_zip, delete_template_dir,
};
use preview_server::get_preview_server_info;
use ops::{batch_pack_sub_channels, close_ops_login_window, open_ops_login_window};
use settlement::generate_settlement_statements;
use updater::{check_update, download_and_install, get_app_version};

/// 编译时注入：`OPS_MODE=true tauri build` 构建的版本返回 true，
/// 前端据此动态隐藏非运营菜单。
#[tauri::command]
fn is_ops_mode() -> bool {
    option_env!("OPS_MODE") == Some("true")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            landing::init_bundled_templates_dir(app.handle());
            // 初始化 SQLite 数据库
            if let Err(e) = db::init_db() {
                eprintln!("[JarPorter] 初始化数据库失败: {}", e);
            }
            // 启动本地静态预览服务器（仅 127.0.0.1），用于落地页预览
            preview_server::start(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_ops_mode,
            load_config,
            save_config,
            list_git_branches,
            list_git_branches_from_url,
            clone_repo,
            get_last_commit,
            get_commit_list,
            get_commit_diff,
            get_commit_authors,
            list_branch_diff_commits,
            list_npm_scripts,
            detect_frontend_dir,
            detect_spring_profiles,
            check_dockerfile,
            cancel_build,
            package_from_branch,
            build_and_push,
            push_local_image,
            list_local_images,
            open_directory,
            save_build_record,
            get_build_history,
            clear_build_history,
            delete_build_record,
            update_build_record_image,
            delete_artifact_path,
            fetch_sub_channels,
            fetch_vest_data,
            generate_landing_pages,
            generate_vest_landing_pages,
            upload_landing_to_ftp,
            get_temp_dir,
            preview_landing_page,
            get_bundled_templates_dir,
            get_templates_diagnostic_log_path,
            read_diagnostic_log,
            get_preview_server_info,
            list_template_dirs,
            list_template_infos,
            upload_template_zip,
            delete_template_dir,
            list_remote_branches,
            check_remote_merge,
            merge_remote_branches,
            get_merge_conflict_diff,
            batch_pack_sub_channels,
            open_ops_login_window,
            close_ops_login_window,
            generate_settlement_statements,
            db::get_jar_port,
            db::save_jar_port,
            check_update,
            download_and_install,
            get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
