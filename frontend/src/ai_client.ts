import {
  DEFAULT_SYSTEM_PROMPT,
  recordUsage,
  loadCustomProviders,
  expandQuickCommand,
  loadWebSearchSettings,
  getActiveMcpServersPrompt,
  type WebSearchSettings,
  type ProviderQuotaInfo,
} from "./settings";
import type { WindowPassport } from "./main";
import type { ProviderType } from "./settings";
import { invoke } from "@tauri-apps/api/core";

/**
 * Resolves API key: checks localStorage first, then transparently checks local runtime .env
 */
async function getEffectiveApiKey(storageKey: string, envVarName: string): Promise<string> {
  const localVal = localStorage.getItem(storageKey)?.trim();
  if (localVal) return localVal;
  try {
    const envVal = await invoke<string | null>("get_env_var", { name: envVarName });
    if (envVal?.trim()) return envVal.trim();
  } catch {}
  return "";
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onTokensUpdate: (promptTokens: number, candidateTokens: number, totalTokens: number) => void;
  onError: (errorMessage: string) => void;
  onFinish: (fullText: string, totalTokens: number, modelUsed?: string, quotaInfo?: ProviderQuotaInfo) => void;
}

export interface CapturedContentPayload {
  mode: "text" | "screenshot" | "empty";
  text?: string;
  jpegBase64?: string;
}

/**
 * Returns the currently active provider selected by the user.
 */
export function getActiveProvider(): ProviderType {
  const saved = localStorage.getItem("ai_helper_provider") as ProviderType;
  if (saved) return saved;
  return "auto";
}

/**
 * Returns the last model info actually executed to render in UI.
 */
export function getLastExecutedModel(): string {
  return localStorage.getItem("ai_helper_last_executed_model") || "";
}

/**
 * Generates an informative UI badge showing the active provider and model.
 */
export function getProviderBadge(): string {
  const lastExecuted = getLastExecutedModel();
  if (lastExecuted) {
    return lastExecuted;
  }

  const provider = getActiveProvider();
  if (provider.startsWith("custom_")) {
    const list = loadCustomProviders();
    const cp = list.find((c) => c.id === provider);
    const model = localStorage.getItem(`ai_helper_model_${provider}`) || "default";
    return `🖥️ ${cp ? cp.name : "Custom"} (${model})`;
  }

  switch (provider) {
    case "auto":
      return "⚡ Auto Router";
    case "gemini_key": {
      const model = localStorage.getItem("ai_helper_gemini_model") || "gemini-2.5-flash";
      return `Google Gemini (${model})`;
    }
    case "groq_key": {
      const model = localStorage.getItem("ai_helper_groq_model") || "llama-3.3-70b-versatile";
      const short = model.split("-")[0] || model;
      return `Groq LPU (${short})`;
    }
    case "openrouter_key": {
      const model = localStorage.getItem("ai_helper_openrouter_model") || "openrouter/free";
      const shortName = model.split("/").pop()?.replace(":free", "") || model;
      return `OpenRouter (${shortName})`;
    }
    default:
      return "Public Pool";
  }
}

/**
 * Checks whether the chosen provider and model support image (screenshot) inputs.
 */
export function isVisionSupported(provider?: ProviderType, modelName?: string): boolean {
  const prov = provider || getActiveProvider();
  if (prov === "gemini_key") return true;
  if (prov === "openrouter_key") {
    const m = (modelName || localStorage.getItem("ai_helper_openrouter_model") || "").toLowerCase();
    return m.includes("vision") || m.includes("vl") || m.includes("flash") || m.includes("4o") || m.includes("claude-3");
  }
  if (prov === "auto") {
    const geminiKey = localStorage.getItem("ai_helper_gemini_api_key");
    const openRouterKey = localStorage.getItem("ai_helper_openrouter_api_key");
    return !!(geminiKey || openRouterKey);
  }
  return false;
}

const URL_REGEX = /https?:\/\/[^\s<>"'{}|\\^`\[\]]+/gi;

/**
 * Extracts and deduplicates HTTP/HTTPS URLs from raw text.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return Array.from(new Set(matches)).filter((u) => u.startsWith("http://") || u.startsWith("https://"));
}

/**
 * Fetches webpage content and converts it to clean Markdown via Jina Reader (or Firecrawl)
 * with zero browser overhead and an 8-second circuit-breaker timeout.
 */
export async function fetchUrlContent(url: string, settings?: WebSearchSettings): Promise<string | null> {
  const ws = settings || loadWebSearchSettings();
  if (ws.urlReaderProvider === "off") return null;

  try {
    const host = ws.urlReaderHost?.trim() || "https://r.jina.ai";
    const target = `${host.replace(/\/+$/, "")}/${url}`;
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "X-Retain-Images": "none",
    };
    if (ws.urlReaderKey?.trim()) {
      headers["Authorization"] = `Bearer ${ws.urlReaderKey.trim()}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(target, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[URL Reader] Failed to fetch ${url} (HTTP ${res.status})`);
      return null;
    }

    const text = await res.text();
    // Return clean markdown, truncated to 12000 chars to respect context limits
    return text.slice(0, 12000);
  } catch (err) {
    console.warn(`[URL Reader] Error fetching ${url}:`, err);
    return null;
  }
}

/**
 * Performs real-time web search via Jina Search (or Tavily) and returns formatted Markdown.
 */
export async function performWebSearch(query: string, settings?: WebSearchSettings): Promise<string | null> {
  const ws = settings || loadWebSearchSettings();
  if (ws.searchProvider === "off") return null;

  try {
    if (ws.searchProvider === "jina_search") {
      const host = ws.searchHost?.trim() || "https://s.jina.ai";
      const target = `${host.replace(/\/+$/, "")}/${encodeURIComponent(query)}`;
      const headers: Record<string, string> = {
        Accept: "text/plain",
        "X-Retain-Images": "none",
      };
      if (ws.searchKey?.trim()) {
        headers["Authorization"] = `Bearer ${ws.searchKey.trim()}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(target, { method: "GET", headers, signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const text = await res.text();
      return text.slice(0, 10000);
    } else if (ws.searchProvider === "tavily") {
      const host = ws.searchHost?.trim() || "https://api.tavily.com";
      const target = `${host.replace(/\/+$/, "")}/search`;
      if (!ws.searchKey?.trim()) {
        console.warn("[Web Search] Tavily requires an API key!");
        return null;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: ws.searchKey.trim(),
          query,
          max_results: 3,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const data = await res.json();
      const results = (data.results || []).map((r: any) => `### [${r.title}](${r.url})\n${r.content}`).join("\n\n");
      return results.slice(0, 10000);
    } else if (ws.searchProvider === "brave") {
      const host = ws.searchHost?.trim() || "https://api.search.brave.com/res/v1/web/search";
      const target = `${host.replace(/\/+$/, "")}?q=${encodeURIComponent(query)}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Subscription-Token": ws.searchKey.trim(),
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(target, { method: "GET", headers, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      const webResults = (data.web?.results || []).map((r: any) => `### [${r.title}](${r.url})\n${r.description}`).join("\n\n");
      return webResults.slice(0, 10000);
    } else if (ws.searchProvider === "custom") {
      const host = ws.searchHost?.trim() || "http://localhost:8080";
      const sep = host.includes("?") ? "&" : "?";
      const target = `${host}${sep}q=${encodeURIComponent(query)}&format=json`;
      const headers: Record<string, string> = {
        Accept: "application/json, text/plain",
      };
      if (ws.searchKey?.trim()) {
        headers["Authorization"] = `Bearer ${ws.searchKey.trim()}`;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(target, { method: "GET", headers, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data.results && Array.isArray(data.results)) {
          return data.results.slice(0, 5).map((r: any) => `### [${r.title}](${r.url})\n${r.content || ""}`).join("\n\n");
        }
      } catch {}
      return text.slice(0, 10000);
    }
    return null;
  } catch (err) {
    console.warn(`[Web Search] Error searching for ${query}:`, err);
    return null;
  }
}

/**
 * Dispatches the AI request to the active provider with multi-turn conversation history.
 */
export async function streamAIResponse(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[] = [],
  callbacks: StreamCallbacks
): Promise<void> {
  let effectiveQuery = expandQuickCommand(userQuery, content?.text, passport?.window_title);
  const provider = getActiveProvider();
  const webSettings = loadWebSearchSettings();

  // 1. URL Reader (Cherry Studio Architecture):
  // If query or selection contains URLs, fetch them via Jina Reader/Firecrawl
  if (webSettings.urlReaderProvider !== "off") {
    const rawCombinedText = `${userQuery} ${content?.text || ""}`;
    const detectedUrls = extractUrls(rawCombinedText);
    if (detectedUrls.length > 0) {
      const urlsToFetch = detectedUrls.slice(0, 2);
      for (const targetUrl of urlsToFetch) {
        const fetchedMarkdown = await fetchUrlContent(targetUrl, webSettings);
        if (fetchedMarkdown) {
          effectiveQuery += `\n\n[Web page content from ${targetUrl}]:\n${fetchedMarkdown}`;
        }
      }
    }
  }

  // 2. Web Search Fallback for non-Gemini / non-grounded providers:
  // If user explicitly asks to search or runs /web, and model is NOT using native tools:
  const isExplicitSearch =
    userQuery.toLowerCase().startsWith("/web") ||
    userQuery.toLowerCase().startsWith("/search") ||
    userQuery.toLowerCase().includes("поищи в интернете") ||
    userQuery.toLowerCase().includes("найди в интернете");

  const willUseModelNativeGrounding =
    webSettings.preferModelTools &&
    (provider === "gemini_key" || (provider === "auto" && !content?.jpegBase64));

  if (isExplicitSearch && !willUseModelNativeGrounding && webSettings.searchProvider !== "off") {
    const cleanSearchQuery =
      userQuery.replace(/^\/(?:web|search)\s*/i, "").trim() || content?.text || userQuery;
    const searchResults = await performWebSearch(cleanSearchQuery, webSettings);
    if (searchResults) {
      effectiveQuery += `\n\n[Web Search Results for "${cleanSearchQuery}"]:\n${searchResults}`;
    }
  }

  // 3. MCP Tools Awareness (Active across ALL AI models):
  const mcpPrompt = getActiveMcpServersPrompt();
  if (mcpPrompt) {
    effectiveQuery += mcpPrompt;
  }

  // If active provider does not support vision, safely strip image payloads so API won't fail
  let safeContent = content;
  if (content?.mode === "screenshot" && !isVisionSupported(provider)) {
    safeContent = { mode: "empty" };
  }

  if (provider.startsWith("custom_")) {
    await streamCustomProvider(provider, effectiveQuery, passport, safeContent, history, callbacks);
    return;
  }

  switch (provider) {
    case "auto":
      await streamAutoWithFailover(effectiveQuery, passport, content, history, callbacks);
      break;
    case "gemini_key":
      await streamGemini(effectiveQuery, passport, content, history, callbacks);
      break;
    case "groq_key":
      await streamGroq(effectiveQuery, passport, safeContent, history, callbacks);
      break;
    case "openrouter_key":
      await streamOpenRouter(effectiveQuery, passport, content, history, callbacks);
      break;
    default:
      await streamPublicPool(effectiveQuery, passport, safeContent, history, callbacks);
      break;
  }
}

/**
 * Common system prompt constructor incorporating the Context Passport.
 */
/**
 * Static system prompt prefix that NEVER changes between requests within a session.
 * Crucial for triggering Prompt Caching (KV-Cache reuse) on Gemini, Claude, DeepSeek, and OpenAI.
 */
export function getStaticSystemPrompt(): string {
  return localStorage.getItem("ai_helper_system_prompt") || DEFAULT_SYSTEM_PROMPT;
}

/**
 * Builds the current active user turn payload, prepending the dynamic context passport
 * (process name, window title, environment) and any highlighted text.
 *
 * Placing dynamic context strictly in the final user turn ensures the entire preceding
 * prefix (system prompt + past dialogue turns) remains 100% byte-identical for GPU cache hits!
 */
export function buildActiveUserMessage(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null
): string {
  const parts: string[] = [];

  if (passport) {
    const env = passport.is_wsl
      ? "WSL2 Linux"
      : passport.is_ssh
      ? "SSH Remote"
      : "Windows Native";
    parts.push(`[Active Window Context: ${passport.app_name} (${passport.process_name}) | ${env} | "${passport.window_title}"]`);
  }

  if (content?.mode === "text" && content.text) {
    parts.push(`[Highlighted Text / Code]:\n${content.text}`);
  }

  parts.push(userQuery);
  return parts.join("\n\n");
}

/**
 * ⚡ Smart AUTO Mode with Cascading Failover:
 * - If screenshot captured: routes to Gemini Vision -> OpenRouter Vision -> Public Pool.
 * - If code/text: routes to ultra-fast Groq LPU (~500 tok/s) -> Gemini -> Local -> OpenRouter -> Public Pool.
 * - On 429 Rate Limit, 503, or connection drop: seamlessly cascades to the next candidate.
 */
async function streamAutoWithFailover(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks
): Promise<void> {
  const geminiKey = await getEffectiveApiKey("ai_helper_gemini_api_key", "GEMINI_API_KEY");
  const groqKey = await getEffectiveApiKey("ai_helper_groq_api_key", "GROQ_API_KEY");
  const openRouterKey = await getEffectiveApiKey("ai_helper_openrouter_api_key", "OPENROUTER_API_KEY");
  const localUrl = localStorage.getItem("ai_helper_local_url") || "";

  type Runner = {
    name: string;
    run: (cbs: StreamCallbacks) => Promise<void>;
  };

  const isVision = content?.mode === "screenshot" && !!content.jpegBase64;
  const candidates: Runner[] = [];

  if (isVision) {
    if (geminiKey) {
      candidates.push({
        name: "Google Gemini (Vision)",
        run: (cbs) => streamGemini(userQuery, passport, content, history, cbs, true),
      });
    }
    if (openRouterKey) {
      candidates.push({
        name: "OpenRouter (Vision)",
        run: (cbs) => streamOpenRouter(userQuery, passport, content, history, cbs, true),
      });
    }
    candidates.push({
      name: "Общий бесплатный пул",
      run: (cbs) => streamPublicPool(userQuery, passport, content, history, cbs, true),
    });
  } else {
    if (groqKey) {
      candidates.push({
        name: "Groq Cloud (LPU)",
        run: (cbs) => streamGroq(userQuery, passport, content, history, cbs, true),
      });
    }
    if (geminiKey) {
      candidates.push({
        name: "Google Gemini",
        run: (cbs) => streamGemini(userQuery, passport, content, history, cbs, true),
      });
    }
    if (localUrl) {
      candidates.push({
        name: "Local Offline LLM",
        run: (cbs) => streamCustomLocal(userQuery, passport, content, history, cbs, true),
      });
    }
    if (openRouterKey) {
      candidates.push({
        name: "OpenRouter",
        run: (cbs) => streamOpenRouter(userQuery, passport, content, history, cbs, true),
      });
    }
    const customList = loadCustomProviders();
    customList.forEach((cp) => {
      candidates.push({
        name: cp.name,
        run: (cbs) => streamCustomProvider(cp.id, userQuery, passport, content, history, cbs, true),
      });
    });
    candidates.push({
      name: "Public Pool",
      run: (cbs) => streamPublicPool(userQuery, passport, content, history, cbs, true),
    });
  }

  let lastError = "";

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let candidateHasReceivedChunks = false;
    let candidateError = "";

    const interceptedCallbacks: StreamCallbacks = {
      onChunk: (text) => {
        candidateHasReceivedChunks = true;
        callbacks.onChunk(text);
      },
      onTokensUpdate: callbacks.onTokensUpdate,
      onError: (errMsg) => {
        candidateError = errMsg;
      },
      onFinish: (fullText, tokens, modelUsed, quotaInfo) => {
        callbacks.onFinish(fullText, tokens, modelUsed, quotaInfo);
      },
    };

    try {
      await candidate.run(interceptedCallbacks);
      if (!candidateError && candidateHasReceivedChunks) {
        return;
      }
    } catch (err: any) {
      candidateError = err.message || String(err);
    }

    if (candidateHasReceivedChunks) {
      if (candidateError) callbacks.onError(candidateError);
      return;
    }

    lastError = candidateError || "Ошибка провайдера";
    console.warn(`[AI Helper AUTO Router] ${candidate.name} failed: ${lastError}. Cascading to next candidate...`);
  }

  callbacks.onError(`Все провайдеры в цепочке недоступны. Последняя ошибка: ${lastError}`);
}

/**
 * 1. Zero-config Public Pool (Pollinations AI).
 */
async function streamPublicPool(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks,
  isAuto = false
): Promise<void> {
  const systemText = getStaticSystemPrompt();
  const userText = buildActiveUserMessage(userQuery, passport, content);

  const modelName = "openai-fast";
  const supportsVision = isVisionSupported("public_pool", modelName);
  const priorMessages = history.slice(-16).map((m) => {
    if (m.image && supportsVision) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const endpoint = "https://text.pollinations.ai/openai/chat/completions";
  const userContent: any[] = [{ type: "text", text: userText }];
  if (content?.mode === "screenshot" && content.jpegBase64 && supportsVision) {
    const imgUrl = content.jpegBase64.startsWith("data:")
      ? content.jpegBase64
      : `data:image/jpeg;base64,${content.jpegBase64}`;
    userContent.push({
      type: "image_url",
      image_url: { url: imgUrl },
    });
  }

  const body = {
    model: modelName,
    messages: [
      { role: "system", content: systemText },
      ...priorMessages,
      { role: "user", content: userContent },
    ],
    stream: true,
  };

  const displayName = isAuto ? `⚡ АВТО ➔ Открытый пул (${modelName})` : `Открытый пул (${modelName})`;
  await streamOpenAICompatible(endpoint, body, "", "public_pool", modelName, displayName, callbacks);
}

/**
 * 2. Groq Cloud (Ultra-fast LPU, dynamic live-discovered model).
 */
async function streamGroq(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks,
  isAuto = false
): Promise<void> {
  const apiKey = await getEffectiveApiKey("ai_helper_groq_api_key", "GROQ_API_KEY");
  if (!apiKey) {
    callbacks.onError("Ключ Groq не задан. Вставьте ключ в Настройках или переключитесь на общий пул.");
    return;
  }

  const model = localStorage.getItem("ai_helper_groq_model") || "llama-3.3-70b-versatile";
  const systemText = getStaticSystemPrompt();
  const userText = buildActiveUserMessage(userQuery, passport, content);

  const supportsVision = isVisionSupported("groq", model);
  const priorMessages = history.slice(-16).map((m) => {
    if (m.image && supportsVision) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const body = {
    model: model,
    messages: [
      { role: "system", content: systemText },
      ...priorMessages,
      { role: "user", content: userText },
    ],
    stream: true,
  };

  const displayName = isAuto ? `⚡ АВТО ➔ Groq LPU (${model.split("-")[0]})` : `Groq LPU (${model})`;
  await streamOpenAICompatible(endpoint, body, apiKey, "groq_key", model, displayName, callbacks);
}

/**
 * 3. OpenRouter (Zero-cost free catalog with vision support).
 */
async function streamOpenRouter(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks,
  isAuto = false
): Promise<void> {
  const apiKey = await getEffectiveApiKey("ai_helper_openrouter_api_key", "OPENROUTER_API_KEY");
  if (!apiKey) {
    callbacks.onError("Ключ OpenRouter не задан. Вставьте ключ в Настройках или выберите общий пул.");
    return;
  }

  const model = localStorage.getItem("ai_helper_openrouter_model") || "openrouter/free";
  const systemText = getStaticSystemPrompt();

  const supportsVision = isVisionSupported("openrouter_key", model);
  const priorMessages = history.slice(-16).map((m) => {
    if (m.image && supportsVision) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const messages: any[] = [{ role: "system", content: systemText }, ...priorMessages];

  if (content?.mode === "screenshot" && content.jpegBase64 && supportsVision) {
    const activeText = buildActiveUserMessage(userQuery, passport, null);
    const imgUrl = content.jpegBase64.startsWith("data:")
      ? content.jpegBase64
      : `data:image/jpeg;base64,${content.jpegBase64}`;
    messages.push({
      role: "user",
      content: [
        { type: "text", text: activeText },
        {
          type: "image_url",
          image_url: {
            url: imgUrl,
          },
        },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: buildActiveUserMessage(userQuery, passport, content),
    });
  }

  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: model,
    messages: messages,
    stream: true,
  };

  const shortName = model.split("/").pop()?.replace(":free", "") || model;
  const displayName = isAuto ? `⚡ АВТО ➔ OpenRouter (${shortName})` : `OpenRouter (${shortName})`;

  await streamOpenAICompatible(
    endpoint,
    body,
    apiKey,
    "openrouter_key",
    model,
    displayName,
    callbacks,
    {
      "HTTP-Referer": "https://github.com/ai-helper-desktop",
      "X-Title": "AI Helper Desktop",
    }
  );
}

/**
 * 4. Google AI Studio (Dynamic live-discovered model, e.g. gemini-2.0-flash).
 */
async function streamGemini(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks,
  isAuto = false
): Promise<void> {
  const apiKey = await getEffectiveApiKey("ai_helper_gemini_api_key", "GEMINI_API_KEY");
  if (!apiKey) {
    callbacks.onError("Ключ Google AI Studio не задан. Вставьте ключ в Настройках или выберите общий пул.");
    return;
  }

  const model = localStorage.getItem("ai_helper_gemini_model") || "gemini-2.0-flash";
  const systemInstructionText = getStaticSystemPrompt();

  const priorContents = history.slice(-16).map((m) => {
    const parts: any[] = [];
    if (m.image) {
      const cleanBase64 = m.image.replace(/^data:image\/[a-z]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanBase64,
        },
      });
    }
    parts.push({ text: m.content });
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });

  const activeText = buildActiveUserMessage(
    userQuery,
    passport,
    content?.mode === "text" ? content : null
  );

  const currentParts: any[] = [{ text: activeText }];

  const supportsVision = isVisionSupported("gemini_key", model);
  if (content?.mode === "screenshot" && content.jpegBase64 && supportsVision) {
    const rawBase64 = content.jpegBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    currentParts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: rawBase64,
      },
    });
  }

  const contents = [
    ...priorContents,
    {
      role: "user",
      parts: currentParts,
    },
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;

  const webSettings = loadWebSearchSettings();
  const requestPayload: any = {
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    contents,
  };

  // Google Search Grounding: if enabled and search provider is not turned off
  if (webSettings.preferModelTools && webSettings.searchProvider !== "off") {
    requestPayload.tools = [{ googleSearch: {} }];
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      callbacks.onError(`Gemini API (${response.status}): ${errText.slice(0, 160)}`);
      return;
    }

    if (!response.body) {
      callbacks.onError("Пустой ответ от сервера.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let accumulatedText = "";
    let buffer = "";
    let totalTokens = 0;
    let promptTokens = 0;
    let candidateTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            const candidateParts = data.candidates?.[0]?.content?.parts;
            if (candidateParts) {
              for (const p of candidateParts) {
                if (p.text) {
                  accumulatedText += p.text;
                  callbacks.onChunk(p.text);
                }
              }
            }

            if (data.usageMetadata) {
              promptTokens = data.usageMetadata.promptTokenCount || promptTokens;
              candidateTokens = data.usageMetadata.candidatesTokenCount || candidateTokens;
              totalTokens = data.usageMetadata.totalTokenCount || promptTokens + candidateTokens;
              callbacks.onTokensUpdate(promptTokens, candidateTokens, totalTokens);
            }
          } catch {}
        }
      }
    }

    // Record usage in telemetries
    const usage = recordUsage("gemini_key", model, totalTokens, promptTokens, candidateTokens);

    const isVision = content?.mode === "screenshot" && !!content.jpegBase64;
    const modelLabel = `${model}${isVision ? " [📷 Vision]" : ""}`;
    const displayName = isAuto ? `⚡ АВТО ➔ Google Gemini (${modelLabel})` : `Google Gemini (${modelLabel})`;
    localStorage.setItem("ai_helper_last_executed_model", displayName);

    const quotaInfo: ProviderQuotaInfo = {
      provider: "gemini_key",
      model: model,
      displayName: displayName,
      requestsToday: usage.requestsToday,
      requestsHour: usage.requestsHour,
      tokensToday: usage.tokensToday,
      tokensHour: usage.tokensHour,
      tokensLastRequest: totalTokens,
      promptTokensLastRequest: promptTokens,
      candidateTokensLastRequest: candidateTokens,
    };

    callbacks.onFinish(accumulatedText, totalTokens, displayName, quotaInfo);
  } catch (err: any) {
    callbacks.onError(`Ошибка API: ${err.message || err}`);
  }
}

/**
 * 5. Local / Custom Offline LLM (Ollama, LM Studio, vLLM, etc.)
 */
async function streamCustomLocal(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks,
  isAuto = false
): Promise<void> {
  const baseUrl = (localStorage.getItem("ai_helper_local_url") || "http://localhost:11434/v1").replace(/\/+$/, "");
  const model = localStorage.getItem("ai_helper_local_model") || "llama3";
  const systemText = getStaticSystemPrompt();
  const userText = buildActiveUserMessage(userQuery, passport, content);

  const supportsVision = isVisionSupported("custom_local", model);
  const priorMessages = history.slice(-16).map((m) => {
    if (m.image && supportsVision) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: model,
    messages: [
      { role: "system", content: systemText },
      ...priorMessages,
      { role: "user", content: userText },
    ],
    stream: true,
  };

  const apiKey = localStorage.getItem("ai_helper_local_key") || "";
  const displayName = isAuto ? `⚡ АВТО ➔ 🖥️ Local (${model})` : `🖥️ Local (${model})`;
  await streamOpenAICompatible(endpoint, body, apiKey, "custom_local", model, displayName, callbacks);
}

/**
 * Universal runner for user-defined custom OpenAI-compatible providers.
 */
async function streamCustomProvider(
  providerId: string,
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks,
  isAuto = false
): Promise<void> {
  const list = loadCustomProviders();
  const cp = list.find((c) => c.id === providerId);
  if (!cp) {
    callbacks.onError(`Provider ${providerId} not found in configuration`);
    return;
  }

  const baseUrl = cp.baseUrl.replace(/\/+$/, "");
  const model = localStorage.getItem(`ai_helper_model_${providerId}`) || "default";
  const systemText = getStaticSystemPrompt();
  const userText = buildActiveUserMessage(userQuery, passport, content);

  const supportsVision = isVisionSupported(providerId, model);
  const priorMessages = history.slice(-16).map((m) => {
    if (m.image && supportsVision) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: model,
    messages: [
      { role: "system", content: systemText },
      ...priorMessages,
      { role: "user", content: userText },
    ],
    stream: true,
  };

  const displayName = isAuto ? `⚡ АВТО ➔ 🖥️ ${cp.name} (${model})` : `🖥️ ${cp.name} (${model})`;
  await streamOpenAICompatible(endpoint, body, cp.apiKey || "", providerId, model, displayName, callbacks);
}

/**
 * Universal SSE reader for any standard OpenAI-compatible endpoint.
 */
async function streamOpenAICompatible(
  endpoint: string,
  body: any,
  apiKey: string,
  provider: ProviderType,
  modelName: string,
  displayName: string,
  callbacks: StreamCallbacks,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      let msg = `Ошибка HTTP ${response.status}: ${response.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) msg = errJson.error.message;
      } catch {}
      callbacks.onError(msg);
      return;
    }

    // Capture live hardware headers from provider (Groq / OpenRouter)
    let remainingRequestsHeader = response.headers.get("x-ratelimit-remaining-requests");
    let remainingTokensHeader = response.headers.get("x-ratelimit-remaining-tokens");
    let resetRequestsHeader = response.headers.get("x-ratelimit-reset-requests");
    let resetTokensHeader = response.headers.get("x-ratelimit-reset-tokens");

    if (!response.body) {
      callbacks.onError("Пустой ответ от сервера.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let accumulatedText = "";
    let buffer = "";
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let exactTotalTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedText += delta;
              callbacks.onChunk(delta);
              const est = Math.max(1, Math.round(accumulatedText.length / 3.6));
              callbacks.onTokensUpdate(0, est, est);
            }

            // If provider provides exact usage object in chunk (OpenAI/Groq/OpenRouter standard)
            if (data.usage) {
              totalPromptTokens = data.usage.prompt_tokens || totalPromptTokens;
              totalCompletionTokens = data.usage.completion_tokens || totalCompletionTokens;
              exactTotalTokens = data.usage.total_tokens || totalPromptTokens + totalCompletionTokens;
              callbacks.onTokensUpdate(totalPromptTokens, totalCompletionTokens, exactTotalTokens);
            }
          } catch {}
        }
      }
    }

    const finalTokens = exactTotalTokens > 0 ? exactTotalTokens : Math.max(1, Math.round(accumulatedText.length / 3.6));
    const usage = recordUsage(provider, modelName, finalTokens, totalPromptTokens, totalCompletionTokens);

    localStorage.setItem("ai_helper_last_executed_model", displayName);

    const quotaInfo: ProviderQuotaInfo = {
      provider: provider,
      model: modelName,
      displayName: displayName,
      requestsToday: usage.requestsToday,
      requestsHour: usage.requestsHour,
      tokensToday: usage.tokensToday,
      tokensHour: usage.tokensHour,
      tokensLastRequest: finalTokens,
      promptTokensLastRequest: totalPromptTokens,
      candidateTokensLastRequest: totalCompletionTokens,
      remainingRequestsHeader: remainingRequestsHeader || undefined,
      remainingTokensHeader: remainingTokensHeader || undefined,
      resetRequestsHeader: resetRequestsHeader || undefined,
      resetTokensHeader: resetTokensHeader || undefined,
    };

    callbacks.onFinish(accumulatedText, finalTokens, displayName, quotaInfo);
  } catch (err: any) {
    callbacks.onError(`Ошибка соединения: ${err.message || err}`);
  }
}
