use crate::drive::rate_semaphore::GLOBAL_SEMAPHORE;
use crate::drive::utils::{get_item, list_folder_contents, DriveItem};
use crate::oauth::{get_drive_hub, get_sheets_hub};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::{broadcast, mpsc, RwLock, Semaphore};
use tokio::task::JoinHandle;

use google_drive3::api::Permission as G_Permission;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub folders_processed: usize,
    pub files_processed: usize,
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
pub struct EmployeeAccess {
    pub email: String,
    pub display_name: String,
    pub total_access: usize,
    pub roles: HashMap<String, usize>,
    pub accesses: Vec<AccessDetail>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkAccess {
    pub item_id: String,
    pub item_name: String,
    pub item_type: String,
    pub url: String,
    pub link_share_role: String,
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

pub struct AuditScanner {
    app: tauri::AppHandle,
    window: tauri::Window,
    employee_map: Arc<RwLock<HashMap<String, EmployeeAccess>>>,
    link_accesses: Arc<RwLock<Vec<LinkAccess>>>,
    log_tx: mpsc::UnboundedSender<String>,
    cancel_tx: broadcast::Sender<()>,
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
        let (cancel_tx, _) = broadcast::channel(1);

        let scanner = Self {
            app,
            window,
            employee_map: Arc::new(RwLock::new(HashMap::new())),
            link_accesses: Arc::new(RwLock::new(Vec::new())),
            log_tx,
            cancel_tx,
            folder_cache: Arc::new(RwLock::new(HashMap::new())),
            processed_folders: Arc::new(RwLock::new(0)),
            processed_files: Arc::new(RwLock::new(0)),
        };

        (scanner, log_rx)
    }

    fn emit_progress(&self) {
        tokio::spawn({
            let window = self.window.clone();
            let folders = self.processed_folders.clone();
            let files = self.processed_files.clone();

            async move {
                let f = *folders.read().await;
                let fi = *files.read().await;
                let _ = window.emit(
                    "audit_progress",
                    &ScanProgress {
                        folders_processed: f,
                        files_processed: fi,
                    },
                );
            }
        });
    }

    fn log(&self, message: &str) {
        let _ = self.log_tx.send(message.to_string());
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

    fn clone_for_task(&self) -> Self {
        Self {
            app: self.app.clone(),
            window: self.window.clone(),
            employee_map: self.employee_map.clone(),
            link_accesses: self.link_accesses.clone(),
            log_tx: self.log_tx.clone(),
            cancel_tx: self.cancel_tx.clone(),
            folder_cache: self.folder_cache.clone(),
            processed_folders: self.processed_folders.clone(), // добавить
            processed_files: self.processed_files.clone(),     // добавить
        }
    }

    async fn get_folder_contents_cached(&self, folder_id: &str) -> Result<Vec<DriveItem>, String> {
        {
            let cache = self.folder_cache.read().await;
            if let Some(contents) = cache.get(folder_id) {
                return Ok(contents.clone());
            }
        }

        let contents = list_folder_contents(self.app.clone(), folder_id).await?;

        {
            let mut cache = self.folder_cache.write().await;
            cache.insert(folder_id.to_string(), contents.clone());
        }

        Ok(contents)
    }

    pub async fn scan(&self, folder_id: &str) -> Result<AuditResult, String> {
        let start = Instant::now();
        self.log("🔍 Запуск аудита...");
        self.process_folder_audit(folder_id, None, String::new())
            .await?;

        let employee_map = self.employee_map.read().await;
        let mut employees: Vec<EmployeeAccess> = employee_map.values().cloned().collect();
        employees.sort_by(|a, b| b.total_access.cmp(&a.total_access));

        let link_accesses = self.link_accesses.read().await.clone();

        self.log(&format!(
            "✅ Готово: {} сотрудников, {} ссылок",
            employees.len(),
            link_accesses.len()
        ));

        let duration = start.elapsed();
        let seconds = duration.as_secs_f64();

        self.log(&format!("Сканирование выполнилось за {:.2} сек", seconds));

        let folders = *self.processed_folders.read().await;
        let files = *self.processed_files.read().await;

        Ok(AuditResult {
            employees,
            link_accesses,
            scan_date: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn process_folder_audit(
        &self,
        folder_id: &str,
        parent_id: Option<String>, // ДОБАВИТЬ parent_id
        current_path: String,
    ) -> Result<(), String> {
        self.process_folder_inner(folder_id, parent_id, current_path)
            .await
    }

    fn process_folder_inner<'a>(
        &'a self,
        folder_id: &'a str,
        parent_id: Option<String>,
        current_path: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            let mut cancel_rx = self.cancel_tx.subscribe();
            if cancel_rx.try_recv().is_ok() {
                return Err("Cancelled".to_string());
            }

            {
                let mut count = self.processed_folders.write().await;
                *count += 1;
            }
            self.emit_progress();

            self.emit_processing_status(folder_id, "processing");

            let folder = get_item(self.app.clone(), folder_id).await?;
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

            self.emit_tree_node(TreeNode {
                id: folder_id.to_string(),
                name: folder_name.clone(),
                item_type: "folder".to_string(),
                parent_id: parent_id.clone(),
                has_suspicious_access: false,
                suspicious_count: 0,
                path: full_path.clone(),
            });

            self.process_item_permissions(&folder, &full_path, parent_id.as_deref())
                .await;

            let items = self.get_folder_contents_cached(folder_id).await?;

            let files: Vec<_> = items.iter().filter(|i| !i.is_folder()).cloned().collect();
            let subfolders: Vec<_> = items.iter().filter(|i| i.is_folder()).cloned().collect();

            for subfolder in &subfolders {
                if let Some(subfolder_id) = &subfolder.id {
                    self.emit_processing_status(subfolder_id, "queued");
                }
            }

            let mut file_handles = Vec::new();
            for file in files {
                let scanner = self.clone_for_task();
                let path = full_path.clone();
                let folder_id_str = folder_id.to_string();

                let handle = tokio::spawn(async move {
                    scanner
                        .process_item_permissions(&file, &path, Some(&folder_id_str))
                        .await;
                    {
                        let mut count = scanner.processed_files.write().await;
                        *count += 1;
                    }
                    scanner.emit_progress();
                });

                file_handles.push(handle);
            }

            for handle in file_handles {
                let _ = handle.await;
            }

            // Параллельная обработка подпапок
            let mut subfolder_tasks = Vec::new();

            for subfolder in subfolders {
                if cancel_rx.try_recv().is_ok() {
                    break;
                }

                if let Some(subfolder_id) = subfolder.id.clone() {
                    let scanner = self.clone_for_task();
                    let parent_id = Some(folder_id.to_string());
                    let path = full_path.clone();

                    let task = tokio::spawn(async move {
                        scanner.emit_processing_status(&subfolder_id, "processing");
                        let result = scanner
                            .process_folder_inner(&subfolder_id, parent_id, path)
                            .await;
                        scanner.emit_processing_status(&subfolder_id, "done");
                        result
                    });

                    subfolder_tasks.push(task);
                }
            }

            for task in subfolder_tasks {
                match task.await {
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => {
                        self.log(&format!("Ошибка в подпапке: {}", e));
                    }
                    Err(join_err) => {
                        self.log(&format!("Задача подпапки упала: {:?}", join_err));
                    }
                }
            }

            self.emit_processing_status(folder_id, "done");

            Ok(())
        })
    }

    async fn process_item_permissions(
        &self,
        item: &DriveItem,
        path: &str,
        parent_id: Option<&str>,
    ) {
        let permissions = item.permissions.as_deref().unwrap_or(&[]);
        let item_id = item.id.as_ref().unwrap_or(&String::new()).clone();
        let item_name = item
            .name
            .as_ref()
            .unwrap_or(&"Без названия".to_string())
            .clone();
        let is_folder = item.is_folder();
        let item_type = if is_folder { "Папка" } else { "Файл" };

        let mut personal_count = 0;
        let mut link_count = 0;

        for perm in permissions {
            let role = perm.role.as_deref().unwrap_or("reader");
            let perm_type = perm.perm_type.as_deref().unwrap_or("");

            // Ссылочный доступ
            if perm_type == "anyone" {
                link_count += 1;
                let mut links = self.link_accesses.write().await;
                links.push(LinkAccess {
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
                personal_count += 1;
                let email_lower = email.to_lowercase();
                let display_name = perm.display_name.clone().unwrap_or_else(|| email.clone());

                let mut employee_map = self.employee_map.write().await;
                let employee =
                    employee_map
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

        if !is_folder && (personal_count > 0 || link_count > 0) {
            self.emit_tree_node(TreeNode {
                id: item_id.clone(),
                name: item_name.clone(),
                item_type: "file".to_string(),
                parent_id: parent_id.map(|s| s.to_string()),
                has_suspicious_access: true,
                suspicious_count: personal_count + link_count,
                path: path.to_string(),
            });
        }
    }
}

static CANCEL_AUDIT: OnceCell<broadcast::Sender<()>> = OnceCell::new();

#[tauri::command]
pub async fn audit_drive(
    app: tauri::AppHandle,
    window: tauri::Window,
    folder_id: String,
) -> Result<AuditResult, String> {
    let (scanner, mut log_rx) = AuditScanner::new(app.clone(), window.clone()).await;

    CANCEL_AUDIT.get_or_init(|| scanner.cancel_tx.clone());

    let window_clone = window.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = window_clone.emit("audit_log", &msg);
        }
    });

    // ДОБАВИТЬ периодический прогресс:
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

    result
}

#[tauri::command]
pub async fn cancel_audit_drive() -> Result<(), String> {
    if let Some(cancel_tx) = CANCEL_AUDIT.get() {
        let _ = cancel_tx.send(());
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
pub async fn export_employee_data(
    app: tauri::AppHandle,
    window: tauri::Window,
    employee: EmployeeAccess,
) -> Result<String, String> {
    let hub = get_sheets_hub(&app).await?;

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

    let title = format!(
        "Аудит доступов - {} - {}",
        employee.display_name,
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
    let employees_count = audit_result.employees.len();

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

    let mut employees = audit_result.employees.clone();
    employees.sort_by(|a, b| b.total_access.cmp(&a.total_access));

    let mut info_rows = vec![vec![
        "Сотрудник".to_string(),
        "Количество доступов".to_string(),
    ]];

    for emp in &employees {
        info_rows.push(vec![emp.email.clone(), emp.total_access.to_string()]);
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
            format!("Записали сводку по {} сотрудникам", employees_count),
        )
        .ok();

    window.emit("audit_log", "Создаём листы...").ok();

    let mut create_requests = Vec::new();
    for employee in &employees {
        let rows_needed = employee.accesses.len() as i32 + 1; // +1 для заголовка
        let sheet_title = format!("{} ({})", employee.email, employee.total_access);

        let mut add_sheet = google_sheets4::api::AddSheetRequest::default();
        let mut props = google_sheets4::api::SheetProperties::default();
        props.title = Some(sheet_title);

        let mut grid_props = google_sheets4::api::GridProperties::default();
        grid_props.row_count = Some(rows_needed + 100);
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

        for employee in employees_chunk {
            let sheet_title = format!("{} ({})", employee.email, employee.total_access);

            let mut rows = vec![vec![
                "Тип".into(),
                "Название".into(),
                "Роль".into(),
                "Путь".into(),
                "Ссылка".into(),
            ]];

            rows.extend(employee.accesses.iter().map(|a| {
                vec![
                    a.item_type.clone(),
                    a.item_name.clone(),
                    a.role.clone(),
                    a.path.clone(),
                    a.url.clone(),
                ]
            }));

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
    let mut hub = get_sheets_hub(&app).await?;

    let mut rows: Vec<Vec<String>> = vec![vec![
        "Тип".to_string(),
        "Название".to_string(),
        "Роль ссылки".to_string(),
        "Путь".to_string(),
        "Ссылка".to_string(),
    ]];

    for link in &audit_result.link_accesses {
        rows.push(vec![
            link.item_type.clone(),
            link.item_name.clone(),
            link.link_share_role.clone(),
            link.path.clone(),
            link.url.clone(),
        ]);
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
            if item.owners.unwrap_or(vec![]).iter().any(|o| {
                o.email_address
                    .clone()
                    .unwrap_or("".to_string())
                    .to_lowercase()
                    == email_lower
            }) {
                return Ok(true);
            }

            let still_exists = item.permissions.unwrap_or(vec![]).iter().any(|p| {
                if let Some(perm_email) = p.email_address.clone() {
                    if perm_email.to_lowercase() == email.to_lowercase() {
                        if let Some(perm_id) = permission_id.clone() {
                            return perm_id == p.id.clone().unwrap_or("".to_string());
                        }
                        return true;
                    }
                }
                false
            });
            return Ok(still_exists);
        }
        Err(_) => return Ok(false),
    }
}
