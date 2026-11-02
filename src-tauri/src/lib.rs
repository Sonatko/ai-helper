pub mod commands;
pub mod system;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Global thread-safe state holding context data across Tauri commands.
///
/// Why:
/// The hotkey handler runs on a background thread. When F7 is pressed, it captures
/// the foreground window passport and saves it here so the frontend can query it.
pub struct AppState {
    pub last_passport: Mutex<Option<system::passport::WindowPassport>>,
}

/// The core library entry point for the AI Helper desktop application.
///
/// Why:
/// Initializes the Tauri application, registers system hotkeys, manages IPC state,
/// and handles the lifecycle of the floating assistant window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register managed application state
        .manage(AppState {
            last_passport: Mutex::new(None),
        })
        // Register IPC commands callable from frontend via @tauri-apps/api/core
        .invoke_handler(tauri::generate_handler![
            commands::passport::get_last_passport
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                // CRITICAL RACE-CONDITION PREVENTION:
                                // Capture the active foreground window passport BEFORE showing our window,
                                // while the target application (VS Code, Terminal, etc.) still holds OS focus!
                                let passport = system::passport::capture_active_window_passport();

                                if let Some(ref p) = passport {
                                    println!(
                                        "[AI Helper Passport] App: '{}' ({}) | Title: '{}' | Env: {:?} | Bounds: {}x{} | DPI: {}",
                                        p.app_name, p.process_name, p.window_title, p.environment, p.rect.width, p.rect.height, p.dpi
                                    );
                                }

                                if let Some(state) = app.try_state::<AppState>() {
                                    if let Ok(mut last) = state.last_passport.lock() {
                                        *last = passport;
                                    }
                                }

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
