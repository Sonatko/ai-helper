# AI Helper — Native Windows 11 AI Assistant

> **Ultra-lightweight, zero-latency desktop AI assistant built in Rust (Tauri v2) and TypeScript.**
> Integrates directly with Windows 11 via native Win32 APIs, providing instant multi-modal context capture, multi-turn conversational memory in SQLite, live web search, and Model Context Protocol (MCP) tooling.

---

## ⚡ The Core Philosophy: "Golden Context Triad"

Unlike browser-based ChatGPT or heavy Electron apps that break your flow, AI Helper gathers full context automatically in under 4 milliseconds:

$$\text{AI Packet} = \mathbf{Context\ Passport} + \mathbf{Content} + \mathbf{Prompt}$$

1. **Context Passport (Win32 Metadata):** Foreground process name (`code.exe`, `windowsterminal.exe`), window title, and runtime environment (WSL2 Ubuntu, SSH, or Windows Native).
2. **Dynamic Content:**
   - **Smart Selection:** Copies highlighted code/text safely using Windows CUA `Ctrl+Insert` without terminating terminal processes (`SIGINT`).
   - **Hardware BitBlt Capture:** If nothing is highlighted, captures an in-memory hardware screenshot via Win32 GDI in 2–3 ms without DirectX overhead.
   - **Precision Snipping (Alt+F7):** Freezes the screen in RAM and lets you crop a specific UI region with real-time coordinate snapping.
3. **User Prompt:** Compact single-line input capsule (`60px`) floating on screen, expanding dynamically as responses stream in.

---

## 🌟 Key Features

- **⚡ Zero-Lag Hotkey Pipeline:** Window appears on screen in $\le 4$ ms. JPEG compression and base64 encoding run asynchronously on background threads.
- **🧠 Multi-Turn Conversational Memory:** Local embedded SQLite database operating in ACID WAL-mode (*Write-Ahead Logging*). Seamless thread history with keyboard navigation (`Ctrl+H`, `Ctrl+[`, `Ctrl+]`).
- **🔍 Live Web Search & Markdown URL Reader:**
  - Jina Search & Jina Reader: zero API keys required for free live web retrieval.
  - Tavily, Brave Search, ExaMCP, Firecrawl, Defuddle, and custom proxy endpoints.
- **🛒 Cherry Studio Style MCP Architecture:**
  - 1-Click marketplace for Model Context Protocol servers (`Web Fetch`, `Local Filesystem`, `GitHub Explorer`, `Brave Search`, `SQLite`, `Memory Graph`).
  - Native Win32 `ShellExecute` launcher for external registries (`Smithery.ai`, `Glama.ai`, `Official MCP`).
  - Automatic tool manifest injection into prompts for any model.
- **🤖 Universal Model Support:**
  - **Google Gemini API:** Native vision & streaming (`gemini-2.0-flash`, `gemini-2.5-flash`).
  - **Groq Cloud:** Ultra-fast LPU inference (~500 tokens/sec) on Llama 3.3 70B.
  - **OpenRouter Free Tier:** Curated zero-cost open-source models.
  - **Local Models:** Connects directly to local Ollama (`http://localhost:11434/v1`) or LM Studio.
  - **Auto Router:** Automatically detects screenshots and routes to vision models, with fallback on rate limits (HTTP 429).
- **🛡️ 100% Local Privacy:**
  - Zero cloud telemetry.
  - API keys and tokens are stored exclusively in the local browser `localStorage` on your machine.
  - Database stored locally in Windows `AppData`.

---

## ⌨️ Global Shortcuts

> All global shortcuts can be fully customized with your preferred key combinations in **AI Settings → Hotkeys**.

| Shortcut | Default Binding | Action |
| :--- | :--- | :--- |
| **Smart Summon** | `F7` (or custom: `Alt+Space`, `Ctrl+Space`, etc.) | Captures active window context (selection or screenshot) and summons assistant. |
| **Precision Snipping** | `Alt + F7` (or custom: `Ctrl+Shift+S`, `Alt+S`, etc.) | Freezes desktop in RAM and reveals interactive region crop overlay. |
| **Hide / Collapse** | `Escape` | 1st press collapses response / closes dialogs; 2nd press completely hides assistant. |
| **History Menu** | `Ctrl + H` | Toggles multi-turn thread history menu. |
| **Cycle Threads** | `Ctrl + [` / `Ctrl + ]` | Fast-cycles through previous conversation threads. |
| **Send Query** | `Enter` | Sends prompt (handles IME composition cleanly for international keyboards). |

---

## 🚀 Quick Slash Commands

Type `/` in the input capsule to trigger quick context templates:
- `/tr` — Translate highlighted text to Russian (preserves code & technical terms).
- `/fix` — Diagnose error logs, stack traces, and provide drop-in code fixes.
- `/sum` — Summarize content into 3–5 actionable bullet points.
- `/explain` — Explain complex algorithms or concepts simply.
- `/improve` — Enhance clarity, grammar, and professional tone.
- `/web` — Live web search for up-to-date documentation.

---

## 🛠️ Build & Installation

### Prerequisites
- **Node.js** $\ge 18$
- **Rust** $\ge 1.75$ (`rustup default stable`)
- **Windows 10 / 11**

### Development Mode
```powershell
# 1. Install frontend dependencies
npm install --prefix frontend

# 2. Launch live development environment with Vite HMR + Rust compilation
npm run tauri dev
```

### Production Release Build
```powershell
# Build standalone lightweight native Windows binary
npm run tauri build
```
The compiled executable installer will be generated in `src-tauri/target/release/bundle/msi/`.

---

## 📄 License
MIT License. Free for personal and commercial open-source use.

