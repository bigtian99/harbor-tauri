mod build;
mod commit;
mod config_cmd;
mod docker;
mod git;
mod history;
mod landing;
mod models;
mod preview_server;
mod utils;

use build::{
    build_and_push, cancel_build, check_dockerfile, detect_frontend_dir, detect_spring_profiles,
    list_npm_scripts, open_directory, package_from_branch,
};
use commit::{get_commit_authors, get_commit_list, get_last_commit};
use config_cmd::{load_config, save_config};
use git::list_git_branches;
use history::{
    clear_build_history, copy_artifact_to_output, delete_artifact_path, delete_build_record,
    get_build_history, save_build_record, update_build_record_image,
};
use landing::{
    fetch_sub_channels, generate_landing_pages, get_bundled_templates_dir, get_temp_dir,
    preview_landing_page, upload_landing_to_ftp,
};
use preview_server::get_preview_server_info;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 启动本地静态预览服务器（仅 127.0.0.1），用于落地页预览
            preview_server::start(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_git_branches,
            get_last_commit,
            get_commit_list,
            get_commit_authors,
            list_npm_scripts,
            detect_frontend_dir,
            detect_spring_profiles,
            check_dockerfile,
            cancel_build,
            package_from_branch,
            build_and_push,
            open_directory,
            save_build_record,
            get_build_history,
            clear_build_history,
            delete_build_record,
            update_build_record_image,
            copy_artifact_to_output,
            delete_artifact_path,
            fetch_sub_channels,
            generate_landing_pages,
            upload_landing_to_ftp,
            get_temp_dir,
            preview_landing_page,
            get_bundled_templates_dir,
            get_preview_server_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
