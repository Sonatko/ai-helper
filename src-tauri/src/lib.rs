pub mod commands;
pub mod system;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Global thread-safe state holding context data across Tauri commands.
///
/// Why:
/// The hotkey handler runs on a background thread. When hotkeys are triggered,
/// it captures the window passport and content (text or screenshot) and saves it here.
pub struct AppState {
    pub last_passport: Mutex<Option<system::passport::WindowPassport>>,
    pub last_content: Mutex<Option<system::content::CapturedContent>>,
}

/// The core library entry point for the AI Helper desktop application.
///
/// Why:
/// Initializes the Tauri application, registers global shortcuts (F7 and Alt+F7),
/// manages IPC state, and handles the lifecycle of the floating assistant window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register managed application state
        .manage(AppState {
            last_passport: Mutex::new(None),
            last_content: Mutex::new(None),
        })
        // Register IPC commands callable from frontend
        .invoke_handler(tauri::generate_handler![
            commands::passport::get_last_passport,
            commands::content::get_last_content,
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
                                // 1. Capture passport while target application holds OS focus
                                let passport = system::passport::capture_active_window_passport();

                                // 2. Capture content: checks highlighted text first, falls back to BitBlt screenshot
                                let content = system::content::capture_active_content(&passport);

                                // 3. Diagnostic reporting to terminal
                                if let Some(ref p) = passport {
                                    println!(
                                        "[AI Helper Passport] App: '{}' ({}) | Title: '{}' | Bounds: {}x{} | DPI: {}",
                                        p.app_name, p.process_name, p.window_title, p.rect.width, p.rect.height, p.dpi
                                    );
                                }

                                match &content {
                                    system::content::CapturedContent::Text(text) => {
                                        let preview: String = text.chars().take(60).collect();
                                        println!(
                                            "[AI Helper Content] Mode: Highlighted Text ({} chars) -> \"{}\"",
                                            text.len(),
                                            preview
                                        );
                                    }
                                    system::content::CapturedContent::Screenshot { width, height, .. } => {
                                        println!(
                                            "[AI Helper Content] Mode: BitBlt Screenshot ({}x{} px, in-memory JPEG)",
                                            width, height
                                        );
                                    }
                                    system::content::CapturedContent::Empty => {
                                        println!("[AI Helper Content] Mode: Empty Content");
                                    }
                                }

                                // 4. Save into thread-safe AppState
                                if let Some(state) = app.try_state::<AppState>() {
                                    if let Ok(mut last_p) = state.last_passport.lock() {
                                        *last_p = passport;
                                    }
                                    if let Ok(mut last_c) = state.last_content.lock() {
                                        *last_c = Some(content);
                                    }
                                }

                                // 5. Reveal assistant window and focus input
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

            let global_shortcut = app.global_shortcut();

            // Register primary F7 shortcut
            let primary_key = "F7";
            let fallback_key = "F8";
            if let Err(err) = global_shortcut.register(primary_key) {
                eprintln!(
                    "[AI Helper] Warning: Primary hotkey '{}' is occupied ({:?}). Attempting fallback to '{}'...",
                    primary_key, err, fallback_key
                );
                let _ = global_shortcut.register(fallback_key);
            } else {
                println!("[AI Helper] Successfully registered global hotkey: {}", primary_key);
            }

            // Register Alt+F7 shortcut
            let alt_key = "Alt+F7";
            if let Err(err) = global_shortcut.register(alt_key) {
                eprintln!("[AI Helper] Notice: Shortcut '{}' could not be registered: {:?}", alt_key, err);
            } else {
                println!("[AI Helper] Successfully registered global hotkey: {}", alt_key);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
