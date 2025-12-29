use crate::oauth::get_drive_hub;
use google_drive3::api::File;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::hash::Hash;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProperties {
    pub properties: HashMap<String, String>,
}

impl CustomProperties {
    pub fn new() -> Self {
        Self {
            properties: HashMap::new(),
        }
    }

    pub fn get(&self, key: &str) -> Option<&String> {
        self.properties.get(key)
    }

    pub fn set(&mut self, key: String, value: String) {
        self.properties.insert(key, value);
    }

    pub fn delete(&mut self, key: String) {
        self.properties.remove(key.as_str());
    }
}

#[tauri::command]
pub async fn read_custom_properties(
    app: tauri::AppHandle,
    file_id: &str,
) -> Result<CustomProperties, String> {
    let hub = get_drive_hub(&app).await?;

    let result = hub
        .files()
        .get(file_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .param("fields", "properties")
        .doit()
        .await
        .map_err(|e| format!("Failed to get file properties: {}", e))?;

    let file = result.1;

    let properties = file
        .properties
        .unwrap_or_default()
        .into_iter()
        .collect::<HashMap<String, String>>();

    Ok(CustomProperties { properties })
}

#[tauri::command]
pub async fn update_custom_property(
    app: tauri::AppHandle,
    file_id: &str,
    properties: HashMap<&str, &str>,
) -> Result<(), String> {
    let hub = get_drive_hub(&app).await?;

    let mut original_props = read_custom_properties(app.clone(), file_id).await?;

    for (key, value) in properties {
        original_props.set(key.to_string(), value.to_string())
    }

    let mut file = File::default();
    file.properties = Some(original_props.properties);

    hub.files()
        .update(file, file_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .doit_without_upload()
        .await
        .map_err(|e| format!("Failed to update properties: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_custom_property(
    app: tauri::AppHandle,
    file_id: &str,
    keys: Vec<&str>,
) -> Result<(), String> {
    let hub = get_drive_hub(&app).await?;

    let mut original_props = read_custom_properties(app.clone(), file_id).await?;

    for key in keys {
        original_props.delete(key.to_string())
    }

    let mut file = File::default();
    file.properties = Some(original_props.properties);

    hub.files()
        .update(file, file_id)
        .add_scope("https://www.googleapis.com/auth/drive")
        .doit_without_upload()
        .await
        .map_err(|e| format!("Failed to update properties: {}", e))?;

    Ok(())
}
