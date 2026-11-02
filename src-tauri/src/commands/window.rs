use tauri::{AppHandle, LogicalSize, Manager, Size, WebviewWindow};

/// Expands the assistant window to reveal the streamed response area.
///
/// Why:
/// Executed natively in Rust without requiring permissive frontend window-size capabilities.
#[tauri::command]
pub fn expand_window(window: WebviewWindow) {
    let _ = window.set_size(Size::Logical(LogicalSize {
        width: 680.0,
        height: 420.0,
    }));
}

/// Collapses the assistant window back to the single-line input capsule.
///
/// Why:
/// Restores the compact 60px height when the user clears the query or presses Escape.
#[tauri::command]
pub fn collapse_window(window: WebviewWindow) {
    let _ = window.set_size(Size::Logical(LogicalSize {
        width: 680.0,
        height: 60.0,
    }));
}

/// Shows and focuses the dedicated settings window.
///
/// Why:
/// Invoked from the system tray or on first launch when no API credentials exist.
#[tauri::command]
pub fn open_settings_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hides the dedicated settings window.
///
/// Why:
/// Closes the settings UI gracefully without destroying the underlying webview.
#[tauri::command]
pub fn close_settings_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.hide();
    }
}

