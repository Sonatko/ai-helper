use crate::system::content::CapturedContent;
use crate::AppState;
use tauri::State;

/// Retrieves the content (highlighted text OR screenshot) captured when the hotkey was pressed.
///
/// Why:
/// The frontend calls this command to display a preview badge (e.g. "📷 Скриншот окна" or "📝 Выделенный текст")
/// and attaches it to the prompt sent to the LLM.
///
/// Returns:
/// `Option<CapturedContent>` holding either text, in-memory base64 screenshot, or None.
#[tauri::command]
pub fn get_last_content(state: State<'_, AppState>) -> Option<CapturedContent> {
    state.last_content.lock().unwrap().clone()
}

