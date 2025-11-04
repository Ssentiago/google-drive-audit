use crate::tokens::{Tokens, clear_tokens, get_tokens, is_token_valid, save_tokens};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::cmp::min;
use tiny_http::{Response, Server};
use url::Url;

pub const CLIENT_ID: &str =
    "89904030073-n57leahr5epo8bf7q1qlo2spnui75d80.apps.googleusercontent.com";
pub const CLIENT_SECRET: &str = "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";

#[derive(Serialize, Deserialize, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[tauri::command]
pub async fn start_google_oauth(app: tauri::AppHandle) -> Result<String, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
        _ => return Err("Не удалось получить порт".to_string()),
    };

    let redirect_uri = format!("http://localhost:{}", port);
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&\
        redirect_uri={}&\
        response_type=code&\
        scope=https://www.googleapis.com/auth/drive%20https://www.googleapis.com/auth/spreadsheets%20email%20profile&\
        access_type=offline&\
        prompt=consent",
        CLIENT_ID,
        urlencoding::encode(&redirect_uri)
    );

    open::that(&auth_url).map_err(|e| e.to_string())?;

    let request = server.recv().map_err(|e| e.to_string())?;
    let url_str = format!("http://localhost{}", request.url());
    let parsed_url = Url::parse(&url_str).map_err(|e| e.to_string())?;
    let code = parsed_url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .ok_or("No code in callback")?;

    let html =
        "<html><body><h1>✅ Авторизация успешна!</h1><p>Можете закрыть это окно.</p></body></html>";
    request
        .respond(
            Response::from_string(html).with_header(
                tiny_http::Header::from_bytes(
                    &b"Content-Type"[..],
                    &b"text/html; charset=utf-8"[..],
                )
                .unwrap(),
            ),
        )
        .map_err(|e| e.to_string())?;

    let token = exchange_code_for_token(&code, &redirect_uri).await?;
    let tokens = Tokens {
        access_token: token.access_token.clone(),
        refresh_token: token.refresh_token.clone(),
        expires_at: (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + token.expires_in),
    };

    save_tokens(&app, &tokens)?;
    Ok(token.access_token)
}

async fn exchange_code_for_token(code: &str, redirect_uri: &str) -> Result<TokenResponse, String> {
    let client = Client::new();
    let params = [
        ("code", code),
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    response.json().await.map_err(|e| e.to_string())
}

// 🔥 ГЛАВНАЯ ФУНКЦИЯ: получает валидный токен или обновляет
#[tauri::command]
pub async fn get_valid_access_token(app: tauri::AppHandle) -> Result<String, String> {
    let mut tokens = get_tokens(&app)?;

    if is_token_valid(&tokens) {
        return Ok(tokens.access_token);
    }

    // Токен протух → обновляем
    let new_token = refresh_access_token_inner(&app).await?;
    Ok(new_token)
}

// Внутренняя функция обновления (без проверки валидности)
pub async fn refresh_access_token_inner(app: &tauri::AppHandle) -> Result<String, String> {
    let tokens = get_tokens(app)?;
    let refresh_token = tokens.clone().refresh_token.ok_or("Нет refresh токена")?;

    let client = Client::new();
    let params = [
        ("refresh_token", refresh_token.as_str()),
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("grant_type", "refresh_token"),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let token: TokenResponse = response.json().await.map_err(|e| e.to_string())?;

    let new_tokens = Tokens {
        access_token: token.access_token.clone(),
        refresh_token: tokens.refresh_token,
        expires_at: (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + token.expires_in),
    };

    save_tokens(app, &new_tokens)?;
    Ok(token.access_token)
}

#[tauri::command]
pub fn logout(app: tauri::AppHandle) -> Result<(), String> {
    clear_tokens(&app)
}

#[tauri::command]
pub fn is_authenticated(app: tauri::AppHandle) -> Result<bool, String> {
    let tokens = get_tokens(&app)?;
    Ok(is_token_valid(&tokens))
}

#[tauri::command]
pub fn force_reauth(app: tauri::AppHandle) -> Result<(), String> {
    clear_tokens(&app)?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}
