mod config_cmd;
mod diag;
mod landing;
mod models;
mod ops;
mod preview_server;
mod privacy;
mod settlement;
mod sysopen;
mod updater;
mod utils;

use config_cmd::{load_config, save_config};
use diag::{
    export_diagnostic_log, get_templates_diagnostic_log_path, list_diagnostic_log_dates,
    read_diagnostic_log, write_diagnostic_log,
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
use sysopen::{open_directory, open_external_url};
use updater::{check_update, download_and_install, get_app_version};

/// 编译时注入：`OPS_MODE=true tauri build` 构建的版本返回 true。
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
            // 初始化本地静态预览服务器托管状态；真正服务按需启动
            preview_server::init(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_ops_mode,
            load_config,
            save_config,
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
            check_update,
            download_and_install,
            get_app_version,
            open_directory,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
