import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

/**
 * Window passport data structure received from the Rust Win32 backend.
 */
export interface WindowPassport {
  hwnd: number;
  pid: number;
  process_name: string;
  app_name: string;
  process_path: string;
  window_title: string;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  dpi: number;
  environment: string | null;
  is_elevated: boolean;
  os_info: string;
  arch: string;
}

/**
 * Captured user context content (text or in-memory screenshot).
 */
export type CapturedContent =
  | { type: "Text"; payload: string }
  | { type: "Screenshot"; payload: { base64: string; width: number; height: number } }
  | { type: "Empty" };

window.addEventListener("DOMContentLoaded", () => {
  const queryInput = document.getElementById("query-input") as HTMLInputElement | null;
  const badgePill = document.getElementById("badge-pill") as HTMLElement | null;
  const responsePanel = document.getElementById("response-panel") as HTMLElement | null;
  const responseContent = document.getElementById("response-content") as HTMLElement | null;
  const statusIndicator = document.getElementById("status-indicator") as HTMLElement | null;
  const tokenCountEl = document.getElementById("token-count") as HTMLElement | null;
  const quotaTextEl = document.getElementById("quota-text") as HTMLElement | null;
  const quotaProgressBar = document.getElementById("quota-progress-bar") as HTMLElement | null;
  const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement | null;
  const newChatBtn = document.getElementById("new-chat-btn") as HTMLButtonElement | null;

  const appWindow = getCurrentWindow();
  let isExpanded = false;
  let isStreaming = false;

  // Daily quota tracker in localStorage
  const getTodayKey = () => `ai_helper_requests_${new Date().toISOString().slice(0, 10)}`;
  const getDailyRequests = (): number => {
    return parseInt(localStorage.getItem(getTodayKey()) || "0", 10);
  };
  const incrementDailyRequests = (): number => {
    const next = getDailyRequests() + 1;
    localStorage.setItem(getTodayKey(), next.toString());
    return next;
  };

  const updateQuotaDisplay = () => {
    const used = getDailyRequests();
    const max = 1500;
    if (quotaTextEl) {
      quotaTextEl.textContent = `${used}/${max}`;
    }
    if (quotaProgressBar) {
      const pct = Math.min(100, Math.max(1, (used / max) * 100));
      quotaProgressBar.style.width = `${pct}%`;
    }
  };

  updateQuotaDisplay();

  // 1. Expand / Collapse Window handlers (delegated to Rust backend)
  const expandWindow = async () => {
    if (!isExpanded) {
      await invoke("expand_window");
      if (responsePanel) {
        responsePanel.classList.remove("hidden");
      }
      isExpanded = true;
    }
  };

  const collapseWindow = async () => {
    if (isExpanded) {
      if (responsePanel) {
        responsePanel.classList.add("hidden");
      }
      await invoke("collapse_window");
      isExpanded = false;
    }
  };

  // 2. Start new session handler (Ctrl+N or + Новый button)
  const startNewSession = async () => {
    if (isStreaming) return;
    await collapseWindow();
    if (queryInput) {
      queryInput.value = "";
      queryInput.focus();
    }
    if (responseContent) {
      responseContent.textContent = "";
    }
    if (statusIndicator) {
      statusIndicator.textContent = "";
    }
    if (tokenCountEl) {
      tokenCountEl.textContent = "⚡ 0 токенов";
    }
    // Refresh passport and content for the new context
    focusInput();
  };

  // 3. Auto-focus and fetch context passport & content
  const focusInput = async () => {
    if (queryInput) {
      queryInput.focus();
      if (!isExpanded) {
        queryInput.select();
      }
    }

    try {
      const passport = await invoke<WindowPassport | null>("get_last_passport");
      const content = await invoke<CapturedContent | null>("get_last_content");

      if (badgePill) {
        if (content && content.type === "Text") {
          badgePill.textContent = "📝 Текст";
          badgePill.title = `Выделено: ${content.payload.slice(0, 50)}...`;
          badgePill.classList.remove("hidden");
        } else if (content && content.type === "Screenshot") {
          const app = passport?.app_name || "Окно";
          badgePill.textContent = `📷 ${app}`;
          badgePill.title = `Снимок окна: ${passport?.window_title || ""}`;
          badgePill.classList.remove("hidden");
        } else {
          badgePill.classList.add("hidden");
        }
      }
    } catch (err) {
      console.error("[AI Helper UI] Failed to retrieve context:", err);
    }
  };

  focusInput();
  window.addEventListener("focus", focusInput);

  // 4. Middle-click (wheel hold & move) window dragging
  let isDragging = false;
  let startScreenX = 0;
  let startScreenY = 0;
  let startWindowX = 0;
  let startWindowY = 0;

  window.addEventListener("pointerdown", async (event: PointerEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      if (target && target.setPointerCapture) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // Ignore
        }
      }
      const pos = await appWindow.outerPosition();
      startWindowX = pos.x;
      startWindowY = pos.y;
      startScreenX = event.screenX;
      startScreenY = event.screenY;
      isDragging = true;
    }
  });

  window.addEventListener("pointermove", (event: PointerEvent) => {
    if (isDragging) {
      const deltaX = event.screenX - startScreenX;
      const deltaY = event.screenY - startScreenY;
      appWindow.setPosition(new PhysicalPosition(startWindowX + deltaX, startWindowY + deltaY));
    }
  });

  const stopDrag = (event: PointerEvent) => {
    if (event.button === 1 && isDragging) {
      isDragging = false;
      const target = event.target as HTMLElement | null;
      if (target && target.releasePointerCapture) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore
        }
      }
    }
  };

  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);

  // 5. Keyboard shortcuts: Enter (send), Escape (hide without wipe), Ctrl+N (new session)
  window.addEventListener("keydown", async (event: KeyboardEvent) => {
    // Ctrl + N: Start fresh session
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      await startNewSession();
      return;
    }

    // Enter: Send query and stream response
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const query = queryInput?.value.trim() || "";
      if (!query || isStreaming) {
        return;
      }

      await expandWindow();
      if (statusIndicator) {
        statusIndicator.textContent = "● Печатает...";
      }
      if (responseContent) {
        responseContent.textContent = "";
      }

      isStreaming = true;
      incrementDailyRequests();
      updateQuotaDisplay();

      let totalChars = 0;

      // Subscribe to real-time IPC channel chunks
      const onChunk = new Channel<string>();
      onChunk.onmessage = (chunk: string) => {
        if (responseContent) {
          responseContent.textContent += chunk;
          totalChars += chunk.length;
          // Approximate token count: ~3.8 chars per token for mixed code/Russian
          const tokens = Math.max(1, Math.round(totalChars / 3.8));
          if (tokenCountEl) {
            tokenCountEl.textContent = `⚡ ${tokens} токенов`;
          }
          // Auto-scroll to bottom as text arrives
          responseContent.scrollTop = responseContent.scrollHeight;
        }
      };

      try {
        await invoke("test_mock_stream", { onChunk });
        if (statusIndicator) {
          statusIndicator.textContent = "✓ Завершено";
        }
      } catch (err) {
        if (statusIndicator) {
          statusIndicator.textContent = "✕ Ошибка потока";
        }
        console.error("[AI Helper UI] Stream error:", err);
      } finally {
        isStreaming = false;
      }
    }

    // Escape: Hide window softly WITHOUT deleting current response!
    if (event.key === "Escape") {
      event.preventDefault();
      appWindow.hide().catch((err) => {
        console.error("[AI Helper] Failed to hide window:", err);
      });
    }
  });

  // 6. Action button handlers
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = responseContent?.textContent || "";
      if (text) {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Скопировано!";
        setTimeout(() => {
          copyBtn.textContent = "Скопировать";
        }, 1500);
      }
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", async () => {
      await startNewSession();
    });
  }
});
