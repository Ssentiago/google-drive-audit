use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::{Store, StoreBuilder};

#[derive(Serialize, Deserialize, Clone)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64,
}

const STORE_PATH: &str = "tokens.json";

static STORE_ARC: OnceCell<Arc<Store<tauri::Wry>>> = OnceCell::new();
static REFRESH_LOCK: OnceCell<Mutex<()>> = OnceCell::new();

fn get_store(app: &AppHandle) -> Result<&'static Arc<Store<tauri::Wry>>, String> {
    STORE_ARC.get_or_try_init(|| {
        let path = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join(STORE_PATH);

        StoreBuilder::new(app, path)
            .build()
            .map_err(|e| e.to_string())
    })
}

pub fn save_tokens(app: &AppHandle, tokens: &Tokens) -> Result<(), String> {
    let store = get_store(app)?;
    store.set("tokens", json!(tokens));
    store.save().map_err(|e| e.to_string())
}

pub fn get_tokens(app: &AppHandle) -> Result<Tokens, String> {
    let store = get_store(app)?;
    store
        .get("tokens")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| "Токены не найдены".to_string())
}

pub fn is_token_valid(tokens: &Tokens) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    now < tokens.expires_at.saturating_sub(60)
}

pub fn clear_tokens(app: &AppHandle) -> Result<(), String> {
    let store = get_store(app)?;
    store.delete("tokens");
    store.save().map_err(|e| e.to_string())
}

pub async fn get_valid_access_token(app: tauri::AppHandle) -> Result<String, String> {
    let tokens = get_tokens(&app)?;

    if is_token_valid(&tokens) {
        return Ok(tokens.access_token);
    }

    let _lock = REFRESH_LOCK.get_or_init(|| Mutex::new(())).lock();

    let tokens = get_tokens(&app)?;
    if is_token_valid(&tokens) {
        return Ok(tokens.access_token);
    }

    refresh_access_token_inner(&app).await
}

async fn refresh_access_token_inner(app: &AppHandle) -> Result<String, String> {
    use reqwest::Client;

    let tokens = get_tokens(app)?;
    let refresh_token = tokens.refresh_token.clone().ok_or("Нет refresh токена")?;

    let client = Client::new();
    let params = [
        ("refresh_token", refresh_token.as_str()),
        ("client_id", crate::oauth::CLIENT_ID),
        ("client_secret", crate::oauth::CLIENT_SECRET),
        ("grant_type", "refresh_token"),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: u64,
    }

    let token: TokenResponse = response.json().await.map_err(|e| e.to_string())?;

    let new_tokens = Tokens {
        access_token: token.access_token.clone(),
        refresh_token: tokens.refresh_token,
        expires_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + token.expires_in,
    };

    save_tokens(app, &new_tokens)?;
    Ok(token.access_token)
}
