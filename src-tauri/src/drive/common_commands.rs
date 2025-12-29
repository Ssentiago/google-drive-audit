use crate::drive::custom_property::update_custom_property;
use crate::drive::utils::{get_item, list_folder_contents, DriveItem};
use crate::oauth::get_drive_hub;
use google_drive3::api::File;
use maplit::hashmap;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::Emitter;

#[tauri::command]
pub async fn remove_permission(
    app: tauri::AppHandle,
    window: tauri::Window,
    file_id: String,
    permission_id: String,
) -> Result<(), String> {
    let drive_hub = get_drive_hub(&app).await?;

    let response = drive_hub
        .permissions()
        .delete(&file_id, &permission_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .doit()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                window
                    .emit("scan_log", &format!("Удалён доступ: {}", permission_id))
                    .ok();
                Ok(())
            } else if status == 404 || status == 403 {
                window
                    .emit(
                        "scan_log",
                        &format!("⚠️ Доступ уже удалён: {}", permission_id),
                    )
                    .ok();
                Ok(())
            } else {
                Err(format!("API error: {}", status))
            }
        }
        Err(err) => {
            window
                .emit("scan_log", &format!("Ошибка запроса: {}", err))
                .ok();
            Err(format!("Request failed: {}", err))
        }
    }
}

async fn copy_item_recursive(
    item_id: &str,
    new_parent_id: &str,
    new_name: &str,
    suspicious_emails: &[String],
    window: &tauri::Window,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let hub = get_drive_hub(&app).await?;

    let item = get_item(app.clone(), item_id).await?;

    if item.is_folder() {
        let file = File {
            name: Some(new_name.to_string()),
            mime_type: Some("application/vnd.google-apps.folder".to_string()),
            parents: Some(vec![new_parent_id.to_string()]),
            ..Default::default()
        };

        let empty_data = Cursor::new(vec![]);

        let (response, created_folder) = hub
            .files()
            .create(file)
            .add_scope("https://www.googleapis.com/auth/drive")
            .supports_all_drives(true)
            .upload(
                empty_data,
                "application/vnd.google-apps.folder".parse().unwrap(),
            )
            .await
            .map_err(|e| e.to_string())?;

        let new_folder_id = created_folder.id.ok_or("Нет ID папки")?;

        if !response.status().is_success() {
            return Err(format!("Ошибка создания папки: {}", response.status()));
        }

        let new_folder_full = get_item(app.clone(), &new_folder_id).await?;

        window
            .emit("scan_log", &format!("📁 Создана папка: {}", new_name))
            .ok();

        let children = list_folder_contents(app.clone(), item_id).await?;

        for child in children {
            let child_id = child.id.unwrap_or("Нет ID".to_string());
            let child_name = child.name.unwrap_or("Без имени".to_string());
            Box::pin(copy_item_recursive(
                &child_id,
                &new_folder_id,
                &child_name,
                suspicious_emails,
                window,
                app.clone(),
            ))
            .await?;
        }

        clean_suspicious_permissions(
            new_folder_full,
            suspicious_emails.to_vec(),
            window,
            app.clone(),
        )
        .await?;

        Ok(new_folder_id)
    } else {
        let (response, copied_file) = hub
            .files()
            .copy(File::default(), item_id)
            .add_scope("https://www.googleapis.com/auth/drive")
            .supports_all_drives(true)
            .doit()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Ошибка копирования: {}", response.status()));
        }

        let new_id = copied_file.id.ok_or("Нет ID")?;

        let update_file = File {
            name: Some(new_name.to_string()),
            parents: Some(vec![new_parent_id.to_string()]),
            ..Default::default()
        };

        hub.files()
            .update(update_file, &new_id)
            .add_scope("https://www.googleapis.com/auth/drive")
            .supports_all_drives(true)
            .doit_without_upload()
            .await
            .map_err(|e| e.to_string())?;

        window
            .emit("scan_log", &format!("📄 Скопирован файл: {}", new_name))
            .ok();

        let copied_item = get_item(app.clone(), &new_id).await?;
        clean_suspicious_permissions(copied_item, suspicious_emails.to_vec(), window, app).await?;

        Ok(new_id)
    }
}
async fn clean_suspicious_permissions(
    item: DriveItem,
    suspicious_emails: Vec<String>,
    window: &tauri::Window,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let item_id = item.id.unwrap_or("".to_string());

    for perm in item.permissions.unwrap_or(vec![]) {
        if suspicious_emails.contains(&perm.email_address.unwrap_or("".to_string()))
            && perm.role != Some("owner".to_string())
        {
            remove_permission(
                app.clone(),
                window.clone(),
                item_id.clone(),
                perm.id.unwrap_or("".to_string()),
            )
            .await?;
        }
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CopyInfo {
    pub copy_id: String,
    pub copy_name: String,
    pub copy_url: Option<String>,
    pub original_id: String,
    pub original_name: String,
    pub original_url: Option<String>,
}

#[tauri::command]
pub async fn copy_and_clean(
    app: tauri::AppHandle,
    window: tauri::Window,
    item_id: String,
    name: String,
    parent_id: String,
    suspicious_emails: Vec<String>,
) -> Result<CopyInfo, String> {
    let new_name = format!("[C] {}", name);

    window
        .emit("scan_log", &format!("🚀 Начинаем копирование: {}", name))
        .ok();

    let new_id = copy_item_recursive(
        &item_id,
        &parent_id,
        &new_name,
        &suspicious_emails,
        &window,
        app.clone(),
    )
    .await?;

    let copy_item = get_item(app.clone(), &new_id).await?;
    let original_item = get_item(app.clone(), &item_id).await?;

    update_custom_property(
        app.clone(),
        &item_id,
        hashmap! {
            "is_copied" => "true",
            "copy_item_id" => &new_id
        },
    )
    .await?;

    update_custom_property(
        app.clone(),
        &new_id,
        hashmap! {
            "original_item_id" => item_id.as_str()
        },
    )
    .await?;

    window
        .emit("scan_log", &format!("✅ Готово: {}", new_name))
        .ok();

    Ok(CopyInfo {
        copy_id: new_id,
        copy_name: copy_item.name.unwrap_or(new_name),
        copy_url: copy_item.web_view_link,
        original_id: item_id,
        original_name: original_item.name.unwrap_or(name),
        original_url: original_item.web_view_link,
    })
}

#[tauri::command]
pub async fn is_drive_item(app: tauri::AppHandle, file_id: String) -> Result<bool, String> {
    match get_item(app.clone(), &file_id).await {
        Ok(_) => Ok(true),   // Существует в Drive
        Err(_) => Ok(false), // Не существует или нет доступа
    }
}
