// Prevents additional console window on Windows in release mode.
// In debug mode, the console remains attached for debugging and error logging.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Binary entry point for the desktop executable.
///
/// Why:
/// Delegates immediately to `ai_helper_lib::run()` where the Tauri runtime lifecycle is managed.
fn main() {
    ai_helper_lib::run();
}

