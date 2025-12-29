use crate::drive::common_commands::copy_and_clean;
use crate::drive::utils::get_item;
use crate::oauth::get_drive_hub;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug)]
pub struct PermissionInfo {
    pub id: String,
    pub email: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub role: String,
    #[serde(rename = "type")]
    pub perm_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileMetadata {
    pub id: String,
    pub name: String,
    pub url: String,
    pub owner: String,
    pub permissions: Vec<PermissionInfo>,
}

#[tauri::command]
pub async fn scan_files_direct(
    window: tauri::Window,
    app: tauri::AppHandle,
    file_ids: Vec<String>,
) -> Result<Vec<FileMetadata>, String> {
    let mut results = Vec::new();

    for file_id in file_ids {
        window
            .emit("direct_scan_log", &format!("Сканируем: {}", file_id))
            .ok();

        let item = get_item(app.clone(), &file_id).await?;

        let owner = item
            .owners
            .as_ref()
            .and_then(|arr| arr.first())
            .and_then(|o| o.email_address.as_deref())
            .map(|s| s.to_string())
            .unwrap_or("Неизвестно".to_string());

        let permissions: Vec<PermissionInfo> = item
            .permissions
            .unwrap_or(vec![])
            .iter()
            .filter_map(|p| {
                Some(PermissionInfo {
                    id: p.id.clone().unwrap_or("".to_string()),
                    email: p.email_address.clone().unwrap_or("".to_string()),
                    display_name: p.display_name.clone().unwrap_or("".to_string()),
                    role: p.role.clone().unwrap_or("".to_string()),
                    perm_type: p.perm_type.clone().unwrap_or("".to_string()),
                })
            })
            .collect();

        results.push(FileMetadata {
            id: item.id.unwrap_or("".to_string()),
            name: item.name.unwrap_or("".to_string()),
            url: item.web_view_link.unwrap_or("".to_string()),
            owner,
            permissions,
        });
    }

    window
        .emit(
            "direct_scan_log",
            &format!("✅ Готово: {} файлов", results.len()),
        )
        .ok();

    Ok(results)
}

#[tauri::command]
pub async fn copy_file_without_owner(
    window: tauri::Window,
    app: tauri::AppHandle,
    file_id: String,
    file_name: String,
    owner_email: String,
) -> Result<(), String> {
    let drive_item = get_item(app.clone(), &file_id).await?;

    let parent_id = drive_item
        .parents
        .unwrap_or(vec![])
        .first()
        .unwrap_or(&"no_parents".to_string())
        .to_string();

    let new_name = format!("КОПИЯ | {}", file_name);

    window
        .emit("direct_scan_log", &format!("Копируем: {}", file_name))
        .ok();

    copy_and_clean(
        app.clone(),
        window.clone(),
        file_id.clone(),
        new_name.clone(),
        parent_id.clone(),
        vec![owner_email.to_lowercase()],
    )
    .await?;

    window
        .emit(
            "direct_scan_log",
            &format!("✅ Создана копия: {}", new_name),
        )
        .ok();

    Ok(())
}
