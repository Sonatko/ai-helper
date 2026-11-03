import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  streamAIResponse,
  getActiveProvider,
  getProviderBadge,
  type HistoryMessage,
} from "./ai_client";
import { getProviderTelemetryStats, type ProviderQuotaInfo } from "./settings";

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
  is_wsl?: boolean;
  is_ssh?: boolean;
}

/**
 * Captured user context content (text or in-memory screenshot).
 */
export type CapturedContent =
  | { type: "Text"; payload: string }
  | { type: "Screenshot"; payload: { base64: string; width: number; height: number } }
  | { type: "Empty" };

/**
 * Multi-turn Chat Message.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/**
 * Persistent Conversation Thread Session.
 */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  passport?: WindowPassport | null;
}

const STORAGE_KEY_SESSIONS = "ai_helper_sessions_v1";

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]): void {
  try {
    // Keep up to 35 most recent sessions
    const trimmed = sessions.slice(0, 35);
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(trimmed));
  } catch (err) {
    console.warn("Failed to persist sessions:", err);
  }
}

function createNewSession(): ChatSession {
  const now = Date.now();
  return {
    id: `sess_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: "Новый диалог",
    createdAt: now,
    updatedAt: now,
    messages: [],
    passport: null,
  };
}

window.addEventListener("DOMContentLoaded", () => {
  const queryInput = document.getElementById("query-input") as HTMLInputElement | null;
  const badgePill = document.getElementById("badge-pill") as HTMLElement | null;
  const capsuleNewBtn = document.getElementById("capsule-new-btn") as HTMLButtonElement | null;
  const capsuleHistoryBtn = document.getElementById("capsule-history-btn") as HTMLButtonElement | null;
  const historyPanel = document.getElementById("history-panel") as HTMLElement | null;
  const historyList = document.getElementById("history-list") as HTMLElement | null;
  const clearHistoryBtn = document.getElementById("clear-history-btn") as HTMLButtonElement | null;

  const responsePanel = document.getElementById("response-panel") as HTMLElement | null;
  const responseContent = document.getElementById("response-content") as HTMLElement | null;
  const statusIndicator = document.getElementById("status-indicator") as HTMLElement | null;
  const tokenCountEl = document.getElementById("token-count") as HTMLElement | null;
  const quotaTextEl = document.getElementById("quota-text") as HTMLElement | null;
  const quotaProgressBar = document.getElementById("quota-progress-bar") as HTMLElement | null;
  const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement | null;

  const appWindow = getCurrentWindow();
  let isExpanded = false;
  let isStreaming = false;

  let currentPassport: WindowPassport | null = null;
  let currentContent: CapturedContent | null = null;

  // Active Multi-turn Session state
  let currentSession: ChatSession = createNewSession();
  let selectedHistoryIndex = 0;

  // 1. Dynamic Quota & Live Telemetry Meter display
  const updateQuotaDisplay = (liveQuota?: ProviderQuotaInfo) => {
    const provider = getActiveProvider();
    const badgeText = liveQuota?.displayName || getProviderBadge();
    const stats = getProviderTelemetryStats(provider);

    if (liveQuota?.remainingRequestsHeader) {
      // Live hardware counter from Groq
      if (quotaTextEl) {
        quotaTextEl.textContent = `${badgeText} • За час: ${stats.requestsHour} зап. • Осталось сегодня: ${liveQuota.remainingRequestsHeader} RPD`;
      }
      if (quotaProgressBar) {
        quotaProgressBar.style.width = "100%";
        quotaProgressBar.style.background = "linear-gradient(90deg, #10b981, #38bdf8)";
      }
    } else if (provider === "gemini_key" || badgeText.includes("Gemini")) {
      if (quotaTextEl) {
        quotaTextEl.textContent = `${badgeText} • За час: ${stats.requestsHour} зап. (${stats.tokensHour} tok) • Сегодня: ${stats.requestsToday} зап. (${stats.tokensToday} tok)`;
      }
      if (quotaProgressBar) {
        quotaProgressBar.style.width = "100%";
        quotaProgressBar.style.background = "linear-gradient(90deg, #38bdf8, #818cf8)";
      }
    } else if (provider === "custom_local" || badgeText.includes("Local")) {
      if (quotaTextEl) {
        quotaTextEl.textContent = `${badgeText} • За час: ${stats.requestsHour} зап. (${stats.tokensHour} tok) • Сегодня: ${stats.requestsToday}`;
      }
      if (quotaProgressBar) {
        quotaProgressBar.style.width = "100%";
        quotaProgressBar.style.background = "linear-gradient(90deg, #34d399, #10b981)";
      }
    } else if (provider === "openrouter_key" || badgeText.includes("OpenRouter")) {
      if (quotaTextEl) {
        quotaTextEl.textContent = `${badgeText} • За час: ${stats.requestsHour} зап. (${stats.tokensHour} tok) • Сегодня: ${stats.requestsToday}`;
      }
      if (quotaProgressBar) {
        quotaProgressBar.style.width = "100%";
        quotaProgressBar.style.background = "linear-gradient(90deg, #a78bfa, #38bdf8)";
      }
    } else {
      if (quotaTextEl) {
        quotaTextEl.textContent = `${badgeText} • За час: ${stats.requestsHour} зап. (${stats.tokensHour} tok)`;
      }
      if (quotaProgressBar) {
        quotaProgressBar.style.width = "100%";
        quotaProgressBar.style.background = "#10b981";
      }
    }
  };

  updateQuotaDisplay();

  // 2. Window expansion / view modes (Strictly mutually exclusive)
  const showResponseMode = async () => {
    if (historyPanel) historyPanel.classList.add("hidden");
    if (responsePanel) responsePanel.classList.remove("hidden");
    if (!isExpanded) {
      await invoke("expand_window");
      isExpanded = true;
    }
  };

  const showHistoryMode = async () => {
    if (responsePanel) responsePanel.classList.add("hidden");
    selectedHistoryIndex = 0;
    renderHistory();
    if (historyPanel) historyPanel.classList.remove("hidden");
    if (!isExpanded) {
      await invoke("expand_window");
      isExpanded = true;
    }
  };

  const collapseAll = async () => {
    if (historyPanel) historyPanel.classList.add("hidden");
    if (responsePanel) responsePanel.classList.add("hidden");
    if (isExpanded) {
      await invoke("collapse_window");
      isExpanded = false;
    }
  };

  // 3. Render Session messages in Response View
  const renderSessionMessages = (session: ChatSession) => {
    if (!responseContent) return;
    responseContent.innerHTML = "";

    session.messages.forEach((msg) => {
      const turnEl = document.createElement("div");
      turnEl.className = "chat-turn";

      if (msg.role === "user") {
        turnEl.innerHTML = `
          <div class="chat-user-row">
            <div class="chat-user-bubble">${escapeHtml(msg.content)}</div>
          </div>
        `;
      } else {
        turnEl.innerHTML = `
          <div class="chat-assistant-bubble">${escapeHtml(msg.content)}</div>
        `;
      }
      responseContent.appendChild(turnEl);
    });

    responseContent.scrollTop = responseContent.scrollHeight;
  };

  function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // 4. Start fresh session (Ctrl+N or + Новый button)
  const startNewSession = async () => {
    if (isStreaming) return;
    currentSession = createNewSession();
    await collapseAll();
    if (queryInput) {
      queryInput.value = "";
      queryInput.focus();
    }
    if (responseContent) {
      responseContent.innerHTML = "";
    }
    if (statusIndicator) {
      statusIndicator.textContent = "";
    }
    if (tokenCountEl) {
      tokenCountEl.textContent = "⚡ 0 токенов";
    }
    focusInput();
  };

  // 5. Fetch Passport & Content context
  const focusInput = async () => {
    if (queryInput) {
      queryInput.focus();
      if (!isExpanded) {
        queryInput.select();
      }
    }

    try {
      currentPassport = await invoke<WindowPassport | null>("get_last_passport");
      currentContent = await invoke<CapturedContent | null>("get_last_content");
      updateContextBadge();
    } catch (err) {
      console.error("[AI Helper UI] Failed to retrieve context:", err);
    }
  };

  const updateContextBadge = () => {
    if (!badgePill) return;
    if (currentContent && currentContent.type === "Text") {
      badgePill.textContent = "📝 Выделено";
      badgePill.title = `Выделенный текст: ${currentContent.payload.slice(0, 60)}...`;
      badgePill.classList.remove("hidden");
    } else if (currentContent && currentContent.type === "Screenshot") {
      const app = currentPassport?.app_name || "Окно";
      badgePill.textContent = `📷 ${app}`;
      badgePill.title = `Снимок окна: ${currentPassport?.window_title || ""}`;
      badgePill.classList.remove("hidden");
    } else {
      badgePill.classList.add("hidden");
    }
  };

  // Asynchronous background completion notification from Rust (0% UI freeze)
  listen("context_content_ready", async () => {
    try {
      currentPassport = await invoke<WindowPassport | null>("get_last_passport");
      currentContent = await invoke<CapturedContent | null>("get_last_content");
      updateContextBadge();
    } catch {}
  });

  focusInput();
  window.addEventListener("focus", () => {
    updateQuotaDisplay();
    focusInput();
  });
  window.addEventListener("storage", () => updateQuotaDisplay());

  // 6. History List rendering and navigation
  const renderHistory = () => {
    const sessions = loadSessions();

    if (!historyList) return;
    historyList.innerHTML = "";

    if (sessions.length === 0) {
      historyList.innerHTML =
        '<div style="padding: 24px; color: #64748b; font-size: 13px; text-align: center;">История диалогов пуста</div>';
      return;
    }

    sessions.forEach((sess, idx) => {
      const itemEl = document.createElement("div");
      itemEl.className = `history-item ${idx === selectedHistoryIndex ? "selected" : ""}`;
      itemEl.tabIndex = 0;

      const lastMsg = sess.messages[sess.messages.length - 1]?.content || "Пустой диалог";
      const dateStr = new Date(sess.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      itemEl.innerHTML = `
        <div class="history-item-top">
          <div class="history-query">${escapeHtml(sess.title)}</div>
          <button class="history-delete-btn" title="Удалить диалог">✕</button>
        </div>
        <div class="history-meta">
          <span>${escapeHtml(lastMsg.slice(0, 48))}...</span>
          <span>${sess.messages.length} сообщ. • ${dateStr}</span>
        </div>
      `;

      // Click to load session
      itemEl.onclick = async (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("history-delete-btn")) {
          e.stopPropagation();
          deleteSessionByIndex(idx);
          return;
        }
        await resumeSession(sess);
      };

      historyList.appendChild(itemEl);
    });

    // Ensure selected item is scrolled into view
    const selectedEl = historyList.children[selectedHistoryIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  };

  const resumeSession = async (sess: ChatSession) => {
    currentSession = sess;
    renderSessionMessages(currentSession);
    await showResponseMode();
    queryInput?.focus();
  };

  const deleteSessionByIndex = (idx: number) => {
    const sessions = loadSessions();
    if (idx >= 0 && idx < sessions.length) {
      const deletedId = sessions[idx].id;
      sessions.splice(idx, 1);
      saveSessions(sessions);
      if (currentSession.id === deletedId) {
        currentSession = createNewSession();
      }
      if (selectedHistoryIndex >= sessions.length) {
        selectedHistoryIndex = Math.max(0, sessions.length - 1);
      }
      renderHistory();
    }
  };

  const toggleHistory = async () => {
    if (!historyPanel) return;
    const isHidden = historyPanel.classList.contains("hidden");
    if (isHidden) {
      await showHistoryMode();
    } else {
      await collapseAll();
      queryInput?.focus();
    }
  };

  if (capsuleHistoryBtn) capsuleHistoryBtn.addEventListener("click", toggleHistory);
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", () => {
      saveSessions([]);
      currentSession = createNewSession();
      renderHistory();
    });
  }
  if (capsuleNewBtn) capsuleNewBtn.addEventListener("click", startNewSession);

  // 7. Middle-click window dragging
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
        } catch {}
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
        } catch {}
      }
    }
  };

  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);

  // 8. Robust Single-Enter Query Submission
  const submitCurrentQuery = async () => {
    const query = queryInput?.value.trim() || "";
    if (!query || isStreaming) return;

    // Clear input bar for next turn
    if (queryInput) queryInput.value = "";

    // 1. Add User Message to active session
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    if (currentSession.messages.length === 0) {
      currentSession.title = query.length > 42 ? `${query.slice(0, 42)}...` : query;
      currentSession.passport = currentPassport;
    }

    currentSession.messages.push(userMsg);
    renderSessionMessages(currentSession);
    await showResponseMode();

    // 2. Prepare Live Streaming Bubble for Assistant
    if (statusIndicator) {
      statusIndicator.textContent = "● Подключение...";
    }
    if (tokenCountEl) {
      tokenCountEl.textContent = "⚡ Подсчёт...";
    }

    const assistantTurnEl = document.createElement("div");
    assistantTurnEl.className = "chat-turn";
    const assistantBubble = document.createElement("div");
    assistantBubble.className = "chat-assistant-bubble";
    assistantTurnEl.appendChild(assistantBubble);
    responseContent?.appendChild(assistantTurnEl);

    isStreaming = true;

    // Extract prior dialogue history (mapped to role: user | assistant)
    const priorHistory: HistoryMessage[] = currentSession.messages
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    // Attach context content (screenshot, crop region, or highlighted text) if freshly captured
    if (!currentContent) {
      try {
        currentContent = await invoke<CapturedContent | null>("get_last_content");
      } catch {}
    }

    let contentPayload: { mode: "text" | "screenshot" | "empty"; text?: string; jpegBase64?: string } = {
      mode: "empty",
    };

    if (currentContent && currentContent.type === "Text") {
      contentPayload = { mode: "text", text: currentContent.payload };
      currentContent = null;
      if (badgePill) badgePill.classList.add("hidden");
    } else if (currentContent && currentContent.type === "Screenshot") {
      contentPayload = { mode: "screenshot", jpegBase64: currentContent.payload.base64 };
      currentContent = null;
      if (badgePill) badgePill.classList.add("hidden");
    }

    let accumulatedAssistantText = "";

    await streamAIResponse(query, currentPassport, contentPayload, priorHistory, {
      onChunk: (chunk: string) => {
        accumulatedAssistantText += chunk;
        assistantBubble.textContent = accumulatedAssistantText;
        if (responseContent) {
          responseContent.scrollTop = responseContent.scrollHeight;
        }
        if (statusIndicator) {
          statusIndicator.textContent = "● Печатает...";
        }
      },
      onTokensUpdate: (promptTokens: number, candidateTokens: number, totalTokens: number) => {
        if (tokenCountEl) {
          if (promptTokens > 0) {
            tokenCountEl.textContent = `⚡ ${totalTokens} токенов (${promptTokens} вход • ${candidateTokens} ответ)`;
            tokenCountEl.title =
              `📥 Вход: ${promptTokens} токенов (вопрос + системная инструкция + контекст окна)\n` +
              `📤 Ответ: ${candidateTokens} токенов (сгенерированный текст нейросети)\n` +
              `Всего обработано: ${totalTokens} токенов`;
          } else {
            tokenCountEl.textContent = `⚡ ${totalTokens} токенов`;
            tokenCountEl.title = `Всего обработано токенов в этом запросе: ${totalTokens}`;
          }
        }
      },
      onError: (errMsg: string) => {
        if (statusIndicator) {
          statusIndicator.textContent = "✕ Ошибка";
        }
        assistantBubble.textContent = `⚠️ ${errMsg}`;
        isStreaming = false;
        setTimeout(() => queryInput?.focus(), 50);
      },
      onFinish: (fullText: string, totalTokens: number, _modelUsed?: string, quotaInfo?: ProviderQuotaInfo) => {
        if (statusIndicator) {
          statusIndicator.textContent = "✓ Завершено";
        }
        if (tokenCountEl && totalTokens > 0) {
          const pTok = quotaInfo?.promptTokensLastRequest || 0;
          const cTok = quotaInfo?.candidateTokensLastRequest || 0;
          if (pTok > 0 && cTok > 0) {
            tokenCountEl.textContent = `⚡ ${totalTokens} токенов (${pTok} вход • ${cTok} ответ)`;
            tokenCountEl.title =
              `📥 Вход: ${pTok} токенов (вопрос + системная инструкция + контекст окна)\n` +
              `📤 Ответ: ${cTok} токенов (сгенерированный текст нейросети)\n` +
              `Всего обработано: ${totalTokens} токенов`;
          } else {
            tokenCountEl.textContent = `⚡ ${totalTokens} токенов`;
            tokenCountEl.title = `Всего обработано токенов в этом запросе: ${totalTokens}`;
          }
        }
        updateQuotaDisplay(quotaInfo);
        isStreaming = false;

        // Save assistant message to current session
        const assistantMsg: ChatMessage = {
          id: `msg_${Date.now()}_a`,
          role: "assistant",
          content: fullText,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        currentSession.messages.push(assistantMsg);
        currentSession.updatedAt = Date.now();

        // Upsert into persistent sessions
        const sessions = loadSessions();
        const existingIdx = sessions.findIndex((s) => s.id === currentSession.id);
        if (existingIdx >= 0) {
          sessions[existingIdx] = currentSession;
        } else {
          sessions.unshift(currentSession);
        }
        saveSessions(sessions);

        // Always refocus the query input for smooth subsequent questions without double clicks
        setTimeout(() => queryInput?.focus(), 50);
      },
    });
  };

  // Direct Input Listener with IME composition protection to eliminate the double-enter glitch
  if (queryInput) {
    queryInput.addEventListener("keydown", async (event: KeyboardEvent) => {
      // If user is completing an IME composition (e.g. Russian input in WebView2), ignore Enter key during composition
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        await submitCurrentQuery();
      }
    });
  }

  // 9. Keybindings & Streaming execution
  window.addEventListener("keydown", async (event: KeyboardEvent) => {
    // History Keyboard Navigation (Up / Down / Enter / Delete)
    if (historyPanel && !historyPanel.classList.contains("hidden")) {
      const sessions = loadSessions();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (selectedHistoryIndex < sessions.length - 1) {
          selectedHistoryIndex++;
          renderHistory();
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (selectedHistoryIndex > 0) {
          selectedHistoryIndex--;
          renderHistory();
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (sessions[selectedHistoryIndex]) {
          await resumeSession(sessions[selectedHistoryIndex]);
        }
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSessionByIndex(selectedHistoryIndex);
        return;
      }
    }

    // Ctrl+N: Start new session
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      await startNewSession();
      return;
    }

    // Ctrl+H: Toggle History
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
      event.preventDefault();
      await toggleHistory();
      return;
    }

    // Ctrl+[ and Ctrl+]: Quick cycle through sessions
    if ((event.ctrlKey || event.metaKey) && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      const sessions = loadSessions();
      if (sessions.length > 0) {
        const curIdx = sessions.findIndex((s) => s.id === currentSession.id);
        let nextIdx = curIdx;
        if (event.key === "]") {
          nextIdx = curIdx + 1 >= sessions.length ? 0 : curIdx + 1;
        } else {
          nextIdx = curIdx - 1 < 0 ? sessions.length - 1 : curIdx - 1;
        }
        await resumeSession(sessions[nextIdx]);
      }
      return;
    }

    // Submit Query (Enter) from window if not focused on input
    if (event.key === "Enter" && !event.shiftKey && document.activeElement !== queryInput) {
      event.preventDefault();
      await submitCurrentQuery();
    }

    // Two-stage Escape
    if (event.key === "Escape") {
      event.preventDefault();

      // 1. If history panel is open -> collapse back to 60px input capsule
      if (historyPanel && !historyPanel.classList.contains("hidden")) {
        await collapseAll();
        queryInput?.focus();
        return;
      }

      // 2. If response panel is open -> 1st Escape collapses it back to compact capsule
      if (responsePanel && !responsePanel.classList.contains("hidden")) {
        await collapseAll();
        queryInput?.focus();
        return;
      }

      // 3. If already collapsed to capsule -> 2nd Escape hides the window
      appWindow.hide().catch((err) => {
        console.error("[AI Helper] Failed to hide window:", err);
      });
    }
  });

  // 9. Copy response button
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      // Copy last assistant response or entire thread text
      const lastAssistantMsg = [...currentSession.messages].reverse().find((m) => m.role === "assistant");
      const textToCopy = lastAssistantMsg?.content || responseContent?.textContent || "";
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
        copyBtn.textContent = "Скопировано!";
        setTimeout(() => {
          copyBtn.textContent = "Скопировать";
        }, 1500);
      }
    });
  }
});
