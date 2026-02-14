use crate::drive::utils::{get_item, list_folder_contents, DriveItem};
use crate::oauth::{get_drive_hub, get_sheets_hub};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

use crate::app_handle_storage::{get_app_handle, get_main_window};
use crate::drive::folder_cache::{add_scan_to_folder, ScanHistoryEntry};
use google_drive3::api::Permission as G_Permission;

// ─────────────────────────────────────────────
// Доменные типы
// ─────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Owner,
    Organizer,
    FileOrganizer,
    Editor,
    Commenter,
    Viewer,
}

impl From<&str> for Role {
    fn from(value: &str) -> Self {
        match value {
            "owner" => Role::Owner,
            "organizer" => Role::Organizer,
            "fileOrganizer" => Role::FileOrganizer,
            "writer" => Role::Editor,
            "commenter" => Role::Commenter,
            "reader" => Role::Viewer,
            _ => Role::Viewer,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub email: String,
    pub role: Role,
    pub permission_id: String,
    pub is_link: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime_type: String,
    pub parent_id: Option<String>,
    pub permissions: Vec<Permission>,
    pub properties: HashMap<String, String>,
}

// ─────────────────────────────────────────────
// Статистика
// ─────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeStats {
    pub total_items: usize,
    pub owners: usize,
    pub organizers: usize,
    pub file_organizers: usize,
    pub editors: usize,
    pub commenters: usize,
    pub viewers: usize,
    pub link_accesses: usize,
}

// ─────────────────────────────────────────────
// Прогресс и дерево (для emit в UI)
// ─────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub folders_processed: usize,
    pub files_processed: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: String,
    pub name: String,
    pub item_type: String,
    pub parent_id: Option<String>,
    pub has_suspicious_access: bool,
    pub suspicious_count: usize,
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingStatus {
    pub node_id: String,
    pub status: String,
}

// ─────────────────────────────────────────────
// Результат аудита
// ─────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditResult {
    pub items: HashMap<String, Item>,
    pub email_index: HashMap<String, Vec<(String, usize)>>,
    pub stats: HashMap<String, EmployeeStats>,
    pub scan_date: String,
}

// ─────────────────────────────────────────────
// Scanner
// ─────────────────────────────────────────────

pub struct AuditScanner {
    app: tauri::AppHandle,
    window: tauri::Window,
    items: Arc<RwLock<HashMap<String, Item>>>,
    email_index: Arc<RwLock<HashMap<String, Vec<(String, usize)>>>>,
    log_tx: mpsc::UnboundedSender<String>,
    cancel_token: CancellationToken,
    folder_cache: Arc<RwLock<HashMap<String, Vec<DriveItem>>>>,
    processed_folders: Arc<RwLock<usize>>,
    processed_files: Arc<RwLock<usize>>,
}

impl AuditScanner {
    pub async fn new(
        app: tauri::AppHandle,
        window: tauri::Window,
    ) -> (Self, mpsc::UnboundedReceiver<String>) {
        let (log_tx, log_rx) = mpsc::unbounded_channel();

        let scanner = Self {
            app,
            window,
            items: Arc::new(RwLock::new(HashMap::new())),
            email_index: Arc::new(RwLock::new(HashMap::new())),
            log_tx,
            cancel_token: CancellationToken::new(),
            folder_cache: Arc::new(RwLock::new(HashMap::new())),
            processed_folders: Arc::new(RwLock::new(0)),
            processed_files: Arc::new(RwLock::new(0)),
        };

        (scanner, log_rx)
    }

    fn clone_for_task(&self) -> Self {
        Self {
            app: self.app.clone(),
            window: self.window.clone(),
            items: self.items.clone(),
            email_index: self.email_index.clone(),
            log_tx: self.log_tx.clone(),
            cancel_token: self.cancel_token.clone(),
            folder_cache: self.folder_cache.clone(),
            processed_folders: self.processed_folders.clone(),
            processed_files: self.processed_files.clone(),
        }
    }

    fn log(&self, message: &str) {
        let _ = self.log_tx.send(message.to_string());
    }

    fn emit_progress(&self) {
        let window = self.window.clone();
        let folders = self.processed_folders.clone();
        let files = self.processed_files.clone();
        tokio::spawn(async move {
            let f = *folders.read().await;
            let fi = *files.read().await;
            let _ = window.emit(
                "audit_progress",
                &ScanProgress {
                    folders_processed: f,
                    files_processed: fi,
                },
            );
        });
    }

    fn emit_tree_node(&self, node: TreeNode) {
        let _ = self.window.emit("audit_tree_node", &node);
    }

    fn emit_processing_status(&self, node_id: &str, status: &str) {
        let _ = self.window.emit(
            "audit_processing_status",
            &ProcessingStatus {
                node_id: node_id.to_string(),
                status: status.to_string(),
            },
        );
    }

    async fn get_folder_contents_cached(&self, folder_id: &str) -> Result<Vec<DriveItem>, String> {
        {
            let cache = self.folder_cache.read().await;
            if let Some(contents) = cache.get(folder_id) {
                return Ok(contents.clone());
            }
        }
        let contents = list_folder_contents(self.app.clone(), folder_id).await?;
        self.folder_cache
            .write()
            .await
            .insert(folder_id.to_string(), contents.clone());
        Ok(contents)
    }

    pub async fn scan(&self, folder_id: &str) -> Result<AuditResult, String> {
        let start = Instant::now();
        self.log("🔍 Запуск аудита...");

        let scan_result = self
            .process_folder_inner(folder_id, None, String::new())
            .await;

        if let Err(e) = scan_result {
            if e == "Cancelled" {
                self.log("⚠️ Сканирование отменено пользователем");
                return Err("Cancelled".to_string());
            }
            return Err(e);
        }

        if self.cancel_token.is_cancelled() {
            self.log("⚠️ Сканирование отменено пользователем");
            return Err("Cancelled".to_string());
        }

        let items = self.items.read().await.clone();
        let email_index = self.email_index.read().await.clone();

        let stats = Self::build_stats(&items, &email_index);

        let duration = start.elapsed().as_secs_f64();
        let folders_count = *self.processed_folders.read().await;
        let files_count = *self.processed_files.read().await;

        let mut suspicious_count = 0;
        for items_list in email_index.values() {
            suspicious_count += items_list.len();
        }

        self.log(&format!(
            "✅ Готово: {} item'ов, {} участников за {:.2} сек",
            items.len(),
            email_index.len(),
            duration,
        ));

        let scan_data = ScanHistoryEntry {
            timestamp: chrono::Utc::now().timestamp(),
            folders_count,
            files_count,
            duration_sec: duration,
            suspicious_count,
        };

        if let Err(e) = add_scan_to_folder(folder_id, scan_data) {
            self.log(&format!("⚠️ Не удалось сохранить статистику: {}", e));
        }

        Ok(AuditResult {
            items,
            email_index,
            stats,
            scan_date: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn build_stats(
        items: &HashMap<String, Item>,
        email_index: &HashMap<String, Vec<(String, usize)>>,
    ) -> HashMap<String, EmployeeStats> {
        let mut stats: HashMap<String, EmployeeStats> = HashMap::new();

        for (email, entries) in email_index {
            let s = stats.entry(email.clone()).or_default();
            s.total_items = entries.len();

            for (item_id, perm_idx) in entries {
                let Some(item) = items.get(item_id) else {
                    continue;
                };
                let Some(perm) = item.permissions.get(*perm_idx) else {
                    continue;
                };

                if perm.is_link {
                    s.link_accesses += 1;
                } else {
                    match perm.role {
                        Role::Owner => s.owners += 1,
                        Role::Organizer => s.organizers += 1,
                        Role::FileOrganizer => s.file_organizers += 1,
                        Role::Editor => s.editors += 1,
                        Role::Commenter => s.commenters += 1,
                        Role::Viewer => s.viewers += 1,
                    }
                }
            }
        }

        stats
    }

    fn process_folder_inner<'a>(
        &'a self,
        folder_id: &'a str,
        parent_id: Option<String>,
        current_path: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            *self.processed_folders.write().await += 1;
            self.emit_progress();
            self.emit_processing_status(folder_id, "processing");

            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            let drive_item = get_item(self.app.clone(), folder_id).await?;

            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            let folder_name = drive_item
                .name
                .as_deref()
                .unwrap_or("Без названия")
                .to_string();

            let full_path = if current_path.is_empty() {
                folder_name.clone()
            } else {
                format!("{} / {}", current_path, folder_name)
            };

            self.log(&format!("📁 {}", folder_name));

            let folder_item = self
                .convert_and_store(&drive_item, &full_path, parent_id.clone())
                .await;

            self.emit_tree_node(TreeNode {
                id: folder_id.to_string(),
                name: folder_name.clone(),
                item_type: "folder".to_string(),
                parent_id: parent_id.clone(),
                has_suspicious_access: folder_item.permissions.iter().any(|p| p.is_link),
                suspicious_count: folder_item.permissions.len(),
                path: full_path.clone(),
            });

            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            let children = self.get_folder_contents_cached(folder_id).await?;

            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            let files: Vec<_> = children
                .iter()
                .filter(|i| !i.is_folder())
                .cloned()
                .collect();
            let subfolders: Vec<_> = children.iter().filter(|i| i.is_folder()).cloned().collect();

            for sf in &subfolders {
                if let Some(sf_id) = &sf.id {
                    self.emit_processing_status(sf_id, "queued");
                }
            }

            let mut file_handles = Vec::new();
            for file in files {
                if self.cancel_token.is_cancelled() {
                    return Err("Cancelled".to_string());
                }

                let scanner = self.clone_for_task();
                let path = full_path.clone();
                let pid = Some(folder_id.to_string());

                let handle = tokio::spawn(async move {
                    if scanner.cancel_token.is_cancelled() {
                        return;
                    }

                    let item = scanner.convert_and_store(&file, &path, pid).await;

                    if scanner.cancel_token.is_cancelled() {
                        return;
                    }

                    if !item.permissions.is_empty() {
                        scanner.emit_tree_node(TreeNode {
                            id: item.id.clone(),
                            name: item.name.clone(),
                            item_type: "file".to_string(),
                            parent_id: item.parent_id.clone(),
                            has_suspicious_access: item.permissions.iter().any(|p| p.is_link),
                            suspicious_count: item.permissions.len(),
                            path: item.path.clone(),
                        });
                    }

                    *scanner.processed_files.write().await += 1;
                    scanner.emit_progress();
                });

                file_handles.push(handle);
            }

            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            for h in file_handles {
                let _ = h.await;
            }

            if self.cancel_token.is_cancelled() {
                return Err("Cancelled".to_string());
            }

            let mut subfolder_tasks = Vec::new();
            for subfolder in subfolders {
                if self.cancel_token.is_cancelled() {
                    return Err("Cancelled".to_string());
                }
                if let Some(sf_id) = subfolder.id.clone() {
                    let scanner = self.clone_for_task();
                    let pid = Some(folder_id.to_string());
                    let path = full_path.clone();

                    let task = tokio::spawn(async move {
                        scanner.emit_processing_status(&sf_id, "processing");
                        let res = scanner.process_folder_inner(&sf_id, pid, path).await;
                        scanner.emit_processing_status(&sf_id, "done");
                        res
                    });
                    subfolder_tasks.push(task);
                }
            }

            for task in subfolder_tasks {
                if self.cancel_token.is_cancelled() {
                    return Err("Cancelled".to_string());
                }
                match task.await {
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => {
                        if e == "Cancelled" {
                            return Err("Cancelled".to_string());
                        }
                        self.log(&format!("Ошибка в подпапке: {}", e))
                    }
                    Err(e) => self.log(&format!("Задача подпапки упала: {:?}", e)),
                }
            }

            self.emit_processing_status(folder_id, "done");
            Ok(())
        })
    }

    async fn convert_and_store(
        &self,
        drive_item: &DriveItem,
        path: &str,
        parent_id: Option<String>,
    ) -> Item {
        let id = drive_item.id.clone().unwrap_or_default();
        let name = drive_item
            .name
            .clone()
            .unwrap_or_else(|| "Без названия".to_string());
        let mime_type = drive_item.mime_type.clone().unwrap_or_default();

        let raw_perms = drive_item.permissions.as_deref().unwrap_or(&[]);

        let mut permissions: Vec<Permission> = Vec::with_capacity(raw_perms.len());

        for raw in raw_perms {
            let role = Role::from(raw.role.as_deref().unwrap_or("reader"));
            let perm_type = raw.perm_type.as_deref().unwrap_or("");
            let is_link = perm_type == "anyone";

            let email = if is_link {
                String::new()
            } else {
                raw.email_address
                    .as_ref()
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default()
            };

            if !is_link && email.is_empty() {
                continue;
            }

            permissions.push(Permission {
                email: email.clone(),
                role,
                permission_id: raw.id.clone().unwrap_or_default(),
                is_link,
            });
        }

        let item = Item {
            id: id.clone(),
            name,
            path: path.to_string(),
            mime_type,
            parent_id,
            permissions: permissions.clone(),
            properties: drive_item.properties.clone(),
        };

        self.items.write().await.insert(id.clone(), item.clone());

        {
            let mut index = self.email_index.write().await;
            for (perm_idx, perm) in permissions.iter().enumerate() {
                let key = if perm.is_link {
                    "__link__".to_string()
                } else {
                    perm.email.clone()
                };
                index.entry(key).or_default().push((id.clone(), perm_idx));
            }
        }

        item
    }
}

// ─────────────────────────────────────────────
// Глобальный токен
// ─────────────────────────────────────────────

static CANCEL_TOKEN: Lazy<Arc<RwLock<Option<CancellationToken>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

// ─────────────────────────────────────────────
// Tauri-команды
// ─────────────────────────────────────────────

#[tauri::command]
pub async fn audit_drive(
    app: tauri::AppHandle,
    window: tauri::Window,
    folder_id: String,
) -> Result<AuditResult, String> {
    let (scanner, mut log_rx) = AuditScanner::new(app.clone(), window.clone()).await;

    *CANCEL_TOKEN.write().await = Some(scanner.cancel_token.clone());

    let window_clone = window.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = window_clone.emit("audit_log", &msg);
        }
    });

    let scanner_clone = scanner.clone_for_task();
    let progress_window = window.clone();
    let progress_handle = tokio::spawn(async move {
        loop {
            let folders = *scanner_clone.processed_folders.read().await;
            let files = *scanner_clone.processed_files.read().await;
            let _ = progress_window.emit(
                "audit_progress",
                &ScanProgress {
                    folders_processed: folders,
                    files_processed: files,
                },
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let result = scanner.scan(&folder_id).await;
    progress_handle.abort();

    *CANCEL_TOKEN.write().await = None;

    result
}

#[tauri::command]
pub async fn cancel_audit_drive() -> Result<(), String> {
    let token = CANCEL_TOKEN.read().await;
    if let Some(t) = token.as_ref() {
        t.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn update_link_access(
    app: tauri::AppHandle,
    item_id: String,
    permission_id: String,
    new_role: String,
) -> Result<(), String> {
    let hub = get_drive_hub(&app).await?;
    let mut perm = google_drive3::api::Permission::default();
    perm.role = Some(new_role);

    hub.permissions()
        .update(perm, &item_id, &permission_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .supports_all_drives(true)
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn verify_access(
    app: tauri::AppHandle,
    item_id: String,
    email: String,
    permission_id: Option<String>,
) -> Result<bool, String> {
    let item = get_item(app.clone(), &item_id).await;

    match item {
        Ok(item) => {
            let email_lower = email.to_lowercase();

            if item
                .owners
                .unwrap_or_default()
                .iter()
                .any(|o| o.email_address.as_deref().unwrap_or("").to_lowercase() == email_lower)
            {
                return Ok(true);
            }

            let still_exists = item.permissions.unwrap_or_default().iter().any(|p| {
                let matches_email = p
                    .email_address
                    .as_deref()
                    .map(|e| e.to_lowercase() == email_lower)
                    .unwrap_or(false);

                if !matches_email {
                    return false;
                }

                match &permission_id {
                    Some(pid) => p.id.as_deref().unwrap_or("") == pid,
                    None => true,
                }
            });

            Ok(still_exists)
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn export_employee_data(
    app: tauri::AppHandle,
    window: tauri::Window,
    email: String,
    audit_result: AuditResult,
) -> Result<String, String> {
    let hub = get_sheets_hub(&app).await?;

    let accesses = audit_result
        .email_index
        .get(&email.to_lowercase())
        .ok_or("Сотрудник не найден")?;

    let mut rows: Vec<Vec<String>> = vec![vec![
        "Тип".to_string(),
        "Название".to_string(),
        "Роль".to_string(),
        "Путь".to_string(),
        "ID".to_string(),
    ]];

    for (item_id, perm_idx) in accesses {
        let item = audit_result.items.get(item_id).ok_or("Item не найден")?;

        let perm = item
            .permissions
            .get(*perm_idx)
            .ok_or("Permission не найден")?;

        let item_type = if item.mime_type.contains("folder") {
            "Папка"
        } else {
            "Файл"
        };

        let role_str = match perm.role {
            Role::Owner => "Владелец",
            Role::Organizer => "Организатор",
            Role::FileOrganizer => "Файл-организатор",
            Role::Editor => "Редактор",
            Role::Commenter => "Комментатор",
            Role::Viewer => "Просмотр",
        };

        rows.push(vec![
            item_type.to_string(),
            item.name.clone(),
            role_str.to_string(),
            item.path.clone(),
            item.id.clone(),
        ]);
    }

    let title = format!(
        "Аудит доступов - {} - {}",
        email,
        chrono::Utc::now().format("%Y-%m-%d")
    );

    let total_rows = rows.len() as i32;
    let row_count = (total_rows + 100).max(2000);

    let mut grid_props = google_sheets4::api::GridProperties::default();
    grid_props.row_count = Some(row_count);
    grid_props.column_count = Some(26);

    let mut sheet = google_sheets4::api::Sheet::default();
    let mut sheet_props = google_sheets4::api::SheetProperties::default();
    sheet_props.title = Some("Данные".to_string());
    sheet_props.sheet_id = Some(0);
    sheet_props.grid_properties = Some(grid_props);
    sheet.properties = Some(sheet_props);

    let mut spreadsheet = google_sheets4::api::Spreadsheet::default();
    let mut props = google_sheets4::api::SpreadsheetProperties::default();
    props.title = Some(title);
    spreadsheet.properties = Some(props);
    spreadsheet.sheets = Some(vec![sheet]);

    let (_, created) = hub
        .spreadsheets()
        .create(spreadsheet)
        .add_scope("https://www.googleapis.com/auth/spreadsheets")
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    let spreadsheet_id = created.spreadsheet_id.clone().ok_or("Нет spreadsheetId")?;
    let spreadsheet_url = created
        .spreadsheet_url
        .clone()
        .ok_or("Нет spreadsheetUrl")?;

    window
        .emit("audit_log", "Записываем данные в таблицу...")
        .ok();

    let mut start_row = 1;

    for chunk in rows.chunks(900) {
        let range = format!("Данные!A{}", start_row);

        let mut value_range = google_sheets4::api::ValueRange::default();
        value_range.range = Some(range);
        value_range.values = Some(
            chunk
                .iter()
                .map(|r| r.iter().map(|c| c.clone().into()).collect())
                .collect(),
        );

        let mut batch = google_sheets4::api::BatchUpdateValuesRequest::default();
        batch.value_input_option = Some("USER_ENTERED".to_string());
        batch.data = Some(vec![value_range]);

        hub.spreadsheets()
            .values_batch_update(batch, &spreadsheet_id)
            .add_scope("https://www.googleapis.com/auth/spreadsheets")
            .doit()
            .await
            .map_err(|e| e.to_string())?;

        start_row += chunk.len();
    }

    let permission = G_Permission {
        type_: Some("anyone".to_string()),
        role: Some("reader".to_string()),
        ..Default::default()
    };

    let drive_hub = get_drive_hub(&app).await?;

    let result = drive_hub
        .permissions()
        .create(permission, &spreadsheet_id)
        .doit()
        .await;

    if result.is_err() {
        window
            .emit("audit_log", "⚠️ Не удалось сделать таблицу публичной")
            .ok();
    }

    window
        .emit("audit_log", "✅ Данные записаны, открываем таблицу...")
        .ok();

    crate::oauth::open_url(spreadsheet_url.clone())?;
    Ok(spreadsheet_url)
}

#[tauri::command]
pub async fn export_all_employees(
    app: tauri::AppHandle,
    window: tauri::Window,
    audit_result: AuditResult,
) -> Result<String, String> {
    let hub = get_sheets_hub(&app).await?;

    let mut employees: Vec<(String, &EmployeeStats)> = audit_result
        .stats
        .iter()
        .filter(|(email, _)| *email != "__link__")
        .map(|(email, stats)| (email.clone(), stats))
        .collect();

    employees.sort_by(|a, b| b.1.total_items.cmp(&a.1.total_items));

    let mut sheets = Vec::new();
    let mut info_sheet = google_sheets4::api::Sheet::default();
    let mut info_props = google_sheets4::api::SheetProperties::default();
    info_props.title = Some("Сводка".to_string());
    info_props.sheet_id = Some(0);
    info_sheet.properties = Some(info_props);
    sheets.push(info_sheet);

    let mut spreadsheet = google_sheets4::api::Spreadsheet::default();
    let mut spreadsheet_props = google_sheets4::api::SpreadsheetProperties::default();
    spreadsheet_props.title = Some(format!(
        "Аудит доступов {}",
        chrono::Utc::now().format("%Y-%m-%d")
    ));
    spreadsheet.properties = Some(spreadsheet_props);
    spreadsheet.sheets = Some(sheets);

    let (_, created) = hub
        .spreadsheets()
        .create(spreadsheet)
        .add_scope("https://www.googleapis.com/auth/spreadsheets")
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    let spreadsheet_id = created.spreadsheet_id.clone().ok_or("Нет ID")?;
    let spreadsheet_url = created.spreadsheet_url.clone().ok_or("Нет URL")?;

    window.emit("audit_log", "Записываем сводку...").ok();

    let mut info_rows = vec![vec![
        "Сотрудник".to_string(),
        "Всего доступов".to_string(),
        "Владелец".to_string(),
        "Редактор".to_string(),
        "Просмотр".to_string(),
    ]];

    for (email, stats) in &employees {
        info_rows.push(vec![
            email.clone(),
            stats.total_items.to_string(),
            stats.owners.to_string(),
            stats.editors.to_string(),
            stats.viewers.to_string(),
        ]);
    }

    let mut info_range = google_sheets4::api::ValueRange::default();
    info_range.range = Some("Сводка!A1".to_string());
    info_range.values = Some(
        info_rows
            .iter()
            .map(|r| r.iter().map(|c| c.clone().into()).collect())
            .collect(),
    );

    let mut info_batch = google_sheets4::api::BatchUpdateValuesRequest::default();
    info_batch.value_input_option = Some("USER_ENTERED".to_string());
    info_batch.data = Some(vec![info_range]);

    hub.spreadsheets()
        .values_batch_update(info_batch, &spreadsheet_id)
        .add_scope("https://www.googleapis.com/auth/spreadsheets")
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    window
        .emit(
            "audit_log",
            format!("Записали сводку по {} сотрудникам", employees.len()),
        )
        .ok();

    window.emit("audit_log", "Создаём листы...").ok();

    let mut create_requests = Vec::new();
    for (email, stats) in &employees {
        let sheet_title = format!("{} ({})", email, stats.total_items);

        let mut add_sheet = google_sheets4::api::AddSheetRequest::default();
        let mut props = google_sheets4::api::SheetProperties::default();
        props.title = Some(sheet_title);

        let mut grid_props = google_sheets4::api::GridProperties::default();
        grid_props.row_count = Some((stats.total_items as i32) + 200);
        grid_props.column_count = Some(5);
        props.grid_properties = Some(grid_props);

        add_sheet.properties = Some(props);

        let mut request = google_sheets4::api::Request::default();
        request.add_sheet = Some(add_sheet);
        create_requests.push(request);
    }

    let mut create_batch = google_sheets4::api::BatchUpdateSpreadsheetRequest::default();
    create_batch.requests = Some(create_requests);

    hub.spreadsheets()
        .batch_update(create_batch, &spreadsheet_id)
        .add_scope("https://www.googleapis.com/auth/spreadsheets")
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    window
        .emit("audit_log", format!("Создали {} листов", employees.len()))
        .ok();

    const BATCH_SIZE: usize = 30;

    for (batch_idx, employees_chunk) in employees.chunks(BATCH_SIZE).enumerate() {
        window
            .emit(
                "audit_log",
                format!("Записываем порцию {}...", batch_idx + 1),
            )
            .ok();

        let mut value_ranges = Vec::new();

        for (email, stats) in employees_chunk {
            let sheet_title = format!("{} ({})", email, stats.total_items);

            let accesses = audit_result.email_index.get(&*email).unwrap();

            let mut rows = vec![vec![
                "Тип".into(),
                "Название".into(),
                "Роль".into(),
                "Путь".into(),
                "ID".into(),
            ]];

            for (item_id, perm_idx) in accesses {
                let item = &audit_result.items[item_id];
                let perm = &item.permissions[*perm_idx];

                let item_type = if item.mime_type.contains("folder") {
                    "Папка"
                } else {
                    "Файл"
                };

                let role_str = match perm.role {
                    Role::Owner => "Владелец",
                    Role::Organizer => "Организатор",
                    Role::FileOrganizer => "Файл-организатор",
                    Role::Editor => "Редактор",
                    Role::Commenter => "Комментатор",
                    Role::Viewer => "Просмотр",
                };

                rows.push(vec![
                    item_type.to_string(),
                    item.name.clone(),
                    role_str.to_string(),
                    item.path.clone(),
                    item.id.clone(),
                ]);
            }

            let range = format!("'{}'!A1", sheet_title);

            let mut vr = google_sheets4::api::ValueRange::default();
            vr.range = Some(range);
            vr.values = Some(
                rows.iter()
                    .map(|r| r.iter().map(|c| c.clone().into()).collect())
                    .collect(),
            );

            value_ranges.push(vr);
        }

        let mut batch = google_sheets4::api::BatchUpdateValuesRequest::default();
        batch.value_input_option = Some("USER_ENTERED".to_string());
        batch.data = Some(value_ranges);

        hub.spreadsheets()
            .values_batch_update(batch, &spreadsheet_id)
            .add_scope("https://www.googleapis.com/auth/spreadsheets")
            .doit()
            .await
            .map_err(|e| e.to_string())?;

        window
            .emit(
                "audit_log",
                format!("Записали {} сотрудников", employees_chunk.len()),
            )
            .ok();

        if batch_idx < (employees.len() + BATCH_SIZE - 1) / BATCH_SIZE - 1 {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    }

    let permission = G_Permission {
        type_: Some("anyone".to_string()),
        role: Some("reader".to_string()),
        ..Default::default()
    };

    let drive_hub = get_drive_hub(&app).await?;

    let result = drive_hub
        .permissions()
        .create(permission, &spreadsheet_id)
        .doit()
        .await;

    if result.is_err() {
        window
            .emit("audit_log", "⚠️ Не удалось сделать таблицу публичной")
            .ok();
    }

    window
        .emit("audit_log", "✅ Данные записаны, открываем таблицу...")
        .ok();

    crate::oauth::open_url(spreadsheet_url.clone())?;
    Ok(spreadsheet_url)
}

#[tauri::command]
pub async fn export_links_data(
    app: tauri::AppHandle,
    window: tauri::Window,
    audit_result: AuditResult,
) -> Result<String, String> {
    let hub = get_sheets_hub(&app).await?;

    let mut rows: Vec<Vec<String>> = vec![vec![
        "Тип".to_string(),
        "Название".to_string(),
        "Роль ссылки".to_string(),
        "Путь".to_string(),
        "ID".to_string(),
    ]];

    if let Some(link_accesses) = audit_result.email_index.get("__link__") {
        for (item_id, perm_idx) in link_accesses {
            let item = audit_result.items.get(item_id).ok_or("Item не найден")?;

            let perm = item
                .permissions
                .get(*perm_idx)
                .ok_or("Permission не найден")?;

            let item_type = if item.mime_type.contains("folder") {
                "Папка"
            } else {
                "Файл"
            };

            let role_str = match perm.role {
                Role::Owner => "Владелец",
                Role::Organizer => "Организатор",
                Role::FileOrganizer => "Файл-организатор",
                Role::Editor => "Редактор",
                Role::Commenter => "Комментатор",
                Role::Viewer => "Просмотр",
            };

            rows.push(vec![
                item_type.to_string(),
                item.name.clone(),
                role_str.to_string(),
                item.path.clone(),
                item.id.clone(),
            ]);
        }
    }

    let title = format!(
        "Аудит доступов по ссылкам - {}",
        chrono::Utc::now().format("%Y-%m-%d")
    );

    let mut spreadsheet = google_sheets4::api::Spreadsheet::default();
    let mut props = google_sheets4::api::SpreadsheetProperties::default();
    props.title = Some(title);
    spreadsheet.properties = Some(props);

    let (_, created) = hub
        .spreadsheets()
        .create(spreadsheet)
        .add_scope("https://www.googleapis.com/auth/spreadsheets")
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    let spreadsheet_id = created.spreadsheet_id.clone().ok_or("Нет spreadsheetId")?;
    let spreadsheet_url = created
        .spreadsheet_url
        .clone()
        .ok_or("Нет spreadsheetUrl")?;

    window
        .emit("audit_log", "Записываем данные в таблицу...")
        .ok();

    let mut start_row = 1;

    for chunk in rows.chunks(900) {
        let range = format!("Sheet1!A{}", start_row);

        let mut value_range = google_sheets4::api::ValueRange::default();
        value_range.range = Some(range);
        value_range.values = Some(
            chunk
                .iter()
                .map(|r| r.iter().map(|c| c.clone().into()).collect())
                .collect(),
        );

        let mut batch = google_sheets4::api::BatchUpdateValuesRequest::default();
        batch.value_input_option = Some("USER_ENTERED".to_string());
        batch.data = Some(vec![value_range]);

        hub.spreadsheets()
            .values_batch_update(batch, &spreadsheet_id)
            .add_scope("https://www.googleapis.com/auth/spreadsheets")
            .doit()
            .await
            .map_err(|e| e.to_string())?;

        start_row += chunk.len();
    }

    let permission = G_Permission {
        type_: Some("anyone".to_string()),
        role: Some("reader".to_string()),
        ..Default::default()
    };

    let drive_hub = get_drive_hub(&app).await?;

    let result = drive_hub
        .permissions()
        .create(permission, &spreadsheet_id)
        .doit()
        .await;

    if result.is_err() {
        window
            .emit("audit_log", "⚠️ Не удалось сделать таблицу публичной")
            .ok();
    }

    window
        .emit("audit_log", "✅ Данные записаны, открываем таблицу...")
        .ok();

    crate::oauth::open_url(spreadsheet_url.clone())?;
    Ok(spreadsheet_url)
}

#[tauri::command]
pub async fn delete_property(
    app: tauri::AppHandle,
    file_id: &str,
    key: &str,
) -> Result<(), String> {
    let window = get_main_window();

    let mut item = get_item(app.clone(), file_id).await?;

    item.delete_property(key);
    item.sync_properties().await?;

    window
        .emit(
            "audit_log",
            format!(
                "✅ Удалили {} свойство у объекта {}",
                key,
                item.name.unwrap_or("".to_string())
            ),
        )
        .ok();

    Ok(())
}

#[tauri::command]
pub async fn is_perm_exists(
    app: tauri::AppHandle,
    file_id: String,
    perm_id: String,
) -> Result<bool, String> {
    let hub = get_drive_hub(&app).await?;

    match hub
        .permissions()
        .get(&file_id, &perm_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .supports_all_drives(true)
        .doit()
        .await
    {
        Ok(_) => Ok(true),
        Err(google_drive3::Error::BadRequest(_)) => Ok(false),
        Err(google_drive3::Error::Failure(resp)) => {
            let status = resp.status();
            if status == 404 || status == 403 {
                Ok(false)
            } else {
                Err(format!("HTTP {}", status))
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn delete_original_from_parent(
    original_id: String,
    copy_id: String,
) -> Result<String, String> {
    let app = get_app_handle();
    let hub = get_drive_hub(&app).await?;
    let window = get_main_window();

    let original = get_item(app.clone(), &original_id).await?;
    let mut copy = get_item(app.clone(), &copy_id).await?;
    let parents = original.parents.ok_or("Нет родительских папок")?;

    for parent_id in parents {
        match hub
            .files()
            .update(google_drive3::api::File::default(), &original_id)
            .remove_parents(&parent_id)
            .add_scope("https://www.googleapis.com/auth/drive")
            .supports_all_drives(true)
            .doit_without_upload()
            .await
        {
            Ok(_) => {}
            Err(e) => {
                let err_str = e.to_string();
                // Google API иногда возвращает 204 No Content (пустое тело)
                if !err_str.contains("EOF while parsing") && !err_str.contains("expected value") {
                    return Err(format!("Failed: {}", err_str));
                }
                // Иначе игнорируем — операция успешна
            }
        }
    }

    copy.delete_property("original_item_id");
    copy.sync_properties().await?;

    let item_name = original.name.unwrap_or_else(|| String::from("без имени"));

    window
        .emit(
            "scan_log",
            &format!("🗑️ Удалили оригинал из папки: {}", item_name),
        )
        .ok();

    Ok(item_name)
}

#[tauri::command]
pub async fn is_this_folder(item_id: String) -> Result<(), String> {
    let app = get_app_handle();
    let hub = get_drive_hub(&app).await?;
    let app = get_app_handle();

    let result = hub
        .files()
        .get(&item_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .supports_all_drives(true)
        .param("fields", "id,name,mimeType")
        .doit()
        .await;

    println!("result: {:?}", result);

    match result {
        Ok((response, file)) => match file.mime_type {
            Some(mime_type) if mime_type == "application/vnd.google-apps.folder" => Ok(()),
            Some(_) => Err("Это не папка".to_string()),
            None => Err("mime_type не найден".to_string()),
        },
        Err(google_drive3::Error::BadRequest(json)) => {
            if let Some(error) = json.get("error") {
                if let Some(code) = error.get("code").and_then(|c| c.as_i64()) {
                    match code {
                        404 => Err("Файл не найден (404)".to_string()),
                        403 => Err("Нет доступа (403)".to_string()),
                        _ => Err(format!("HTTP error {}", code)),
                    }
                } else {
                    Err("Неизвестная ошибка".to_string())
                }
            } else {
                Err("Неизвестная ошибка".to_string())
            }
        }
        Err(e) => Err(format!("Drive API error: {}", e)),
    }
}
