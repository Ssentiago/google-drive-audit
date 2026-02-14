use crate::app_handle_storage::get_app_handle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanHistoryEntry {
    pub timestamp: i64,
    pub folders_count: usize,
    pub files_count: usize,
    pub duration_sec: f64,
    pub suspicious_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedFolder {
    pub id: String,
    pub name: String,
    pub saved_at: i64,
    pub last_scan: Option<ScanHistoryEntry>,
    pub scan_history: Vec<ScanHistoryEntry>,
}

#[derive(Serialize, Deserialize, Default)]
struct CacheData {
    folders: HashMap<String, SavedFolder>,
}

const CACHE_FILE: &str = "folder_cache.json";
const MAX_HISTORY: usize = 10;

fn get_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось получить путь: {}", e))
        .map(|p| p.join(CACHE_FILE))
}

fn load_cache(app: &tauri::AppHandle) -> Result<CacheData, String> {
    let path = get_cache_path(app)?;

    if !path.exists() {
        return Ok(CacheData::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения кеша: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Ошибка парсинга кеша: {}", e))
}

fn save_cache(app: &tauri::AppHandle, data: &CacheData) -> Result<(), String> {
    let path = get_cache_path(app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Ошибка создания директории: {}", e))?;
    }

    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("Ошибка сериализации: {}", e))?;

    fs::write(&path, json).map_err(|e| format!("Ошибка записи кеша: {}", e))
}

pub fn is_folder_saved(app: &tauri::AppHandle, folder_id: &str) -> bool {
    if let Ok(cache) = load_cache(app) {
        cache.folders.contains_key(folder_id)
    } else {
        false
    }
}

pub fn add_scan_to_folder(folder_id: &str, scan_data: ScanHistoryEntry) -> Result<(), String> {
    let app = get_app_handle();
    let mut cache = load_cache(app)?;

    if let Some(folder) = cache.folders.get_mut(folder_id) {
        folder.last_scan = Some(scan_data.clone());
        folder.scan_history.insert(0, scan_data);

        if folder.scan_history.len() > MAX_HISTORY {
            folder.scan_history.truncate(MAX_HISTORY);
        }

        save_cache(app, &cache)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn save_folder(
    app: tauri::AppHandle,
    folder_id: String,
    folder_name: String,
) -> Result<SavedFolder, String> {
    let mut cache = load_cache(&app)?;

    let now = chrono::Utc::now().timestamp();

    let saved = SavedFolder {
        id: folder_id.clone(),
        name: folder_name,
        saved_at: now,
        last_scan: None,
        scan_history: Vec::new(),
    };

    cache.folders.insert(folder_id, saved.clone());
    save_cache(&app, &cache)?;

    Ok(saved)
}

#[tauri::command]
pub async fn update_folder_name(
    app: tauri::AppHandle,
    folder_id: String,
    folder_name: String,
) -> Result<(), String> {
    let mut cache = load_cache(&app)?;

    if let Some(folder) = cache.folders.get_mut(&folder_id) {
        folder.name = folder_name;
        save_cache(&app, &cache)?;
        Ok(())
    } else {
        Err("Папка не найдена".to_string())
    }
}

#[tauri::command]
pub async fn get_saved_folders(app: tauri::AppHandle) -> Result<Vec<SavedFolder>, String> {
    let cache = load_cache(&app)?;

    let mut folders: Vec<SavedFolder> = cache.folders.into_values().collect();
    folders.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));

    Ok(folders)
}

#[tauri::command]
pub async fn get_folder_info(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<Option<SavedFolder>, String> {
    let cache = load_cache(&app)?;
    Ok(cache.folders.get(&folder_id).cloned())
}

#[tauri::command]
pub async fn remove_saved_folder(app: tauri::AppHandle, folder_id: String) -> Result<(), String> {
    let mut cache = load_cache(&app)?;
    cache.folders.remove(&folder_id);
    save_cache(&app, &cache)
}

#[tauri::command]
pub async fn clear_folder_history(app: tauri::AppHandle, folder_id: String) -> Result<(), String> {
    let mut cache = load_cache(&app)?;

    if let Some(folder) = cache.folders.get_mut(&folder_id) {
        folder.scan_history.clear();
        folder.last_scan = None;
        save_cache(&app, &cache)?;
    }

    Ok(())
}
