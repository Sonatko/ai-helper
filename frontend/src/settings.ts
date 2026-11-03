import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SYSTEM_PROMPT =
  "Ты сверхбыстрый и лаконичный технический ассистент разработчика для Windows 11. " +
  "Отвечай кратко, без лишних вводных слов, сразу суть решения. " +
  "Если передан скриншот окна или выделенный код с ошибкой — дай точечное исправление и понятную причину сбоя.";

export type ProviderType =
  | "auto"
  | "public_pool"
  | "gemini_key"
  | "groq_key"
  | "openrouter_key"
  | (string & {});

export interface ModelOption {
  id: string;
  name: string;
  group?: string;
  badge?: string;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
}

export interface ProviderQuotaInfo {
  provider: ProviderType;
  model: string;
  displayName: string;
  requestsToday: number;
  requestsHour: number;
  tokensToday: number;
  tokensHour: number;
  maxDailyRequests?: number;
  maxRpm?: number;
  tokensLastRequest?: number;
  promptTokensLastRequest?: number;
  candidateTokensLastRequest?: number;
  remainingRequestsHeader?: string;
  remainingTokensHeader?: string;
  resetRequestsHeader?: string;
  resetTokensHeader?: string;
}

export interface StoredTelemetryEntry {
  timestamp: number;
  provider: ProviderType;
  model: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

const STORAGE_KEY_TELEMETRY = "ai_helper_telemetry_v1";
const STORAGE_KEY_CUSTOM_PROVIDERS = "ai_helper_custom_providers_v1";

export function loadCustomProviders(): CustomProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_PROVIDERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomProviders(providers: CustomProviderConfig[]): void {
  localStorage.setItem(STORAGE_KEY_CUSTOM_PROVIDERS, JSON.stringify(providers));
}

export function getTelemetryHistory(): StoredTelemetryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TELEMETRY);
    if (!raw) return [];
    const entries: StoredTelemetryEntry[] = JSON.parse(raw);
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    return entries.filter((e) => e.timestamp > oneDayAgo);
  } catch {
    return [];
  }
}

export function recordUsage(
  provider: ProviderType,
  model: string,
  totalTokens: number,
  promptTokens = 0,
  completionTokens = 0
): { requestsToday: number; requestsHour: number; tokensToday: number; tokensHour: number } {
  const history = getTelemetryHistory();
  const now = Date.now();
  const entry: StoredTelemetryEntry = {
    timestamp: now,
    provider,
    model,
    tokens: totalTokens,
    promptTokens,
    completionTokens,
  };
  history.push(entry);

  const trimmed = history.slice(-300);
  localStorage.setItem(STORAGE_KEY_TELEMETRY, JSON.stringify(trimmed));

  const oneHourAgo = now - 60 * 60 * 1000;
  const startOfDay = new Date().setHours(0, 0, 0, 0);

  const entriesToday = trimmed.filter((e) => e.provider === provider && e.timestamp >= startOfDay);
  const entriesHour = trimmed.filter((e) => e.provider === provider && e.timestamp >= oneHourAgo);

  return {
    requestsToday: entriesToday.length,
    requestsHour: entriesHour.length,
    tokensToday: entriesToday.reduce((acc, e) => acc + (e.tokens || 0), 0),
    tokensHour: entriesHour.reduce((acc, e) => acc + (e.tokens || 0), 0),
  };
}

export function getProviderTelemetryStats(provider: ProviderType): {
  requestsToday: number;
  requestsHour: number;
  tokensToday: number;
  tokensHour: number;
} {
  const history = getTelemetryHistory();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const startOfDay = new Date().setHours(0, 0, 0, 0);

  const entriesToday = history.filter((e) => e.provider === provider && e.timestamp >= startOfDay);
  const entriesHour = history.filter((e) => e.provider === provider && e.timestamp >= oneHourAgo);

  return {
    requestsToday: entriesToday.length,
    requestsHour: entriesHour.length,
    tokensToday: entriesToday.reduce((acc, e) => acc + (e.tokens || 0), 0),
    tokensHour: entriesHour.reduce((acc, e) => acc + (e.tokens || 0), 0),
  };
}

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement;
  const customProvidersGroup = document.getElementById("custom-providers-group") as HTMLOptGroupElement;
  const deleteProviderBtn = document.getElementById("delete-provider-btn") as HTMLButtonElement;
  const providerBadge = document.getElementById("provider-badge") as HTMLElement;
  const statusMsg = document.getElementById("status-msg") as HTMLElement;

  // Add provider card elements
  const addProviderCard = document.getElementById("add-provider-card") as HTMLElement;
  const newProviderName = document.getElementById("new-provider-name") as HTMLInputElement;
  const newProviderUrl = document.getElementById("new-provider-url") as HTMLInputElement;
  const newProviderKey = document.getElementById("new-provider-key") as HTMLInputElement;
  const cancelAddProviderBtn = document.getElementById("cancel-add-provider-btn") as HTMLButtonElement;
  const saveNewProviderBtn = document.getElementById("save-new-provider-btn") as HTMLButtonElement;

  const keyRow = document.getElementById("key-row") as HTMLElement;
  const keyLabel = document.getElementById("key-label") as HTMLElement;
  const keyInput = document.getElementById("key-input") as HTMLInputElement;
  const getKeyLink = document.getElementById("get-key-link") as HTMLAnchorElement;
  const eyeBtn = document.getElementById("eye-btn") as HTMLButtonElement;
  const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
  const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;

  const endpointRow = document.getElementById("endpoint-row") as HTMLElement;
  const endpointInput = document.getElementById("endpoint-input") as HTMLInputElement;
  const localSaveBtn = document.getElementById("local-save-btn") as HTMLButtonElement;

  const infoNotice = document.getElementById("info-notice") as HTMLElement;
  const modelRow = document.getElementById("model-row") as HTMLElement;
  const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
  const modelCountLabel = document.getElementById("model-count-label") as HTMLElement;

  const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
  const resetPromptBtn = document.getElementById("reset-prompt-btn") as HTMLButtonElement;
  const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;

  // Eye toggle
  eyeBtn.addEventListener("click", () => {
    if (keyInput.type === "password") {
      keyInput.type = "text";
      eyeBtn.textContent = "🔒";
    } else {
      keyInput.type = "password";
      eyeBtn.textContent = "👁️";
    }
  });

  const flashStatus = (text: string, isError = false) => {
    statusMsg.textContent = text;
    statusMsg.style.color = isError ? "#ef4444" : "#38bdf8";
  };

  const providerLinks: Record<string, string> = {
    gemini_key: "https://aistudio.google.com/app/apikey",
    groq_key: "https://console.groq.com/keys",
    openrouter_key: "https://openrouter.ai/keys",
  };

  const renderCustomProvidersInSelect = (selectedId?: string) => {
    const list = loadCustomProviders();
    customProvidersGroup.innerHTML = "";
    list.forEach((cp) => {
      const opt = document.createElement("option");
      opt.value = cp.id;
      opt.textContent = `🖥️ ${cp.name}`;
      if (cp.id === selectedId) opt.selected = true;
      customProvidersGroup.appendChild(opt);
    });
  };

  const renderModelOptions = (models: ModelOption[], savedSelectedId: string) => {
    modelSelect.innerHTML = "";

    if (models.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Click 🔄 to load models...";
      modelSelect.appendChild(opt);
      modelCountLabel.textContent = "";
      return;
    }

    modelCountLabel.textContent = `${models.length} available`;

    const groups: Record<string, ModelOption[]> = {};
    models.forEach((m) => {
      const grp = m.group || "Models";
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(m);
    });

    Object.entries(groups).forEach(([grpName, groupModels]) => {
      const optGroup = document.createElement("optgroup");
      optGroup.label = grpName;

      groupModels.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.badge ? `${m.name} [${m.badge}]` : m.name;
        if (m.id === savedSelectedId) opt.selected = true;
        optGroup.appendChild(opt);
      });

      modelSelect.appendChild(optGroup);
    });
  };

  // Fetch functions for providers
  const fetchGemini = async (key: string) => {
    if (!key) {
      renderModelOptions([], "");
      return;
    }
    flashStatus("Fetching Gemini models...");
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw: any[] = data.models || [];

      const valid = raw.filter((m) => {
        const idLower = (m.name || "").toLowerCase();
        const displayLower = (m.displayName || "").toLowerCase();
        const isTTS = idLower.includes("tts") || displayLower.includes("tts");
        const isEmbed = idLower.includes("embedding") || displayLower.includes("embedding");
        const isAudio = idLower.includes("audio") || displayLower.includes("audio");
        const isImage = idLower.includes("imagen") || displayLower.includes("image-generation");
        return m.supportedGenerationMethods?.includes("generateContent") && !isTTS && !isEmbed && !isAudio && !isImage;
      });

      const seen = new Set<string>();
      const list: ModelOption[] = [];
      valid.forEach((m) => {
        const cleanId = m.name.replace(/^models\//, "");
        const name = m.displayName || cleanId;
        const normKey = name.trim().toLowerCase();
        if (!seen.has(normKey)) {
          seen.add(normKey);
          let grp = "Gemini Models";
          if (cleanId.includes("gemma")) grp = "Gemma Open Models";
          else if (cleanId.includes("preview") || cleanId.includes("banana")) grp = "Experimental (Preview)";

          const isVision = cleanId.includes("flash") || cleanId.includes("pro");
          const ctxK = Math.round((m.inputTokenLimit || 1048576) / 1024);
          list.push({
            id: cleanId,
            name,
            group: grp,
            badge: `${isVision ? "📷 " : ""}${ctxK}k`,
          });
        }
      });

      const saved = localStorage.getItem("ai_helper_gemini_model") || "";
      renderModelOptions(list, saved);
      flashStatus(`Loaded ${list.length} Gemini models`);
    } catch (err: any) {
      flashStatus(`Gemini error: ${err.message}`, true);
    }
  };

  const fetchGroq = async (key: string) => {
    if (!key) {
      renderModelOptions([], "");
      return;
    }
    flashStatus("Fetching Groq models...");
    try {
      const resp = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw: any[] = data.data || [];

      const list: ModelOption[] = raw
        .filter((m) => m.active !== false && !m.id.includes("whisper") && !m.id.includes("guard"))
        .map((m) => {
          const ctxK = m.context_window ? `${Math.round(m.context_window / 1024)}k` : "128k";
          return {
            id: m.id,
            name: m.id,
            group: "Groq LPU Hardware",
            badge: `⚡ ~500 tok/s • ${ctxK}`,
          };
        });

      const saved = localStorage.getItem("ai_helper_groq_model") || "";
      renderModelOptions(list, saved);
      flashStatus(`Loaded ${list.length} Groq models`);
    } catch (err: any) {
      flashStatus(`Groq error: ${err.message}`, true);
    }
  };

  const fetchOpenRouter = async () => {
    flashStatus("Fetching OpenRouter models...");
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw: any[] = data.data || [];

      const freeList: ModelOption[] = [];
      const popularList: ModelOption[] = [];

      raw.forEach((m) => {
        const isFree = !m.pricing || (m.pricing.prompt === 0 && m.pricing.completion === 0);
        const ctxK = m.context_length ? `${Math.round(m.context_length / 1024)}k` : "8k";
        const idLower = m.id.toLowerCase();

        if (isFree) {
          freeList.push({
            id: m.id,
            name: m.name || m.id,
            group: "Free Models (0$)",
            badge: `0$ • ${ctxK}`,
          });
        } else if (
          idLower.includes("claude") ||
          idLower.includes("gpt-4") ||
          idLower.includes("deepseek") ||
          idLower.includes("qwen") ||
          idLower.includes("gemini")
        ) {
          popularList.push({
            id: m.id,
            name: m.name || m.id,
            group: "Popular Flagships",
            badge: `\$${m.pricing?.prompt}/M • ${ctxK}`,
          });
        }
      });

      const combined = [...freeList, ...popularList];
      const saved = localStorage.getItem("ai_helper_openrouter_model") || "";
      renderModelOptions(combined, saved);
      flashStatus(`Loaded ${freeList.length} free + ${popularList.length} popular models`);
    } catch (err: any) {
      flashStatus(`OpenRouter error: ${err.message}`, true);
    }
  };

  const fetchCustomProviderModels = async (url: string, key?: string, customId?: string) => {
    const cleanUrl = url.trim().replace(/\/+$/, "");
    if (!cleanUrl) {
      flashStatus("Enter Base URL first", true);
      return;
    }
    flashStatus(`Querying ${cleanUrl}...`);
    try {
      const headers: Record<string, string> = {};
      if (key) headers["Authorization"] = `Bearer ${key}`;
      const resp = await fetch(`${cleanUrl}/models`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw: any[] = data.data || [];

      const list: ModelOption[] = raw.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        group: "Server Models",
        badge: "Ready",
      }));

      const storageKey = customId ? `ai_helper_model_${customId}` : "ai_helper_local_model";
      const saved = localStorage.getItem(storageKey) || "";
      renderModelOptions(list, saved);
      flashStatus(`Loaded ${list.length} models from server`);
    } catch (err: any) {
      flashStatus(`Server unreachable: ${err.message}`, true);
    }
  };

  // Sync UI when provider changes
  const updateProviderUI = (provider: ProviderType) => {
    if (provider === "add_new_provider") {
      addProviderCard.style.display = "block";
      newProviderName.focus();
      return;
    } else {
      addProviderCard.style.display = "none";
    }

    localStorage.setItem("ai_helper_provider", provider);

    providerBadge.textContent = "Ready";
    providerBadge.style.color = "#10b981";

    const customList = loadCustomProviders();
    const currentCustom = customList.find((c) => c.id === provider);

    if (currentCustom) {
      deleteProviderBtn.style.display = "inline-flex";
      infoNotice.style.display = "none";
      keyRow.style.display = "flex";
      endpointRow.style.display = "flex";
      modelRow.style.display = "flex";

      endpointInput.value = currentCustom.baseUrl;
      keyInput.value = currentCustom.apiKey || "";
      keyInput.placeholder = "API Key (optional)";
      getKeyLink.style.display = "none";
      keyLabel.querySelector("span")!.textContent = "API Key";

      fetchCustomProviderModels(currentCustom.baseUrl, currentCustom.apiKey, currentCustom.id);
      return;
    }

    deleteProviderBtn.style.display = "none";

    if (provider === "auto") {
      keyRow.style.display = "none";
      endpointRow.style.display = "none";
      modelRow.style.display = "none";
      infoNotice.style.display = "block";
      infoNotice.innerHTML =
        "<strong>⚡ Auto Router:</strong> Automatically routes your request to the best available model (Vision / Code / Reasoning) with instant failover across your configured providers.";
      flashStatus("Auto mode active");
      return;
    }

    if (provider === "public_pool") {
      keyRow.style.display = "none";
      endpointRow.style.display = "none";
      modelRow.style.display = "none";
      infoNotice.style.display = "block";
      infoNotice.innerHTML =
        "<strong>🌐 Public Pool:</strong> Community AI gateway (Pollinations). Zero config, ready out of the box.";
      flashStatus("Public pool active");
      return;
    }

    infoNotice.style.display = "none";
    keyRow.style.display = "flex";
    modelRow.style.display = "flex";
    endpointRow.style.display = "none";

    getKeyLink.style.display = "inline";
    getKeyLink.href = providerLinks[provider] || "#";
    keyLabel.querySelector("span")!.textContent = "API Key";

    if (provider === "gemini_key") {
      keyInput.value = localStorage.getItem("ai_helper_gemini_api_key") || "";
      keyInput.placeholder = "AIzaSy...";
      if (keyInput.value.trim()) fetchGemini(keyInput.value.trim());
      else renderModelOptions([], "");
    } else if (provider === "groq_key") {
      keyInput.value = localStorage.getItem("ai_helper_groq_api_key") || "";
      keyInput.placeholder = "gsk_...";
      if (keyInput.value.trim()) fetchGroq(keyInput.value.trim());
      else renderModelOptions([], "");
    } else if (provider === "openrouter_key") {
      keyInput.value = localStorage.getItem("ai_helper_openrouter_api_key") || "";
      keyInput.placeholder = "sk-or-v1-...";
      fetchOpenRouter();
    }
  };

  // Provider change event
  providerSelect.addEventListener("change", () => {
    updateProviderUI(providerSelect.value as ProviderType);
  });

  // Save New Custom Provider
  saveNewProviderBtn.addEventListener("click", () => {
    const name = newProviderName.value.trim();
    const url = newProviderUrl.value.trim();
    const key = newProviderKey.value.trim();

    if (!name || !url) {
      flashStatus("Enter Provider Name and Base URL", true);
      return;
    }

    const providers = loadCustomProviders();
    const id = `custom_${Date.now()}`;
    const newProvider: CustomProviderConfig = {
      id,
      name,
      baseUrl: url,
      apiKey: key,
    };
    providers.push(newProvider);
    saveCustomProviders(providers);

    renderCustomProvidersInSelect(id);
    addProviderCard.style.display = "none";
    newProviderName.value = "";
    newProviderUrl.value = "";
    newProviderKey.value = "";

    providerSelect.value = id;
    updateProviderUI(id);
    flashStatus(`Added provider: ${name}`);
  });

  cancelAddProviderBtn.addEventListener("click", () => {
    addProviderCard.style.display = "none";
    providerSelect.value = localStorage.getItem("ai_helper_provider") || "auto";
    updateProviderUI(providerSelect.value as ProviderType);
  });

  // Delete Custom Provider
  deleteProviderBtn.addEventListener("click", () => {
    const active = providerSelect.value;
    let list = loadCustomProviders();
    list = list.filter((c) => c.id !== active);
    saveCustomProviders(list);

    renderCustomProvidersInSelect();
    providerSelect.value = "auto";
    updateProviderUI("auto");
    flashStatus("Custom provider deleted");
  });

  // Save Key Button
  saveBtn.addEventListener("click", () => {
    const p = providerSelect.value as ProviderType;
    const val = keyInput.value.trim();

    if (p === "gemini_key") {
      localStorage.setItem("ai_helper_gemini_api_key", val);
      fetchGemini(val);
    } else if (p === "groq_key") {
      localStorage.setItem("ai_helper_groq_api_key", val);
      fetchGroq(val);
    } else if (p === "openrouter_key") {
      localStorage.setItem("ai_helper_openrouter_api_key", val);
      fetchOpenRouter();
    } else {
      // Check if custom provider
      const customList = loadCustomProviders();
      const custom = customList.find((c) => c.id === p);
      if (custom) {
        custom.apiKey = val;
        saveCustomProviders(customList);
        fetchCustomProviderModels(custom.baseUrl, val, custom.id);
      }
    }

    saveBtn.textContent = "Saved ✓";
    setTimeout(() => (saveBtn.textContent = "Save"), 1200);
  });

  localSaveBtn.addEventListener("click", () => {
    const p = providerSelect.value;
    const customList = loadCustomProviders();
    const custom = customList.find((c) => c.id === p);
    if (custom) {
      custom.baseUrl = endpointInput.value.trim();
      custom.apiKey = keyInput.value.trim();
      saveCustomProviders(customList);
      fetchCustomProviderModels(custom.baseUrl, custom.apiKey, custom.id);
    }
    localSaveBtn.textContent = "Saved ✓";
    setTimeout(() => (localSaveBtn.textContent = "Save URL"), 1200);
  });

  // Refresh Button
  refreshBtn.addEventListener("click", () => {
    const p = providerSelect.value as ProviderType;
    if (p === "gemini_key") fetchGemini(keyInput.value.trim());
    else if (p === "groq_key") fetchGroq(keyInput.value.trim());
    else if (p === "openrouter_key") fetchOpenRouter();
    else {
      const customList = loadCustomProviders();
      const custom = customList.find((c) => c.id === p);
      if (custom) fetchCustomProviderModels(custom.baseUrl, keyInput.value.trim(), custom.id);
    }
  });

  // Model Selection change
  modelSelect.addEventListener("change", () => {
    const p = providerSelect.value as ProviderType;
    const model = modelSelect.value;
    if (p === "gemini_key") localStorage.setItem("ai_helper_gemini_model", model);
    else if (p === "groq_key") localStorage.setItem("ai_helper_groq_model", model);
    else if (p === "openrouter_key") localStorage.setItem("ai_helper_openrouter_model", model);
    else {
      localStorage.setItem(`ai_helper_model_${p}`, model);
    }
  });

  // Prompt logic
  promptInput.value = localStorage.getItem("ai_helper_system_prompt") || DEFAULT_SYSTEM_PROMPT;
  promptInput.addEventListener("input", () => {
    localStorage.setItem("ai_helper_system_prompt", promptInput.value);
  });

  resetPromptBtn.addEventListener("click", () => {
    promptInput.value = DEFAULT_SYSTEM_PROMPT;
    localStorage.setItem("ai_helper_system_prompt", DEFAULT_SYSTEM_PROMPT);
  });

  // Close Settings Window
  const closeWindow = async () => {
    try {
      await invoke("close_settings_window");
    } catch {
      window.close();
    }
  };

  closeBtn.addEventListener("click", closeWindow);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeWindow();
  });

  // Initial setup: render custom providers list
  const initialProvider = (localStorage.getItem("ai_helper_provider") as ProviderType) || "auto";
  renderCustomProvidersInSelect(initialProvider);
  providerSelect.value = initialProvider;
  updateProviderUI(initialProvider);
});
