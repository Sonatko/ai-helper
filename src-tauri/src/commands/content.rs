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

/// Atomically extracts and empties the captured content from RAM.
///
/// Why:
/// Guarantees that a screenshot or selection is used strictly once for the initial prompt,
/// preventing stale duplicate captures from leaking into subsequent dialogue turns.
#[tauri::command]
pub fn consume_last_content(state: State<'_, AppState>) -> Option<CapturedContent> {
    state.last_content.lock().unwrap().take()
}

/// Clears any buffered capture from RAM (e.g. when user clicks [X] to dismiss attachment).
#[tauri::command]
pub fn clear_last_content(state: State<'_, AppState>) {
    let mut lock = state.last_content.lock().unwrap();
    *lock = None;
}


