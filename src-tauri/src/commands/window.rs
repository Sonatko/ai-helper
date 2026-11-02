use tauri::{LogicalSize, Size, WebviewWindow};

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

