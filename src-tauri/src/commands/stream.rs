use std::time::Duration;
use tauri::ipc::Channel;

/// Emulates a streaming LLM response using official Tauri v2 IPC Channels.
///
/// Why:
/// Allows end-to-end verification of window expansion, auto-scrolling,
/// real-time DOM updates, and UI performance without external network latency or API keys.
#[tauri::command]
pub async fn test_mock_stream(on_chunk: Channel<String>) {
    let mock_text = "\
Привет! Я зафиксировал ваше активное окно и собрал полный контекст.\n\n\
Все узлы работают стабильно:\n\
• Паспорт окна получен за 0.3 мс (Win32 API)\n\
• Контент (текст или BitBlt скриншот) сжат прямо в памяти RAM\n\
• Потоковый канал Tauri v2 передает чанки без мерцаний интерфейса\n\n\
Технический каркас готов. Теперь можно переходить к подключению реальной нейросети!";

    // Split text into word tokens with spaces to emulate LLM token generation
    for word in mock_text.split_inclusive(' ') {
        tokio::time::sleep(Duration::from_millis(35)).await;
        let _ = on_chunk.send(word.to_string());
    }
}

