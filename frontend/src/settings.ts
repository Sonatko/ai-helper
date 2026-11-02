import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SYSTEM_PROMPT =
  "Ты сверхбыстрый и лаконичный технический ассистент разработчика для Windows 11. " +
  "Отвечай кратко, без лишних вводных слов, сразу суть решения. " +
  "Если передан скриншот окна или выделенный код с ошибкой — дай точечное исправление и понятную причину сбоя.";

export interface DailyUsage {
  date: string;
  requestsCount: number;
  tokensCount: number;
}

export function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function getDailyUsage(): DailyUsage {
  const today = getTodayDateString();
  const raw = localStorage.getItem("ai_helper_daily_usage");
  if (!raw) {
    return { date: today, requestsCount: 0, tokensCount: 0 };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.date === today) {
      return parsed;
    }
  } catch {}
  return { date: today, requestsCount: 0, tokensCount: 0 };
}

export function recordUsage(tokens: number): DailyUsage {
  const usage = getDailyUsage();
  usage.requestsCount += 1;
  usage.tokensCount += tokens;
  localStorage.setItem("ai_helper_daily_usage", JSON.stringify(usage));
  return usage;
}

export type ProviderType = "auto" | "public_pool" | "gemini_key" | "groq_key" | "openrouter_key" | "custom_local";

document.addEventListener("DOMContentLoaded", () => {
  // Radio options & labels
  const optAuto = document.getElementById("opt-auto") as HTMLInputElement;
  const optPublic = document.getElementById("opt-public") as HTMLInputElement;
  const optGemini = document.getElementById("opt-gemini") as HTMLInputElement;
  const optGroq = document.getElementById("opt-groq") as HTMLInputElement;
  const optOpenRouter = document.getElementById("opt-openrouter") as HTMLInputElement;
  const optLocal = document.getElementById("opt-local") as HTMLInputElement;

  const optAutoLabel = document.getElementById("opt-auto-label") as HTMLElement;
  const optPublicLabel = document.getElementById("opt-public-label") as HTMLElement;
  const optGeminiLabel = document.getElementById("opt-gemini-label") as HTMLElement;
  const optGroqLabel = document.getElementById("opt-groq-label") as HTMLElement;
  const optOpenRouterLabel = document.getElementById("opt-openrouter-label") as HTMLElement;
  const optLocalLabel = document.getElementById("opt-local-label") as HTMLElement;

  // Config blocks
  const cfgGemini = document.getElementById("cfg-gemini") as HTMLElement;
  const cfgGroq = document.getElementById("cfg-groq") as HTMLElement;
  const cfgOpenRouter = document.getElementById("cfg-openrouter") as HTMLElement;
  const cfgLocal = document.getElementById("cfg-local") as HTMLElement;

  // Google Gemini inputs
  const geminiKeyInput = document.getElementById("gemini-key-input") as HTMLInputElement;
  const geminiEyeBtn = document.getElementById("gemini-eye-btn") as HTMLButtonElement;
  const geminiSaveBtn = document.getElementById("gemini-save-btn") as HTMLButtonElement;
  const geminiFetchModelsBtn = document.getElementById("gemini-fetch-models-btn") as HTMLButtonElement;
  const geminiStatusMsg = document.getElementById("gemini-status-msg") as HTMLElement;
  const geminiModelsContainer = document.getElementById("gemini-models-container") as HTMLElement;
  const geminiModelSelect = document.getElementById("gemini-model-select") as HTMLSelectElement;

  // Groq inputs
  const groqKeyInput = document.getElementById("groq-key-input") as HTMLInputElement;
  const groqEyeBtn = document.getElementById("groq-eye-btn") as HTMLButtonElement;
  const groqSaveBtn = document.getElementById("groq-save-btn") as HTMLButtonElement;
  const groqFetchModelsBtn = document.getElementById("groq-fetch-models-btn") as HTMLButtonElement;
  const groqStatusMsg = document.getElementById("groq-status-msg") as HTMLElement;
  const groqModelsContainer = document.getElementById("groq-models-container") as HTMLElement;
  const groqModelSelect = document.getElementById("groq-model-select") as HTMLSelectElement;

  // OpenRouter inputs
  const openrouterKeyInput = document.getElementById("openrouter-key-input") as HTMLInputElement;
  const openrouterEyeBtn = document.getElementById("openrouter-eye-btn") as HTMLButtonElement;
  const openrouterSaveBtn = document.getElementById("openrouter-save-btn") as HTMLButtonElement;
  const fetchFreeModelsBtn = document.getElementById("fetch-free-models-btn") as HTMLButtonElement;
  const openrouterStatusMsg = document.getElementById("openrouter-status-msg") as HTMLElement;
  const freeModelsContainer = document.getElementById("free-models-container") as HTMLElement;
  const openrouterModelSelect = document.getElementById("openrouter-model-select") as HTMLSelectElement;

  // Local / Custom inputs
  const localUrlInput = document.getElementById("local-url-input") as HTMLInputElement;
  const localSaveBtn = document.getElementById("local-save-btn") as HTMLButtonElement;
  const localFetchModelsBtn = document.getElementById("local-fetch-models-btn") as HTMLButtonElement;
  const localStatusMsg = document.getElementById("local-status-msg") as HTMLElement;
  const localModelsContainer = document.getElementById("local-models-container") as HTMLElement;
  const localModelSelect = document.getElementById("local-model-select") as HTMLSelectElement;

  // System Prompt inputs
  const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
  const resetPromptBtn = document.getElementById("reset-prompt-btn") as HTMLButtonElement;
  const closeSettingsBtn = document.getElementById("close-settings-btn") as HTMLButtonElement;

  // 1. Initial State
  const defaultProvider: ProviderType = import.meta.env.VITE_GEMINI_API_KEY ? "auto" : "public_pool";
  const currentProvider = (localStorage.getItem("ai_helper_provider") as ProviderType) || defaultProvider;

  geminiKeyInput.value =
    localStorage.getItem("ai_helper_gemini_api_key") ||
    (import.meta.env.VITE_GEMINI_API_KEY as string) ||
    "";
  groqKeyInput.value = localStorage.getItem("ai_helper_groq_api_key") || "";
  openrouterKeyInput.value =
    localStorage.getItem("ai_helper_openrouter_api_key") ||
    (import.meta.env.VITE_OPENROUTER_API_KEY as string) ||
    "";
  localUrlInput.value = localStorage.getItem("ai_helper_local_url") || "http://localhost:11434/v1";

  const switchProvider = (provider: ProviderType) => {
    localStorage.setItem("ai_helper_provider", provider);

    optAutoLabel.classList.toggle("active", provider === "auto");
    optPublicLabel.classList.toggle("active", provider === "public_pool");
    optGeminiLabel.classList.toggle("active", provider === "gemini_key");
    optGroqLabel.classList.toggle("active", provider === "groq_key");
    optOpenRouterLabel.classList.toggle("active", provider === "openrouter_key");
    optLocalLabel.classList.toggle("active", provider === "custom_local");

    optAuto.checked = provider === "auto";
    optPublic.checked = provider === "public_pool";
    optGemini.checked = provider === "gemini_key";
    optGroq.checked = provider === "groq_key";
    optOpenRouter.checked = provider === "openrouter_key";
    optLocal.checked = provider === "custom_local";

    if (provider === "auto") {
      cfgGemini.style.display = "block";
      cfgGroq.style.display = "block";
      cfgOpenRouter.style.display = "block";
      cfgLocal.style.display = "block";
    } else {
      cfgGemini.style.display = provider === "gemini_key" ? "block" : "none";
      cfgGroq.style.display = provider === "groq_key" ? "block" : "none";
      cfgOpenRouter.style.display = provider === "openrouter_key" ? "block" : "none";
      cfgLocal.style.display = provider === "custom_local" ? "block" : "none";
    }
  };

  switchProvider(currentProvider);

  optAuto.addEventListener("change", () => switchProvider("auto"));
  optPublic.addEventListener("change", () => switchProvider("public_pool"));
  optGemini.addEventListener("change", () => switchProvider("gemini_key"));
  optGroq.addEventListener("change", () => switchProvider("groq_key"));
  optOpenRouter.addEventListener("change", () => switchProvider("openrouter_key"));
  optLocal.addEventListener("change", () => switchProvider("custom_local"));

  // 2. Eye Toggles
  const setupEyeToggle = (btn: HTMLButtonElement, input: HTMLInputElement) => {
    btn.addEventListener("click", () => {
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "🔒";
      } else {
        input.type = "password";
        btn.textContent = "👁️";
      }
    });
  };
  setupEyeToggle(geminiEyeBtn, geminiKeyInput);
  setupEyeToggle(groqEyeBtn, groqKeyInput);
  setupEyeToggle(openrouterEyeBtn, openrouterKeyInput);

  const flashSaved = (btn: HTMLButtonElement) => {
    btn.textContent = "✓ Сохранено";
    setTimeout(() => (btn.textContent = "Сохранить"), 1500);
  };

  geminiSaveBtn.addEventListener("click", () => {
    localStorage.setItem("ai_helper_gemini_api_key", geminiKeyInput.value.trim());
    flashSaved(geminiSaveBtn);
  });

  groqSaveBtn.addEventListener("click", () => {
    localStorage.setItem("ai_helper_groq_api_key", groqKeyInput.value.trim());
    flashSaved(groqSaveBtn);
  });

  openrouterSaveBtn.addEventListener("click", () => {
    localStorage.setItem("ai_helper_openrouter_api_key", openrouterKeyInput.value.trim());
    flashSaved(openrouterSaveBtn);
  });

  localSaveBtn.addEventListener("click", () => {
    localStorage.setItem("ai_helper_local_url", localUrlInput.value.trim());
    flashSaved(localSaveBtn);
  });

  // 3. Dynamic Live Discovery: Google Gemini API (v1beta/models)
  const fetchGeminiModels = async () => {
    const key = geminiKeyInput.value.trim();
    if (!key) {
      geminiStatusMsg.textContent = "⚠️ Сначала введите и сохраните API-ключ Google AI Studio.";
      return;
    }

    geminiFetchModelsBtn.disabled = true;
    geminiStatusMsg.textContent = "📡 Опрос Google API (GET /v1beta/models)...";

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${await resp.text()}`);
      }

      const data = await resp.json();
      const rawModels: any[] = data.models || [];

      // Filter generation-capable models
      const validModels = rawModels.filter((m) =>
        m.supportedGenerationMethods?.includes("generateContent")
      );

      geminiModelSelect.innerHTML = "";
      if (validModels.length === 0) {
        geminiStatusMsg.textContent = "✕ Модели генерации текста не обнаружены в ответе API.";
        return;
      }

      const savedModel = localStorage.getItem("ai_helper_gemini_model") || "";

      validModels.forEach((m) => {
        const opt = document.createElement("option");
        // format name from "models/gemini-2.0-flash" -> "gemini-2.0-flash"
        const cleanName = m.name.replace(/^models\//, "");
        opt.value = cleanName;
        const inK = m.inputTokenLimit ? `${Math.round(m.inputTokenLimit / 1024)}k` : "1M";
        const outK = m.outputTokenLimit ? `${Math.round(m.outputTokenLimit / 1024)}k` : "8k";
        opt.textContent = `${m.displayName || cleanName} [Контекст: ${inK} вход / ${outK} выход]`;

        if (cleanName === savedModel) opt.selected = true;
        geminiModelSelect.appendChild(opt);
      });

      if (!savedModel && validModels.length > 0) {
        const preferred = validModels.find((m) => m.name.includes("2.0-flash")) || validModels[0];
        const cleanPref = preferred.name.replace(/^models\//, "");
        geminiModelSelect.value = cleanPref;
        localStorage.setItem("ai_helper_gemini_model", cleanPref);
      }

      geminiModelsContainer.style.display = "block";
      geminiStatusMsg.textContent = `✓ Найдено ${validModels.length} активных моделей Google AI Studio. Выберите нужную:`;
    } catch (err: any) {
      geminiStatusMsg.textContent = `✕ Ошибка опроса Google API: ${err.message || err}`;
    } finally {
      geminiFetchModelsBtn.disabled = false;
    }
  };

  geminiFetchModelsBtn.addEventListener("click", fetchGeminiModels);
  geminiModelSelect.addEventListener("change", () => {
    localStorage.setItem("ai_helper_gemini_model", geminiModelSelect.value);
  });

  // 4. Dynamic Live Discovery: Groq Cloud API (/openai/v1/models)
  const fetchGroqModels = async () => {
    const key = groqKeyInput.value.trim();
    if (!key) {
      groqStatusMsg.textContent = "⚠️ Сначала введите и сохраните API-ключ Groq.";
      return;
    }

    groqFetchModelsBtn.disabled = true;
    groqStatusMsg.textContent = "📡 Опрос Groq Cloud API (GET /openai/v1/models)...";

    try {
      const resp = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${await resp.text()}`);
      }

      const data = await resp.json();
      const rawModels: any[] = data.data || [];
      const validModels = rawModels.filter((m) => m.active !== false);

      groqModelSelect.innerHTML = "";
      if (validModels.length === 0) {
        groqStatusMsg.textContent = "✕ Активные модели Groq не найдены.";
        return;
      }

      const savedModel = localStorage.getItem("ai_helper_groq_model") || "";

      validModels.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        const ctxK = m.context_window ? `${Math.round(m.context_window / 1024)}k токенов` : "128k";
        opt.textContent = `${m.id} [Контекстное окно: ${ctxK}]`;

        if (m.id === savedModel) opt.selected = true;
        groqModelSelect.appendChild(opt);
      });

      if (!savedModel && validModels.length > 0) {
        const preferred = validModels.find((m) => m.id.includes("70b")) || validModels[0];
        groqModelSelect.value = preferred.id;
        localStorage.setItem("ai_helper_groq_model", preferred.id);
      }

      groqModelsContainer.style.display = "block";
      groqStatusMsg.textContent = `✓ Найдено ${validModels.length} активных моделей на чипах Groq LPU:`;
    } catch (err: any) {
      groqStatusMsg.textContent = `✕ Ошибка опроса Groq API: ${err.message || err}`;
    } finally {
      groqFetchModelsBtn.disabled = false;
    }
  };

  groqFetchModelsBtn.addEventListener("click", fetchGroqModels);
  groqModelSelect.addEventListener("change", () => {
    localStorage.setItem("ai_helper_groq_model", groqModelSelect.value);
  });

  // 5. Dynamic Live Discovery: OpenRouter Zero-Cost Free Models
  const fetchOpenRouterModels = async () => {
    fetchFreeModelsBtn.disabled = true;
    openrouterStatusMsg.textContent = "📡 Опрос OpenRouter API (GET /api/v1/models)...";

    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models");
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${await resp.text()}`);
      }

      const data = await resp.json();
      const allModels: any[] = data.data || [];

      // Filter strictly 0$ free models
      const freeModels = allModels.filter((m) => {
        const pricing = m.pricing;
        if (!pricing) return false;
        const promptPrice = parseFloat(pricing.prompt || "1");
        const compPrice = parseFloat(pricing.completion || "1");
        return promptPrice === 0 && compPrice === 0;
      });

      openrouterModelSelect.innerHTML = "";
      if (freeModels.length === 0) {
        openrouterStatusMsg.textContent = "В данный момент бесплатные модели не найдены.";
        return;
      }

      const savedModel = localStorage.getItem("ai_helper_openrouter_model") || "";

      freeModels.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        const contextLen = m.context_length ? `[${Math.round(m.context_length / 1024)}k]` : "";
        opt.textContent = `🟢 [0$ FREE] ${m.name || m.id} ${contextLen}`;
        if (savedModel && m.id === savedModel) opt.selected = true;
        openrouterModelSelect.appendChild(opt);
      });

      if (!savedModel && freeModels.length > 0) {
        const preferred = freeModels.find((m) => m.id === "openrouter/free") || freeModels[0];
        openrouterModelSelect.value = preferred.id;
        localStorage.setItem("ai_helper_openrouter_model", preferred.id);
      }

      freeModelsContainer.style.display = "block";
      openrouterStatusMsg.textContent = `✓ Найдено ${freeModels.length} полностью бесплатных моделей (0$):`;
    } catch (err: any) {
      openrouterStatusMsg.textContent = `✕ Ошибка опроса OpenRouter: ${err.message || err}`;
    } finally {
      fetchFreeModelsBtn.disabled = false;
    }
  };

  fetchFreeModelsBtn.addEventListener("click", fetchOpenRouterModels);
  openrouterModelSelect.addEventListener("change", () => {
    localStorage.setItem("ai_helper_openrouter_model", openrouterModelSelect.value);
  });

  // 6. Dynamic Live Discovery: Local Models (Ollama / LM Studio)
  const fetchLocalModels = async () => {
    const baseUrl = localUrlInput.value.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      localStatusMsg.textContent = "⚠️ Введите адрес локального сервера (например http://localhost:11434/v1).";
      return;
    }

    localFetchModelsBtn.disabled = true;
    localStatusMsg.textContent = `📡 Опрос локального шлюза (${baseUrl}/models)...`;

    try {
      const resp = await fetch(`${baseUrl}/models`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${await resp.text()}`);
      }

      const data = await resp.json();
      const rawModels: any[] = data.data || [];

      localModelSelect.innerHTML = "";
      if (rawModels.length === 0) {
        localStatusMsg.textContent = "✕ Локальные модели не обнаружены. Проверьте запущен ли Ollama / LM Studio.";
        return;
      }

      const savedModel = localStorage.getItem("ai_helper_local_model") || "";

      rawModels.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `🖥️ [Local Offline] ${m.id}`;
        if (m.id === savedModel) opt.selected = true;
        localModelSelect.appendChild(opt);
      });

      if (!savedModel && rawModels.length > 0) {
        localModelSelect.value = rawModels[0].id;
        localStorage.setItem("ai_helper_local_model", rawModels[0].id);
      }

      localModelsContainer.style.display = "block";
      localStatusMsg.textContent = `✓ Найдено ${rawModels.length} локальных моделей на вашем компьютере:`;
    } catch (err: any) {
      localStatusMsg.textContent = `✕ Сервер недоступен: ${err.message || err}. Убедитесь, что Ollama или LM Studio запущены.`;
    } finally {
      localFetchModelsBtn.disabled = false;
    }
  };

  localFetchModelsBtn.addEventListener("click", fetchLocalModels);
  localModelSelect.addEventListener("change", () => {
    localStorage.setItem("ai_helper_local_model", localModelSelect.value);
  });

  // Auto-trigger discovery if keys already exist
  if (geminiKeyInput.value.trim()) {
    fetchGeminiModels();
  }
  if (groqKeyInput.value.trim()) {
    fetchGroqModels();
  }

  // 7. System Prompt
  promptInput.value = localStorage.getItem("ai_helper_system_prompt") || DEFAULT_SYSTEM_PROMPT;
  promptInput.addEventListener("input", () => {
    localStorage.setItem("ai_helper_system_prompt", promptInput.value);
  });

  resetPromptBtn.addEventListener("click", () => {
    promptInput.value = DEFAULT_SYSTEM_PROMPT;
    localStorage.setItem("ai_helper_system_prompt", DEFAULT_SYSTEM_PROMPT);
  });

  // 8. Close Settings
  closeSettingsBtn.addEventListener("click", async () => {
    try {
      await invoke("close_settings_window");
    } catch {
      window.close();
    }
  });
});
