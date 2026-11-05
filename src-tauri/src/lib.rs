
pub mod commands;
pub mod storage;
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
    pub last_screen_freeze: Mutex<Option<system::content::RawScreenCapture>>,
    pub hotkey_main: Mutex<String>,
    pub hotkey_snip: Mutex<String>,
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
            last_screen_freeze: Mutex::new(None),
            hotkey_main: Mutex::new("F7".to_string()),
            hotkey_snip: Mutex::new("Alt+F7".to_string()),
        })
        // Register IPC commands callable from frontend
        .invoke_handler(tauri::generate_handler![
            commands::passport::get_last_passport,
            commands::content::get_last_content,
            commands::content::consume_last_content,
            commands::content::clear_last_content,
            commands::stream::test_mock_stream,
            commands::window::expand_window,
            commands::window::collapse_window,
            commands::window::open_settings_window,
            commands::window::close_settings_window,
            commands::window::open_external_url,
            commands::window::confirm_crop_region,
            commands::window::cancel_crop_region,
            commands::window::get_registered_hotkeys,
            commands::window::update_registered_hotkeys,
            commands::chat::get_chat_sessions,
            commands::chat::save_chat_session,
            commands::chat::get_chat_messages,
            commands::chat::add_chat_message,
            commands::chat::delete_chat_session,
            commands::chat::clear_chat_history,
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("app_summoned", ());
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let is_snip = if let Some(state) = app.try_state::<AppState>() {
                            let snip_cfg = state.hotkey_snip.lock().unwrap().clone();
                            if let Ok(parsed) = snip_cfg.parse::<tauri_plugin_global_shortcut::Shortcut>() {
                                shortcut == &parsed
                            } else {
                                let shortcut_str = format!("{:?}", shortcut).to_lowercase();
                                shortcut_str.contains("alt")
                            }
                        } else {
                            let shortcut_str = format!("{:?}", shortcut).to_lowercase();
                            shortcut_str.contains("alt")
                        };

                        if is_snip {
                            // ========================================================
                            // SCENARIO 3: INTERACTIVE SCREEN REGION SNIP (Alt + F7)
                            // ========================================================
                            // 1. Instant capture of context passport while target app holds OS focus
                            let passport = system::passport::capture_active_window_passport();

                            // 2. Freeze full desktop in RAM (< 3 ms) BEFORE overlay is shown
                            let freeze = system::content::fast_capture_fullscreen();

                            if let Some(state) = app.try_state::<AppState>() {
                                if let Ok(mut last_p) = state.last_passport.lock() {
                                    *last_p = passport;
                                }
                                if let Ok(mut last_f) = state.last_screen_freeze.lock() {
                                    *last_f = freeze;
                                }
                            }

                            // 3. Reveal and focus interactive snipping overlay
                            if let Some(snip_win) = app.get_webview_window("snipping") {
                                let _ = snip_win.show();
                                let _ = snip_win.unminimize();
                                commands::window::force_focus_window(&snip_win);
                                let _ = snip_win.set_focus();
                                let _ = snip_win.emit("snipping_activated", ());
                            }
                        } else {
                            // ========================================================
                            // SCENARIO 1 & 2: MAIN CAPSULE SEARCH (F7)
                            // ========================================================
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                let is_foreground = commands::window::is_window_foreground(&window);

                                if is_visible && is_foreground {
                                    let _ = window.hide();
                                } else {
                                    // 1. Instant capture of context passport (< 0.2 ms)
                                    let passport = system::passport::capture_active_window_passport();

                                    // 2. Dispatch Ctrl+Insert and capture hardware screen
                                    let seq_before = system::content::dispatch_safe_copy();
                                    let raw_screen = if let Some(ref p) = passport {
                                        system::content::fast_capture_raw_screen(&p.rect)
                                    } else {
                                        None
                                    };

                                    // 3. Reveal assistant window immediately (< 3 ms)
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    commands::window::force_focus_window(&window);
                                    let _ = window.set_focus();
                                    let _ = window.emit("app_summoned", ());

                                    // 4. Save initial passport into AppState
                                    if let Some(state) = app.try_state::<AppState>() {
                                        if let Ok(mut last_p) = state.last_passport.lock() {
                                            *last_p = passport.clone();
                                        }
                                    }

                                    // 5. Finalize context capture asynchronously in a background thread (0% UI freeze)
                                    let app_handle = app.clone();
                                    std::thread::spawn(move || {
                                        let content = system::content::finalize_capture(raw_screen, seq_before, false);

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
            // Initialize SQLite chats database in OS-specific AppData folder
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("chats.db");

            let db_manager = storage::DatabaseManager::new(&db_path)
                .expect("Failed to initialize SQLite database");
            app.manage(db_manager);

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
            let snip_item = MenuItem::with_id(
                app,
                "snip",
                "✂️ Вырезать область (Alt+F7)",
                true,
                None::<&str>,
            )?;
            let settings_item =
                MenuItem::with_id(app, "settings", "⚙️ Настройки...", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "🚪 Выход", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&toggle_item, &snip_item, &settings_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
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
                    "snip" => {
                        let passport = system::passport::capture_active_window_passport();
                        let freeze = system::content::fast_capture_fullscreen();
                        if let Some(state) = app.try_state::<AppState>() {
                            if let Ok(mut last_p) = state.last_passport.lock() {
                                *last_p = passport;
                            }
                            if let Ok(mut last_f) = state.last_screen_freeze.lock() {
                                *last_f = freeze;
                            }
                        }
                        if let Some(snip_win) = app.get_webview_window("snipping") {
                            let _ = snip_win.show();
                            let _ = snip_win.unminimize();
                            commands::window::force_focus_window(&snip_win);
                            let _ = snip_win.set_focus();
                            let _ = snip_win.emit("snipping_activated", ());
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

            // Load configured global shortcuts from SQLite or use defaults
            let (saved_main, saved_snip) = if let Some(db) = app.try_state::<storage::db::DatabaseManager>() {
                let m = db.get_setting("hotkey_main").unwrap_or(None).unwrap_or_else(|| "F7".to_string());
                let s = db.get_setting("hotkey_snip").unwrap_or(None).unwrap_or_else(|| "Alt+F7".to_string());
                (m, s)
            } else {
                ("F7".to_string(), "Alt+F7".to_string())
            };

            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut m) = state.hotkey_main.lock() {
                    *m = saved_main.clone();
                }
                if let Ok(mut s) = state.hotkey_snip.lock() {
                    *s = saved_snip.clone();
                }
            }

            tray_builder = tray_builder.tooltip(format!(
                "AI Helper — {} (Ассистент) / {} (Вырезать область)",
                saved_main, saved_snip
            ));

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            // Register global shortcuts
            let global_shortcut = app.global_shortcut();
            if let Err(err) = global_shortcut.register(saved_main.as_str()) {
                eprintln!(
                    "[AI Helper] Warning: Hotkey '{}' could not be registered ({:?}). Falling back to 'F7'...",
                    saved_main, err
                );
                let _ = global_shortcut.register("F7");
            } else {
                println!("[AI Helper] Successfully registered global hotkey: {}", saved_main);
            }

            if let Err(err) = global_shortcut.register(saved_snip.as_str()) {
                eprintln!(
                    "[AI Helper] Notice: Shortcut '{}' could not be registered: {:?}",
                    saved_snip, err
                );
                let _ = global_shortcut.register("Alt+F7");
            } else {
                println!("[AI Helper] Successfully registered global hotkey: {}", saved_snip);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
