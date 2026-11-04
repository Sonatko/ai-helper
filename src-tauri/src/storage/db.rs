use base64::Engine;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Data representation of a conversation thread session in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub model_used: String,
}

/// Data representation of an individual message bubble in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRecord {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tokens: i64,
    pub created_at: i64,
    #[serde(default)]
    pub image_data: Option<String>,
}

/// Thread-safe SQLite database manager for chat history.
///
/// Why:
/// Centralizes all database transactions under an in-process Mutex to guarantee
/// ACID integrity across asynchronous Tauri command threads.
pub struct DatabaseManager {
    conn: Mutex<Connection>,
    media_dir: PathBuf,
}

impl DatabaseManager {
    /// Initializes the SQLite database file, enabling WAL mode and creating core tables.
    ///
    /// # Arguments
    /// * `db_path` - Filesystem path to the chats.db file in AppData.
    pub fn new(db_path: &Path) -> Result<Self> {
        let parent_dir = db_path.parent().unwrap_or_else(|| Path::new("."));
        let media_dir = parent_dir.join("media");
        let _ = std::fs::create_dir_all(&media_dir);

        let conn = Connection::open(db_path)?;

        // WAL mode permits concurrent reads while writes take place, preventing UI stalls
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;

             CREATE TABLE IF NOT EXISTS sessions (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 model_used TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS messages (
                 id TEXT PRIMARY KEY,
                 session_id TEXT NOT NULL,
                 role TEXT NOT NULL,
                 content TEXT NOT NULL,
                 tokens INTEGER DEFAULT 0,
                 created_at INTEGER NOT NULL,
                 image_path TEXT,
                 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
             );

             CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

             CREATE TABLE IF NOT EXISTS kv_settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;

        // Idempotent schema migration for existing databases created without image_path column
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN image_path TEXT;", []);

        Ok(Self {
            conn: Mutex::new(conn),
            media_dir,
        })
    }

    /// Retrieves all active conversation sessions sorted chronologically by most recently updated.
    pub fn get_sessions(&self) -> Result<Vec<SessionRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, model_used 
             FROM sessions 
             ORDER BY updated_at DESC 
             LIMIT 50",
        )?;

        let session_iter = stmt.query_map([], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                model_used: row.get(4)?,
            })
        })?;

        let mut sessions = Vec::new();
        for item in session_iter {
            sessions.push(item?);
        }
        Ok(sessions)
    }

    /// Inserts or updates a session metadata record.
    pub fn save_session(&self, record: &SessionRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, model_used)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                 title = excluded.title,
                 updated_at = excluded.updated_at,
                 model_used = excluded.model_used;",
            params![
                record.id,
                record.title,
                record.created_at,
                record.updated_at,
                record.model_used
            ],
        )?;
        Ok(())
    }

    /// Retrieves all messages belonging to a session in strictly chronological order,
    /// hydrating any attached multimodal images from the media directory.
    pub fn get_messages(&self, session_id: &str) -> Result<Vec<MessageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, tokens, created_at, image_path 
             FROM messages 
             WHERE session_id = ?1 
             ORDER BY created_at ASC",
        )?;

        let parent_dir = self.media_dir.parent().unwrap_or_else(|| Path::new("."));

        let msg_iter = stmt.query_map(params![session_id], |row| {
            let id: String = row.get(0)?;
            let session_id: String = row.get(1)?;
            let role: String = row.get(2)?;
            let content: String = row.get(3)?;
            let tokens: i64 = row.get(4)?;
            let created_at: i64 = row.get(5)?;
            let rel_image_path: Option<String> = row.get(6)?;

            let image_data = if let Some(ref path) = rel_image_path {
                let full_path = parent_dir.join(path);
                if let Ok(bytes) = std::fs::read(&full_path) {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    Some(format!("data:image/jpeg;base64,{}", b64))
                } else {
                    None
                }
            } else {
                None
            };

            Ok(MessageRecord {
                id,
                session_id,
                role,
                content,
                tokens,
                created_at,
                image_data,
            })
        })?;

        let mut messages = Vec::new();
        for item in msg_iter {
            messages.push(item?);
        }
        Ok(messages)
    }

    /// Adds a single message to a session, persisting any attached image to disk
    /// rather than bloating the SQLite database file with raw megabytes.
    pub fn add_message(&self, msg: &MessageRecord) -> Result<()> {
        let mut stored_image_path: Option<String> = None;

        if let Some(ref img_b64) = msg.image_data {
            let clean_b64 = if let Some(idx) = img_b64.find(',') {
                &img_b64[idx + 1..]
            } else {
                img_b64.as_str()
            };

            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean_b64.trim()) {
                let file_name = format!("{}.jpg", msg.id);
                let target_path = self.media_dir.join(&file_name);
                if std::fs::write(&target_path, bytes).is_ok() {
                    stored_image_path = Some(format!("media/{}", file_name));
                }
            }
        }

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, tokens, created_at, image_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
            params![
                msg.id,
                msg.session_id,
                msg.role,
                msg.content,
                msg.tokens,
                msg.created_at,
                stored_image_path
            ],
        )?;

        // Update session's last activity timestamp to bump it to top of history
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2;",
            params![msg.created_at, msg.session_id],
        )?;

        Ok(())
    }

    /// Deletes a session and cleans up any media files on disk.
    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Find any media files associated with the session before deleting
        if let Ok(mut stmt) = conn.prepare("SELECT image_path FROM messages WHERE session_id = ?1 AND image_path IS NOT NULL;") {
            let parent_dir = self.media_dir.parent().unwrap_or_else(|| Path::new("."));
            let paths_iter = stmt.query_map(params![session_id], |row| row.get::<_, String>(0));
            if let Ok(paths) = paths_iter {
                for path_res in paths.flatten() {
                    let _ = std::fs::remove_file(parent_dir.join(path_res));
                }
            }
        }

        conn.execute("DELETE FROM sessions WHERE id = ?1;", params![session_id])?;
        Ok(())
    }

    /// Truncates all sessions, messages, and empties the media cache directory.
    pub fn clear_all_sessions(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sessions;", [])?;
        conn.execute("DELETE FROM messages;", [])?;

        if let Ok(entries) = std::fs::read_dir(&self.media_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }

        Ok(())
    }

    /// Retrieves a persistent configuration value by key from SQLite.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM kv_settings WHERE key = ?1 LIMIT 1;")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Stores or updates a persistent configuration key-value pair in SQLite.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO kv_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            params![key, value],
        )?;
        Ok(())
    }
}

