use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size, WebviewWindow};

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

/// Forces the Windows OS to bring the assistant window to the top and activate it.
///
/// Why:
/// When triggered from a registered global hotkey (WM_HOTKEY), Windows explicitly
/// permits the target application to take foreground focus. Standard Win32 ShowWindow
/// combined with BringWindowToTop and SetForegroundWindow guarantees activation without thread input hacks.
pub fn force_focus_window(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{
                BringWindowToTop, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
            };

            let target_hwnd = HWND(hwnd.0 as _);
            let _ = ShowWindow(target_hwnd, SW_RESTORE);
            let _ = ShowWindow(target_hwnd, SW_SHOW);
            let _ = BringWindowToTop(target_hwnd);
            let _ = SetForegroundWindow(target_hwnd);
        }
    }
}

/// Checks if this window or any of its child controls currently holds the OS foreground focus.
///
/// Why:
/// Tauri's internal `window.is_focused()` only checks webview queue flags and often returns `true`
/// even when the user has switched focus to VS Code or another application.
/// Comparing `GetForegroundWindow()` against our Win32 HWND hierarchy provides 100% reliable ground truth.
pub fn is_window_foreground(window: &WebviewWindow) -> bool {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};

            let target_hwnd = HWND(hwnd.0 as _);
            let fg_hwnd = GetForegroundWindow();

            if fg_hwnd == target_hwnd {
                return true;
            }
            if GetAncestor(fg_hwnd, GA_ROOT) == target_hwnd {
                return true;
            }
        }
    }
    false
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

/// Confirms the interactive screen region crop selected by the user in the snipping overlay.
///
/// Why:
/// Crops physical pixels from the in-memory freeze frame, encodes them to JPEG,
/// saves to AppState, hides the snipping overlay, and reveals the main assistant capsule.
#[tauri::command]
pub fn confirm_crop_region(
    app: AppHandle,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    dpr: f64,
) {
    use crate::AppState;
    use crate::system::content::{crop_raw_screen, encode_jpeg_base64, CapturedContent};

    // Hide snipping overlay immediately
    if let Some(snip_win) = app.get_webview_window("snipping") {
        let _ = snip_win.hide();
    }

    let scale = if dpr > 0.0 { dpr } else { 1.0 };
    let phys_x = (x as f64 * scale).round() as u32;
    let phys_y = (y as f64 * scale).round() as u32;
    let phys_w = (width as f64 * scale).round() as u32;
    let phys_h = (height as f64 * scale).round() as u32;

    if let Some(state) = app.try_state::<AppState>() {
        let mut content_to_set = None;

        if let Ok(freeze_guard) = state.last_screen_freeze.lock() {
            if let Some(ref freeze) = *freeze_guard {
                if let Some(cropped) = crop_raw_screen(freeze, phys_x, phys_y, phys_w, phys_h) {
                    println!(
                        "[AI Helper Content] Mode: Interactive Region Crop ({}x{} px at {},{})",
                        cropped.width, cropped.height, phys_x, phys_y
                    );
                    if let Some(base64) = encode_jpeg_base64(&cropped.bgra_bytes, cropped.width, cropped.height) {
                        content_to_set = Some(CapturedContent::Screenshot {
                            base64,
                            width: cropped.width,
                            height: cropped.height,
                            is_crop: true,
                        });
                    }
                }
            }
        }

        if let Some(content) = content_to_set {
            if let Ok(mut last_c) = state.last_content.lock() {
                *last_c = Some(content);
            }
        }
    }

    // Reveal and focus the primary assistant capsule window
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.unminimize();
        let _ = main_win.show();
        force_focus_window(&main_win);
        let _ = main_win.set_focus();
        let _ = main_win.emit("app_summoned", ());
        let _ = main_win.emit("context_content_ready", ());
    }
}

/// Cancels the interactive screen region crop and hides the snipping overlay.
#[tauri::command]
pub fn cancel_crop_region(app: AppHandle) {
    if let Some(snip_win) = app.get_webview_window("snipping") {
        let _ = snip_win.hide();
    }
}

/// Opens an external URL in the default system web browser.
///
/// Why:
/// Inside Tauri v2's WebView2, clicking target="_blank" links is blocked by sandboxing.
/// Calling the Win32 ShellExecuteW API guarantees that external links (Smithery, Glama, GitHub)
/// open instantly in the user's default browser (Chrome, Edge, Firefox, Brave) without spawning command prompts.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide_url = HSTRING::from(&url);
        let wide_op = windows::core::w!("open");

        unsafe {
            let res = ShellExecuteW(
                None,
                wide_op,
                &wide_url,
                None,
                None,
                SW_SHOWNORMAL,
            );
            // ShellExecuteW returns a pseudo-handle > 32 on success
            if (res.0 as usize) <= 32 {
                return Err(format!("ShellExecuteW failed with code {}", res.0 as usize));
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Unsupported OS".to_string())
    }
}

