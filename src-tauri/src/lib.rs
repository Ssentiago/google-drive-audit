mod drive;
mod http_client;
mod oauth;
mod tokens;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            oauth::start_google_oauth,
            oauth::logout,
            oauth::open_url,
            drive::scan_drive,
            drive::remove_permission,
            oauth::force_reauth,
            drive::get_scan_info,
            drive::load_scan_cache,
            drive::create_and_open_spreadsheet,
            drive::copy_and_clean,
            drive::scan_files_direct,
            drive::copy_file_without_owner,
            drive::get_parent_id,
            drive::verify_access,
            drive::audit_drive,
            drive::remove_access,
            drive::update_link_access,
            drive::export_employee_data,
            drive::export_all_employees,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
