use crate::app_handle_storage::get_app_handle;
use crate::oauth::get_drive_hub;
use google_drive3::api::File;
use governor::clock::DefaultClock;
use governor::state::{InMemoryState, NotKeyed};
use governor::{Quota, RateLimiter};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::num::NonZeroU32;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::time::{sleep, timeout, Duration};

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct Permission {
    pub id: Option<String>,
    #[serde(rename = "emailAddress")]
    pub email_address: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub role: Option<String>,
    #[serde(rename = "type")]
    pub perm_type: Option<String>,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct Owner {
    #[serde(rename = "emailAddress")]
    pub email_address: Option<String>,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct DriveItem {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(rename = "webViewLink")]
    pub web_view_link: Option<String>,
    pub parents: Option<Vec<String>>,
    pub permissions: Option<Vec<Permission>>,
    pub owners: Option<Vec<Owner>>,
    #[serde(default)]
    pub properties: HashMap<String, String>,
}

impl DriveItem {
    pub fn is_folder(&self) -> bool {
        self.mime_type.as_deref() == Some("application/vnd.google-apps.folder")
    }

    pub fn get_property(&self, key: &str) -> Option<&String> {
        self.properties.get(key)
    }

    pub fn set_property(&mut self, key: String, value: String) {
        self.properties.insert(key, value);
    }

    pub fn delete_property(&mut self, key: &str) {
        self.properties.remove(key);
    }

    pub async fn sync_properties(&mut self) -> Result<(), String> {
        let app = get_app_handle();
        let hub = get_drive_hub(&app).await?;

        let file_id = self.id.as_ref().ok_or("No file ID")?;

        let mut file = File::default();
        file.properties = Some(self.properties.clone());

        hub.files()
            .update(file, file_id)
            .add_scope("https://www.googleapis.com/auth/drive")
            .doit_without_upload()
            .await
            .map_err(|e| format!("Failed to sync properties: {}", e))?;

        Ok(())
    }

    pub async fn fetch_properties(&mut self) -> Result<(), String> {
        let app = get_app_handle();
        let hub = get_drive_hub(&app).await?;

        let file_id = self.id.as_ref().ok_or("No file ID")?;

        let result = hub
            .files()
            .get(file_id)
            .add_scope("https://www.googleapis.com/auth/drive")
            .param("fields", "properties")
            .doit()
            .await
            .map_err(|e| format!("Failed to fetch properties: {}", e))?;

        self.properties = result.1.properties.unwrap_or_default();
        Ok(())
    }
}
const MAX_RETRIES: u32 = 10;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RETRY_DELAY: Duration = Duration::from_millis(1000);

pub static GLOBAL_SEMAPHORE: Lazy<Arc<Semaphore>> = Lazy::new(|| Arc::new(Semaphore::new(10)));
pub static GLOBAL_RATE_LIMITER: Lazy<RateLimiter<NotKeyed, InMemoryState, DefaultClock>> =
    Lazy::new(|| {
        RateLimiter::direct(
            Quota::per_second(NonZeroU32::new(20).unwrap())
                .allow_burst(NonZeroU32::new(30).unwrap()), // burst 30
        )
    });

async fn retry_with_backoff<F, Fut, T, E>(
    mut operation: F,
    operation_name: &str,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    for attempt in 0..MAX_RETRIES {
        match timeout(REQUEST_TIMEOUT, operation()).await {
            Ok(Ok(result)) => return Ok(result),
            Ok(Err(e)) => {
                let error_str = e.to_string();
                eprintln!("❌ {} error: {}", operation_name, error_str);

                if error_str.contains("404") || error_str.contains("not found") {
                    eprintln!("🚫 404 - файл не существует, прекращаем ретраи");
                    return Err(error_str);
                }

                if error_str.contains("429")
                    || error_str.contains("403")
                    || error_str.contains("rate")
                    || error_str.contains("quota")
                {
                    eprintln!("🚫 RATE LIMIT HIT!");
                    let delay = Duration::from_secs(10 * 2_u32.pow(attempt) as u64); // 10s, 20s, 40s
                    sleep(delay).await;
                } else {
                    let delay = RETRY_DELAY * 2_u32.pow(attempt);
                    sleep(delay).await;
                }
            }
            Err(_) => {
                eprintln!("⏱️ {} timeout", operation_name);
                sleep(RETRY_DELAY * 2_u32.pow(attempt)).await;
            }
        }
    }
    Err(format!(
        "{} failed after {} retries",
        operation_name, MAX_RETRIES
    ))
}

pub async fn get_item(app: tauri::AppHandle, file_id: &str) -> Result<DriveItem, String> {
    let _permit = GLOBAL_SEMAPHORE.acquire().await.unwrap();
    GLOBAL_RATE_LIMITER.until_ready().await;
    retry_with_backoff(
        || async {
            let hub = get_drive_hub(&app).await?;

            let (response, file) = hub
                .files()
                .get(file_id)
                .add_scope("https://www.googleapis.com/auth/drive")
                .supports_all_drives(true)
                .param("fields", "name,webViewLink,mimeType,parents,permissions(id,emailAddress,role,type,displayName),owners(emailAddress),properties")
                .doit()
                .await
                .map_err(|e| format!("{}", e))?;

            if !response.status().is_success() {
                return Err(format!("HTTP {}", response.status()));
            }

            let perm: Vec<Permission> = file
                .permissions
                .unwrap_or_default()
                .iter()
                .map(|p| Permission {
                    id: p.id.clone(),
                    email_address: p.email_address.clone(),
                    display_name: p.display_name.clone(),
                    role: p.role.clone(),
                    perm_type: p.type_.clone(),
                })
                .collect();

            let owners = file.owners.map(|owners_vec| {
                owners_vec
                    .iter()
                    .map(|o| Owner {
                        email_address: o.email_address.clone(),
                    })
                    .collect()
            });

            Ok(DriveItem {
                id: Some(file_id.to_string()),
                name: file.name,
                web_view_link: file.web_view_link,
                mime_type: file.mime_type,
                permissions: Some(perm),
                owners,
                parents: file.parents,
                properties: file.properties.unwrap_or_default(),
            })
        },
        "get_item",
    )
        .await
}

pub async fn list_folder_contents(
    app: tauri::AppHandle,
    folder_id: &str,
) -> Result<Vec<DriveItem>, String> {
    let _permit = GLOBAL_SEMAPHORE.acquire().await.unwrap();
    GLOBAL_RATE_LIMITER.until_ready().await;

    retry_with_backoff(
        || async {

            let drive_hub = get_drive_hub(&app).await?;
            let mut all_items = Vec::new();
            let mut page_token: Option<String> = None;

            loop {
                let mut request = drive_hub
                    .files()
                    .list()
                    .q(&format!("'{}' in parents and trashed=false", folder_id))
                    .add_scope("https://www.googleapis.com/auth/drive")
                    .param("fields", "nextPageToken,files(id,name,mimeType,webViewLink,parents,permissions(id,emailAddress,role,type,displayName),owners(emailAddress))")
                    .page_size(1000)
                    .supports_all_drives(true)
                    .include_items_from_all_drives(true);

                if let Some(token) = &page_token {
                    request = request.page_token(token);
                }

                let (response, file_list) = request
                    .doit()
                    .await
                    .map_err(|e| format!("{}", e))?;

                if !response.status().is_success() {
                    return Err(format!("HTTP {}", response.status()));
                }

                if let Some(files) = file_list.files {
                    let converted: Vec<DriveItem> = files
                        .iter()
                        .map(|f| DriveItem {
                            id: f.id.clone(),
                            name: f.name.clone(),
                            web_view_link: f.web_view_link.clone(),
                            mime_type: f.mime_type.clone(),
                            permissions: f.permissions.as_ref().map(|perms| {
                                perms
                                    .iter()
                                    .map(|p| Permission {
                                        id: p.id.clone(),
                                        email_address: p.email_address.clone(),
                                        display_name: p.display_name.clone(),
                                        role: p.role.clone(),
                                        perm_type: p.type_.clone(),
                                    })
                                    .collect()
                            }),
                            owners: f.owners.as_ref().map(|owners| {
                                owners
                                    .iter()
                                    .map(|o| Owner {
                                        email_address: o.email_address.clone(),
                                    })
                                    .collect()
                            }),
                            parents: f.parents.clone(),
                            properties: f.properties.clone().unwrap_or_default(),
                        })
                        .collect();

                    all_items.extend(converted);
                }

                page_token = file_list.next_page_token;
                if page_token.is_none() {
                    break;
                }
            }

            if folder_id == "1QxaWOZ6nBJvuf9EE0BWoV0cLGGIT21Tf" {
                for item in all_items.clone(){
                    println!("item name: {}", item.name.unwrap_or("".to_string()));
                    let owners: Vec<String> = item
                        .owners
                        .as_ref()
                        .unwrap_or(&Vec::new())
                        .iter()
                        .filter_map(|o| o.email_address.as_ref().map(|e| e.to_lowercase()))
                        .collect();
                    let owner = owners.first();
                    if let Some(o) = owner {
                        println!("item owner: {}", o)
                    }
                    println!("----")
                }
            }

            Ok(all_items)
        },
        "list_folder_contents",
    )
        .await
}
