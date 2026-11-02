pub mod commands;
pub mod system;

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
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
/// sets up system tray icon and context menu, manages IPC state, and handles window lifecycles.
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
            commands::stream::test_mock_stream,
            commands::window::expand_window,
            commands::window::collapse_window,
            commands::window::open_settings_window,
            commands::window::close_settings_window,
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let shortcut_str = format!("{:?}", shortcut).to_lowercase();
                                let is_alt = shortcut_str.contains("alt");

                                // 1. Instant capture of context passport (< 0.2 ms) while target app holds OS focus
                                let passport = system::passport::capture_active_window_passport();

                                // 2. Ultra-fast non-blocking preparation (< 2 ms):
                                // Dispatches Ctrl+Insert (if text selected) and grabs hardware downscaled GDI pixels
                                let seq_before = system::content::dispatch_safe_copy();
                                let raw_screen = if let Some(ref p) = passport {
                                    system::content::fast_capture_raw_screen(&p.rect)
                                } else {
                                    None
                                };

                                // 3. Reveal assistant window IMMEDIATELY (< 3 ms)!
                                // ZERO UI LAG: the search capsule appears in under 5 ms from physical key press!
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();

                                // 4. Save initial passport into AppState
                                if let Some(state) = app.try_state::<AppState>() {
                                    if let Ok(mut last_p) = state.last_passport.lock() {
                                        *last_p = passport.clone();
                                    }
                                }

                                // 5. Finalize context capture asynchronously in a background thread (0% UI freeze)
                                let app_handle = app.clone();
                                std::thread::spawn(move || {
                                    let content = system::content::finalize_capture(raw_screen, seq_before, is_alt);

                                    // Diagnostic reporting to terminal
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
                                                "[AI Helper Content] Mode: Fast BitBlt Screenshot ({}x{} px, in-memory JPEG)",
                                                width, height
                                            );
                                        }
                                        system::content::CapturedContent::Empty => {
                                            println!("[AI Helper Content] Mode: Empty Content");
                                        }
                                    }

                                    if let Some(state) = app_handle.try_state::<AppState>() {
                                        if let Ok(mut last_c) = state.last_content.lock() {
                                            *last_c = Some(content);
                                        }
                                    }

                                    // Notify frontend to refresh its badge seamlessly
                                    let _ = app_handle.emit("context_content_ready", ());
                                });
                            }
                        }
                    }
                })
                .build(),
        )
        // Graceful window lifecycle management
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent destruction of settings window; simply hide it
                if window.label() == "settings" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // Retrieve the primary webview window by its label
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // --- System Tray Configuration ---
            let toggle_item = MenuItem::with_id(
                app,
                "toggle",
                "🔍 Показать / Скрыть (F7)",
                true,
                None::<&str>,
            )?;
            let settings_item =
                MenuItem::with_id(app, "settings", "⚙️ Настройки...", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "🚪 Выход", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&toggle_item, &settings_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("AI Helper — Нажмите F7 для вызова")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "settings" => {
                        if let Some(settings_win) = app.get_webview_window("settings") {
                            let _ = settings_win.show();
                            let _ = settings_win.unminimize();
                            let _ = settings_win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                if is_visible {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            // Register global shortcuts
            let global_shortcut = app.global_shortcut();
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
