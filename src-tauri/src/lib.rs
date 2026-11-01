use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// The core library entry point for the AI Helper desktop application.
///
/// Why:
/// Slice 2 implements global system hotkey registration via Windows Win32 API.
/// Pressing the hotkey toggles the visibility of the assistant window:
/// - If visible: hides the window immediately.
/// - If hidden: reveals the window and focuses the input field.
/// Includes graceful conflict handling (falls back to F8 if F7 is already occupied).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Retrieve the primary webview window by its label
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Register global shortcut with graceful fallback
            // Default preferred key: F7 (safe single key, minimal collision risk)
            let primary_key = "F7";
            let fallback_key = "F8";

            let global_shortcut = app.global_shortcut();
            if let Err(err) = global_shortcut.register(primary_key) {
                eprintln!(
                    "[AI Helper] Warning: Primary hotkey '{}' is occupied ({:?}). Attempting fallback to '{}'...",
                    primary_key, err, fallback_key
                );
                if let Err(fallback_err) = global_shortcut.register(fallback_key) {
                    eprintln!(
                        "[AI Helper] Error: Fallback hotkey '{}' also failed ({:?}).",
                        fallback_key, fallback_err
                    );
                } else {
                    println!("[AI Helper] Successfully registered fallback hotkey: {}", fallback_key);
                }
            } else {
                println!("[AI Helper] Successfully registered global hotkey: {}", primary_key);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
