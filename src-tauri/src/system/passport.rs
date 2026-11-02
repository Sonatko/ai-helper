use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(windows)]
use windows::core::PWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, RECT};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(windows)]
use windows::Win32::UI::HiDpi::GetDpiForWindow;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
};

/// Screen coordinates and dimensions of a window bounding box.
///
/// Why:
/// Needed for Slice 4 to pass pixel-perfect bounds to the Win32 BitBlt screenshot function.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub width: i32,
    pub height: i32,
}

/// The clean, objective context passport of the user's active application window.
///
/// Why:
/// Modern AI models (Gemini Flash, Claude, GPT) are pre-trained on millions of developer tools.
/// Instead of fragile hand-coded if/else heuristics, we pass pure OS-level facts:
/// process name, window title, screen geometry, DPI, and process elevation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowPassport {
    /// Win32 window handle as a usize integer (used by Slice 4 BitBlt capture)
    pub hwnd: usize,
    /// Operating system Process ID (PID)
    pub pid: u32,
    /// Executable filename, e.g. "Antigravity IDE.exe", "code.exe"
    pub process_name: String,
    /// Human-friendly application name (e.g. "Antigravity IDE", "code")
    pub app_name: String,
    /// Full binary path on disk, e.g. "C:\Program Files\..."
    pub process_path: String,
    /// Window title bar text (from GetWindowTextW)
    pub window_title: String,
    /// Bounding rectangle in screen coordinates
    pub rect: WindowRect,
    /// Monitor DPI scaling factor (96 = 100%, 120 = 125%, 144 = 150%, 192 = 200%)
    pub dpi: u32,
    /// Low-level remote or virtualization environment if explicitly detected (e.g. WSL2, SSH)
    pub environment: Option<String>,
    /// Whether the active window is running with Administrator (elevated) privileges
    pub is_elevated: bool,
    /// Host operating system family (e.g. "Windows")
    pub os_info: String,
    /// Host CPU architecture ("x86_64", "aarch64")
    pub arch: String,
}

/// Detects if the active window is running inside an explicit WSL2 or SSH session.
///
/// Why:
/// Unlike application types (which the LLM recognizes on its own), virtualization and
/// remote shells change the target command syntax (bash vs cmd).
fn detect_remote_env(title: &str) -> Option<String> {
    let lower = title.to_lowercase();
    if lower.contains("ubuntu") || lower.contains("debian") || lower.contains("wsl") {
        Some("WSL2 (Linux)".to_string())
    } else if lower.contains("ssh ") || lower.contains("@") {
        Some("SSH Remote".to_string())
    } else {
        None
    }
}

/// Checks if the target window is running with elevated (Administrator) rights.
///
/// Why:
/// Standard Windows consoles and terminal apps prepend "Administrator:" or
/// "Администратор:" to the window title when running with elevated tokens.
fn check_is_elevated(title: &str) -> bool {
    let lower = title.to_lowercase();
    lower.starts_with("administrator:")
        || lower.starts_with("администратор:")
        || lower.contains("administrator: ")
        || lower.contains("администратор: ")
}

/// Captures the full context passport of the currently focused foreground window.
///
/// Why:
/// Must be invoked in < 1 ms before the assistant window is shown,
/// ensuring we capture the window the user was actually interacting with.
///
/// Returns:
/// `Some(WindowPassport)` if a valid window is focused, or `None` if desktop/empty.
#[cfg(windows)]
pub fn capture_active_window_passport() -> Option<WindowPassport> {
    unsafe {
        // Step 1: Query the OS for the current foreground window handle
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        // Avoid capturing our own assistant window
        let mut pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return None;
        }

        // Step 2: Query window title (UTF-16 buffer of 512 units to avoid truncation)
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        // Step 3: Query window screen coordinates
        let mut win_rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut win_rect);
        let rect = WindowRect {
            left: win_rect.left,
            top: win_rect.top,
            right: win_rect.right,
            bottom: win_rect.bottom,
            width: (win_rect.right - win_rect.left).max(0),
            height: (win_rect.bottom - win_rect.top).max(0),
        };

        // Step 4: Query monitor DPI for physical-to-logical pixel scaling
        let raw_dpi = GetDpiForWindow(hwnd);
        let dpi = if raw_dpi > 0 { raw_dpi } else { 96 };

        // Step 5: Query process executable path
        let mut process_path = String::new();
        let mut process_name = String::new();
        let mut app_name = String::new();

        if let Ok(process_handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut path_buf = [0u16; 1024];
            let mut size = path_buf.len() as u32;

            if QueryFullProcessImageNameW(
                process_handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(path_buf.as_mut_ptr()),
                &mut size,
            )
            .is_ok()
            {
                process_path = String::from_utf16_lossy(&path_buf[..size as usize]);
                let path = Path::new(&process_path);
                if let Some(file_name) = path.file_name() {
                    process_name = file_name.to_string_lossy().to_string();
                }
                if let Some(stem) = path.file_stem() {
                    app_name = stem.to_string_lossy().to_string();
                }
            }

            let _ = CloseHandle(process_handle);
        }

        // Step 6: Derive elevation and optional remote environment
        let environment = detect_remote_env(&window_title);
        let is_elevated = check_is_elevated(&window_title);

        Some(WindowPassport {
            hwnd: hwnd.0 as usize,
            pid,
            process_name,
            app_name,
            process_path,
            window_title,
            rect,
            dpi,
            environment,
            is_elevated,
            os_info: "Windows".to_string(),
            arch: std::env::consts::ARCH.to_string(),
        })
    }
}

/// Fallback for non-Windows platforms (e.g. testing or cross-compilation).
#[cfg(not(windows))]
pub fn capture_active_window_passport() -> Option<WindowPassport> {
    None
}
