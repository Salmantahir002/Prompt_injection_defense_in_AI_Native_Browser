# Process Architecture — Who Owns What, Who Talks to Whom

Companion to `ARCHITECTURE.md` (which covers the full feature/security design).
This file answers one narrower question: **which of the four running
processes owns each piece of code, and what channel connects each pair of
them.** It reflects the current implementation, after guest page hosting was
migrated from a renderer-owned `<webview>` tag to a main-process-owned
`WebContentsView`.

## The four processes

```
┌───────────────────────────────┐        IPC over        ┌───────────────────────────────────┐
│   RENDERER PROCESS (React)     │◄──────contextBridge────►│   ELECTRON MAIN PROCESS (Node)     │
│   frontend/src/                │      window.electronAPI │   frontend/electron/               │
│                                 │                          │                                     │
│  - Browser shell UI (tabs,     │                          │  - BrowserWindow + WebContentsView  │
│    toolbar, address bar)       │                          │    per tab (owns the guest page)    │
│  - Kimo assistant (Chat/Agent) │                          │  - Browser Runtime (CDP driver)     │
│  - Agent loop orchestration    │                          │  - CDP inspection (Scan Page)       │
│  - Explainability drawers      │                          │  - Provider secure storage           │
│  - Empty <div> per tab — the   │                          │  - Backend process lifecycle         │
│    actual page renders here,   │                          │  - Context menu, window chrome       │
│    composited by main, not     │                          │                                     │
│    part of this DOM tree       │                          │                                     │
└───────────────┬─────────────────┘                          └───────────────┬─────────────────────┘
                │                                                              │
                │ HTTP (fetch, loopback)                                       │ spawns + owns lifecycle
                │ port 8000                                                    │ (child_process.spawn)
                │                                                              │ + pushes active provider
                ▼                                                              ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    BACKEND PROCESS (Node.js + Fastify) — backend-node/            │
│  - Prompt/webpage security classification (rule-based + optional ONNX)            │
│  - Multi-provider LLM gateway (OpenAI-compatible / Anthropic / Gemini)            │
│  - Agent planning endpoint                                                        │
│  - No browser control, no Electron API access — plain HTTP server                 │
└───────────────────────────────────────────────────────────────────────────────────┘

Electron Main also drives a fourth thing directly — not a separate OS process
tree in the Node sense, but a separate Chromium renderer sandboxed from both
the app's own renderer and from Node:

┌───────────────────────────────────────────┐
│  GUEST WEB CONTENT (per browser tab)       │
│  A Chromium WebContents owned by Main,     │
│  positioned over the empty container div   │
│  in the React UI. Main reaches it directly │
│  via the WebContentsView/webContents API   │
│  (loadURL, navigationHistory, executeJava- │
│  Script) and via CDP (debugger.attach) for │
│  everything the Browser Runtime and the    │
│  security scanner need.                    │
└─────────────────────────────────────────────┘
```

---

## 1. Renderer process — React UI (`frontend/src/`)

Everything here runs sandboxed, with **no Node access** (`contextIsolation:
true`, `nodeIntegration: false`). It never touches a file, spawns a process,
or holds an LLM API key. It knows the *shape* of a browsed page only through
what Main chooses to send it over IPC or HTTP.

| Owns | Files |
| :--- | :--- |
| Tab/shell state, address bar, navigation buttons | `App.tsx` (`BrowserShell`), `components/BrowserToolbar.tsx` |
| The empty per-tab mount point the guest page is composited over | `components/BrowserWebView.tsx` — no `<webview>` tag; a plain `<div>` whose bounds are pushed to Main |
| Kimo assistant (Chat + Agent modes), explainability drawers, provider settings UI | `components/AiAssistantSidebar.tsx`, `AgentModePanel.tsx`, `ProviderSettingsModal.tsx`, `*AnalysisDetailsPanel.tsx` |
| Agent loop orchestration (plan → gate → execute → verify) | `services/agentRuntimeCore.ts`, `agentCircuitBreaker.ts`, `agentSecurityPipeline.ts`, `agentRecoveryEngine.ts` |
| Talking to the backend | `services/backendApiClient.ts`, `providerApiClient.ts`, `agentApiClient.ts` |
| Talking to Main | `services/browserRuntime.ts` (Browser Runtime facade) + direct `window.electronAPI.browser.*` calls from `BrowserWebView.tsx` |

The renderer never imports Electron's `webContents`/CDP APIs and never
receives a webpage's DOM directly — it only gets a `webContentsId` (a plain
number) to hand back to Main on every subsequent call, and typed results
(security verdicts, AXTree snapshots) that Main or the backend already
computed.

## 2. Electron Main process (`frontend/electron/`)

Runs with full Node access. Owns every native/OS-level resource: the window,
every tab's actual web content, the CDP connection to each tab, encrypted
credential storage, and the backend child process.

| Owns | Files |
| :--- | :--- |
| Window + one `WebContentsView` per browser tab, keyed by `webContents.id` | `main.ts` (`tabViews` map, `browser:create-tab`/`close-tab`/`navigate`/`go-back`/`go-forward`/`reload` handlers) |
| Pushing new tab-content event notifications (loading, navigate, fail) to the renderer | `main.ts` (`attachGuestBehaviour`, `browser:tab-event`) |
| The context-isolated IPC bridge and channel allow-list | `preload.ts` |
| Hardened webPreferences (no `<webview>` tag, no remote module, navigation restrictions) | `electronSecurityConfig.ts` |
| Browser Runtime — the only path that drives a guest page (native CDP input, AXTree extraction, verification) | `browserRuntime/*.ts` (`browserRuntime.ts`, `cdpSession.ts`, `pageInspector.ts`, `stateBuilder.ts`, `elementResolver.ts`, `nativeInput.ts`, `waitEngine.ts`, `verificationEngine.ts`) |
| Deep CDP content capture behind the manual "Scan Page" button | `cdpInspectionService.ts` |
| Native right-click context menu for guest tabs | `webviewContextMenu.ts` |
| Encrypted LLM provider credential storage (OS `safeStorage`) | `providerSecureStore.ts` |
| Spawning, health-checking, and killing the backend process | `backendProcess.ts` |

Main is also the only process that ever calls Chromium's own guest-content
API directly — `view.webContents.loadURL()`, `navigationHistory`,
`executeJavaScript()`, and `debugger.attach()` all run here, never in the
renderer. This is exactly the "Direct chromium API" arrow in the target
diagram: nothing about a tab's actual content crosses into the React DOM.

## 3. Backend process (`backend-node/`)

A plain Fastify HTTP server, launched by Main as a **separate OS process**
(`child_process.spawn`, using Electron's bundled Node via
`ELECTRON_RUN_AS_NODE`) so a crash there can't take the app down and vice
versa. It has no Electron APIs, no window, no CDP — it only sees whatever
text/JSON the renderer or Main POSTs to it over loopback HTTP.

| Owns | Files |
| :--- | :--- |
| Prompt/webpage security classification (rule-based, optional ONNX) | `src/services/ruleBasedDetectorService.ts`, `promptClassifierService.ts` |
| Multi-provider LLM gateway | `src/services/llmProviderManager.ts`, `llmGateways/*` |
| Agent planning (goal + AXTree state → next tool call) | `src/services/agentPlannerService.ts`, `agentToolRegistry.ts` |
| REST routes | `src/routes/*.routes.ts` (health, security, llm, agent, providers) |

Full endpoint list: see `ARCHITECTURE.md` §3.

---

## How the three (four) sides talk to each other

| Link | Mechanism | Examples |
| :--- | :--- | :--- |
| **Renderer ↔ Main** | Electron IPC, via `contextBridge`-exposed `window.electronAPI` (`preload.ts`) | `browser.createTab/navigate/goBack/reload` (invoke), `browser.setBounds` (fire-and-forget `send`, keeps tab resize/switch off the round-trip cost), `browser.onTabEvent` (Main → renderer push for load state/navigation/errors), `runtimeInvoke` (single typed bridge for every Browser Runtime command), `scanWebview`, `providers.*` |
| **Renderer → Backend** | Plain HTTP `fetch`, loopback, port 8000 — **not** proxied through Main | `backendApiClient.ts` → `/api/v1/security/check-prompt`, `/check-webpage`, `/llm/chat`; `agentApiClient.ts` → `/api/v1/agent/plan`, `/scan-active-page` |
| **Main → Backend** | Process lifecycle (spawn/health-check/kill) + one HTTP push | `backendProcess.ts` spawns `backend-node/dist/server.js` and polls `/api/v1/health`; `providerSecureStore.ts` pushes the decrypted *active* provider to `POST /api/v1/providers/active` on save (the backend never sees inactive providers' credentials) |
| **Main → Guest WebContents** | Direct Electron API + CDP, no IPC (same process) | `WebContentsView.setBounds`, `webContents.loadURL/navigationHistory/executeJavaScript`; `webContents.debugger.attach()` for the Browser Runtime and the security snapshot |

### Why the guest page is positioned, not parented, in the renderer

A `WebContentsView` is a native compositor layer added directly to the
`BrowserWindow`'s `contentView` tree — it always paints on top of the host
window's own DOM, and nothing in the renderer's CSS (`z-index`,
`position: fixed`, `pointer-events: none`) can cover or gate it. `BrowserWebView.tsx`
tracks its container `<div>`'s on-screen rect with a `ResizeObserver` and
pushes it to Main over `browser.setBounds`; whenever something must show
instead — an inactive tab, the New Tab page, a load error, a drawer/modal, or
an assistant-panel resize drag — the renderer instead tells Main to shrink
that tab's view to `{0,0,0,0}` rather than trying to layer over it.

### Why Renderer → Backend is direct HTTP, not IPC → Main → HTTP

The backend has no credentials or state that Main needs to gate access to,
and adding an IPC hop would only add latency to every security check and
chat/planning call. The one thing that *does* go through Main first is
credentials (`providerSecureStore.ts`) — those never touch the renderer at
all.
