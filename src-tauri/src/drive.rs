pub use crate::http_client::AuthClient;
use crate::oauth::get_valid_access_token;
use dirs;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Emitter;
use tauri::command; // или где AuthClient

const SUSPICIOUS_EMAILS: &[&str] = &[];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeAccess {
    pub email: String,
    pub display_name: String,
    pub total_access: usize,
    pub roles: HashMap<String, usize>, // "owner": 5, "writer": 10
    pub accesses: Vec<AccessDetail>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccessDetail {
    pub item_id: String,
    pub item_name: String,
    pub item_type: String,
    pub url: String,
    pub role: String,
    pub permission_id: Option<String>,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkAccess {
    pub item_id: String,
    pub item_name: String,
    pub item_type: String,
    pub url: String,
    pub link_share_role: String, // reader, writer, commenter
    pub permission_id: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditResult {
    pub employees: Vec<EmployeeAccess>,
    pub link_accesses: Vec<LinkAccess>,
    pub scan_date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccessResult {
    pub r#type: String,
    pub item_type: String,
    pub name: String,
    pub url: String,
    pub user: String,
    pub role: String,
    pub item_id: String,
    pub email: String,
    pub parent_id: String,
    pub permission_id: Option<String>,
    pub path: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub access: Vec<AccessResult>,
    pub scan_date: String,
}

#[derive(Deserialize, Debug, Clone)]
struct DriveFile {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    #[serde(rename = "webViewLink")]
    web_view_link: Option<String>,
    parents: Option<Vec<String>>,
    permissions: Option<Vec<Permission>>,
    owners: Option<Vec<Owner>>,
}

#[derive(Deserialize, Debug, Clone)]
struct Permission {
    id: Option<String>,
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    role: Option<String>,
    #[serde(rename = "type")]
    perm_type: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
struct Owner {
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
}

#[derive(Deserialize, Debug)]
struct FilesListResponse {
    files: Option<Vec<DriveFile>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

pub struct DriveScanner {
    client: AuthClient,
    results: Vec<AccessResult>,
    processed_folders: usize,
    processed_files: usize,
    window: tauri::Window,
    suspicious_emails: Vec<String>,
    folder_cache: Arc<Mutex<HashMap<String, Vec<DriveFile>>>>,
}

impl DriveScanner {
    pub fn new(app: tauri::AppHandle, window: tauri::Window, suspicious_emails: &[String]) -> Self {
        Self {
            client: AuthClient::new(app),
            results: Vec::new(),
            processed_folders: 0,
            processed_files: 0,
            window,
            suspicious_emails: suspicious_emails.to_vec(),
            folder_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn get_folder_contents_cached(&self, folder_id: &str) -> Result<Vec<DriveFile>, String> {
        {
            let cache = self.folder_cache.lock().unwrap();
            if let Some(contents) = cache.get(folder_id) {
                return Ok(contents.clone());
            }
        }

        let contents = self.list_folder_contents(folder_id).await?;

        {
            let mut cache = self.folder_cache.lock().unwrap();
            cache.insert(folder_id.to_string(), contents.clone());
        }

        Ok(contents)
    }

    fn log(&self, message: &str) {
        let _ = self.window.emit("scan_log", message);
    }

    pub async fn scan(&mut self, folder_id: &str) -> Result<ScanResult, String> {
        let start = Instant::now();
        self.clear_cache();
        self.log("СТАРТ: Сканирование диска...\n");
        self.process_folder(folder_id, None, String::new()).await?;
        self.print_summary();

        let duration = start.elapsed();
        let seconds = duration.as_secs_f64();
        self.log(&format!("Сканирование выполнилось за {:.2} сек", seconds));

        Ok(ScanResult {
            access: self.results.clone(),
            scan_date: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn process_folder(
        &mut self,
        folder_id: &str,
        parent_id: Option<String>,
        current_path: String,
    ) -> Result<(), String> {
        let folder = self.get_file(folder_id).await?;
        let folder_name = folder
            .name
            .as_ref()
            .unwrap_or(&"Без названия".to_string())
            .clone();

        self.log(&format!("📁 Папка: {}", folder_name));
        self.processed_folders += 1;

        if let Some(parent) = &parent_id {
            let copy_name = format!("КОПИЯ | {}", folder_name);
            if self.copy_exists_in_folder(parent, &copy_name).await {
                self.log(&format!(
                    " ⏭️ ПРОПУСК: папка {} уже скопирована",
                    folder_name
                ));
                return Ok(());
            }
        }

        let folder_own_path = current_path.clone();
        self.check_item(&folder, "Папка", parent_id.as_deref(), &folder_own_path)
            .await;

        let full_path_for_children = if current_path.is_empty() {
            folder_name.clone()
        } else {
            format!("{} / {}", current_path, folder_name)
        };

        let items = self.list_folder_contents(folder_id).await?;
        let files: Vec<_> = items
            .iter()
            .filter(|i| i.mime_type.as_deref() != Some("application/vnd.google-apps.folder"))
            .collect();
        let subfolders: Vec<_> = items
            .iter()
            .filter(|i| i.mime_type.as_deref() == Some("application/vnd.google-apps.folder"))
            .collect();

        self.log(&format!(
            " └─ Файлов: {}, Подпапок: {}",
            files.len(),
            subfolders.len()
        ));

        for file in files {
            self.log(&format!(
                " 📄 {}",
                file.name.as_ref().unwrap_or(&"Без названия".to_string())
            ));
            self.check_item(file, "Файл", Some(folder_id), &full_path_for_children)
                .await;
            self.processed_files += 1;
        }

        for subfolder in subfolders {
            if let Some(subfolder_id) = &subfolder.id {
                Box::pin(self.process_folder(
                    subfolder_id,
                    Some(folder_id.to_string()),
                    full_path_for_children.clone(),
                ))
                .await?;
            }
        }
        Ok(())
    }
    async fn get_file(&self, file_id: &str) -> Result<DriveFile, String> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?fields=id,name,webViewLink,permissions(id,emailAddress,role,type,displayName),owners(emailAddress)&supportsAllDrives=true",
            file_id
        );

        let response = self.client.get(&url).await.map_err(|e| e.to_string())?;

        let status = response.status();

        if !status.is_success() {
            return Err(format!("Drive API error: {}", status));
        }

        response.json().await.map_err(|e| e.to_string())
    }
    async fn list_folder_contents(&self, folder_id: &str) -> Result<Vec<DriveFile>, String> {
        let mut all_items = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut url = format!(
                "https://www.googleapis.com/drive/v3/files?q='{}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType,webViewLink,parents,permissions(id,emailAddress,role,type,displayName),owners(emailAddress))&pageSize=1000&supportsAllDrives=true",
                folder_id
            );

            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={}", token));
            }

            let response = self.client.get(&url).await.map_err(|e| e.to_string())?;

            let status = response.status();

            if !status.is_success() {
                return Err(format!("Drive API error: {}", status));
            }

            let data: FilesListResponse = response.json().await.map_err(|e| e.to_string())?;

            if let Some(files) = data.files {
                all_items.extend(files);
            }

            page_token = data.next_page_token;
            if page_token.is_none() {
                break;
            }
        }

        Ok(all_items)
    }
    async fn check_item(
        &mut self,
        item: &DriveFile,
        item_type: &str,
        parent_id: Option<&str>,
        path: &str,
    ) {
        let permissions = item.permissions.as_deref().unwrap_or(&[]);

        let owners: Vec<String> = item
            .owners
            .as_ref()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|o| o.email_address.as_ref().map(|e| e.to_lowercase()))
            .collect();

        fn role_map(role: &str) -> &str {
            match role {
                "owner" => "Владелец",
                "writer" => "Редактор",
                "commenter" => "Комментатор",
                "reader" => "Просмотр",
                _ => role,
            }
        }

        for perm in permissions {
            if perm.role.as_deref() == Some("owner") {
                continue;
            }

            if let Some(email) = &perm.email_address {
                let email_lower = email.to_lowercase();

                if self.suspicious_emails.contains(&email_lower) {
                    let role = role_map(perm.role.as_deref().unwrap_or("reader"));

                    self.results.push(AccessResult {
                        r#type: "permission".to_string(),
                        item_type: item_type.to_string(),
                        name: item
                            .name
                            .clone()
                            .unwrap_or_else(|| "Без названия".to_string()),
                        url: item.web_view_link.clone().unwrap_or_default(),
                        user: format!(
                            "{} ({})",
                            perm.display_name.as_deref().unwrap_or("Unknown"),
                            email
                        ),
                        role: role.to_string(),
                        item_id: item.id.clone().unwrap_or_default(),
                        email: email_lower.clone(),
                        parent_id: parent_id.unwrap_or("").to_string(),
                        permission_id: perm.id.clone(),
                        path: path.to_string(),
                    });

                    self.log(&format!("   ⚠️ ДОСТУП: {} - {}", email_lower, role));
                }
            }
        }

        let suspicious_owners: Vec<_> = owners
            .iter()
            .filter(|o| self.suspicious_emails.contains(o))
            .collect();

        for owner in suspicious_owners {
            // ← ПРОВЕРКА КОПИИ ДЛЯ ФАЙЛОВ И ПАПОК
            if let Some(parent) = parent_id {
                let item_name = item.name.as_deref().unwrap_or("");
                let copy_name = format!("КОПИЯ | {}", item_name);

                if self.copy_exists_in_folder(parent, &copy_name).await {
                    self.log(&format!(
                        "   ⏭️ ПРОПУСК: копия уже существует для {}",
                        item_name
                    ));
                    continue; // ← ПРОПУСКАЕМ ЭТОГО ВЛАДЕЛЬЦА
                }
            }

            self.results.push(AccessResult {
                r#type: "owner".to_string(),
                item_type: item_type.to_string(),
                name: item
                    .name
                    .clone()
                    .unwrap_or_else(|| "Без названия".to_string()),
                url: item.web_view_link.clone().unwrap_or_default(),
                user: owner.clone(),
                role: "Владелец".to_string(),
                item_id: item.id.clone().unwrap_or_default(),
                email: owner.clone(),
                parent_id: parent_id.unwrap_or("").to_string(),
                permission_id: None,
                path: path.to_string(),
            });

            self.log(&format!("   👑 ВЛАДЕЛЕЦ: {}", owner));
        }
    }

    pub fn clear_cache(&self) {
        let mut cache = self.folder_cache.lock().unwrap();
        cache.clear();
    }

    async fn copy_exists_in_folder(&self, folder_id: &str, copy_name: &str) -> bool {
        match self.get_folder_contents_cached(folder_id).await {
            Ok(items) => items.iter().any(|i| i.name.as_deref() == Some(copy_name)),
            Err(_) => false,
        }
    }

    fn print_summary(&self) {
        self.log("\n============================================================");
        self.log("✅ ЗАВЕРШЕНО");
        self.log("============================================================");
        self.log(&format!("📁 Обработано папок: {}", self.processed_folders));
        self.log(&format!("📄 Обработано файлов: {}", self.processed_files));
        self.log(&format!("⚠️ Найдено доступов: {}", self.results.len()));
        self.log("============================================================\n");
    }
}

fn cache_path() -> std::path::PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| std::env::temp_dir());
    path.push("drive-cleaner-cache.json");
    path
}

fn snapshot_path() -> std::path::PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| std::env::temp_dir());
    path.push("drive-cleaner-snapshot.json");
    path
}

fn save_cache(result: &ScanResult) -> Result<(), String> {
    let json = serde_json::to_string_pretty(result).map_err(|e| e.to_string())?;
    fs::write(cache_path(), &json).map_err(|e| e.to_string())?;
    fs::write(snapshot_path(), json).map_err(|e| e.to_string())?; // ← дубликат
    Ok(())
}

// Загрузить кеш
fn load_cache() -> Result<Option<ScanResult>, String> {
    let path = cache_path();
    println!("Путь к кешу: {}", path.display());
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let result = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(result))
}

#[tauri::command]
pub async fn scan_drive(
    app: tauri::AppHandle,
    window: tauri::Window,
    folder_id: String,
    suspicious_emails: Vec<String>,
    force_rescan: bool, // ← новый флаг
) -> Result<ScanResult, String> {
    // Попробуем кеш
    if !force_rescan {
        if let Ok(Some(cached)) = load_cache() {
            window.emit("scan_log", "Кеш загружен из файла").ok();
            return Ok(cached);
        }
    }

    let token = get_valid_access_token(app.clone()).await?;

    let mut scanner = DriveScanner::new(app.clone(), window.clone(), &suspicious_emails); // ← token убран

    let result = scanner.scan(&folder_id).await?;

    // Сохраняем кеш
    if let Err(e) = save_cache(&result) {
        window
            .emit("scan_log", &format!("Не удалось сохранить кеш: {}", e))
            .ok();
    } else {
        window.emit("scan_log", "Результат сохранён в кеш").ok();
    }

    Ok(result)
}
#[tauri::command]
pub async fn remove_permission(
    file_id: String,
    permission_id: String,
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/permissions/{}",
        file_id, permission_id
    );

    let client = AuthClient::new(app.clone()); // ← reqwest::Client::new()

    let res = client.delete(&url).await.map_err(|e| e.to_string())?;

    let status = res.status();

    if status.is_success() {
        window
            .emit("scan_log", &format!("Удалён доступ: {}", permission_id))
            .ok();

        // ← УДАЛЯЕМ ЗАПИСЬ ИЗ КЕША
        remove_from_cache(&file_id, &permission_id)?;

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
        let err_text = res
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!("API error {}: {}", status, err_text))
    }
}

// ← НОВАЯ ФУНКЦИЯ
fn remove_from_cache(item_id: &str, identifier: &str) -> Result<(), String> {
    let path = cache_path();
    if !path.exists() {
        return Ok(());
    }

    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut result: ScanResult = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    // Удаляем по item_id + либо type="owner", либо по permission_id
    result.access.retain(|a| {
        !(a.item_id == item_id
            && (a.r#type == identifier || a.permission_id.as_deref() == Some(identifier)))
    });

    let updated_json = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    fs::write(path, updated_json).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn load_scan_cache() -> Result<ScanResult, String> {
    let path = cache_path();
    if !path.exists() {
        return Err("No cache".to_string());
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let result: ScanResult = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn get_scan_info() -> Result<Option<ScanInfo>, String> {
    let path = cache_path();
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let result: ScanResult = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let emails: Vec<String> = result
        .access
        .iter()
        .map(|a| a.email.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    Ok(Some(ScanInfo {
        scan_date: result.scan_date.clone(),
        email_count: emails.len(),
        emails,
        total_access_count: result.access.len(), // ← НОВОЕ ПОЛЕ
    }))
}

#[derive(serde::Serialize)]
pub struct ScanInfo {
    pub scan_date: String,
    pub email_count: usize,
    pub emails: Vec<String>,
    pub total_access_count: usize, // ← ТУТ
}

async fn copy_item_recursive(
    client: &AuthClient,
    item_id: &str,
    new_parent_id: &str,
    new_name: &str,
    suspicious_emails: &[String],
    window: &tauri::Window,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let item_url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?fields=id,name,mimeType,permissions&supportsAllDrives=true",
        item_id
    );
    let item_res = client.get(&item_url).await.map_err(|e| e.to_string())?;

    let item: serde_json::Value = item_res.json().await.map_err(|e| e.to_string())?;
    let mime_type = item["mimeType"].as_str().unwrap_or("");

    if mime_type == "application/vnd.google-apps.folder" {
        let create_folder_url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true";
        let folder_body = serde_json::json!({
            "name": new_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [new_parent_id]
        });

        let folder_res = client
            .post_json(create_folder_url, &folder_body)
            .await
            .map_err(|e| e.to_string())?;
        if !folder_res.status().is_success() {
            return Err(format!("Ошибка создания папки: {}", folder_res.status()));
        }

        let folder_data: serde_json::Value = folder_res.json().await.map_err(|e| e.to_string())?;
        let new_folder_id = folder_data["id"]
            .as_str()
            .ok_or("Нет ID папки")?
            .to_string();

        window
            .emit("scan_log", &format!("📁 Создана папка: {}", new_name))
            .ok();

        let list_url = format!(
            "https://www.googleapis.com/drive/v3/files?q='{}'%20in%20parents%20and%20trashed=false&fields=files(id,name)&supportsAllDrives=true&pageSize=1000",
            item_id
        );
        let list_res = client.get(&list_url).await.map_err(|e| e.to_string())?;

        let list_data: serde_json::Value = list_res.json().await.map_err(|e| e.to_string())?;
        let children = list_data["files"].as_array().ok_or("Нет files")?;

        for child in children {
            let child_id = child["id"].as_str().ok_or("Нет child id")?;
            let child_name = child["name"].as_str().unwrap_or("Без имени");
            Box::pin(copy_item_recursive(
                client,
                child_id,
                &new_folder_id,
                child_name,
                suspicious_emails,
                window,
                app.clone(),
            ))
            .await?;
        }

        clean_suspicious_permissions(
            client,
            &new_folder_id,
            suspicious_emails,
            window,
            app.clone(),
        )
        .await?;

        Ok(new_folder_id)
    } else {
        let copy_url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/copy?supportsAllDrives=true",
            item_id
        );
        let copy_body = serde_json::json!({
            "name": new_name,
            "parents": [new_parent_id]
        });

        let copy_res = client
            .post_json(&copy_url, &copy_body)
            .await
            .map_err(|e| e.to_string())?;

        if !copy_res.status().is_success() {
            return Err(format!("Ошибка копирования файла: {}", copy_res.status()));
        }

        let copy_data: serde_json::Value = copy_res.json().await.map_err(|e| e.to_string())?;
        let new_id = copy_data["id"].as_str().ok_or("Нет ID копии")?.to_string();

        window
            .emit("scan_log", &format!("📄 Скопирован файл: {}", new_name))
            .ok();

        clean_suspicious_permissions(client, &new_id, suspicious_emails, window, app).await?;

        Ok(new_id)
    }
}
async fn clean_suspicious_permissions(
    client: &AuthClient,
    item_id: &str,
    suspicious_emails: &[String],
    window: &tauri::Window,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let perms_url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/permissions?supportsAllDrives=true",
        item_id
    );
    let perms_res = client.get(&perms_url).await.map_err(|e| e.to_string())?;

    let perms: serde_json::Value = perms_res.json().await.map_err(|e| e.to_string())?;
    let permissions = perms["permissions"].as_array().ok_or("Нет permissions")?;

    for perm in permissions {
        let email = perm["emailAddress"].as_str();
        let perm_id = perm["id"].as_str();
        let role = perm["role"].as_str();

        if let (Some(email), Some(perm_id)) = (email, perm_id) {
            if suspicious_emails.contains(&email.to_lowercase().to_string())
                && role != Some("owner")
            {
                let del_url = format!(
                    "https://www.googleapis.com/drive/v3/files/{}/permissions/{}?supportsAllDrives=true",
                    item_id, perm_id
                );
                let del_res = client.delete(&del_url).await.map_err(|e| e.to_string())?;

                if del_res.status().is_success() {
                    window
                        .emit("scan_log", &format!("   ❌ Удалён: {}", email))
                        .ok();
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_and_clean(
    app: tauri::AppHandle,
    window: tauri::Window,
    item_id: String,
    name: String,
    parent_id: String,
    suspicious_emails: Vec<String>,
) -> Result<(), String> {
    let client = AuthClient::new(app.clone());
    let new_name = format!("КОПИЯ | {}", name);

    window
        .emit("scan_log", &format!("🚀 Начинаем копирование: {}", name))
        .ok();

    copy_item_recursive(
        &client,
        &item_id,
        &parent_id,
        &new_name,
        &suspicious_emails,
        &window,
        app.clone(),
    )
    .await?;

    window
        .emit("scan_log", &format!("✅ Готово: {}", new_name))
        .ok();

    update_cache_after_copy(&item_id, &suspicious_emails)?;

    Ok(())
}

fn update_cache_after_copy(original_id: &str, suspicious_emails: &[String]) -> Result<(), String> {
    let path = cache_path();
    if !path.exists() {
        return Ok(());
    }

    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut result: ScanResult = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    // Собираем все ID которые нужно удалить (сам объект + всё что внутри рекурсивно)
    let mut ids_to_remove = std::collections::HashSet::new();
    ids_to_remove.insert(original_id.to_string());

    // Рекурсивно находим всех потомков
    loop {
        let before_size = ids_to_remove.len();

        for item in &result.access {
            if ids_to_remove.contains(&item.parent_id) {
                ids_to_remove.insert(item.item_id.clone());
            }
        }

        // Если не нашли новых - выходим
        if ids_to_remove.len() == before_size {
            break;
        }
    }

    // Удаляем все найденные записи с подозрительными email
    result.access.retain(|a| {
        if ids_to_remove.contains(&a.item_id) {
            !suspicious_emails.contains(&a.email.to_lowercase())
        } else {
            true
        }
    });

    let updated_json = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    fs::write(path, updated_json).map_err(|e| e.to_string())?;

    Ok(())
}
fn load_snapshot() -> Result<Option<ScanResult>, String> {
    let path = snapshot_path();
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let result = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(result))
}

#[tauri::command]
pub async fn create_and_open_spreadsheet(
    window: tauri::Window, // ← убрал дубликат
    app: tauri::AppHandle,
) -> Result<String, String> {
    let client = AuthClient::new(app.clone());

    let cache = load_snapshot()?.ok_or("Нет данных для экспорта")?;

    if cache.access.is_empty() {
        return Err("Нет результатов для экспорта".to_string());
    }

    let total_rows_needed = std::cmp::max(cache.access.len() + 1, 1000);

    // Создаём таблицу с 2 листами
    let create_url = "https://sheets.googleapis.com/v4/spreadsheets";
    let spreadsheet_body = serde_json::json!({
        "properties": {
            "title": format!("Drive Audit - {}", chrono::Utc::now().format("%Y-%m-%d %H:%M"))
        },
        "sheets": [
            {
                "properties": {
                    "title": "Сводка",
                    "sheetId": 0
                }
            },
            {
                "properties": {
                    "title": "Детали",
                    "sheetId": 1,
                "gridProperties": {
                    "rowCount": total_rows_needed,
                    "columnCount": 7
                }
                }
            }
        ]
    });

    let create_res = client.post_json(create_url, &spreadsheet_body).await?;

    if !create_res.status().is_success() {
        return Err(format!("Ошибка создания таблицы: {}", create_res.status()));
    }

    let spreadsheet: serde_json::Value = create_res.json().await.map_err(|e| e.to_string())?;
    let spreadsheet_id = spreadsheet["spreadsheetId"]
        .as_str()
        .ok_or("Нет ID таблицы")?;
    let spreadsheet_url = spreadsheet["spreadsheetUrl"]
        .as_str()
        .ok_or("Нет URL таблицы")?;

    window
        .emit("scan_log", "Таблица создана, готовим данные...")
        .ok();

    // === ЛИСТ 1: СВОДКА ===
    use std::collections::HashMap;

    #[derive(Default)]
    struct UserStats {
        owner_count: usize,
        writer_count: usize,
        commenter_count: usize,
        reader_count: usize,
        is_owner: bool,
    }

    let mut stats: HashMap<String, UserStats> = HashMap::new();

    for item in &cache.access {
        let entry = stats.entry(item.email.clone()).or_default();

        match item.role.as_str() {
            "Владелец" => {
                entry.owner_count += 1;
                entry.is_owner = true;
            }
            "Редактор" => {
                if !entry.is_owner {
                    entry.writer_count += 1;
                }
            }
            "Комментатор" => {
                if !entry.is_owner {
                    entry.commenter_count += 1;
                }
            }
            "Просмотр" => {
                if !entry.is_owner {
                    entry.reader_count += 1;
                }
            }
            _ => {}
        }
    }

    let mut summary_rows: Vec<Vec<String>> = vec![vec![
        "Email".to_string(),
        "Владелец".to_string(),
        "Редактор".to_string(),
        "Комментатор".to_string(),
        "Просмотр".to_string(),
        "Всего доступов".to_string(),
    ]];

    let mut total_owners = 0;
    let mut total_writers = 0;
    let mut total_commenters = 0;
    let mut total_readers = 0;
    let mut grand_total = 0;

    for (email, stat) in stats.iter() {
        let total = stat.owner_count + stat.writer_count + stat.commenter_count + stat.reader_count;
        summary_rows.push(vec![
            email.clone(),
            stat.owner_count.to_string(),
            stat.writer_count.to_string(),
            stat.commenter_count.to_string(),
            stat.reader_count.to_string(),
            total.to_string(),
        ]);

        total_owners += stat.owner_count;
        total_writers += stat.writer_count;
        total_commenters += stat.commenter_count;
        total_readers += stat.reader_count;
        grand_total += total;
    }

    // Добавляем итоговую строку
    summary_rows.push(vec![
        "ВСЕГО".to_string(),
        total_owners.to_string(),
        total_writers.to_string(),
        total_commenters.to_string(),
        total_readers.to_string(),
        grand_total.to_string(),
    ]);

    // === ЛИСТ 2: ДЕТАЛИ ===
    let mut detail_rows: Vec<Vec<String>> = vec![vec![
        "Email".to_string(),
        "Пользователь".to_string(),
        "Роль".to_string(),
        "Тип объекта".to_string(),
        "Название".to_string(),
        "Папка".to_string(),
        "Ссылка".to_string(),
    ]];

    for item in &cache.access {
        let folder_url = format!("https://drive.google.com/drive/folders/{}", item.parent_id);

        detail_rows.push(vec![
            item.email.clone(),
            item.user.clone(),
            item.role.clone(),
            item.item_type.clone(),
            item.name.clone(),
            folder_url.clone(),
            item.url.clone(),
        ]);
    }

    window
        .emit("scan_log", "Записываем данные в таблицу...")
        .ok();

    let batch_update_url = format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}:batchUpdate",
        spreadsheet_id
    );

    let updateSummaryRequest = serde_json::json!({
        "requests": [
            {
                "updateCells": {
                    "range": {
                        "sheetId": 0,
                        "startRowIndex": 0,
                        "startColumnIndex": 0
                    },
                    "rows": summary_rows.iter().map(|row| {
                        serde_json::json!({
                            "values": row.iter().map(|cell| {
                                serde_json::json!({
                                    "userEnteredValue": { "stringValue": cell }
                                })
                            }).collect::<Vec<_>>()
                        })
                    }).collect::<Vec<_>>(),
                    "fields": "userEnteredValue"
                }
            },
        ]
    });

    let updateSummaryRes = client
        .post_json(&batch_update_url, &updateSummaryRequest)
        .await?;

    if !updateSummaryRes.status().is_success() {
        let err_text = updateSummaryRes.text().await.unwrap_or_default();
        return Err(format!("Ошибка записи сводки: {}", err_text));
    }
    let total_rows_needed = detail_rows.len();

    let mut start_row = 0;
    for chunk in detail_rows.chunks(900) {
        let updateAccessRequest = serde_json::json!({
            "requests": [
            {
                "updateCells": {
                    "range": {
                        "sheetId": 1,
                        "startRowIndex": start_row,
                        "startColumnIndex": 0
                    },
                    "rows": chunk.iter().enumerate().map(|(row_idx, row)| {
                        serde_json::json!({
                            "values": row.iter().enumerate().map(|(col_idx, cell)| {
                                // Колонка 5 (Папка) - делаем гиперссылкой
                               if col_idx == 5 {
                                    serde_json::json!({
                                        "userEnteredValue": {
                                            "formulaValue": format!("=HYPERLINK(\"{}\"; \"Открыть папку\")", cell)
                                        }
                                    })
                                } else {
                                    serde_json::json!({
                                        "userEnteredValue": { "stringValue": cell }
                                    })
                                }
                            }).collect::<Vec<_>>()
                        })
                    }).collect::<Vec<_>>(),
                    "fields": "userEnteredValue"
                }
            },
            ]
        });

        let updateAccessRes = client
            .post_json(&batch_update_url, &updateAccessRequest)
            .await
            .map_err(|e| e.to_string())?;

        if !updateAccessRes.status().is_success() {
            let err_text = updateAccessRes.text().await.unwrap_or_default();
            return Err(format!("Ошибка записи сводки: {}", err_text));
        }

        start_row += chunk.len();

        window
            .emit("scan_log", &format!("Записано {} строк...", start_row))
            .ok();
    }

    let permissions_url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/permissions",
        spreadsheet_id
    );

    let public_permission = serde_json::json!({
        "type": "anyone",
        "role": "reader"
    });

    let perm_res = client
        .post_json(&permissions_url, &public_permission)
        .await?;

    if !perm_res.status().is_success() {
        window
            .emit("scan_log", "⚠️ Не удалось сделать таблицу публичной")
            .ok();
    }

    window
        .emit("scan_log", "✅ Данные записаны, открываем таблицу...")
        .ok();

    crate::oauth::open_url(spreadsheet_url.to_string())?;

    Ok(spreadsheet_url.to_string())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileMetadata {
    pub id: String,
    pub name: String,
    pub url: String,
    pub owner: String,
    pub permissions: Vec<PermissionInfo>,
}

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

#[tauri::command]
pub async fn scan_files_direct(
    window: tauri::Window,
    app: tauri::AppHandle,
    file_ids: Vec<String>,
) -> Result<Vec<FileMetadata>, String> {
    let client = AuthClient::new(app.clone()); // ← Client::new()
    let mut results = Vec::new();

    for file_id in file_ids {
        window
            .emit("direct_scan_log", &format!("Сканируем: {}", file_id))
            .ok();

        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?fields=id,name,webViewLink,permissions(id,emailAddress,displayName,role,type),owners(emailAddress)&supportsAllDrives=true",
            file_id
        );

        let res = client.get(&url).await.map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            window
                .emit("direct_scan_log", &format!("❌ Ошибка: {}", res.status()))
                .ok();
            continue;
        }

        let file: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

        let owner = file["owners"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|o| o["emailAddress"].as_str())
            .unwrap_or("Неизвестно")
            .to_string();

        let permissions: Vec<PermissionInfo> = file["permissions"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|p| {
                Some(PermissionInfo {
                    id: p["id"].as_str()?.to_string(),
                    email: p["emailAddress"].as_str().unwrap_or("").to_string(),
                    display_name: p["displayName"].as_str().unwrap_or("").to_string(),
                    role: p["role"].as_str()?.to_string(),
                    perm_type: p["type"].as_str()?.to_string(),
                })
            })
            .collect();

        results.push(FileMetadata {
            id: file["id"].as_str().unwrap_or("").to_string(),
            name: file["name"].as_str().unwrap_or("Без названия").to_string(),
            url: file["webViewLink"].as_str().unwrap_or("").to_string(),
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
pub async fn get_parent_id(app: tauri::AppHandle, file_id: String) -> Result<String, String> {
    let client = AuthClient::new(app.clone());

    let file = get_file_simple(&client, &file_id).await?;
    let parent_id = file["parents"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|p| p.as_str())
        .ok_or("no_parent")?
        .to_string();

    Ok(parent_id)
}
#[tauri::command]
pub async fn copy_file_without_owner(
    app: tauri::AppHandle,
    file_id: String,
    file_name: String,
    owner_email: String,
    window: tauri::Window,
) -> Result<(), String> {
    let client = AuthClient::new(app.clone());

    let file = get_file_simple(&client, &file_id).await?;
    let parent_id = file["parents"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|p| p.as_str())
        .ok_or("no_parent")?;

    let new_name = format!("КОПИЯ | {}", file_name);

    window
        .emit("direct_scan_log", &format!("Копируем: {}", file_name))
        .ok();

    copy_item_recursive(
        &client,
        &file_id,
        parent_id,
        &new_name,
        &[owner_email.to_lowercase()],
        &window,
        app.clone(),
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

async fn get_file_simple(client: &AuthClient, file_id: &str) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?fields=parents&supportsAllDrives=true",
        file_id
    );

    let res = client.get(&url).await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Drive API error: {}", res.status()));
    }

    res.json().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn verify_access(
    item_id: String,
    email: String,
    permission_id: Option<String>, // ← для permission
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let client = AuthClient::new(app.clone());

    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?fields=id,permissions(id,emailAddress,role,type),owners(emailAddress)&supportsAllDrives=true",
        item_id
    );

    let res = client.get(&url).await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        remove_from_cache(&item_id, &permission_id.unwrap_or_default())?;
        return Ok(false);
    }

    let file: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let email_lower = email.to_lowercase();

    // Проверяем владельцев
    let owners = file["owners"].as_array().cloned().unwrap_or_default();

    if owners.iter().any(|o| {
        o["emailAddress"]
            .as_str()
            .map(|e| e.to_lowercase() == email_lower)
            .unwrap_or(false)
    }) {
        return Ok(true);
    }

    // Проверяем разрешения
    let permissions = file["permissions"].as_array().cloned().unwrap_or_default();

    let still_exists = permissions.iter().any(|p| {
        if let Some(perm_email) = p["emailAddress"].as_str() {
            if perm_email.to_lowercase() == email_lower {
                // Если есть permission_id - проверяем точное совпадение
                if let Some(id) = &permission_id {
                    return p["id"].as_str() == Some(id);
                }
                return true;
            }
        }
        false
    });

    if !still_exists {
        remove_from_cache(&item_id, &permission_id.unwrap_or_default())?;
    }

    Ok(still_exists)
}

#[tauri::command]
pub async fn audit_drive(
    app: tauri::AppHandle,
    window: tauri::Window,
    folder_id: String,
) -> Result<AuditResult, String> {
    let mut scanner = AuditScanner::new(app.clone(), window.clone());
    scanner.scan(&folder_id).await
}

pub struct AuditScanner {
    client: AuthClient,
    employee_map: HashMap<String, EmployeeAccess>,
    link_accesses: Vec<LinkAccess>,
    window: tauri::Window,
}

impl AuditScanner {
    pub fn new(app: tauri::AppHandle, window: tauri::Window) -> Self {
        Self {
            client: AuthClient::new(app),
            employee_map: HashMap::new(),
            link_accesses: Vec::new(),
            window,
        }
    }

    fn log(&self, message: &str) {
        let _ = self.window.emit("audit_log", message);
    }

    pub async fn scan(&mut self, folder_id: &str) -> Result<AuditResult, String> {
        self.log("🔍 Запуск аудита...");
        self.process_folder_audit(folder_id, String::new()).await?;

        let mut employees: Vec<EmployeeAccess> = self.employee_map.values().cloned().collect();
        employees.sort_by(|a, b| b.total_access.cmp(&a.total_access));

        self.log(&format!(
            "✅ Готово: {} сотрудников, {} ссылок",
            employees.len(),
            self.link_accesses.len()
        ));

        Ok(AuditResult {
            employees,
            link_accesses: self.link_accesses.clone(),
            scan_date: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn process_folder_audit(
        &mut self,
        folder_id: &str,
        current_path: String,
    ) -> Result<(), String> {
        let folder = self.get_file_with_permissions(folder_id).await?;
        let folder_name = folder
            .name
            .as_ref()
            .unwrap_or(&"Без названия".to_string())
            .clone();

        let full_path = if current_path.is_empty() {
            folder_name.clone()
        } else {
            format!("{} / {}", current_path, folder_name)
        };

        self.log(&format!("📁 {}", folder_name));
        self.process_item_permissions(&folder, &full_path).await;

        let items = self.list_folder_contents(folder_id).await?;

        for item in &items {
            if item.mime_type.as_deref() == Some("application/vnd.google-apps.folder") {
                if let Some(subfolder_id) = &item.id {
                    Box::pin(self.process_folder_audit(subfolder_id, full_path.clone())).await?;
                }
            } else {
                self.process_item_permissions(item, &full_path).await;
            }
        }

        Ok(())
    }

    async fn process_item_permissions(&mut self, item: &DriveFile, path: &str) {
        let permissions = item.permissions.as_deref().unwrap_or(&[]);
        let item_id = item.id.as_ref().unwrap_or(&String::new()).clone();
        let item_name = item
            .name
            .as_ref()
            .unwrap_or(&"Без названия".to_string())
            .clone();
        let item_type = if item.mime_type.as_deref() == Some("application/vnd.google-apps.folder") {
            "Папка"
        } else {
            "Файл"
        };

        for perm in permissions {
            let role = perm.role.as_deref().unwrap_or("reader");
            let perm_type = perm.perm_type.as_deref().unwrap_or("");

            // Ссылочный доступ (anyone with link)
            if perm_type == "anyone" {
                self.link_accesses.push(LinkAccess {
                    item_id: item_id.clone(),
                    item_name: item_name.clone(),
                    item_type: item_type.to_string(),
                    url: item.web_view_link.clone().unwrap_or_default(),
                    link_share_role: role.to_string(),
                    permission_id: perm.id.clone().unwrap_or_default(),
                    path: path.to_string(),
                });
                continue;
            }

            // Персональный доступ
            if let Some(email) = &perm.email_address {
                let email_lower = email.to_lowercase();
                let display_name = perm.display_name.clone().unwrap_or_else(|| email.clone());

                let employee = self
                    .employee_map
                    .entry(email_lower.clone())
                    .or_insert_with(|| EmployeeAccess {
                        email: email_lower.clone(),
                        display_name: display_name.clone(),
                        total_access: 0,
                        roles: HashMap::new(),
                        accesses: Vec::new(),
                    });

                employee.total_access += 1;
                *employee.roles.entry(role.to_string()).or_insert(0) += 1;

                employee.accesses.push(AccessDetail {
                    item_id: item_id.clone(),
                    item_name: item_name.clone(),
                    item_type: item_type.to_string(),
                    url: item.web_view_link.clone().unwrap_or_default(),
                    role: role.to_string(),
                    permission_id: perm.id.clone(),
                    path: path.to_string(),
                });
            }
        }
    }

    async fn get_file_with_permissions(&self, file_id: &str) -> Result<DriveFile, String> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?fields=id,name,mimeType,webViewLink,permissions(id,emailAddress,role,type,displayName)&supportsAllDrives=true",
            file_id
        );
        let response = self.client.get(&url).await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Drive API error: {}", response.status()));
        }
        response.json().await.map_err(|e| e.to_string())
    }

    async fn list_folder_contents(&self, folder_id: &str) -> Result<Vec<DriveFile>, String> {
        let mut all_items = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut url = format!(
                "https://www.googleapis.com/drive/v3/files?q='{}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType,webViewLink,permissions(id,emailAddress,role,type,displayName))&pageSize=1000&supportsAllDrives=true",
                folder_id
            );

            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={}", token));
            }

            let response = self.client.get(&url).await.map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!("Drive API error: {}", response.status()));
            }

            let data: FilesListResponse = response.json().await.map_err(|e| e.to_string())?;
            if let Some(files) = data.files {
                all_items.extend(files);
            }

            page_token = data.next_page_token;
            if page_token.is_none() {
                break;
            }
        }

        Ok(all_items)
    }
}

#[tauri::command]
pub async fn remove_access(
    app: tauri::AppHandle,
    item_id: String,
    permission_id: String,
) -> Result<(), String> {
    let client = AuthClient::new(app);
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/permissions/{}?supportsAllDrives=true",
        item_id, permission_id
    );

    let res = client.delete(&url).await.map_err(|e| e.to_string())?;

    if res.status().is_success() || res.status() == 404 {
        Ok(())
    } else {
        Err(format!("API error: {}", res.status()))
    }
}

// Изменение роли ссылочного доступа
#[tauri::command]
pub async fn update_link_access(
    app: tauri::AppHandle,
    item_id: String,
    permission_id: String,
    new_role: String, // reader, writer, commenter
) -> Result<(), String> {
    let client = AuthClient::new(app);
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/permissions/{}?supportsAllDrives=true",
        item_id, permission_id
    );

    let body = serde_json::json!({
        "role": new_role
    });

    let res = client
        .patch_json(&url, &body)
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("API error: {}", res.status()))
    }
}

// Экспорт для одного сотрудника
#[tauri::command]
pub async fn export_employee_data(
    app: tauri::AppHandle,
    employee: EmployeeAccess,
) -> Result<String, String> {
    let client = AuthClient::new(app);

    let spreadsheet_body = serde_json::json!({
        "properties": {
            "title": format!("Аудит доступов - {} - {}", employee.display_name, chrono::Utc::now().format("%Y-%m-%d"))
        }
    });

    let create_url = "https://sheets.googleapis.com/v4/spreadsheets";
    let create_res = client.post_json(create_url, &spreadsheet_body).await?;

    if !create_res.status().is_success() {
        return Err(format!("Ошибка создания таблицы: {}", create_res.status()));
    }

    let spreadsheet: serde_json::Value = create_res.json().await.map_err(|e| e.to_string())?;
    let spreadsheet_id = spreadsheet["spreadsheetId"].as_str().ok_or("Нет ID")?;
    let spreadsheet_url = spreadsheet["spreadsheetUrl"].as_str().ok_or("Нет URL")?;

    let mut rows: Vec<Vec<String>> = vec![vec![
        "Тип".to_string(),
        "Название".to_string(),
        "Роль".to_string(),
        "Путь".to_string(),
        "Ссылка".to_string(),
    ]];

    for access in &employee.accesses {
        rows.push(vec![
            access.item_type.clone(),
            access.item_name.clone(),
            access.role.clone(),
            access.path.clone(),
            access.url.clone(),
        ]);
    }

    let batch_url = format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}:batchUpdate",
        spreadsheet_id
    );

    let update_request = serde_json::json!({
        "requests": [{
            "updateCells": {
                "range": {
                    "sheetId": 0,
                    "startRowIndex": 0,
                    "startColumnIndex": 0
                },
                "rows": rows.iter().map(|row| {
                    serde_json::json!({
                        "values": row.iter().map(|cell| {
                            serde_json::json!({
                                "userEnteredValue": { "stringValue": cell }
                            })
                        }).collect::<Vec<_>>()
                    })
                }).collect::<Vec<_>>(),
                "fields": "userEnteredValue"
            }
        }]
    });

    client.post_json(&batch_url, &update_request).await?;

    crate::oauth::open_url(spreadsheet_url.to_string())?;
    Ok(spreadsheet_url.to_string())
}

// Глобальный экспорт (каждый сотрудник = лист)
#[tauri::command]
pub async fn export_all_employees(
    app: tauri::AppHandle,
    audit_result: AuditResult,
) -> Result<String, String> {
    let client = AuthClient::new(app);

    // Создаём таблицу с листами для каждого сотрудника
    let sheets: Vec<serde_json::Value> = audit_result
        .employees
        .iter()
        .enumerate()
        .map(|(idx, emp)| {
            serde_json::json!({
                "properties": {
                    "title": format!("{} ({})", emp.display_name, emp.total_access),
                    "sheetId": idx,
                    "gridProperties": {
                        "rowCount": emp.accesses.len() + 10,
                        "columnCount": 5
                    }
                }
            })
        })
        .collect();

    let spreadsheet_body = serde_json::json!({
        "properties": {
            "title": format!("Полный аудит - {}", chrono::Utc::now().format("%Y-%m-%d %H:%M"))
        },
        "sheets": sheets
    });

    let create_url = "https://sheets.googleapis.com/v4/spreadsheets";
    let create_res = client.post_json(create_url, &spreadsheet_body).await?;

    if !create_res.status().is_success() {
        return Err(format!("Ошибка создания таблицы: {}", create_res.status()));
    }

    let spreadsheet: serde_json::Value = create_res.json().await.map_err(|e| e.to_string())?;
    let spreadsheet_id = spreadsheet["spreadsheetId"].as_str().ok_or("Нет ID")?;
    let spreadsheet_url = spreadsheet["spreadsheetUrl"].as_str().ok_or("Нет URL")?;

    let batch_url = format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}:batchUpdate",
        spreadsheet_id
    );

    // Заполняем каждый лист
    for (sheet_idx, employee) in audit_result.employees.iter().enumerate() {
        let mut rows: Vec<Vec<String>> = vec![vec![
            "Тип".to_string(),
            "Название".to_string(),
            "Роль".to_string(),
            "Путь".to_string(),
            "Ссылка".to_string(),
        ]];

        for access in &employee.accesses {
            rows.push(vec![
                access.item_type.clone(),
                access.item_name.clone(),
                access.role.clone(),
                access.path.clone(),
                access.url.clone(),
            ]);
        }

        let update_request = serde_json::json!({
            "requests": [{
                "updateCells": {
                    "range": {
                        "sheetId": sheet_idx,
                        "startRowIndex": 0,
                        "startColumnIndex": 0
                    },
                    "rows": rows.iter().map(|row| {
                        serde_json::json!({
                            "values": row.iter().map(|cell| {
                                serde_json::json!({
                                    "userEnteredValue": { "stringValue": cell }
                                })
                            }).collect::<Vec<_>>()
                        })
                    }).collect::<Vec<_>>(),
                    "fields": "userEnteredValue"
                }
            }]
        });

        client.post_json(&batch_url, &update_request).await?;
    }

    crate::oauth::open_url(spreadsheet_url.to_string())?;
    Ok(spreadsheet_url.to_string())
}
