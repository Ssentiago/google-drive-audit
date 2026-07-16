use crate::app_handle_storage::get_app_handle;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::env;
use tokio::io::AsyncWriteExt;

const GITHUB_REPO_OWNER: &str = "Ssentiago";
const GITHUB_REPO_NAME: &str = "google-drive-audit";

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateInfo {
    available: bool,
    current_version: String,
    latest_version: String,
    download_url: Option<String>,
    asset_name: Option<String>,
    release_notes: Option<String>,
    published_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DownloadResult {
    path: String,
    already_existed: bool,
}

#[derive(Deserialize, Debug)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize, Debug)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

fn compare_versions(current: &str, latest: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect()
    };

    let cur = parse(current);
    let lat = parse(latest);

    for (c, l) in cur.iter().zip(lat.iter()) {
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }

    lat.len() > cur.len()
}

fn find_asset_for_platform(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    let os = env::consts::OS;

    match os {
        "windows" => {
            // Приоритет: .msi > .exe
            assets
                .iter()
                .find(|a| a.name.ends_with(".msi"))
                .or_else(|| assets.iter().find(|a| a.name.ends_with(".exe")))
        }
        "macos" => assets.iter().find(|a| a.name.ends_with(".dmg")),
        "linux" => assets.iter().find(|a| a.name.ends_with(".AppImage")),
        _ => None,
    }
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let app = get_app_handle();
    let current_version = app.package_info().version.to_string();

    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_REPO_OWNER, GITHUB_REPO_NAME
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "google-drive-audit-updater")
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API вернул статус: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v').to_string();

    if !compare_versions(&current_version, &latest_version) {
        return Ok(UpdateInfo {
            available: false,
            current_version,
            latest_version,
            download_url: None,
            asset_name: None,
            release_notes: release.body,
            published_at: release.published_at,
        });
    }

    let asset = find_asset_for_platform(&release.assets);

    Ok(UpdateInfo {
        available: true,
        current_version,
        latest_version,
        download_url: asset.map(|a| a.browser_download_url.clone()),
        asset_name: asset.map(|a| a.name.clone()),
        release_notes: release.body,
        published_at: release.published_at,
    })
}

#[tauri::command]
pub async fn download_update(download_url: String, asset_name: String) -> Result<DownloadResult, String> {
    let downloads_dir = dirs::download_dir().ok_or("Не удалось определить папку загрузок")?;

    let file_path = downloads_dir.join(&asset_name);

    if file_path.exists() {
        return Ok(DownloadResult {
            path: file_path.to_string_lossy().to_string(),
            already_existed: true,
        });
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .header("User-Agent", "google-drive-audit-updater")
        .send()
        .await
        .map_err(|e| format!("Ошибка скачивания: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Сервер вернул статус: {}", response.status()));
    }

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Ошибка создания файла: {}", e))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Ошибка чтения потока: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Ошибка записи файла: {}", e))?;
    }

    file.flush().await.map_err(|e| format!("Ошибка flush: {}", e))?;

    Ok(DownloadResult {
        path: file_path.to_string_lossy().to_string(),
        already_existed: false,
    })
}

#[tauri::command]
pub async fn is_update_downloaded(asset_name: String) -> Result<bool, String> {
    let downloads_dir = dirs::download_dir().ok_or("Не удалось определить папку загрузок")?;
    let file_path = downloads_dir.join(&asset_name);
    Ok(file_path.exists())
}

#[tauri::command]
pub async fn get_downloads_dir() -> Result<String, String> {
    let downloads_dir = dirs::download_dir().ok_or("Не удалось определить папку загрузок")?;
    Ok(downloads_dir.to_string_lossy().to_string())
}
