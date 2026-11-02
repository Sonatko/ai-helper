use crate::system::passport::WindowPassport;
use crate::AppState;
use tauri::State;

/// Retrieves the most recent window passport captured at the moment the hotkey was pressed.
///
/// Why:
/// The frontend calls this command when the window opens,
/// allowing the UI to display the active context and prepare the packet for the AI model.
///
/// Returns:
/// `Option<WindowPassport>` containing the window metadata, or `None` if no window was active.
#[tauri::command]
pub fn get_last_passport(state: State<'_, AppState>) -> Option<WindowPassport> {
    state.last_passport.lock().unwrap().clone()
}

