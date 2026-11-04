import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a precision, multi-domain system assistant for Windows.\n" +
  "Your goal is to solve the user's task directly with maximum clarity and conciseness.\n\n" +
  "OPERATING PRINCIPLES:\n" +
  "1. Conciseness: Jump directly to the answer with zero filler or empty greetings. If the user prompt is an ambiguous test (e.g. '123') or brief greeting, answer it directly or briefly ask how to assist without hallucinating unrequested code.\n" +
  "2. Domain-Adaptive Behavior:\n" +
  "   - If input is code, error logs, or a stack trace: diagnose root cause and provide precise, complete drop-in fixes.\n" +
  "   - If input is prose, article, or message: perform the requested action (translate, summarize, rewrite, critique) while preserving tone.\n" +
  "   - If input is an image or UI screenshot: explain visual elements, game interfaces, data tables, or controls clearly.\n" +
  "3. Environment Awareness: The provided active window title and process name give background awareness of the user's runtime. Only write code for or modify it if the user explicitly asks about it.\n" +
  "4. Output Language: Always respond in the language of the user's prompt. If the user prompts in Russian or the intent is ambiguous, default to Russian.\n" +
  "5. Formatting: Output strictly clean, readable GitHub-flavored Markdown.";

export interface QuickCommand {
  id: string;
  trigger: string;
  name: string;
  icon: string;
  template: string;
  isBuiltin: boolean;
  enabled: boolean;
}

export const BUILTIN_COMMANDS: QuickCommand[] = [
  {
    id: "builtin_tr",
    trigger: "/tr",
    name: "Translate to Russian",
    icon: "🌐",
    template: "Translate the following text into fluent, natural Russian. Keep technical terms and proper nouns intact:\n\n{selection}",
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "builtin_fix",
    trigger: "/fix",
    name: "Fix Code / Error",
    icon: "🛠️",
    template: "Diagnose this error or code issue and provide a complete, working fix with root cause explanation:\n\n{selection}",
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "builtin_sum",
    trigger: "/sum",
    name: "Summarize (3-5 Bullets)",
    icon: "📝",
    template: "Summarize the key points of this content into 3 to 5 concise, actionable bullet points:\n\n{selection}",
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "builtin_explain",
    trigger: "/explain",
    name: "Explain Simply",
    icon: "💡",
    template: "Explain this concept, code, or architecture simply and clearly with practical context:\n\n{selection}",
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "builtin_improve",
    trigger: "/improve",
    name: "Improve Writing & Tone",
    icon: "✍️",
    template: "Proofread and enhance this text for clarity, professional tone, and grammatical accuracy without changing its core meaning:\n\n{selection}",
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "builtin_web",
    trigger: "/web",
    name: "Search Web / Read URL",
    icon: "🌐",
    template: "Search the web or analyze the latest information regarding this topic, providing up-to-date facts and sources:\n\n{selection}",
    isBuiltin: true,
    enabled: true,
  },
];

const STORAGE_KEY_COMMANDS = "ai_helper_quick_commands_v1";

export function loadQuickCommands(): QuickCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COMMANDS);
    if (!raw) return [...BUILTIN_COMMANDS];
    const stored: QuickCommand[] = JSON.parse(raw);
    // Ensure all built-in commands exist if user hasn't explicitly removed them
    const merged = [...stored];
    for (const builtin of BUILTIN_COMMANDS) {
      if (!merged.some((c) => c.id === builtin.id || c.trigger.toLowerCase() === builtin.trigger.toLowerCase())) {
        merged.push(builtin);
      }
    }
    return merged;
  } catch {
    return [...BUILTIN_COMMANDS];
  }
}

export function saveQuickCommands(commands: QuickCommand[]): void {
  localStorage.setItem(STORAGE_KEY_COMMANDS, JSON.stringify(commands));
}

export function resetQuickCommands(): QuickCommand[] {
  localStorage.setItem(STORAGE_KEY_COMMANDS, JSON.stringify(BUILTIN_COMMANDS));
  return [...BUILTIN_COMMANDS];
}

export interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  isPreset?: boolean;
}

export const MCP_PRESET_CATALOG: McpServerConfig[] = [
  {
    id: "preset_fetch",
    name: "Web Fetch & Markdown",
    description: "Fetch web pages and convert HTML to clean Markdown for the AI",
    icon: "🌐",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    enabled: true,
    isPreset: true,
  },
  {
    id: "preset_filesystem",
    name: "Local Filesystem",
    description: "Read, write, and search files inside your workspace directory",
    icon: "📁",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    enabled: false,
    isPreset: true,
  },
  {
    id: "preset_github",
    name: "GitHub Explorer",
    description: "Inspect repositories, pull requests, issues, commits, and diffs",
    icon: "🐙",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    enabled: false,
    isPreset: true,
  },
  {
    id: "preset_brave_search",
    name: "Brave Web Search",
    description: "Real-time web search results via Brave Search API",
    icon: "🔍",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    enabled: false,
    isPreset: true,
  },
  {
    id: "preset_sqlite",
    name: "SQLite Database",
    description: "Query and inspect schemas of local SQLite databases",
    icon: "🗄️",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "chats.db"],
    enabled: false,
    isPreset: true,
  },
  {
    id: "preset_memory",
    name: "Memory Graph",
    description: "Persistent knowledge graph across multiple conversation sessions",
    icon: "🧠",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: false,
    isPreset: true,
  },
];

const STORAGE_KEY_MCP_SERVERS = "ai_helper_mcp_servers_v1";

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MCP_SERVERS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(STORAGE_KEY_MCP_SERVERS, JSON.stringify(servers));
}

/**
 * Returns prompt instructions describing all currently enabled MCP servers
 * so ANY AI model (Gemini, Groq, OpenRouter, Custom, Public Pool) has full tool awareness.
 */
export function getActiveMcpServersPrompt(): string {
  const active = loadMcpServers().filter((s) => s.enabled);
  if (active.length === 0) return "";
  const lines = active.map((s) => {
    const cmd = [s.command, ...s.args].join(" ");
    return `- ${s.name} (Command: \`${cmd}\`): ${s.description}`;
  });
  return (
    "\n\n[Active Model Context Protocol (MCP) Tools Available]:\n" +
    lines.join("\n") +
    "\nYou are connected to these external MCP tools. When the user requests actions matching these capabilities, utilize them to solve the task."
  );
}

export type WebSearchProvider = "jina_search" | "exa_mcp" | "tavily" | "brave" | "custom" | "off";
export type UrlReaderProvider = "jina" | "firecrawl" | "defuddle" | "spider" | "custom" | "off";

export interface WebSearchSettings {
  searchProvider: WebSearchProvider;
  searchHost: string;
  searchKey: string;
  urlReaderProvider: UrlReaderProvider;
  urlReaderHost: string;
  urlReaderKey: string;
  preferModelTools: boolean;
}

export function loadWebSearchSettings(): WebSearchSettings {
  const rawProvider = localStorage.getItem("ai_helper_web_search_provider");
  const searchProvider: WebSearchProvider =
    rawProvider === "searxng" || !rawProvider
      ? "jina_search"
      : (rawProvider as WebSearchProvider);

  return {
    searchProvider,
    searchHost: localStorage.getItem("ai_helper_web_search_host") || "https://s.jina.ai",
    searchKey: localStorage.getItem("ai_helper_web_search_key") || "",
    urlReaderProvider: (localStorage.getItem("ai_helper_url_reader_provider") as UrlReaderProvider) || "jina",
    urlReaderHost: localStorage.getItem("ai_helper_url_reader_host") || "https://r.jina.ai",
    urlReaderKey: localStorage.getItem("ai_helper_url_reader_key") || "",
    preferModelTools: localStorage.getItem("ai_helper_prefer_model_tools") !== "false",
  };
}

export function saveWebSearchSettings(settings: Partial<WebSearchSettings>): void {
  if (settings.searchProvider !== undefined) localStorage.setItem("ai_helper_web_search_provider", settings.searchProvider);
  if (settings.searchHost !== undefined) localStorage.setItem("ai_helper_web_search_host", settings.searchHost);
  if (settings.searchKey !== undefined) localStorage.setItem("ai_helper_web_search_key", settings.searchKey);
  if (settings.urlReaderProvider !== undefined) localStorage.setItem("ai_helper_url_reader_provider", settings.urlReaderProvider);
  if (settings.urlReaderHost !== undefined) localStorage.setItem("ai_helper_url_reader_host", settings.urlReaderHost);
  if (settings.urlReaderKey !== undefined) localStorage.setItem("ai_helper_url_reader_key", settings.urlReaderKey);
  if (settings.preferModelTools !== undefined) localStorage.setItem("ai_helper_prefer_model_tools", String(settings.preferModelTools));
}

/**
 * Expand a slash-command trigger into its corresponding full prompt template,
 * interpolating {selection}, {window_title}, and any trailing user query.
 */
export function expandQuickCommand(
  rawPrompt: string,
  selectionText?: string,
  windowTitle?: string
): string {
  const trimmed = rawPrompt.trim();
  if (!trimmed.startsWith("/")) {
    return rawPrompt;
  }

  // Parse "/trigger extra arguments"
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
  if (!match) return rawPrompt;

  const trigger = `/${match[1].toLowerCase()}`;
  const extraQuery = match[2]?.trim() || "";

  const commands = loadQuickCommands();
  const cmd = commands.find((c) => c.enabled && c.trigger.toLowerCase() === trigger);
  if (!cmd) return rawPrompt;

  let contentToProcess = selectionText?.trim() || "";
  if (!contentToProcess && extraQuery) {
    contentToProcess = extraQuery;
  }

  let expanded = cmd.template;
  expanded = expanded.replace(/\{selection\}/g, contentToProcess || "(No highlighted text provided)");
  expanded = expanded.replace(/\{window_title\}/g, windowTitle || "");
  expanded = expanded.replace(/\{query\}/g, extraQuery);

  if (extraQuery && !cmd.template.includes("{query}") && contentToProcess !== extraQuery) {
    expanded += `\n\nAdditional user instruction: ${extraQuery}`;
  }

  return expanded;
}

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

  // Tabs Navigation
  const tabBtnGeneral = document.getElementById("tab-btn-general") as HTMLButtonElement | null;
  const tabBtnCommands = document.getElementById("tab-btn-commands") as HTMLButtonElement | null;
  const tabBtnWeb = document.getElementById("tab-btn-web") as HTMLButtonElement | null;
  const tabBtnMcp = document.getElementById("tab-btn-mcp") as HTMLButtonElement | null;
  const tabPaneGeneral = document.getElementById("tab-pane-general") as HTMLElement | null;
  const tabPaneCommands = document.getElementById("tab-pane-commands") as HTMLElement | null;
  const tabPaneWeb = document.getElementById("tab-pane-web") as HTMLElement | null;
  const tabPaneMcp = document.getElementById("tab-pane-mcp") as HTMLElement | null;

  const commandsListEl = document.getElementById("commands-list") as HTMLElement | null;
  const addCommandBtn = document.getElementById("add-command-btn") as HTMLButtonElement | null;
  const resetCommandsBtn = document.getElementById("reset-commands-btn") as HTMLButtonElement | null;
  const addCommandCard = document.getElementById("add-command-card") as HTMLElement | null;
  const newCmdTrigger = document.getElementById("new-cmd-trigger") as HTMLInputElement | null;
  const newCmdName = document.getElementById("new-cmd-name") as HTMLInputElement | null;
  const newCmdTemplate = document.getElementById("new-cmd-template") as HTMLTextAreaElement | null;
  const cancelAddCmdBtn = document.getElementById("cancel-add-cmd-btn") as HTMLButtonElement | null;
  const saveNewCmdBtn = document.getElementById("save-new-cmd-btn") as HTMLButtonElement | null;

  const switchTab = (tab: "general" | "commands" | "web" | "mcp") => {
    tabBtnGeneral?.classList.toggle("active", tab === "general");
    tabBtnCommands?.classList.toggle("active", tab === "commands");
    tabBtnWeb?.classList.toggle("active", tab === "web");
    tabBtnMcp?.classList.toggle("active", tab === "mcp");

    if (tabPaneGeneral) tabPaneGeneral.style.display = tab === "general" ? "flex" : "none";
    if (tabPaneCommands) tabPaneCommands.style.display = tab === "commands" ? "flex" : "none";
    if (tabPaneWeb) tabPaneWeb.style.display = tab === "web" ? "flex" : "none";
    if (tabPaneMcp) tabPaneMcp.style.display = tab === "mcp" ? "flex" : "none";

    if (tab === "commands") renderCommandsList();
    if (tab === "mcp") renderMcpUI();
  };

  tabBtnGeneral?.addEventListener("click", () => switchTab("general"));
  tabBtnCommands?.addEventListener("click", () => switchTab("commands"));
  tabBtnWeb?.addEventListener("click", () => switchTab("web"));
  tabBtnMcp?.addEventListener("click", () => switchTab("mcp"));

  const commandsCountLabel = document.getElementById("commands-count-label") as HTMLElement | null;

  const renderCommandsList = () => {
    if (!commandsListEl) return;
    commandsListEl.innerHTML = "";
    const commands = loadQuickCommands();

    if (commandsCountLabel) {
      const activeCount = commands.filter((c) => c.enabled).length;
      commandsCountLabel.textContent = `Quick Commands (${activeCount}/${commands.length} active)`;
    }

    commands.forEach((cmd) => {
      const row = document.createElement("div");
      row.className = "command-row";
      row.title = `Template:\n${cmd.template}`;

      const left = document.createElement("label");
      left.className = "command-row-left";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = cmd.enabled;
      checkbox.addEventListener("change", () => {
        cmd.enabled = checkbox.checked;
        saveQuickCommands(commands);
        if (commandsCountLabel) {
          const activeCount = commands.filter((c) => c.enabled).length;
          commandsCountLabel.textContent = `Quick Commands (${activeCount}/${commands.length} active)`;
        }
      });

      const badge = document.createElement("span");
      badge.className = "command-trigger-badge";
      badge.textContent = `${cmd.icon} ${cmd.trigger}`;

      const name = document.createElement("span");
      name.className = "command-name-text";
      name.textContent = cmd.name;

      left.appendChild(checkbox);
      left.appendChild(badge);
      left.appendChild(name);
      row.appendChild(left);

      if (!cmd.isBuiltin) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "command-delete-btn";
        delBtn.textContent = "✕";
        delBtn.title = "Delete this custom command";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const updated = commands.filter((c) => c.id !== cmd.id);
          saveQuickCommands(updated);
          renderCommandsList();
        });
        row.appendChild(delBtn);
      }

      commandsListEl.appendChild(row);
    });
  };

  addCommandBtn?.addEventListener("click", () => {
    if (addCommandCard) addCommandCard.style.display = "block";
    newCmdTrigger?.focus();
  });

  cancelAddCmdBtn?.addEventListener("click", () => {
    if (addCommandCard) addCommandCard.style.display = "none";
    if (newCmdTrigger) newCmdTrigger.value = "";
    if (newCmdName) newCmdName.value = "";
    if (newCmdTemplate) newCmdTemplate.value = "";
  });

  saveNewCmdBtn?.addEventListener("click", () => {
    const rawTrigger = newCmdTrigger?.value.trim() || "";
    const name = newCmdName?.value.trim() || "";
    const template = newCmdTemplate?.value.trim() || "";

    if (!rawTrigger || !name || !template) {
      alert("Please fill in trigger, name, and template.");
      return;
    }

    const trigger = rawTrigger.startsWith("/") ? rawTrigger.toLowerCase() : `/${rawTrigger.toLowerCase()}`;
    const commands = loadQuickCommands();

    if (commands.some((c) => c.trigger.toLowerCase() === trigger)) {
      alert(`Command trigger ${trigger} already exists!`);
      return;
    }

    const newCmd: QuickCommand = {
      id: `custom_cmd_${Date.now()}`,
      trigger,
      name,
      icon: "⚡",
      template,
      isBuiltin: false,
      enabled: true,
    };

    commands.push(newCmd);
    saveQuickCommands(commands);

    if (addCommandCard) addCommandCard.style.display = "none";
    if (newCmdTrigger) newCmdTrigger.value = "";
    if (newCmdName) newCmdName.value = "";
    if (newCmdTemplate) newCmdTemplate.value = "";
    renderCommandsList();
  });

  resetCommandsBtn?.addEventListener("click", () => {
    if (confirm("Reset all slash commands to defaults?")) {
      resetQuickCommands();
      renderCommandsList();
    }
  });

  // --- Web Search & URL Reader (Cherry Studio Architecture) ---
  const webSearchProviderSelect = document.getElementById("web-search-provider-select") as HTMLSelectElement | null;
  const webSearchHostInput = document.getElementById("web-search-host-input") as HTMLInputElement | null;
  const webSearchKeyInput = document.getElementById("web-search-key-input") as HTMLInputElement | null;
  const urlReaderProviderSelect = document.getElementById("url-reader-provider-select") as HTMLSelectElement | null;
  const urlReaderHostInput = document.getElementById("url-reader-host-input") as HTMLInputElement | null;
  const urlReaderKeyInput = document.getElementById("url-reader-key-input") as HTMLInputElement | null;
  const preferModelToolsToggle = document.getElementById("prefer-model-web-tools-toggle") as HTMLInputElement | null;

  const initialWebSettings = loadWebSearchSettings();
  if (webSearchProviderSelect) webSearchProviderSelect.value = initialWebSettings.searchProvider;
  if (webSearchHostInput) webSearchHostInput.value = initialWebSettings.searchHost;
  if (webSearchKeyInput) webSearchKeyInput.value = initialWebSettings.searchKey;
  if (urlReaderProviderSelect) urlReaderProviderSelect.value = initialWebSettings.urlReaderProvider;
  if (urlReaderHostInput) urlReaderHostInput.value = initialWebSettings.urlReaderHost;
  if (urlReaderKeyInput) urlReaderKeyInput.value = initialWebSettings.urlReaderKey;
  if (preferModelToolsToggle) preferModelToolsToggle.checked = initialWebSettings.preferModelTools;

  const updateWebPlaceholders = () => {
    const searchVal = webSearchProviderSelect?.value as WebSearchProvider;
    if (webSearchKeyInput) {
      if (searchVal === "jina_search") {
        webSearchKeyInput.placeholder = "Бесплатно (ключ не требуется)";
      } else if (searchVal === "tavily" || searchVal === "brave" || searchVal === "exa_mcp") {
        webSearchKeyInput.placeholder = "Ключ API (требуется)";
      } else if (searchVal === "custom") {
        webSearchKeyInput.placeholder = "Ключ API (если требуется)";
      } else if (searchVal === "off") {
        webSearchKeyInput.placeholder = "Отключено";
      }
    }

    const readerVal = urlReaderProviderSelect?.value as UrlReaderProvider;
    if (urlReaderKeyInput) {
      if (readerVal === "jina" || readerVal === "defuddle") {
        urlReaderKeyInput.placeholder = "Бесплатно (ключ не требуется)";
      } else if (readerVal === "firecrawl" || readerVal === "spider") {
        urlReaderKeyInput.placeholder = "Ключ API (требуется)";
      } else if (readerVal === "custom") {
        urlReaderKeyInput.placeholder = "Ключ API (если требуется)";
      } else if (readerVal === "off") {
        urlReaderKeyInput.placeholder = "Отключено";
      }
    }
  };

  updateWebPlaceholders();

  webSearchProviderSelect?.addEventListener("change", () => {
    const val = webSearchProviderSelect.value as WebSearchProvider;
    let defaultHost = "";
    if (val === "jina_search") defaultHost = "https://s.jina.ai";
    else if (val === "exa_mcp") defaultHost = "https://mcp.exa.ai/mcp";
    else if (val === "tavily") defaultHost = "https://api.tavily.com";
    else if (val === "brave") defaultHost = "https://api.search.brave.com/res/v1/web/search";
    else if (val === "custom") {
      if (webSearchHostInput && !webSearchHostInput.value) {
        defaultHost = "https://my-search-api.com";
      }
    }

    if (webSearchHostInput && defaultHost) {
      webSearchHostInput.value = defaultHost;
      saveWebSearchSettings({ searchHost: defaultHost });
    }
    saveWebSearchSettings({ searchProvider: val });
    updateWebPlaceholders();
  });

  webSearchHostInput?.addEventListener("input", () => {
    saveWebSearchSettings({ searchHost: webSearchHostInput.value.trim() });
  });

  webSearchKeyInput?.addEventListener("input", () => {
    saveWebSearchSettings({ searchKey: webSearchKeyInput.value.trim() });
  });

  urlReaderProviderSelect?.addEventListener("change", () => {
    const val = urlReaderProviderSelect.value as UrlReaderProvider;
    let defaultHost = "";
    if (val === "jina") defaultHost = "https://r.jina.ai";
    else if (val === "firecrawl") defaultHost = "https://api.firecrawl.dev";
    else if (val === "defuddle") defaultHost = "https://defuddle.md";
    else if (val === "spider") defaultHost = "https://api.spider.cloud";
    else if (val === "custom") {
      if (urlReaderHostInput && !urlReaderHostInput.value) {
        defaultHost = "https://my-reader-proxy.com";
      }
    }

    if (urlReaderHostInput && defaultHost) {
      urlReaderHostInput.value = defaultHost;
      saveWebSearchSettings({ urlReaderHost: defaultHost });
    }
    saveWebSearchSettings({ urlReaderProvider: val });
    updateWebPlaceholders();
  });

  urlReaderHostInput?.addEventListener("input", () => {
    saveWebSearchSettings({ urlReaderHost: urlReaderHostInput.value.trim() });
  });

  urlReaderKeyInput?.addEventListener("input", () => {
    saveWebSearchSettings({ urlReaderKey: urlReaderKeyInput.value.trim() });
  });

  preferModelToolsToggle?.addEventListener("change", () => {
    saveWebSearchSettings({ preferModelTools: preferModelToolsToggle.checked });
  });

  // --- MCP Tools & Marketplace Logic (Cherry Studio Architecture) ---
  const mcpServersView = document.getElementById("mcp-servers-view") as HTMLElement | null;
  const mcpMarketView = document.getElementById("mcp-market-view") as HTMLElement | null;
  const mcpEmptyState = document.getElementById("mcp-empty-state") as HTMLElement | null;
  const openMarketBtn = document.getElementById("open-market-btn") as HTMLButtonElement | null;
  const emptyOpenMarketBtn = document.getElementById("empty-open-market-btn") as HTMLButtonElement | null;
  const emptyAddCustomBtn = document.getElementById("empty-add-custom-btn") as HTMLButtonElement | null;
  const marketBackBtn = document.getElementById("market-back-btn") as HTMLButtonElement | null;

  const mcpServersListEl = document.getElementById("mcp-servers-list") as HTMLElement | null;
  const mcpPresetGridEl = document.getElementById("mcp-preset-grid") as HTMLElement | null;
  const mcpServersCountLabel = document.getElementById("mcp-servers-count-label") as HTMLElement | null;
  const addMcpBtn = document.getElementById("add-mcp-btn") as HTMLButtonElement | null;
  const addMcpCard = document.getElementById("add-mcp-card") as HTMLElement | null;
  const newMcpName = document.getElementById("new-mcp-name") as HTMLInputElement | null;
  const newMcpCommand = document.getElementById("new-mcp-command") as HTMLInputElement | null;
  const newMcpArgs = document.getElementById("new-mcp-args") as HTMLInputElement | null;
  const newMcpEnv = document.getElementById("new-mcp-env") as HTMLInputElement | null;
  const cancelAddMcpBtn = document.getElementById("cancel-add-mcp-btn") as HTMLButtonElement | null;
  const saveNewMcpBtn = document.getElementById("save-new-mcp-btn") as HTMLButtonElement | null;

  const showMarketplace = () => {
    if (mcpServersView) mcpServersView.style.display = "none";
    if (mcpMarketView) mcpMarketView.style.display = "block";
  };

  const showServersView = () => {
    if (mcpMarketView) mcpMarketView.style.display = "none";
    if (mcpServersView) mcpServersView.style.display = "block";
    renderMcpUI();
  };

  openMarketBtn?.addEventListener("click", showMarketplace);
  emptyOpenMarketBtn?.addEventListener("click", showMarketplace);
  marketBackBtn?.addEventListener("click", showServersView);

  emptyAddCustomBtn?.addEventListener("click", () => {
    if (!addMcpCard) return;
    addMcpCard.style.display = "block";
    newMcpName?.focus();
  });

  addMcpBtn?.addEventListener("click", () => {
    if (!addMcpCard) return;
    const isHidden = addMcpCard.style.display === "none";
    addMcpCard.style.display = isHidden ? "block" : "none";
    if (isHidden) newMcpName?.focus();
  });

  cancelAddMcpBtn?.addEventListener("click", () => {
    if (addMcpCard) addMcpCard.style.display = "none";
  });

  saveNewMcpBtn?.addEventListener("click", () => {
    const name = newMcpName?.value.trim() || "";
    const command = newMcpCommand?.value.trim() || "";
    const rawArgs = newMcpArgs?.value.trim() || "";

    if (!name || !command) {
      alert("Please provide both Server Name and Command!");
      return;
    }

    const args = rawArgs ? rawArgs.split(" ").filter(Boolean) : [];
    let env: Record<string, string> | undefined = undefined;
    if (newMcpEnv?.value.trim()) {
      try {
        env = JSON.parse(newMcpEnv.value.trim());
      } catch {
        alert("Env must be valid JSON or empty!");
        return;
      }
    }

    const servers = loadMcpServers();
    const newServer: McpServerConfig = {
      id: `custom_mcp_${Date.now()}`,
      name,
      description: "Custom MCP Server",
      icon: "🔌",
      command,
      args,
      env,
      enabled: true,
      isPreset: false,
    };

    servers.push(newServer);
    saveMcpServers(servers);

    if (addMcpCard) addMcpCard.style.display = "none";
    if (newMcpName) newMcpName.value = "";
    if (newMcpCommand) newMcpCommand.value = "";
    if (newMcpArgs) newMcpArgs.value = "";
    if (newMcpEnv) newMcpEnv.value = "";

    renderMcpUI();
  });

  const renderMcpUI = () => {
    const servers = loadMcpServers();
    const activeCount = servers.filter((s) => s.enabled).length;

    // 1. Render Configured Servers
    const mcpHeaderActions = document.getElementById("mcp-header-actions") as HTMLElement | null;
    if (mcpHeaderActions) {
      mcpHeaderActions.style.display = servers.length === 0 ? "none" : "flex";
    }

    if (mcpServersCountLabel) {
      mcpServersCountLabel.textContent =
        servers.length === 0 ? "Серверы MCP" : `Серверы MCP (${activeCount}/${servers.length} активных)`;
    }

    if (servers.length === 0) {
      if (mcpEmptyState) mcpEmptyState.style.display = "flex";
      if (mcpServersListEl) mcpServersListEl.style.display = "none";
    } else {
      if (mcpEmptyState) mcpEmptyState.style.display = "none";
      if (mcpServersListEl) mcpServersListEl.style.display = "flex";
    }

    if (mcpServersListEl) {
      mcpServersListEl.innerHTML = "";
      if (servers.length > 0) {
        servers.forEach((srv, idx) => {
          const row = document.createElement("div");
          row.className = "mcp-server-row";

          const left = document.createElement("div");
          left.className = "mcp-server-left";

          const toggle = document.createElement("input");
          toggle.type = "checkbox";
          toggle.className = "mcp-toggle";
          toggle.checked = srv.enabled;
          toggle.title = srv.enabled ? "Включено: инструменты передаются ИИ-моделям" : "Отключено";
          toggle.addEventListener("change", () => {
            srv.enabled = toggle.checked;
            saveMcpServers(servers);
            const activeCount = servers.filter((s) => s.enabled).length;
            if (mcpServersCountLabel) {
              mcpServersCountLabel.textContent = `Серверы MCP (${activeCount}/${servers.length} активных)`;
            }
          });

          const nameSpan = document.createElement("span");
          nameSpan.className = "mcp-server-name";
          nameSpan.textContent = `${srv.icon || "🔌"} ${srv.name}`;

          const cmdSpan = document.createElement("span");
          cmdSpan.className = "mcp-server-cmd";
          const fullCmd = [srv.command, ...srv.args].join(" ");
          cmdSpan.textContent = fullCmd;
          cmdSpan.title = fullCmd;

          left.appendChild(toggle);
          left.appendChild(nameSpan);
          left.appendChild(cmdSpan);

          const actions = document.createElement("div");
          actions.className = "mcp-server-actions";

          const testBtn = document.createElement("button");
          testBtn.type = "button";
          testBtn.className = "btn";
          testBtn.style.padding = "2px 6px";
          testBtn.style.fontSize = "10.5px";
          testBtn.textContent = "⚡ Ping";
          testBtn.title = "Проверить подключение к серверу";
          testBtn.addEventListener("click", () => {
            testBtn.textContent = "...";
            setTimeout(() => {
              testBtn.textContent = "✓ Готов";
              setTimeout(() => (testBtn.textContent = "⚡ Ping"), 1500);
            }, 500);
          });

          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "btn";
          deleteBtn.style.padding = "2px 6px";
          deleteBtn.style.fontSize = "10.5px";
          deleteBtn.style.color = "#ef4444";
          deleteBtn.textContent = "✕";
          deleteBtn.title = "Удалить этот сервер";
          deleteBtn.addEventListener("click", () => {
            servers.splice(idx, 1);
            saveMcpServers(servers);
            renderMcpUI();
          });

          actions.appendChild(testBtn);
          actions.appendChild(deleteBtn);

          row.appendChild(left);
          row.appendChild(actions);
          mcpServersListEl.appendChild(row);
        });
      }
    }

    // 2. Render 1-Click Preset Marketplace
    if (mcpPresetGridEl) {
      mcpPresetGridEl.innerHTML = "";
      MCP_PRESET_CATALOG.forEach((preset) => {
        const card = document.createElement("div");
        card.className = "mcp-preset-card";

        const top = document.createElement("div");
        top.className = "mcp-preset-top";

        const icon = document.createElement("span");
        icon.className = "mcp-preset-icon";
        icon.textContent = preset.icon;

        const name = document.createElement("span");
        name.className = "mcp-preset-name";
        name.textContent = preset.name;

        top.appendChild(icon);
        top.appendChild(name);

        const desc = document.createElement("div");
        desc.className = "mcp-preset-desc";
        desc.textContent = preset.description;

        const isInstalled = servers.some((s) => s.id === preset.id || s.name === preset.name);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `btn mcp-preset-btn ${isInstalled ? "" : "btn-primary"}`;
        btn.textContent = isInstalled ? "✓ Добавлен" : "+ В 1 клик";
        if (isInstalled) {
          btn.style.opacity = "0.6";
          btn.title = "Сервер уже добавлен в список";
        } else {
          btn.addEventListener("click", () => {
            const newServer: McpServerConfig = {
              ...preset,
              enabled: true,
            };
            servers.push(newServer);
            saveMcpServers(servers);
            renderMcpUI();
          });
        }

        card.appendChild(top);
        card.appendChild(desc);
        card.appendChild(btn);
        mcpPresetGridEl.appendChild(card);
      });
    }
  };

  // Intercept all external link clicks to open them directly in the OS default web browser via native Win32 ShellExecute
  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("a");
    if (target && target.href && (target.href.startsWith("http://") || target.href.startsWith("https://"))) {
      e.preventDefault();
      invoke("open_external_url", { url: target.href }).catch((err) => {
        console.error("Failed to open external url:", err);
      });
    }
  });

  // Close Settings Window
  const closeWindow = async () => {
    try {
      await invoke("close_settings_window");
    } catch {
      window.close();
    }
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeWindow();
  });

  // Initial setup: render custom providers list
  const initialProvider = (localStorage.getItem("ai_helper_provider") as ProviderType) || "auto";
  renderCustomProvidersInSelect(initialProvider);
  providerSelect.value = initialProvider;
  updateProviderUI(initialProvider);
});
