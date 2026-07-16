#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_handle_storage;
mod drive;
mod oauth;
mod updater;
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
            oauth::get_app_version,
            drive::common_commands::remove_permission,
            drive::common_commands::is_drive_item,
            drive::common_commands::copy_and_clean,
            drive::audit_drive::audit_drive,
            drive::audit_drive::delete_property,
            drive::audit_drive::is_perm_exists,
            drive::audit_drive::cancel_audit_drive,
            drive::audit_drive::export_links_data,
            drive::audit_drive::export_all_employees,
            drive::audit_drive::export_employee_data,
            drive::audit_drive::is_this_folder,
            drive::audit_drive::delete_original_from_parent,
            drive::folder_cache::save_folder,
            drive::folder_cache::update_folder_name,
            drive::folder_cache::get_saved_folders,
            drive::folder_cache::get_folder_info,
            drive::folder_cache::remove_saved_folder,
            drive::folder_cache::clear_folder_history,
            updater::check_for_updates,
            updater::download_update,
            updater::is_update_downloaded,
            updater::get_downloads_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
