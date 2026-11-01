use tauri::Manager;

/// The core library entry point for the AI Helper desktop application.
///
/// Why:
/// Tauri v2 cleanly separates the binary launcher (`main.rs`) from the logic module (`lib.rs`).
/// In accordance with battle-tested production implementations (such as Kunkun and Tauri templates),
/// we explicitly obtain the main window inside the `.setup()` hook and call `show()` and `set_focus()`.
/// This guarantees the Windows OS surfaces the HWND directly to the user's active session.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Retrieve the primary webview window by its label configured in tauri.conf.json
            if let Some(window) = app.get_webview_window("main") {
                // Surface the window onto the screen and focus it
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

