# PromptGuard

**Real-Time Prompt Injection Defense in an AI-Native Browser**

PromptGuard is an AI-native desktop web browser engineered to defend against prompt injection attacks in real time. When an AI assistant browses or reads web content on a user's behalf, malicious actors can weaponize web pages with hidden instructions (Indirect Prompt Injection) or supply hostile prompts (Direct Prompt Injection) to manipulate the model.

PromptGuard implements a multi-stage security pipeline that inspects both user prompts and live web pages across 22 distinct content channels before text can reach a Large Language Model (LLM) or trigger browser automation.

The system is built entirely in TypeScript, pairing an Electron desktop shell and React frontend with a high-performance Fastify 5 security service on Node.js.

---

## Architecture and Process Model

PromptGuard partitions responsibilities across four isolated operating system and runtime layers:

```
┌─────────────────────────────────┐        IPC (Context Bridge)     ┌────────────────────────────────────┐
│    Renderer Process (React 19)  │◄───────────────────────────────►│    Electron Main Process (Node.js) │
│    frontend/src/                │       window.electronAPI        │    frontend/electron/              │
│                                 │                                 │                                    │
│ - Browser shell UI & tabs       │                                 │ - Native window & lifecycle        │
│ - "Kimo" assistant sidebar      │                                 │ - WebContentsView tab host manager │
│ - Explainability drawers        │                                 │ - CDP Browser Runtime engine       │
│ - Host <div> geometry sync      │                                 │ - Provider credential vault        │
└────────────────┬────────────────┘                                 │ - Backend process supervisor       │
                 │                                                  └─────────────────┬──────────────────┘
                 │ HTTP (Port 8000)                                                   │ Spawns & supervises
                 │ loopback fetch                                                     │ (ELECTRON_RUN_AS_NODE=1)
                 ▼                                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          Security Backend Process (Node.js + Fastify 5)                                │
│                          backend-node/                                                                 │
│                                                                                                        │
│ - 22-channel webpage inspection pipeline                                                               │
│ - Prompt classification (hybrid rule-based detector + ONNX Runtime fallback)                           │
│ - Multi-provider LLM gateways (OpenRouter, TokenRouter, Anthropic, Gemini, OpenAI, etc.)               │
│ - Autonomous agent planning service (/api/v1/agent/plan)                                               │
│ - Isolated event logging stores for user and agent scans                                               │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                                    Sandboxed Guest Page Layer
                                    (Managed by Electron Main)
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 WebContentsView (Chromium Sandbox)                                     │
│ - Native out-of-process web rendering (contextIsolation: true, sandbox: true)                         │
│ - Completely isolated from app DOM, local files, and API credentials                                  │
│ - Inspected and automated exclusively via dedicated Chrome DevTools Protocol (CDP) sessions            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Process Roles

1. **Electron Main Process**: Oversees application lifecycle, creates native windows, securely stores encrypted API keys, supervises the backend process lifecycle (`backendProcess.ts`), and manages guest tabs using modern `WebContentsView`.
2. **Renderer Process (React UI)**: Drives the browser chrome, navigation toolbar, address bar, tabs, and the **Kimo** AI assistant sidebar (Chat and Autonomous Agent modes). Tab surfaces are rendered by tracking container bounds via `ResizeObserver` and positioning the native `WebContentsView` via IPC.
3. **Guest Web View (`WebContentsView`)**: Runs external websites inside an isolated Chromium sandbox. Unlike legacy `<webview>` tags, `WebContentsView` prevents untrusted web code from accessing internal application DOM, local files, or saved credentials.
4. **Security Backend (`backend-node`)**: Fastify 5 microservice on loopback port `8000`. Executes 22-channel inspection, text chunking with boundary overlap, prompt classification, LLM gateway proxying, and agent action planning.

---

## Project Structure

```
Prompt_injection_defense_in_AI_Native_Browser/
├── docs/                                 # Architectural specifications and diagrams
│   ├── AGENT_ARCHITECTURE.md             # Autonomous agent loop, security gates, and tool specs
│   ├── ARCHITECTURE.md                   # System design, detection model, and security policies
│   └── ARCHITECTURE.tex                  # Formal specification in LaTeX
├── PROCESS_ARCHITECTURE.md               # Inter-process communication topology
│
├── frontend/                             # Desktop application (Electron + React)
│   ├── electron/                         # Electron Main & Preload scripts
│   │   ├── main.ts                       # App lifecycle, window management, WebContentsView IPC
│   │   ├── preload.ts                    # Hardened contextBridge interface (window.electronAPI)
│   │   ├── backendProcess.ts             # In-process supervision of backend-node
│   │   ├── providerSecureStore.ts        # Encrypted local API key storage (safeStorage)
│   │   ├── webviewContextMenu.ts         # Native context menu and DevTools banner
│   │   ├── cdpInspectionService.ts       # 22-channel snapshot extraction via CDP
│   │   └── browserRuntime/               # Autonomous agent CDP automation engine
│   │       ├── browserRuntime.ts         # CDP command dispatcher and target manager
│   │       ├── nativeInput.ts            # Hardware-level mouse and keyboard event dispatch
│   │       ├── pageInspector.ts          # Accessibility tree (AXTree) parser
│   │       ├── stateBuilder.ts           # Semantic element extraction for agent planner
│   │       ├── verificationEngine.ts     # Pre/post action state validation
│   │       └── waitEngine.ts             # Quiescence and navigation synchronizer
│   ├── src/                              # React 19 UI Application
│   │   ├── App.tsx                       # Main shell layout, tab manager, drawer state
│   │   ├── components/                   # UI components
│   │   │   ├── BrowserWebView.tsx        # Host container synchronizing WebContentsView bounds
│   │   │   ├── AiAssistantSidebar.tsx    # Kimo sidebar (Chat and Agent modes)
│   │   │   ├── ProviderSettingsModal.tsx # Multi-provider connection & key configuration
│   │   │   ├── PromptModelPicker.tsx     # Model selection and routing dropdown
│   │   │   ├── ModelSelector.tsx         # Active provider indicator and selector
│   │   │   └── ProviderIcons.tsx         # SVG branding for AI providers
│   │   ├── services/                     # Frontend client services
│   │   │   ├── backendApiClient.ts       # HTTP client for backend security & chat endpoints
│   │   │   ├── agentApiClient.ts         # HTTP client for agent planning & scan routes
│   │   │   ├── agentRuntimeCore.ts       # Iterative agent execution loop
│   │   │   └── agentSecurityPipeline.ts  # Dual parallel security scan before agent action
│   │   └── styles/                       # CSS design tokens, layouts, and animations
│   ├── e2e/                              # Playwright integration & E2E tests
│   │   ├── agentMode.spec.ts             # End-to-end agent CDP actions and safety tests
│   │   └── providers.spec.ts             # Multi-provider settings modal verification
│   ├── electron-builder.yml              # Windows NSIS distribution packaging config
│   ├── package.json                      # Frontend scripts and dependencies
│   └── vite.config.ts                    # Vite bundler configuration
│
└── backend-node/                         # Security microservice (Node.js + Fastify 5)
    ├── src/
    │   ├── server.ts                     # Fastify bootstrap on 127.0.0.1:8000
    │   ├── app.ts                        # Route registration, CORS policy, 422 error handlers
    │   ├── config/                       # Runtime configuration and environment parsing
    │   │   └── env.ts                    # Settings schema and defaults
    │   ├── core/                         # Constants and logger setup
    │   │   ├── securityConstants.ts      # Classification thresholds and pattern categories
    │   │   └── logging.ts                # Pino logging configuration
    │   ├── routes/                       # Fastify HTTP endpoint handlers
    │   │   ├── health.routes.ts          # /api/v1/health status and runtime telemetry
    │   │   ├── security.routes.ts        # /api/v1/security/* prompt and page scanning
    │   │   ├── agent.routes.ts           # /api/v1/agent/* planning, page scan, tool registry
    │   │   ├── providers.routes.ts       # /api/v1/providers/* dynamic provider management
    │   │   └── llm.routes.ts             # /api/v1/llm/chat guarded chat proxy
    │   ├── schemas/                      # TypeBox contract definitions
    │   │   ├── security.schemas.ts       # Payload schemas for scan requests/verdicts
    │   │   ├── agent.schemas.ts          # Schemas for planner, steps, and AXTree snapshots
    │   │   └── provider.schemas.ts       # Provider configuration and model schemas
    │   ├── services/                     # Business logic and detection algorithms
    │   │   ├── ruleBasedDetectorService.ts # Regex detection across 5 attack vectors
    │   │   ├── promptClassifierService.ts  # Hybrid classifier coordinator
    │   │   ├── promptPreprocessingService.ts # Unicode normalization and obfuscation stripping
    │   │   ├── textChunkingService.ts    # Sliding window chunker with boundary overlap
    │   │   ├── agentPlannerService.ts    # LLM prompt synthesis and JSON tool call parser
    │   │   ├── agentToolRegistry.ts      # Validated catalogue of 11 safe browser tools
    │   │   ├── agentSecurityService.ts   # Agent-specific scan pipeline
    │   │   ├── securityEventStore.ts     # User scan event audit log
    │   │   ├── agentSecurityEventStore.ts# Isolated agent scan event audit log
    │   │   ├── llmProviderManager.ts     # Active provider routing and token tracking
    │   │   └── llmGateways/              # Provider adapters (OpenAI, Anthropic, Gemini)
    │   └── ml/                           # Machine learning runtime scaffold
    │       ├── modelLoader.ts            # Dynamic ONNX pipeline loader
    │       └── onnxClassifier.ts         # ONNX Runtime classifier wrapper
    ├── test/                             # 178 Vitest unit and integration tests
    │   ├── fixtures/                     # Malicious and benign evaluation datasets
    │   └── *.test.ts                     # Test suites for routes, schemas, and detectors
    ├── MIGRATION.md                      # Comprehensive FastAPI -> Fastify migration record
    ├── package.json                      # Backend scripts and dependencies
    └── tsconfig.json                     # Backend TypeScript compiler configuration
```

---

## Core Features

- **Multi-Channel Webpage Inspection (22 Channels)**: Scans 14 core DOM channels (visible text, hidden content, HTML comments, ARIA labels, meta tags, attributes, inputs, iframe content, shadow DOM, inline scripts, styles) plus 8 extended telemetry channels (external scripts, source maps, HTTP redirects, third-party resources, suspicious hostnames, frame navigation, runtime script activity, loaded resources).
- **Dual-Path Security Isolation**: User-initiated manual page scans (`/security/check-webpage`) and autonomous agent page scans (`/agent/scan-active-page`) run through independent routers, aggregation engines, and segregated audit event stores.
- **Fail-Closed Autonomous Agent**: Agent plans actions over CDP while the page is evaluated in parallel. If any channel fails inspection, the proposed action is discarded, the task terminates, and the user is alerted.
- **Hardware-Level CDP Automation**: The agent interacts strictly via native Chromium DevTools Protocol input events (mouse movements, clicks, and keyboard strokes) rather than injected JavaScript DOM methods (`element.click()`).
- **Universal Provider Gateway**: Connect to any OpenAI-compatible gateway (OpenRouter, TokenRouter, NaraRouter, OpenAdapter, AgentRouter, NVIDIA NIM, Cloudflare) or native APIs (Anthropic Claude, Google Gemini). API keys are stored locally using Electron `safeStorage`.
- **Explainability Drawer**: Users can inspect token counts, chunking distributions, linguistic density metrics, and matched regex patterns for every scan.

---

## Prerequisites

Before cloning and running PromptGuard, ensure your system has:

- **Node.js**: Version 20 LTS or newer (includes `npm`).
- **Git**: Recent version for repository cloning.
- **Operating System**: Windows 10/11, macOS, or modern Linux.

---

## How to Clone and Run

### 1. Clone the Repository

```bash
git clone https://github.com/Salmantahir002/Prompt_injection_defense_in_AI_Native_Browser.git
cd Prompt_injection_defense_in_AI_Native_Browser
```

### 2. Set Up and Build the Backend

Navigate to `backend-node`, install dependencies, and build the TypeScript source:

```bash
cd backend-node
npm install
npm run build
```

*(Optional)* Create a `.env` file if you wish to adjust default ports or thresholds:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

> **Note:** You do not need to put API keys in `.env`. Provider API keys are configured directly inside the browser UI and stored securely by Electron.

### 3. Set Up and Launch the Application

Return to the repository root and navigate into `frontend`:

```bash
cd ../frontend
npm install
npm run dev
```

The `npm run dev` script automatically coordinates:
1. The **Fastify backend** on `http://127.0.0.1:8000`.
2. The **Vite dev server** on `http://localhost:5173`.
3. TypeScript compilation of the Electron main and preload scripts.
4. The **Electron browser window**, launched once both HTTP services are responsive.

### 4. Configure an AI Provider

1. Once the browser launches, click the **Kimo** assistant icon in the upper-right corner to expand the sidebar.
2. Click the **Settings** (gear) icon in the assistant header.
3. Select your preferred provider (e.g., **OpenRouter**, **Google Gemini**, **Anthropic**, **OpenAI**, **TokenRouter**, or **Custom**).
4. Enter your API key, select a model, and click **Connect & Activate**.
5. You can now use AI Chat and the Autonomous Agent with real-time prompt injection defense.

---

## Additional Run and Build Commands

### Standalone Backend Execution

```bash
# Run Fastify backend in watch mode (tsx)
cd backend-node
npm run dev

# Run compiled backend production entrypoint
cd backend-node
npm start
```

### Testing

```bash
# Backend unit & integration tests (178 Vitest tests)
cd backend-node
npm test

# Run a specific backend test suite
cd backend-node
npx vitest run test/ruleBasedDetectorPrecision.test.ts

# Frontend E2E tests (Playwright with real CDP)
cd frontend
npm run test:e2e
```

### Production Build and Packaging

```bash
# Compile both backend and frontend bundles
cd frontend
npm run build

# Package standalone Windows installer (NSIS executable)
cd frontend
npm run package
```

The packaging configuration (`frontend/electron-builder.yml`) bundles the compiled Node backend inside `resources/backend` and runs it using Electron's bundled Node runtime (`ELECTRON_RUN_AS_NODE=1`), requiring zero external Node.js installation on end-user machines.

---

## API Reference Summary

All backend endpoints are served under `http://127.0.0.1:8000/api/v1`:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service status, classifier mode, and runtime versions. |
| `POST` | `/security/check-prompt` | Evaluates user prompts for direct injection attacks. |
| `POST` | `/security/check-webpage` | Evaluates 22 webpage channels for manual user scans. |
| `GET` | `/security/events` | Retrieves audit log history of manual scans. |
| `POST` | `/agent/scan-active-page` | Scans active page for autonomous agent iterations. |
| `POST` | `/agent/plan` | Synthesizes goal, page state, and memory into verified tool calls. |
| `GET` | `/agent/security/events` | Retrieves agent security scan audit logs (filterable by `task_id`). |
| `GET` | `/agent/tools` | Returns metadata and schemas for the 11 permitted agent tools. |
| `GET`/`POST`/`DELETE` | `/providers/active` | Inspects, activates, or disconnects the active LLM provider. |
| `GET` | `/providers/presets` | Lists supported provider templates and gateway URLs. |
| `POST` | `/providers/models` | Fetches available models for a given provider configuration. |
| `POST` | `/providers/test` | Validates API credentials and measures endpoint latency. |
| `POST` | `/llm/chat` | Proxies sanitized prompts to the active LLM provider. |

---

## Configuration

Default environment variables in `backend-node/src/config/env.ts`:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8000` | Loopback port for the Fastify server. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Allowed origins for browser renderer fetch requests. |
| `MODEL_DIR` | `ml_models/prompt_injection_model` | Directory path for optional ONNX model artifacts. |
| `CLASSIFIER_THRESHOLD` | `0.70` | Score threshold above which content is marked malicious. |
| `DEFAULT_CHUNK_SIZE` | `800` | Character count per analysis text chunk. |
| `DEFAULT_CHUNK_OVERLAP` | `100` | Boundary overlap between adjacent chunks. |
| `AGENT_MIN_CONFIDENCE` | `0.60` | Confidence threshold below which agent prompts user confirmation. |
