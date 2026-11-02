import { DEFAULT_SYSTEM_PROMPT, recordUsage } from "./settings";
import type { WindowPassport } from "./main";
import type { ProviderType } from "./settings";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onTokensUpdate: (promptTokens: number, candidateTokens: number, totalTokens: number) => void;
  onError: (errorMessage: string) => void;
  onFinish: (fullText: string, totalTokens: number) => void;
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
 * Generates an informative UI badge showing the active provider and model.
 */
export function getProviderBadge(): string {
  const provider = getActiveProvider();
  switch (provider) {
    case "auto": {
      const hasGemini = !!(
        localStorage.getItem("ai_helper_gemini_api_key") ||
        (import.meta.env.VITE_GEMINI_API_KEY as string)
      );
      const hasGroq = !!localStorage.getItem("ai_helper_groq_api_key");
      const hasOpenRouter = !!(
        localStorage.getItem("ai_helper_openrouter_api_key") ||
        (import.meta.env.VITE_OPENROUTER_API_KEY as string)
      );
      const parts = [];
      if (hasGroq) parts.push("Groq");
      if (hasGemini) parts.push("Gemini");
      if (hasOpenRouter) parts.push("OpenRouter");
      const chain = parts.length > 0 ? parts.join(" + ") : "Умный роутер";
      return `⚡ АВТО (${chain})`;
    }
    case "gemini_key": {
      const model = localStorage.getItem("ai_helper_gemini_model") || "gemini-2.0-flash";
      return `Google AI Studio (${model})`;
    }
    case "groq_key": {
      const model = localStorage.getItem("ai_helper_groq_model") || "llama-3.3-70b";
      const short = model.split("-")[0] || model;
      return `Groq LPU (${short})`;
    }
    case "openrouter_key": {
      const model = localStorage.getItem("ai_helper_openrouter_model") || "openrouter/free";
      const shortName = model.split("/").pop()?.replace(":free", "") || model;
      return `OpenRouter (${shortName})`;
    }
    case "custom_local": {
      const model = localStorage.getItem("ai_helper_local_model") || "Локальная модель";
      return `🖥️ Local (${model})`;
    }
    default:
      return "Общий бесплатный пул";
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
  const provider = getActiveProvider();

  switch (provider) {
    case "auto":
      await streamAutoWithFailover(userQuery, passport, content, history, callbacks);
      break;
    case "gemini_key":
      await streamGemini(userQuery, passport, content, history, callbacks);
      break;
    case "groq_key":
      await streamGroq(userQuery, passport, content, history, callbacks);
      break;
    case "openrouter_key":
      await streamOpenRouter(userQuery, passport, content, history, callbacks);
      break;
    case "custom_local":
      await streamCustomLocal(userQuery, passport, content, history, callbacks);
      break;
    default:
      await streamPublicPool(userQuery, passport, content, history, callbacks);
      break;
  }
}

/**
 * Common system prompt constructor incorporating the Context Passport.
 */
function buildSystemInstruction(passport: WindowPassport | null): string {
  const basePrompt = localStorage.getItem("ai_helper_system_prompt") || DEFAULT_SYSTEM_PROMPT;
  if (!passport) return basePrompt;
  return (
    `${basePrompt}\n` +
    `[Паспорт приложения пользователя]\n` +
    `- Программа: ${passport.app_name} (${passport.process_name})\n` +
    `- Заголовок окна: ${passport.window_title}\n` +
    `- Среда: ${passport.is_wsl ? "WSL2 (Linux)" : passport.is_ssh ? "SSH" : "Windows Native"}`
  );
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
  const geminiKey =
    localStorage.getItem("ai_helper_gemini_api_key") ||
    (import.meta.env.VITE_GEMINI_API_KEY as string) ||
    "";
  const groqKey = localStorage.getItem("ai_helper_groq_api_key") || "";
  const openRouterKey =
    localStorage.getItem("ai_helper_openrouter_api_key") ||
    (import.meta.env.VITE_OPENROUTER_API_KEY as string) ||
    "";
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
        run: (cbs) => streamGemini(userQuery, passport, content, history, cbs),
      });
    }
    if (openRouterKey) {
      candidates.push({
        name: "OpenRouter (Vision)",
        run: (cbs) => streamOpenRouter(userQuery, passport, content, history, cbs),
      });
    }
    candidates.push({
      name: "Общий бесплатный пул",
      run: (cbs) => streamPublicPool(userQuery, passport, content, history, cbs),
    });
  } else {
    if (groqKey) {
      candidates.push({
        name: "Groq Cloud (LPU)",
        run: (cbs) => streamGroq(userQuery, passport, content, history, cbs),
      });
    }
    if (geminiKey) {
      candidates.push({
        name: "Google Gemini",
        run: (cbs) => streamGemini(userQuery, passport, content, history, cbs),
      });
    }
    if (localUrl) {
      candidates.push({
        name: "Local Offline LLM",
        run: (cbs) => streamCustomLocal(userQuery, passport, content, history, cbs),
      });
    }
    if (openRouterKey) {
      candidates.push({
        name: "OpenRouter",
        run: (cbs) => streamOpenRouter(userQuery, passport, content, history, cbs),
      });
    }
    candidates.push({
      name: "Общий бесплатный пул",
      run: (cbs) => streamPublicPool(userQuery, passport, content, history, cbs),
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
      onFinish: (fullText, tokens) => {
        callbacks.onFinish(fullText, tokens);
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
  callbacks: StreamCallbacks
): Promise<void> {
  const systemText = buildSystemInstruction(passport);
  let userText = userQuery;
  if (content?.mode === "text" && content.text) {
    userText = `[Выделенный код / ошибка]:\n${content.text}\n\n[Вопрос]: ${userQuery}`;
  }

  const priorMessages = history.slice(-8).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const endpoint = "https://text.pollinations.ai/openai/chat/completions";
  const body = {
    model: "openai-fast",
    messages: [
      { role: "system", content: systemText },
      ...priorMessages,
      { role: "user", content: userText },
    ],
    stream: true,
  };

  await streamOpenAICompatible(endpoint, body, "", callbacks);
}

/**
 * 2. Groq Cloud (Ultra-fast LPU, dynamic live-discovered model).
 */
async function streamGroq(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks
): Promise<void> {
  const apiKey = localStorage.getItem("ai_helper_groq_api_key") || "";
  if (!apiKey) {
    callbacks.onError("Ключ Groq не задан. Вставьте ключ в Настройках или переключитесь на общий пул.");
    return;
  }

  const model = localStorage.getItem("ai_helper_groq_model") || "llama-3.3-70b-versatile";
  const systemText = buildSystemInstruction(passport);
  let userText = userQuery;
  if (content?.mode === "text" && content.text) {
    userText = `[Выделенный код]:\n${content.text}\n\n[Вопрос]: ${userQuery}`;
  }

  const priorMessages = history.slice(-8).map((m) => ({
    role: m.role,
    content: m.content,
  }));

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

  await streamOpenAICompatible(endpoint, body, apiKey, callbacks);
}

/**
 * 3. OpenRouter (Zero-cost free catalog with vision support).
 */
async function streamOpenRouter(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks
): Promise<void> {
  const apiKey =
    localStorage.getItem("ai_helper_openrouter_api_key") ||
    (import.meta.env.VITE_OPENROUTER_API_KEY as string) ||
    "";
  if (!apiKey) {
    callbacks.onError("Ключ OpenRouter не задан. Вставьте ключ в Настройках или выберите общий пул.");
    return;
  }

  const model = localStorage.getItem("ai_helper_openrouter_model") || "openrouter/free";
  const systemText = buildSystemInstruction(passport);

  const priorMessages = history.slice(-8).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages: any[] = [{ role: "system", content: systemText }, ...priorMessages];

  if (content?.mode === "screenshot" && content.jpegBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userQuery },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${content.jpegBase64}`,
          },
        },
      ],
    });
  } else if (content?.mode === "text" && content.text) {
    messages.push({
      role: "user",
      content: `[Выделенный фрагмент]:\n${content.text}\n\n[Вопрос]: ${userQuery}`,
    });
  } else {
    messages.push({
      role: "user",
      content: userQuery,
    });
  }

  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: model,
    messages: messages,
    stream: true,
  };

  await streamOpenAICompatible(endpoint, body, apiKey, callbacks, {
    "HTTP-Referer": "https://github.com/ai-helper-desktop",
    "X-Title": "AI Helper Desktop",
  });
}

/**
 * 4. Google AI Studio (Dynamic live-discovered model, e.g. gemini-2.0-flash).
 */
async function streamGemini(
  userQuery: string,
  passport: WindowPassport | null,
  content: CapturedContentPayload | null,
  history: HistoryMessage[],
  callbacks: StreamCallbacks
): Promise<void> {
  const apiKey =
    localStorage.getItem("ai_helper_gemini_api_key") ||
    (import.meta.env.VITE_GEMINI_API_KEY as string) ||
    "";
  if (!apiKey) {
    callbacks.onError("Ключ Google AI Studio не задан. Вставьте ключ в Настройках или выберите общий пул.");
    return;
  }

  const model = localStorage.getItem("ai_helper_gemini_model") || "gemini-2.0-flash";
  const systemInstructionText = buildSystemInstruction(passport);

  const priorContents = history.slice(-8).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const currentParts: any[] = [];
  if (content?.mode === "text" && content.text) {
    currentParts.push({
      text: `[Выделенный фрагмент кода / ошибки]:\n${content.text}\n\n[Вопрос пользователя]: ${userQuery}`,
    });
  } else {
    currentParts.push({ text: userQuery });
  }

  if (content?.mode === "screenshot" && content.jpegBase64) {
    currentParts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: content.jpegBase64,
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

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents,
      }),
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
              const pTokens = data.usageMetadata.promptTokenCount || 0;
              const cTokens = data.usageMetadata.candidatesTokenCount || 0;
              totalTokens = data.usageMetadata.totalTokenCount || pTokens + cTokens;
              callbacks.onTokensUpdate(pTokens, cTokens, totalTokens);
            }
          } catch {}
        }
      }
    }

    recordUsage(totalTokens);
    callbacks.onFinish(accumulatedText, totalTokens);
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
  callbacks: StreamCallbacks
): Promise<void> {
  const baseUrl = (localStorage.getItem("ai_helper_local_url") || "http://localhost:11434/v1").replace(/\/+$/, "");
  const model = localStorage.getItem("ai_helper_local_model") || "llama3";
  const systemText = buildSystemInstruction(passport);

  let userText = userQuery;
  if (content?.mode === "text" && content.text) {
    userText = `[Выделенный фрагмент]:\n${content.text}\n\n[Вопрос]: ${userQuery}`;
  }

  const priorMessages = history.slice(-8).map((m) => ({
    role: m.role,
    content: m.content,
  }));

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

  await streamOpenAICompatible(endpoint, body, "", callbacks);
}

/**
 * Universal SSE reader for any standard OpenAI-compatible endpoint.
 */
async function streamOpenAICompatible(
  endpoint: string,
  body: any,
  apiKey: string,
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

    if (!response.body) {
      callbacks.onError("Пустой ответ от сервера.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let accumulatedText = "";
    let buffer = "";

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
              const estTokens = Math.max(1, Math.round(accumulatedText.length / 3.6));
              callbacks.onTokensUpdate(0, estTokens, estTokens);
            }
          } catch {}
        }
      }
    }

    const totalEstTokens = Math.max(1, Math.round(accumulatedText.length / 3.6));
    recordUsage(totalEstTokens);
    callbacks.onFinish(accumulatedText, totalEstTokens);
  } catch (err: any) {
    callbacks.onError(`Ошибка соединения: ${err.message || err}`);
  }
}
