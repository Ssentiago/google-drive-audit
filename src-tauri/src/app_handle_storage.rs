use once_cell::sync::OnceCell;
use tauri::{AppHandle, WebviewWindow};

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static MAIN_WINDOW: OnceCell<WebviewWindow> = OnceCell::new();

pub fn init_app_handle(app: AppHandle) {
    APP_HANDLE.set(app).ok();
}

pub fn init_main_window(window: WebviewWindow) {
    MAIN_WINDOW.set(window).ok();
}

pub fn get_app_handle() -> &'static AppHandle {
    APP_HANDLE.get().expect("AppHandle not initialized")
}

pub fn get_main_window() -> &'static WebviewWindow {
    MAIN_WINDOW.get().expect("Main window not initialized")
}
