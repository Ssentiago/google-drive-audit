use crate::oauth::{get_drive_hub, get_sheets_hub, get_user_email};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::format;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{sleep, Duration};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub role_type: String,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResults {
    suspicious_accesses: Vec<Access>,
    undeleted_originals: Vec<UndeletedOriginal>,
    processed_files: usize,
    processed_folders: usize,
}

use google_drive3::api::Permission as G_Permission;

use crate::drive;
use crate::drive::custom_property::{delete_custom_property, read_custom_properties};
use crate::drive::utils::{get_item, list_folder_contents, DriveItem};
use google_sheets4::api::{
    GridProperties, Sheet, SheetProperties, Spreadsheet, SpreadsheetProperties,
};
use tokio::task::AbortHandle;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UndeletedOriginal {
    pub copy_id: String,
    pub copy_name: String,
    pub copy_url: Option<String>,
    pub original_id: String,
    pub original_name: String,
    pub original_url: Option<String>,
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingStatus {
    pub node_id: String,
    pub status: String, // "processing" | "queued" | "done"
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub folders_processed: usize,
    pub files_processed: usize,
}

#[derive(Default)]
struct UserStats {
    owner_count: usize,
    writer_count: usize,
    commenter_count: usize,
    reader_count: usize,
    is_owner: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: String,
    pub name: String,
    pub item_type: String, // "folder" | "file"
    pub parent_id: Option<String>,
    pub has_suspicious_access: bool,
    pub suspicious_count: usize,
    pub path: String,
}

static SCAN_RESULTS: OnceCell<RwLock<ScanResults>> = OnceCell::new();
static SCAN_ABORT: OnceCell<Mutex<Option<AbortHandle>>> = OnceCell::new();

pub struct DriveScanner {
    app: tauri::AppHandle,
    results: Arc<RwLock<Vec<Access>>>,
    processed_folders: Arc<RwLock<usize>>,
    processed_files: Arc<RwLock<usize>>,
    window: tauri::Window,
    suspicious_emails: HashSet<String>,
    log_tx: mpsc::UnboundedSender<String>,
    cancel_tx: broadcast::Sender<()>,
    user_email: String,
    undeleted_originals: Arc<RwLock<Vec<UndeletedOriginal>>>,
}

impl DriveScanner {
    fn emit_processing_status(&self, node_id: &str, status: &str) {
        let _ = self.window.emit(
            "processing_status",
            &ProcessingStatus {
                node_id: node_id.to_string(),
                status: status.to_string(),
            },
        );
    }

    pub async fn new(
        app: tauri::AppHandle,
        window: tauri::Window,
        suspicious_emails: &[String],
    ) -> (Self, mpsc::UnboundedReceiver<String>) {
        let (log_tx, log_rx) = mpsc::unbounded_channel();
        let (cancel_tx, _) = broadcast::channel(1);
        let user_email = get_user_email(app.clone()).await.unwrap_or("".to_string());

        let scanner = Self {
            app,
            results: Arc::new(RwLock::new(Vec::new())),
            processed_folders: Arc::new(RwLock::new(0)),
            processed_files: Arc::new(RwLock::new(0)),
            window,
            suspicious_emails: HashSet::from_iter(suspicious_emails.iter().cloned()),
            log_tx,
            cancel_tx,
            user_email,
            undeleted_originals: Arc::new(RwLock::new(vec![])),
        };

        (scanner, log_rx)
    }

    fn emit_tree_node(&self, node: TreeNode) {
        let _ = self.window.emit("tree_node", &node);
    }

    fn log(&self, message: &str) {
        let _ = self.log_tx.send(message.to_string());
    }

    fn clone_for_task(&self) -> Self {
        Self {
            app: self.app.clone(),
            results: self.results.clone(),
            processed_folders: self.processed_folders.clone(),
            processed_files: self.processed_files.clone(),
            window: self.window.clone(),
            suspicious_emails: self.suspicious_emails.clone(),
            log_tx: self.log_tx.clone(),
            cancel_tx: self.cancel_tx.clone(),
            user_email: self.user_email.clone(),
            undeleted_originals: self.undeleted_originals.clone(),
        }
    }

    pub async fn scan(&self, folder_id: &str) -> Result<ScanResults, String> {
        let start = Instant::now();
        self.log("СТАРТ: Сканирование диска...\n");

        self.process_folder(folder_id, None, String::new()).await?;

        self.print_summary().await;

        let duration = start.elapsed();
        let seconds = duration.as_secs_f64();
        self.log(&format!("Сканирование выполнилось за {:.2} сек", seconds));

        let results = self.results.read().await.clone();
        let originals = self.undeleted_originals.read().await.clone();

        Ok(ScanResults {
            suspicious_accesses: results,
            undeleted_originals: originals,
            processed_files: *self.processed_files.read().await,
            processed_folders: *self.processed_folders.read().await,
        })
    }

    async fn process_folder(
        &self,
        folder_id: &str,
        parent_id: Option<String>,
        current_path: String,
    ) -> Result<(), String> {
        self.process_folder_inner(folder_id, parent_id, current_path)
            .await
    }

    fn is_logged_user_an_owner(&self, folder: &DriveItem) -> bool {
        folder
            .owners
            .as_ref()
            .and_then(|owners| owners.first())
            .and_then(|o| o.email_address.as_ref())
            .map(|email| email == &self.user_email)
            .unwrap_or(false)
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
            self.emit_processing_status(folder_id, "processing");

            let folder = get_item(self.app.clone(), folder_id).await?;
            let folder_name = folder
                .name
                .as_ref()
                .unwrap_or(&"Без названия".to_string())
                .clone();

            let mut cancel_rx = self.cancel_tx.subscribe();
            if cancel_rx.try_recv().is_ok() {
                return Err("Cancelled".to_string());
            }

            self.log(&format!("📁 Папка: {}", folder_name));

            {
                let mut count = self.processed_folders.write().await;
                *count += 1;
            }

            let folder_own_path = current_path.clone();

            self.emit_tree_node(TreeNode {
                id: folder_id.to_string(),
                name: folder_name.clone(),
                item_type: "folder".to_string(),
                parent_id: parent_id.clone(),
                has_suspicious_access: false,
                suspicious_count: 0,
                path: folder_own_path.clone(),
            });

            self.check_item(&folder, "Папка", parent_id.as_deref(), &folder_own_path)
                .await;

            let full_path_for_children = if current_path.is_empty() {
                folder_name.clone()
            } else {
                format!("{} / {}", current_path, folder_name)
            };

            let mut cancel_rx = self.cancel_tx.subscribe();
            if cancel_rx.try_recv().is_ok() {
                return Err("Cancelled".to_string());
            }

            let items = list_folder_contents(self.app.clone(), folder_id).await?;
            let files: Vec<_> = items
                .iter()
                .filter(|i| i.mime_type.as_deref() != Some("application/vnd.google-apps.folder"))
                .cloned()
                .collect();
            let subfolders: Vec<_> = items
                .iter()
                .filter(|i| i.mime_type.as_deref() == Some("application/vnd.google-apps.folder"))
                .cloned()
                .collect();

            self.log(&format!(
                " └─ Файлов: {}, Подпапок: {}",
                files.len(),
                subfolders.len()
            ));

            for subfolder in &subfolders {
                if let Some(subfolder_id) = &subfolder.id {
                    self.emit_processing_status(subfolder_id, "queued");
                }
            }

            let mut file_handles = Vec::new();
            for file in files {
                if cancel_rx.try_recv().is_ok() {
                    break;
                }

                let scanner = self.clone_for_task();
                let path = full_path_for_children.clone();
                let folder_id_str = folder_id.to_string();

                let handle = tokio::spawn(async move {
                    let file_name = file
                        .name
                        .as_ref()
                        .unwrap_or(&"Без названия".to_string())
                        .clone();
                    scanner.log(&format!(" 📄 {}", file_name));

                    scanner
                        .check_item(&file, "Файл", Some(&folder_id_str), &path)
                        .await;

                    {
                        let mut count = scanner.processed_files.write().await;
                        *count += 1;
                    }
                });

                file_handles.push(handle);
            }

            for handle in file_handles {
                let _ = handle.await;
            }

            let mut subfolder_tasks = Vec::new();

            for subfolder in subfolders {
                if cancel_rx.try_recv().is_ok() {
                    break;
                }

                if let Some(subfolder_id) = subfolder.id.clone() {
                    let scanner = self.clone_for_task();
                    let parent_id = Some(folder_id.to_string());
                    let path = full_path_for_children.clone();

                    let task = tokio::spawn(async move {
                        scanner.emit_processing_status(&subfolder_id, "processing");

                        let result = scanner
                            .process_folder_inner(&subfolder_id, parent_id, path.clone())
                            .await;

                        // Отмечаем завершение
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

    async fn check_item(
        &self,
        item: &DriveItem,
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
        let item_id = item.id.as_deref().unwrap_or("");
        let item_name = item.name.as_deref().unwrap_or("Без названия");
        let mut new_accesses = Vec::new();

        // Проверяем обычные разрешения, которые удаляются тупо из метаданных
        for perm in permissions {
            if perm.role.as_deref() == Some("owner") {
                continue;
            }

            if let Some(email) = &perm.email_address {
                let email_lower = email.to_lowercase();
                if self.suspicious_emails.contains(&email_lower) {
                    let role = role_map(perm.role.as_deref().unwrap_or("reader"));
                    let user_name = perm.display_name.as_deref().unwrap_or("Unknown");

                    self.log(&format!(
                        "⚠️ {} | {} | {} ({}) | {}",
                        item_type, item_name, user_name, email_lower, role
                    ));

                    new_accesses.push(Access {
                        role_type: "permission".to_string(),
                        item_type: item_type.to_string(),
                        name: item_name.to_string(),
                        url: item.web_view_link.clone().unwrap_or_default(),
                        user: format!("{} ({})", user_name, email),
                        role: role.to_string(),
                        item_id: item.id.clone().unwrap_or_default(),
                        email: email_lower.clone(),
                        parent_id: parent_id.unwrap_or("").to_string(),
                        permission_id: perm.id.clone(),
                        path: path.to_string(),
                    });
                }
            }
        }

        let suspicious_owner = owners.first();

        // тут мы проверяем владельцев. важно заметить: и файлы, и папки тут важны
        // чтобы не запутаться - разделим на два отдельных кейса:
        // 1) есть какой-то объект и владелец у него какой-то говнюк
        // 2) есть какой-то объект и владелец у него - мы
        // в первом случае мы проверям только сам факт того, что копия была сделана
        // во втором случае мы проверяем, что если этот объект - копия, то оригинал был удалён

        // Кейс 1: Владелец подозрительный И мы НЕ владельцы
        if let Some(owner) = suspicious_owner {
            if self.suspicious_emails.contains(owner) && !self.is_logged_user_an_owner(&item) {
                match self.is_item_copied(item_id).await {
                    true => {}
                    false => {
                        self.log(&format!(
                            "👑 {} | {} | {} | Владелец",
                            item_type, item_name, owner
                        ));

                        new_accesses.push(Access {
                            role_type: "owner".to_string(),
                            item_type: item_type.to_string(),
                            name: item_name.to_string(),
                            url: item.web_view_link.clone().unwrap_or_default(),
                            user: owner.clone(),
                            role: "Владелец".to_string(),
                            item_id: item.id.clone().unwrap_or_default(),
                            email: owner.clone(),
                            parent_id: parent_id.unwrap_or("").to_string(),
                            permission_id: None,
                            path: path.to_string(),
                        });
                    }
                }
            }
        }

        // Кейс 2: Мы владельцы - проверяем неудалённые оригиналы
        if self.is_logged_user_an_owner(&item) {
            if let Ok(props) = read_custom_properties(self.app.clone(), item_id).await {
                if let Some(original_id) = props.get("original_item_id") {
                    match get_item(self.app.clone(), original_id).await {
                        Ok(original) => {
                            self.log(&format!(
                                "💣 Найден неудалённый оригинал: {}",
                                original.name.as_ref().unwrap_or(&"???".to_string())
                            ));

                            self.undeleted_originals
                                .write()
                                .await
                                .push(UndeletedOriginal {
                                    copy_id: item_id.to_string(),
                                    copy_name: item.name.clone().unwrap_or_default(),
                                    copy_url: item.web_view_link.clone(),
                                    original_id: original_id.clone(),
                                    original_name: original.name.unwrap_or_default(),
                                    original_url: original.web_view_link,
                                    path: path.to_string(),
                                });

                            let count = self.undeleted_originals.read().await.len();
                            self.log(&format!("📊 Всего неудалённых оригиналов: {}", count));
                        }
                        Err(_) => {
                            let _ = delete_custom_property(
                                self.app.clone(),
                                item_id,
                                vec!["original_item_id"],
                            )
                            .await;
                        }
                    }
                }
            }
        }
        if !new_accesses.is_empty() {
            self.emit_tree_node(TreeNode {
                id: item.id.clone().unwrap_or_default(),
                name: item_name.to_string(),
                item_type: if item_type == "Папка" {
                    "folder"
                } else {
                    "file"
                }
                .to_string(),
                parent_id: parent_id.map(|s| s.to_string()),
                has_suspicious_access: true,
                suspicious_count: new_accesses.len(),
                path: path.to_string(),
            });

            let mut results = self.results.write().await;
            results.extend(new_accesses);
        }
    }

    async fn is_item_copied(&self, folder_id: &str) -> bool {
        match read_custom_properties(self.app.clone(), folder_id).await {
            Ok(props) => props.get("is_copied") == Some(&"true".to_string()),
            Err(_) => false,
        }
    }

    async fn print_summary(&self) {
        let folders = *self.processed_folders.read().await;
        let files = *self.processed_files.read().await;
        let accesses = self.results.read().await.len();

        self.log("\n============================================================");
        self.log("✅ ЗАВЕРШЕНО");
        self.log("============================================================");
        self.log(&format!("📁 Обработано папок: {}", folders));
        self.log(&format!("📄 Обработано файлов: {}", files));
        self.log(&format!("⚠️ Найдено доступов: {}", accesses));
        self.log("============================================================\n");
    }
}

static CANCEL_BROADCAST: OnceCell<broadcast::Sender<()>> = OnceCell::new();

#[tauri::command]
pub async fn scan_drive(
    app: tauri::AppHandle,
    window: tauri::Window,
    folder_id: String,
    suspicious_emails: Vec<String>,
) -> Result<ScanResults, String> {
    let start = Instant::now();

    let (scanner, mut log_rx) =
        DriveScanner::new(app.clone(), window.clone(), &suspicious_emails).await;

    CANCEL_BROADCAST.get_or_init(|| scanner.cancel_tx.clone());

    let window_clone = window.clone();
    tokio::spawn(async move {
        println!("Log task started");
        while let Some(msg) = log_rx.recv().await {
            let _ = window_clone.emit("scan_log", &msg);
        }
        println!("Log task finished");
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let folder_id_clone = folder_id.clone();
    let scanner_clone = scanner.clone_for_task();
    let progress_window = window.clone();
    let progress_handle = tokio::spawn(async move {
        loop {
            let folders = *scanner_clone.processed_folders.read().await;
            let files = *scanner_clone.processed_files.read().await;
            let _ = progress_window.emit(
                "scan_progress",
                &ScanProgress {
                    folders_processed: folders,
                    files_processed: files,
                },
            );

            sleep(Duration::from_millis(500)).await;
        }
    });

    let handle = tokio::spawn(async move { scanner.scan(&folder_id_clone).await });

    SCAN_ABORT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
        .replace(handle.abort_handle());

    match handle.await {
        Ok(Ok(results)) => {
            let results_lock = SCAN_RESULTS.get_or_init(|| {
                RwLock::new(ScanResults {
                    suspicious_accesses: vec![],
                    undeleted_originals: vec![],
                    processed_files: 0,
                    processed_folders: 0,
                })
            });
            *results_lock.write().await = results.clone();

            let duration = start.elapsed().as_secs_f64();

            if drive::folder_cache::is_folder_saved(&app, &folder_id) {
                let scan_entry = drive::folder_cache::ScanHistoryEntry {
                    timestamp: chrono::Utc::now().timestamp(),
                    folders_count: results.processed_folders,
                    files_count: results.processed_files,
                    duration_sec: duration,
                    suspicious_count: results.suspicious_accesses.len(),
                };

                let _ = drive::folder_cache::add_scan_to_folder(&app, &folder_id, scan_entry);
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            progress_handle.abort();

            Ok(results)
        }
        Ok(Err(e)) => {
            progress_handle.abort();
            Err(e)
        }
        Err(_) => {
            progress_handle.abort();
            Err("Сканирование отменено".to_string())
        }
    }
}
#[tauri::command]
pub async fn load_scan_cache() -> Result<ScanResults, String> {
    let results_lock = SCAN_RESULTS.get_or_init(|| {
        RwLock::new(ScanResults {
            suspicious_accesses: vec![],
            undeleted_originals: vec![],
            processed_files: 0,
            processed_folders: 0,
        })
    });

    let results = results_lock.read().await.clone();
    Ok(results)
}

#[tauri::command]
pub async fn create_and_open_spreadsheet(
    window: tauri::Window,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let hub = get_sheets_hub(&app).await?;

    let results_lock = SCAN_RESULTS.get_or_init(|| {
        RwLock::new(ScanResults {
            suspicious_accesses: vec![],
            undeleted_originals: vec![],
            processed_files: 0,
            processed_folders: 0,
        })
    });

    let export_data = results_lock.read().await.clone().suspicious_accesses;

    if export_data.is_empty() {
        return Err("Нет результатов для экспорта".to_string());
    }

    let total_rows_needed = std::cmp::max(export_data.len() + 1, 1000);

    let spreadsheet = Spreadsheet {
        properties: Some(SpreadsheetProperties {
            title: Some(format!(
                "Drive Audit - {}",
                chrono::Utc::now().format("%Y-%m-%d %H:%M")
            )),
            ..Default::default()
        }),
        sheets: Some(vec![
            Sheet {
                properties: Some(SheetProperties {
                    title: Some("Сводка".to_string()),
                    sheet_id: Some(0),
                    grid_properties: Some(GridProperties {
                        row_count: Some(1000),
                        column_count: Some(6),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Sheet {
                properties: Some(SheetProperties {
                    title: Some("Детали".to_string()),
                    sheet_id: Some(1),
                    grid_properties: Some(GridProperties {
                        row_count: Some(total_rows_needed as i32),
                        column_count: Some(7),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ]),
        ..Default::default()
    };

    let result = hub
        .spreadsheets()
        .create(spreadsheet)
        .doit()
        .await
        .map_err(|e| format!("Ошибка создания таблицы: {}", e))?;

    let spreadsheet_id = result.1.spreadsheet_id.ok_or("Нет ID таблицы")?;
    let spreadsheet_url = result.1.spreadsheet_url.ok_or("Нет URL таблицы")?;

    window
        .emit("scan_log", "Таблица создана, готовим данные...")
        .ok();

    use std::collections::HashMap;

    let mut stats: HashMap<String, UserStats> = HashMap::new();

    for item in &export_data {
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

    summary_rows.push(vec![
        "ВСЕГО".to_string(),
        total_owners.to_string(),
        total_writers.to_string(),
        total_commenters.to_string(),
        total_readers.to_string(),
        grand_total.to_string(),
    ]);

    let mut detail_rows: Vec<Vec<String>> = vec![vec![
        "Email".to_string(),
        "Пользователь".to_string(),
        "Роль".to_string(),
        "Тип объекта".to_string(),
        "Название".to_string(),
        "Папка".to_string(),
        "Ссылка".to_string(),
    ]];

    for item in &export_data {
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

    let summary_range = "Сводка!A1";
    let summary_value_range = google_sheets4::api::ValueRange {
        range: Some(summary_range.to_string()),
        major_dimension: Some("ROWS".to_string()),
        values: Some(
            summary_rows
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|cell| serde_json::json!(cell))
                        .collect::<Vec<_>>()
                })
                .collect(),
        ),
    };

    hub.spreadsheets()
        .values_update(summary_value_range, &spreadsheet_id, summary_range)
        .value_input_option("USER_ENTERED")
        .doit()
        .await
        .map_err(|e| format!("Ошибка записи сводки: {}", e))?;

    let mut start_row = 2;

    for chunk in detail_rows.chunks(900) {
        let detail_range = format!("Детали!A{}", start_row);
        let detail_value_range = google_sheets4::api::ValueRange {
            range: Some(detail_range.clone()),
            major_dimension: Some("ROWS".to_string()),
            values: Some(
                chunk
                    .iter()
                    .map(|row| {
                        row.iter()
                            .enumerate()
                            .map(|(col_idx, cell)| {
                                if col_idx == 5 {
                                    serde_json::json!(format!(
                                        "=HYPERLINK(\"{}\"; \"Открыть папку\")",
                                        cell
                                    ))
                                } else {
                                    serde_json::json!(cell)
                                }
                            })
                            .collect::<Vec<_>>()
                    })
                    .collect(),
            ),
        };

        hub.spreadsheets()
            .values_update(detail_value_range, &spreadsheet_id, &detail_range)
            .value_input_option("USER_ENTERED")
            .doit()
            .await
            .map_err(|e| format!("Ошибка записи деталей: {}", e))?;

        start_row += chunk.len();
        window
            .emit("scan_log", &format!("Записано {} строк...", start_row - 1))
            .ok();
    }

    let drive_hub = get_drive_hub(&app).await?;

    let permission = G_Permission {
        type_: Some("anyone".to_string()),
        role: Some("reader".to_string()),
        ..Default::default()
    };

    let result = drive_hub
        .permissions()
        .create(permission, &spreadsheet_id)
        .doit()
        .await;

    if result.is_err() {
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

#[tauri::command]
pub async fn is_this_folder(app: tauri::AppHandle, item_id: String) -> Result<(), String> {
    let hub = get_drive_hub(&app).await?;

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

#[tauri::command]
pub async fn cancel_scan_drive() -> Result<(), String> {
    if let Some(cancel_tx) = CANCEL_BROADCAST.get() {
        let _ = cancel_tx.send(());
    }

    if let Some(abort) = SCAN_ABORT.get().unwrap().lock().unwrap().take() {
        abort.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_original_from_parent(
    app: tauri::AppHandle,
    window: tauri::AppHandle,
    original_id: String,
    copy_id: String,
) -> Result<(), String> {
    let hub = get_drive_hub(&app).await?;

    let original = get_item(app.clone(), &original_id).await?;
    let parents = original.parents.ok_or("Нет родительских папок")?;

    for parent_id in parents {
        hub.files()
            .update(google_drive3::api::File::default(), &original_id)
            .remove_parents(&parent_id)
            .add_scope("https://www.googleapis.com/auth/drive")
            .supports_all_drives(true)
            .doit_without_upload()
            .await
            .map_err(|e| format!("Failed: {}", e))?;
    }

    delete_custom_property(app.clone(), &copy_id, vec!["original_item_id"]).await?;

    window
        .emit(
            "scan_log",
            &format!(
                "🚀 Удалили объект с именем {} из родительской папки",
                original.name.unwrap_or(String::new())
            ),
        )
        .ok();

    Ok(())
}
