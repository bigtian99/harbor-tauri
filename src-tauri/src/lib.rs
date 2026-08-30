mod build;
mod commit;
mod config_cmd;
mod db;
mod diag;
mod docker;
mod git;
mod history;
mod landing;
mod kubesphere;
mod models;
mod ops;
mod preview_server;
mod privacy;
mod settlement;
mod updater;
mod utils;

use build::{
    build_and_push, cancel_build, cancel_bt_java_deploy, cancel_bt_php_deploy, check_dockerfile,
    detect_frontend_dir, detect_spring_profiles, get_bt_temp_login_url, list_bt_java_projects,
    list_bt_php_sites, list_local_images, list_npm_scripts, open_directory, open_external_url,
    package_from_branch,
    push_local_image, remove_local_image, restart_bt_java_project, stop_bt_java_project,
    stop_bt_php_site, upload_and_restart_bt_java_project, upload_bt_java_jar, upload_bt_php_site,
    warmup_bt_ftp,
};
use commit::{
    get_commit_authors, get_commit_diff, get_commit_list, get_last_commit, list_branch_diff_commits,
};
use config_cmd::{
    clear_git_records, derive_maven_repo_from_home, load_config, resolve_maven_settings, save_config,
};
use diag::{
    export_diagnostic_log, get_templates_diagnostic_log_path, list_diagnostic_log_dates,
    read_diagnostic_log, write_diagnostic_log,
};
use git::{
    check_remote_merge, clone_repo, get_git_remote_url, get_latest_tag, get_merge_conflict_diff,
    match_git_repo_paths,
    list_git_branches, list_git_branches_from_url, list_remote_branches, merge_remote_branches,
};
use history::{
    clear_build_history, delete_artifact_path, delete_build_record, get_build_history,
    save_build_record, update_build_record_image, update_build_record_push,
};

use kubesphere::{
    ks_create_deployment, ks_list_deployment_revisions, ks_list_deployments, ks_list_namespaces,
    ks_create_configmap, ks_create_configmap_yaml, ks_get_configmap, ks_list_configmaps,
    ks_replace_configmap,
    ks_connect, ks_get_deployment_edit, ks_get_pod_logs, ks_login, ks_logout, ks_preview_configmap,
    ks_preview_deployment, ks_update_deployment, ks_update_image,
};
use landing::{
    delete_template_dir, fetch_sub_channels, fetch_vest_data, generate_landing_pages,
    generate_vest_landing_pages, get_bundled_templates_dir, get_temp_dir, list_template_dirs,
    list_template_infos, preview_landing_page, upload_landing_to_ftp, upload_template_zip,
};
use ops::{batch_pack_sub_channels, close_ops_login_window, open_ops_login_window};
use preview_server::{
    ensure_preview_server_started, get_preview_server_info, stop_preview_server,
};
use privacy::{
    clear_privacy_uploads, delete_privacy_uploads, download_privacy_ftp, list_privacy_uploads,
    parse_privacy_target_url, preview_privacy_ftp, upload_privacy_html,
};
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
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            diag::init(app.handle());
            landing::init_bundled_templates_dir(app.handle());
            // 初始化 SQLite 数据库
            if let Err(e) = db::init_db() {
                diag::diag_log("db", &format!("初始化数据库失败: {e}"));
            }
            // 初始化本地静态预览服务器托管状态；真正服务按需启动
            preview_server::init(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_ops_mode,
            ks_connect,
            ks_login,
            ks_list_namespaces,
            ks_list_deployments,
            ks_list_deployment_revisions,
            ks_get_pod_logs,
            ks_update_image,
            ks_get_deployment_edit,
            ks_update_deployment,
            ks_create_deployment,
            ks_preview_deployment,
            ks_list_configmaps,
            ks_get_configmap,
            ks_create_configmap,
            ks_create_configmap_yaml,
            ks_replace_configmap,
            ks_preview_configmap,
            ks_logout,
            load_config,
            save_config,
            resolve_maven_settings,
            derive_maven_repo_from_home,
            clear_git_records,
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
            list_bt_java_projects,
            list_bt_php_sites,
            get_bt_temp_login_url,
            restart_bt_java_project,
            stop_bt_java_project,
            upload_bt_java_jar,
            upload_bt_php_site,
            upload_and_restart_bt_java_project,
            stop_bt_php_site,
            cancel_bt_java_deploy,
            cancel_bt_php_deploy,
            warmup_bt_ftp,
            build_and_push,
            push_local_image,
            list_local_images,
            remove_local_image,
            open_directory,
            save_build_record,
            get_build_history,
            clear_build_history,
            delete_build_record,
            update_build_record_image,
            update_build_record_push,
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
            list_diagnostic_log_dates,
            export_diagnostic_log,
            write_diagnostic_log,
            ensure_preview_server_started,
            stop_preview_server,
            get_preview_server_info,
            list_template_dirs,
            list_template_infos,
            upload_template_zip,
            delete_template_dir,
            list_remote_branches,
            check_remote_merge,
            merge_remote_branches,
            get_merge_conflict_diff,
            get_latest_tag,
            get_git_remote_url,
            match_git_repo_paths,
            batch_pack_sub_channels,
            open_ops_login_window,
            close_ops_login_window,
            upload_privacy_html,
            parse_privacy_target_url,
            preview_privacy_ftp,
            download_privacy_ftp,
            list_privacy_uploads,
            delete_privacy_uploads,
            clear_privacy_uploads,
            generate_settlement_statements,
            db::get_jar_port,
            db::save_jar_port,
            check_update,
            download_and_install,
            get_app_version,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
