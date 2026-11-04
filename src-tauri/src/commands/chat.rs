use crate::storage::{DatabaseManager, MessageRecord, SessionRecord};
use tauri::State;

/// Queries SQLite for all recent conversation sessions.
#[tauri::command]
pub fn get_chat_sessions(db: State<'_, DatabaseManager>) -> Result<Vec<SessionRecord>, String> {
    db.get_sessions().map_err(|e| e.to_string())
}

/// Creates or updates a session metadata entry in SQLite.
#[tauri::command]
pub fn save_chat_session(
    db: State<'_, DatabaseManager>,
    session: SessionRecord,
) -> Result<(), String> {
    db.save_session(&session).map_err(|e| e.to_string())
}

/// Retrieves all messages belonging to a session in chronological order.
#[tauri::command]
pub fn get_chat_messages(
    db: State<'_, DatabaseManager>,
    session_id: String,
) -> Result<Vec<MessageRecord>, String> {
    db.get_messages(&session_id).map_err(|e| e.to_string())
}

/// Appends a new user or assistant message to SQLite.
#[tauri::command]
pub fn add_chat_message(
    db: State<'_, DatabaseManager>,
    message: MessageRecord,
) -> Result<(), String> {
    db.add_message(&message).map_err(|e| e.to_string())
}

/// Deletes a session and all its messages.
#[tauri::command]
pub fn delete_chat_session(
    db: State<'_, DatabaseManager>,
    session_id: String,
) -> Result<(), String> {
    db.delete_session(&session_id).map_err(|e| e.to_string())
}

/// Clears all stored chat history.
#[tauri::command]
pub fn clear_chat_history(db: State<'_, DatabaseManager>) -> Result<(), String> {
    db.clear_all_sessions().map_err(|e| e.to_string())
}

