# 🛡️ PromptGuard: Real-Time Prompt Injection Defense in AI-Native Browsers

PromptGuard is an AI-native secure desktop browser environment designed to detect and block both **direct** (user-entered) and **indirect** (webpage-embedded) prompt injection attacks in real time. Before natural language instructions or scraped webpage contents reach downstream Large Language Models (LLMs), they pass through a multi-stage security pipeline.

Built as a Final Year Project (FYP), the application simulates a secure browser workspace with visual feedback, automated scanning, and detailed decision explainability.

---

## 🚀 Core Features

*   **Electron Chromium Browser Shell:** A desktop-native web browsing frame with navigation controls, address bar, active loading indicators, tab bars, and an AI chat assistant sidebar.
*   **Dual-Path Security Scanning:**
    *   **Direct Prompts:** Scans user chat entries prior to model inference.
    *   **Indirect Injections (DOM Scraper):** Extracts visible text, hidden inputs, meta tags, and HTML comments from the active web page and scans them for embedded attacks.
*   **Explainability Drawer:** A user-activated detailed analysis panel displaying preprocessing logs, chunking stats, linguistic metrics (instruction density, keyword matches), per-chunk scoring tables, and aggregate classifier decisions.
*   **NVIDIA NIM Proxy:** A secure gateway that forwards verified safe prompts to high-performance models (like `google/gemma-3n-e2b-it`) and blocks malicious payloads at the route layer.
*   **Floating Toast Notifications:** Slide-in alert popups on the left side of the viewport providing immediate visual feedback for safety evaluations (emerald-green for safe, crimson-red for blocked).
*   **Silicon Orb Transition:** A 3D-space orbiting solar system and expanding explosion visual sequence that transitions the welcome screen into the main browser window.

---

## 🛠️ Technology Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Desktop Shell** | Electron | Cross-platform desktop shell rendering Chromium windows. |
| **Frontend** | React, TypeScript, Vite | User interface, sidebar chat, tab frames, and SVG visual controls. |
| **Backend API** | Python, FastAPI, Uvicorn | High-performance async endpoints for safety evaluations and LLM proxying. |
| **Scraping** | BeautifulSoup4, Playwright | Renders JavaScript and parses DOM trees for visible and hidden text. |
| **Diagnostics** | Pytest | 42 unit tests checking chunking, preprocessing, and route safety. |
| **Machine Learning**| Scikit-learn, Joblib | Classification loader and feature representation framework. |

---

## 🧠 Current Machine Learning Status

> [!NOTE]
> **ML Model Pending Installation**
> The Stacking Ensemble machine learning classifier (composed of Random Forest, Linear SVM, and XGBoost base estimators under a Logistic Regression meta-learner) is **currently pending model file training and placement**.

### Seamless Fallback Mode
The backend includes a **rule-based fallback detector** that matches regex vectors and security indicators across five attack categories (role override, jailbreak attempts, hidden webpage directions, system prompt reveal, and exfiltration attempts). 
*   If no trained model is found in the configured `backend/app/ml_models/prompt_injection_model/` folder, the backend **automatically falls back to the rule-based service**.
*   All diagnostics, explainability metrics, and per-chunk scores continue to populate normally, ensuring the application remains **fully functional and test-ready without crashing**.

To install the trained models later, place the following files in the model folder:
*   `prompt_injection_pipeline.joblib` (Full vectorization/embedding + classification pipeline)
*   `model_metadata.json` (Threshold settings, metrics, and feature configurations)

---

## 📦 Directory Structure

```
Prompt_injection_defense_in_AI_Native_Browser/
├── frontend/                     # Electron + React Client
│   ├── electron/                 # Electron main, preload, and security scripts
│   ├── src/
│   │   ├── components/           # UI Components (Toolbar, Chat Sidebar, Drawer)
│   │   ├── services/             # API client, scraper hooks
│   │   └── styles/               # CSS variables and animations
│   └── package.json
└── backend/                      # FastAPI Server
    ├── app/
    │   ├── api/v1/               # Endpoint Routers (health, security, LLM proxy)
    │   ├── ml_models/            # Directory for trained .joblib models
    │   ├── services/             # Preprocessing, chunking, rules-based engine
    │   ├── test_data/            # Safe/malicious JSON test sets
    │   └── tests/                # Pytest unit tests
    └── requirements.txt
```

---

## ⚙️ Quick Start

### 1. Backend Setup
*Requires **Python 3.12+** (developed and validated on **Python 3.14.x**).*

Activate the virtual environment inside the `backend` folder and install requirements:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
Copy `.env.example` to `.env` and fill in your configuration (including `NVIDIA_NIM_API_KEY` to enable real assistant chat).

### 2. Frontend & App Startup
The application is configured to run concurrently. Go to the `frontend` folder, install npm modules, and run the developer command:
```bash
cd frontend
npm install
npm run dev
```
*   `npm run dev` spins up the Vite development server, starts the FastAPI uvicorn server in the background, watches for typescript changes, and launches the Electron desktop frame.
*   **Auto-Shutdown:** Closing the Electron application window will automatically terminate the backend FastAPI server background processes.

### 3. Running Backend Tests
Ensure the backend virtual environment is active, then run:
```bash
cd backend
.venv\Scripts\python -m pytest
```
All 42 test cases checking preprocessors, classifiers, chunking limits, and schema formats should pass successfully.
