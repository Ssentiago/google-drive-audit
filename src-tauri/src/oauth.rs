use google_drive3::DriveHub;
use google_sheets4::Sheets;
use hyper_rustls::HttpsConnector;
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::TokioExecutor,
};
use once_cell::sync::OnceCell;
use std::{future::Future, pin::Pin, sync::Arc};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;
use yup_oauth2::{
    authenticator::Authenticator, authenticator_delegate::InstalledFlowDelegate,
    InstalledFlowReturnMethod,
};

use crate::app_handle_storage::get_app_handle;

pub const CLIENT_ID: &str =
    "89904030073-n57leahr5epo8bf7q1qlo2spnui75d80.apps.googleusercontent.com";
pub const CLIENT_SECRET: &str = "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";

pub type HttpsConn = HttpsConnector<HttpConnector>;
type AuthType = Authenticator<HttpsConn>;

static AUTHENTICATOR: OnceCell<TokioMutex<Option<AuthType>>> = OnceCell::new();

struct TauriFlowDelegate;

impl InstalledFlowDelegate for TauriFlowDelegate {
    fn present_user_url<'a>(
        &'a self,
        url: &'a str,
        need_code: bool,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
        Box::pin(async move {
            open::that(url).map_err(|e| e.to_string())?;
            if need_code {
                Err("Code input not supported".to_string())
            } else {
                Ok(String::new())
            }
        })
    }
}

async fn get_or_create_authenticator(app: &AppHandle) -> Result<(), String> {
    let auth_cell = AUTHENTICATOR.get_or_init(|| TokioMutex::new(None));
    let mut auth_guard = auth_cell.lock().await;

    if auth_guard.is_some() {
        return Ok(());
    }

    let token_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("google_tokens.json");

    let auth = yup_oauth2::InstalledFlowAuthenticator::builder(
        yup_oauth2::ApplicationSecret {
            client_id: CLIENT_ID.to_string(),
            client_secret: CLIENT_SECRET.to_string(),
            auth_uri: "https://accounts.google.com/o/oauth2/auth".to_string(),
            token_uri: "https://oauth2.googleapis.com/token".to_string(),
            auth_provider_x509_cert_url: Some(
                "https://www.googleapis.com/oauth2/v1/certs".to_string(),
            ),
            redirect_uris: vec!["http://localhost".to_string()],
            project_id: None,
            client_email: None,
            client_x509_cert_url: None,
        },
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(token_file)
    .flow_delegate(Box::new(TauriFlowDelegate))
    .build()
    .await
    .map_err(|e| e.to_string())?;

    *auth_guard = Some(auth);
    Ok(())
}

fn build_connector() -> HttpsConn {
    hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .unwrap()
        .https_or_http()
        .enable_http1()
        .build()
}

pub async fn get_drive_hub(app: &AppHandle) -> Result<Arc<DriveHub<HttpsConn>>, String> {
    get_or_create_authenticator(app).await?;

    let auth_cell = AUTHENTICATOR.get().unwrap();
    let auth_guard = auth_cell.lock().await;
    let auth = auth_guard.as_ref().unwrap();

    let scopes = &["https://www.googleapis.com/auth/drive"];
    let _ = auth.token(scopes).await.map_err(|e| e.to_string())?;

    drop(auth_guard);

    let auth_cell = AUTHENTICATOR.get().unwrap();
    let auth_guard = auth_cell.lock().await;
    let auth_clone = auth_guard.as_ref().unwrap().clone();
    drop(auth_guard);

    let client = Client::builder(TokioExecutor::new()).build(build_connector());

    Ok(Arc::new(DriveHub::new(client, auth_clone)))
}
pub async fn get_sheets_hub(app: &AppHandle) -> Result<Arc<Sheets<HttpsConn>>, String> {
    get_or_create_authenticator(app).await?;

    let auth_cell = AUTHENTICATOR.get().unwrap();
    let auth_guard = auth_cell.lock().await;
    let auth = auth_guard.as_ref().unwrap().clone();

    let client = Client::builder(TokioExecutor::new()).build(build_connector());
    Ok(Arc::new(Sheets::new(client, auth)))
}

#[tauri::command]
pub async fn start_google_oauth(app: AppHandle) -> Result<String, String> {
    get_or_create_authenticator(&app).await?;

    let auth_cell = AUTHENTICATOR.get().unwrap();
    let auth_guard = auth_cell.lock().await;
    let auth = auth_guard.as_ref().unwrap();

    let scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ];

    let token = auth.token(scopes).await.map_err(|e| e.to_string())?;
    Ok(token.token().unwrap_or_default().to_string())
}

#[tauri::command]
pub async fn get_valid_access_token(app: AppHandle) -> Result<String, String> {
    get_or_create_authenticator(&app).await?;

    let auth_cell = AUTHENTICATOR.get().unwrap();
    let auth_guard = auth_cell.lock().await;
    let auth = auth_guard.as_ref().unwrap();

    let scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
    ];

    let token = auth.token(scopes).await.map_err(|e| e.to_string())?;
    Ok(token.token().unwrap_or_default().to_string())
}

#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), String> {
    println!("logout: начало");

    let token_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("google_tokens.json");

    println!("logout: token_file = {:?}", token_file);

    if token_file.exists() {
        std::fs::remove_file(token_file).map_err(|e| e.to_string())?;
        println!("logout: файл удалён");
    }

    if let Some(auth_cell) = AUTHENTICATOR.get() {
        let mut auth_guard = auth_cell.lock().await;
        *auth_guard = None;
    }

    Ok(())
}

#[tauri::command]
pub async fn is_authenticated(app: AppHandle) -> Result<bool, String> {
    let token_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("google_tokens.json");

    Ok(token_file.exists())
}

#[tauri::command]
pub fn force_reauth(app: AppHandle) -> Result<(), String> {
    let token_file = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("google_tokens.json");

    if token_file.exists() {
        std::fs::remove_file(token_file).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_email(app: AppHandle) -> Result<String, String> {
    let hub = get_drive_hub(&app).await?;

    let (response, about) = hub
        .about()
        .get()
        .param("fields", "user,storageQuota")
        .doit()
        .await
        .map_err(|e| format!("About error: {}", e))?;

    if !response.status().is_success() {
        return Ok(("Cannot get user info".to_string()));
    }

    let user = about.user;

    if let Some(user) = user {
        return Ok(user.email_address.unwrap_or("".to_string()));
    }

    return Ok(("Cannot get user info".to_string()));
}

#[tauri::command]
pub async fn get_current_token(app: AppHandle) -> Result<String, String> {
    get_or_create_authenticator(&app).await?;

    let auth_cell = AUTHENTICATOR.get().unwrap();
    let auth_guard = auth_cell.lock().await;
    let auth = auth_guard.as_ref().unwrap();

    let scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
    ];

    let token = auth.token(scopes).await.map_err(|e| e.to_string())?;
    Ok(token.token().unwrap_or_default().to_string())
}

#[tauri::command]
pub async fn get_app_version() -> Result<String, String> {
    let app = get_app_handle();

    let app_version = app.package_info().version.clone();

    Ok(app_version.to_string())
}
