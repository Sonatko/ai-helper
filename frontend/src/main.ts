import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  streamAIResponse,
  getActiveProvider,
  getProviderBadge,
  isVisionSupported,
  type HistoryMessage,
} from "./ai_client";
import {
  getProviderTelemetryStats,
  loadQuickCommands,
  type ProviderQuotaInfo,
  type QuickCommand,
} from "./settings";
import { renderMarkdown } from "./markdown";

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
  | { type: "Screenshot"; payload: { base64: string; width: number; height: number; is_crop?: boolean } }
  | { type: "Empty" };

/**
 * Multi-turn Chat Message.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  image?: string;
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

/**
 * Persistent SQLite Database records matching the Rust storage backend.
 */
export interface SessionRecord {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  model_used: string;
}

export interface MessageRecord {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tokens: number;
  created_at: number;
  image_data?: string;
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
  const badgePillText = document.getElementById("badge-pill-text") as HTMLElement | null;
  const badgePreviewPopup = document.getElementById("badge-preview-popup") as HTMLElement | null;
  const badgePreviewImg = document.getElementById("badge-preview-img") as HTMLImageElement | null;
  const threadPill = document.getElementById("thread-pill") as HTMLElement | null;
  const threadText = document.getElementById("thread-text") as HTMLElement | null;
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
  const commandsPopup = document.getElementById("commands-popup") as HTMLElement | null;

  let selectedCommandIndex = 0;
  let matchingCommands: QuickCommand[] = [];

  const hideCommandsPopup = () => {
    if (commandsPopup) commandsPopup.classList.add("hidden");
    matchingCommands = [];
    selectedCommandIndex = 0;
  };

  const renderCommandsPopup = () => {
    if (!commandsPopup) return;
    if (matchingCommands.length === 0) {
      hideCommandsPopup();
      return;
    }
    commandsPopup.innerHTML = "";
    matchingCommands.forEach((cmd, idx) => {
      const item = document.createElement("div");
      item.className = `command-pop-item ${idx === selectedCommandIndex ? "selected" : ""}`;
      item.innerHTML = `
        <span class="command-pop-trigger">${cmd.icon} ${cmd.trigger}</span>
        <span class="command-pop-name">${cmd.name}</span>
      `;
      item.addEventListener("click", () => {
        if (queryInput) {
          queryInput.value = `${cmd.trigger} `;
          queryInput.focus();
        }
        hideCommandsPopup();
      });
      commandsPopup.appendChild(item);
    });
    commandsPopup.classList.remove("hidden");
  };

  const appWindow = getCurrentWindow();
  let isExpanded = false;
  let isStreaming = false;

  let currentPassport: WindowPassport | null = null;
  let currentContent: CapturedContent | null = null;

  // Active Multi-turn Session state
  let currentSession: ChatSession = createNewSession();
  let selectedHistoryIndex = 0;
  let cachedSessions: SessionRecord[] = [];

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

  // Active Thread Indicator (Minimalist: hidden when new, visible only when continuing a dialogue)
  const updateSessionBadge = () => {
    if (!threadPill || !threadText) return;
    const isNew = currentSession.messages.length === 0;

    if (isNew) {
      threadPill.classList.add("hidden");
      if (queryInput) {
        queryInput.placeholder = "Спроси что угодно... (Enter для отправки)";
      }
    } else {
      const count = currentSession.messages.length;
      const shortTitle =
        currentSession.title.length > 12
          ? `${currentSession.title.slice(0, 12)}...`
          : currentSession.title;
      threadText.textContent = `💬 ${shortTitle} (${count})`;
      threadPill.title = `Ветка: «${currentSession.title}» (${count} сообщ.). Кликните для просмотра. Нажмите ✕ (Ctrl+N), чтобы начать новый диалог.`;
      threadPill.classList.remove("hidden");
      if (queryInput) {
        queryInput.placeholder = "Ответить в ветку... (Enter для отправки)";
      }
    }
  };

  if (threadPill) {
    threadPill.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      if (target.id === "thread-reset-btn" || target.classList.contains("thread-reset")) {
        e.stopPropagation();
        await startNewSession();
        return;
      }
      if (currentSession.messages.length > 0) {
        renderSessionMessages(currentSession);
        await showResponseMode();
      } else {
        queryInput?.focus();
      }
    });
  }

  updateSessionBadge();

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
    await fetchAndRenderHistory();
    if (historyPanel) historyPanel.classList.remove("hidden");
    if (!isExpanded) {
      await invoke("expand_window");
      isExpanded = true;
    }
  };

  const collapseAll = async () => {
    if (historyPanel) historyPanel.classList.add("hidden");
    if (responsePanel) responsePanel.classList.add("hidden");
    try {
      await invoke("collapse_window");
    } catch (err) {
      console.error("[AI Helper] Failed to collapse window:", err);
    }
    isExpanded = false;
  };

  // 3. Render Session messages in Response View
  const renderSessionMessages = (session: ChatSession) => {
    if (!responseContent) return;
    responseContent.innerHTML = "";

    session.messages.forEach((msg) => {
      const turnEl = document.createElement("div");
      turnEl.className = "chat-turn";

      if (msg.role === "user") {
        const imgHtml = msg.image
          ? `<div class="chat-attached-image-wrap"><img src="${msg.image}" class="chat-attached-image" alt="Captured snippet" /></div>`
          : "";
        turnEl.innerHTML = `
          <div class="chat-user-row">
            ${imgHtml}
            <div class="chat-user-bubble">${escapeHtml(msg.content)}</div>
          </div>
        `;
      } else {
        turnEl.innerHTML = `
          <div class="chat-assistant-bubble">${renderMarkdown(msg.content)}</div>
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
    updateSessionBadge();
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

    const setText = (txt: string, title: string) => {
      if (badgePillText) {
        badgePillText.textContent = txt;
      } else {
        badgePill.textContent = txt;
      }
      badgePill.title = title;
      badgePill.classList.remove("hidden");
    };

    const app = currentPassport?.app_name || currentPassport?.process_name || "Окно";

    if (currentContent && currentContent.type === "Text") {
      const len = currentContent.payload.length;
      setText(`📝 Текст (${len} симв.) • ${app}`, `Выделенный текст (${len} симв.) из ${app}`);
      if (badgePreviewPopup) badgePreviewPopup.classList.add("hidden");
    } else if (currentContent && currentContent.type === "Screenshot") {
      const isCrop = !!currentContent.payload.is_crop;
      const dims = `${currentContent.payload.width}×${currentContent.payload.height} px`;
      const prefix = isCrop ? "✂️ Область" : "📷 Окно";

      setText(
        `${prefix} (${dims}) • ${app}`,
        isCrop
          ? `Вырезанная область (${dims}) из окна ${app} (${currentPassport?.window_title || ""})`
          : `Снимок окна (${dims}): ${currentPassport?.window_title || ""}`
      );

      if (badgePreviewPopup && badgePreviewImg && currentContent.payload.base64) {
        badgePreviewImg.src = currentContent.payload.base64;
        badgePreviewPopup.classList.remove("hidden");
      }
    } else if (currentPassport) {
      setText(`🖥️ ${app}`, `Паспорт окна: ${currentPassport.window_title || app}`);
      if (badgePreviewPopup) badgePreviewPopup.classList.add("hidden");
    } else {
      badgePill.classList.add("hidden");
      if (badgePreviewPopup) badgePreviewPopup.classList.add("hidden");
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

  listen("app_summoned", async () => {
    updateQuotaDisplay();
    updateSessionBadge();
    queryInput?.focus();
    if (!isExpanded) {
      queryInput?.select();
    }
    setTimeout(() => {
      queryInput?.focus();
      if (!isExpanded) {
        queryInput?.select();
      }
    }, 25);
    try {
      currentPassport = await invoke<WindowPassport | null>("get_last_passport");
      currentContent = await invoke<CapturedContent | null>("get_last_content");
      updateContextBadge();
    } catch {}
  });

  collapseAll();
  focusInput();
  window.addEventListener("focus", () => {
    updateQuotaDisplay();
    updateSessionBadge();
    focusInput();
  });

  window.addEventListener("storage", () => updateQuotaDisplay());

  // 6. SQLite-backed History List rendering and navigation
  const renderHistoryUI = () => {
    if (!historyList) return;
    historyList.innerHTML = "";

    if (cachedSessions.length === 0) {
      historyList.innerHTML =
        '<div style="padding: 24px; color: #64748b; font-size: 13px; text-align: center;">История диалогов пуста</div>';
      return;
    }

    cachedSessions.forEach((sess, idx) => {
      const itemEl = document.createElement("div");
      itemEl.className = `history-item ${idx === selectedHistoryIndex ? "selected" : ""}`;
      itemEl.tabIndex = 0;

      const dateStr = new Date(sess.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const modelBadge = sess.model_used ? ` • ${sess.model_used}` : "";

      itemEl.innerHTML = `
        <div class="history-item-top">
          <div class="history-query">${escapeHtml(sess.title)}</div>
          <button class="history-delete-btn" title="Удалить диалог">✕</button>
        </div>
        <div class="history-meta">
          <span>${dateStr}${modelBadge}</span>
        </div>
      `;

      // Click to load session
      itemEl.onclick = async (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("history-delete-btn")) {
          e.stopPropagation();
          await deleteSessionByIndex(idx);
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

  const fetchAndRenderHistory = async () => {
    try {
      cachedSessions = await invoke<SessionRecord[]>("get_chat_sessions");
      renderHistoryUI();
    } catch (err) {
      console.error("[AI Helper] Failed to load chat sessions from SQLite:", err);
    }
  };

  const resumeSession = async (sessRecord: SessionRecord) => {
    try {
      const records = await invoke<MessageRecord[]>("get_chat_messages", {
        sessionId: sessRecord.id,
      });

      const loadedMessages: ChatMessage[] = records.map((r) => ({
        id: r.id,
        role: r.role as "user" | "assistant",
        content: r.content,
        timestamp: new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        image: r.image_data,
      }));

      currentSession = {
        id: sessRecord.id,
        title: sessRecord.title,
        createdAt: sessRecord.created_at,
        updatedAt: sessRecord.updated_at,
        messages: loadedMessages,
        passport: null,
      };

      renderSessionMessages(currentSession);
      updateSessionBadge();
      await showResponseMode();
      queryInput?.focus();
    } catch (err) {
      console.error("[AI Helper] Failed to load session messages from SQLite:", err);
    }
  };

  const deleteSessionByIndex = async (idx: number) => {
    if (idx >= 0 && idx < cachedSessions.length) {
      const target = cachedSessions[idx];
      try {
        await invoke("delete_chat_session", { sessionId: target.id });
        if (currentSession.id === target.id) {
          currentSession = createNewSession();
        }
        cachedSessions.splice(idx, 1);
        if (selectedHistoryIndex >= cachedSessions.length) {
          selectedHistoryIndex = Math.max(0, cachedSessions.length - 1);
        }
        renderHistoryUI();
      } catch (err) {
        console.error("[AI Helper] Failed to delete session from SQLite:", err);
      }
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
    clearHistoryBtn.addEventListener("click", async () => {
      try {
        await invoke("clear_chat_history");
        cachedSessions = [];
        currentSession = createNewSession();
        renderHistoryUI();
      } catch (err) {
        console.error("[AI Helper] Failed to clear history from SQLite:", err);
      }
    });
  }

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

  // 8. Robust Single-Enter Query Submission with Zero-Prompt support
  const submitCurrentQuery = async () => {
    let query = queryInput?.value.trim() || "";
    if (isStreaming) return;

    // Zero-Prompt: When Enter is pressed without typing text, synthesize a smart context query
    if (!query) {
      if (!currentContent) {
        try {
          currentContent = await invoke<CapturedContent | null>("get_last_content");
        } catch {}
      }

      if (currentContent && currentContent.type === "Text") {
        query = "Объясни выделенный фрагмент или исправь ошибку";
      } else if (currentContent && currentContent.type === "Screenshot") {
        const prov = getActiveProvider();
        if (isVisionSupported(prov)) {
          query = "Что изображено на экране? Кратко объясни суть или подскажи решение";
        } else {
          const app = currentPassport?.app_name || currentPassport?.process_name || "окна";
          query = `Кратко объясни контекст активного приложения ${app}`;
        }
      } else if (currentPassport) {
        query = `Кратко объясни контекст активного приложения ${currentPassport.app_name}`;
      } else {
        return;
      }
    }

    // Clear input bar for next turn
    if (queryInput) queryInput.value = "";

    // 1. Add User Message to active session
    const attachedImage = currentContent && currentContent.type === "Screenshot" ? currentContent.payload.base64 : undefined;
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      image: attachedImage,
    };

    if (currentSession.messages.length === 0) {
      currentSession.title = query.length > 42 ? `${query.slice(0, 42)}...` : query;
      currentSession.passport = currentPassport;
    }

    currentSession.messages.push(userMsg);
    renderSessionMessages(currentSession);
    updateSessionBadge();
    await showResponseMode();

    // Persist session header and user message to SQLite
    const activeProv = getActiveProvider();
    invoke("save_chat_session", {
      session: {
        id: currentSession.id,
        title: currentSession.title,
        created_at: currentSession.createdAt,
        updated_at: Date.now(),
        model_used: activeProv,
      },
    }).catch((err) => console.error("[AI Helper] SQLite user session save error:", err));

    invoke("add_chat_message", {
      message: {
        id: userMsg.id,
        session_id: currentSession.id,
        role: "user",
        content: userMsg.content,
        tokens: 0,
        created_at: Date.now(),
        image_data: userMsg.image,
      },
    }).catch((err) => console.error("[AI Helper] SQLite user message save error:", err));

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

    // Extract prior dialogue history (mapped to role: user | assistant with images)
    const priorHistory: HistoryMessage[] = currentSession.messages
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content, image: m.image }));

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
        assistantBubble.innerHTML = renderMarkdown(accumulatedAssistantText);
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
        assistantBubble.innerHTML = renderMarkdown(fullText);
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
        updateSessionBadge();

        // Upsert into persistent SQLite storage
        const usedModel = _modelUsed || getActiveProvider();
        invoke("save_chat_session", {
          session: {
            id: currentSession.id,
            title: currentSession.title,
            created_at: currentSession.createdAt,
            updated_at: currentSession.updatedAt,
            model_used: usedModel,
          },
        }).catch((err) => console.error("[AI Helper] SQLite session update error:", err));

        invoke("add_chat_message", {
          message: {
            id: assistantMsg.id,
            session_id: currentSession.id,
            role: "assistant",
            content: fullText,
            tokens: totalTokens,
            created_at: currentSession.updatedAt,
          },
        }).catch((err) => console.error("[AI Helper] SQLite message insert error:", err));

        // Always refocus the query input for smooth subsequent questions without double clicks
        setTimeout(() => queryInput?.focus(), 50);
      },
    });
  };

  // Direct Input Listener with IME composition protection and Quick Commands Autocomplete
  if (queryInput) {
    queryInput.addEventListener("input", () => {
      const val = queryInput.value;
      if (val.startsWith("/") && !val.includes(" ")) {
        const all = loadQuickCommands().filter((c) => c.enabled);
        matchingCommands = all.filter((c) => c.trigger.toLowerCase().startsWith(val.toLowerCase()));
        selectedCommandIndex = 0;
        renderCommandsPopup();
      } else {
        hideCommandsPopup();
      }
    });

    queryInput.addEventListener("keydown", async (event: KeyboardEvent) => {
      // If user is completing an IME composition (e.g. Russian input in WebView2), ignore Enter key during composition
      if (event.isComposing || event.keyCode === 229) {
        return;
      }

      // Autocomplete popup navigation
      if (!commandsPopup?.classList.contains("hidden") && matchingCommands.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          selectedCommandIndex = (selectedCommandIndex + 1) % matchingCommands.length;
          renderCommandsPopup();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          selectedCommandIndex = (selectedCommandIndex - 1 + matchingCommands.length) % matchingCommands.length;
          renderCommandsPopup();
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const selected = matchingCommands[selectedCommandIndex];
          if (selected) {
            queryInput.value = `${selected.trigger} `;
            hideCommandsPopup();
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          hideCommandsPopup();
          return;
        }
      }

      if (event.key === "Enter" && !event.shiftKey) {
        // If popup is open and user pressed enter directly on a partial command, fill it first or submit
        if (!commandsPopup?.classList.contains("hidden") && matchingCommands.length > 0) {
          const selected = matchingCommands[selectedCommandIndex];
          if (selected && queryInput.value.trim() === selected.trigger) {
            hideCommandsPopup();
          }
        }
        event.preventDefault();
        event.stopPropagation();
        hideCommandsPopup();
        await submitCurrentQuery();
      }
    });
  }

  // 9. Keybindings & Streaming execution
  window.addEventListener("keydown", async (event: KeyboardEvent) => {
    // History Keyboard Navigation (Up / Down / Enter / Delete)
    if (historyPanel && !historyPanel.classList.contains("hidden")) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (selectedHistoryIndex < cachedSessions.length - 1) {
          selectedHistoryIndex++;
          renderHistoryUI();
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (selectedHistoryIndex > 0) {
          selectedHistoryIndex--;
          renderHistoryUI();
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (cachedSessions[selectedHistoryIndex]) {
          await resumeSession(cachedSessions[selectedHistoryIndex]);
        }
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        await deleteSessionByIndex(selectedHistoryIndex);
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
      if (cachedSessions.length === 0) {
        try {
          cachedSessions = await invoke<SessionRecord[]>("get_chat_sessions");
        } catch {}
      }
      if (cachedSessions.length > 0) {
        const curIdx = cachedSessions.findIndex((s) => s.id === currentSession.id);
        let nextIdx = curIdx;
        if (event.key === "]") {
          nextIdx = curIdx + 1 >= cachedSessions.length ? 0 : curIdx + 1;
        } else {
          nextIdx = curIdx - 1 < 0 ? cachedSessions.length - 1 : curIdx - 1;
        }
        await resumeSession(cachedSessions[nextIdx]);
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

      // 1. If any panel is open or window is expanded -> 1st Escape collapses to 60px capsule
      const isPanelVisible =
        (historyPanel && !historyPanel.classList.contains("hidden")) ||
        (responsePanel && !responsePanel.classList.contains("hidden"));

      if (isExpanded || isPanelVisible) {
        await collapseAll();
        queryInput?.focus();
        return;
      }

      // 2. If already collapsed to capsule -> 2nd Escape hides the window
      await collapseAll();
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

  // 10. Code block copy button event delegation
  if (responseContent) {
    responseContent.addEventListener("click", async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const copyBtnEl = target?.closest(".code-copy-btn") as HTMLButtonElement | null;
      if (!copyBtnEl) return;

      const container = copyBtnEl.closest(".code-block-container");
      const codeEl = container?.querySelector("code");
      if (!codeEl) return;

      const rawCode = codeEl.textContent || "";
      try {
        await navigator.clipboard.writeText(rawCode);
        const originalText = copyBtnEl.textContent;
        copyBtnEl.textContent = "✓ Скопировано!";
        copyBtnEl.classList.add("copied");
        setTimeout(() => {
          copyBtnEl.textContent = originalText;
          copyBtnEl.classList.remove("copied");
        }, 1800);
      } catch (err) {
        console.error("[AI Helper] Failed to copy code to clipboard:", err);
      }
    });
  }
});
