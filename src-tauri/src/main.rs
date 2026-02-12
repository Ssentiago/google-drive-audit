#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_handle_storage;
mod drive;
mod oauth;
use app_handle_storage::{init_app_handle, init_main_window};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            init_app_handle(app.handle().clone());

            let window = app
                .get_webview_window("main")
                .expect("Main window not found");
            init_main_window(window);

            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            oauth::start_google_oauth,
            oauth::logout,
            oauth::open_url,
            oauth::force_reauth,
            oauth::is_authenticated,
            oauth::get_user_email,
            oauth::get_current_token,
            drive::drive_scan::scan_drive,
            drive::drive_scan::cancel_scan_drive,
            drive::drive_scan::create_and_open_spreadsheet,
            drive::drive_scan::load_scan_cache,
            drive::drive_scan::is_this_folder,
            drive::drive_scan::delete_original_from_parent,
            drive::common_commands::remove_permission,
            drive::common_commands::is_drive_item,
            drive::common_commands::copy_and_clean,
            drive::direct_scan::scan_files_direct,
            drive::direct_scan::copy_file_without_owner,
            drive::drive_audit::audit_drive,
            drive::drive_audit::cancel_audit_drive,
            drive::drive_audit::update_link_access,
            drive::drive_audit::export_employee_data,
            drive::drive_audit::export_all_employees,
            drive::drive_audit::export_links_data,
            drive::folder_cache::save_folder,
            drive::folder_cache::update_folder_name,
            drive::folder_cache::get_saved_folders,
            drive::folder_cache::get_folder_info,
            drive::folder_cache::remove_saved_folder,
            drive::folder_cache::clear_folder_history,
            drive::custom_property::update_custom_property,
            drive::custom_property::read_custom_properties,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
