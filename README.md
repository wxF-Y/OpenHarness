<h1 align="center">
  <br>
  HLAgent
  <br>
</h1>

<p align="center">
  <strong>AI Agent Web Platform — Browser-based interface to the full OpenHarness AI Agent runtime</strong>
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-≥3.10-blue?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Node.js-≥18-339933?logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat" alt="License">
</p>

**HLAgent** is a modern Web UI platform for AI Agents, built on top of [OpenHarness](https://github.com/HKUDS/OpenHarness). It replaces the command-line `oh` interface with a full browser-based experience — real-time streaming chat, multi-agent Swarm coordination, scheduled Cron jobs, Memory management, and more.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Real-time Chat** | WebSocket-based streaming conversation with full tool-call visualization |
| **Swarm Coordination** | Spawn and manage multi-agent teams from the browser |
| **Cron Scheduling** | Create and monitor scheduled agent tasks |
| **Memory Management** | View and edit persistent agent memory files |
| **Skills Browser** | Discover and load agent skills on demand |
| **Git Integration** | View diffs and git status inline |
| **Autopilot** | Run autonomous background agent tasks |
| **Onboarding Wizard** | 5-step guided setup for first-time users |
| **Multi-Provider** | Anthropic, OpenAI, Copilot, Codex, Ollama, and more |

---

## 🏗️ Architecture

```
HLAgent/
├── gateway/   # FastAPI backend  (WebSocket + REST API, port 8000)
├── sdk/       # hlagent-sdk Python package (WebBackendHost wrapper)
└── web/       # React + Vite + TailwindCSS frontend (port 5173)

src/openharness/   # Core Agent runtime (engine, tools, skills, permissions…)
```

**Request flow:**

```
Browser ──WebSocket──▶ Gateway (FastAPI) ──▶ hlagent-sdk ──▶ OpenHarness runtime
                                                             (tools, LLM API, memory…)
```

Agent state is stored in `~/.hlagent/` (isolated from any CLI-based OpenHarness usage).

---

## 🚀 Quick Start

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Python | 3.10 |
| Node.js | 18 |
| npm | 9 |
| git | any |

### Linux / macOS / WSL

```bash
# 1. Clone the repository
git clone https://github.com/HKUDS/OpenHarness.git
cd OpenHarness

# 2. Install everything in one step
bash scripts/install.sh

# 3. Start both services
bash scripts/start.sh
```

Open **http://localhost:5173** in your browser.

### Windows (PowerShell)

```powershell
# 1. Clone the repository
git clone https://github.com/HKUDS/OpenHarness.git
cd OpenHarness

# 2. Install everything
.\scripts\install.ps1

# 3. Start both services
.\scripts\start.ps1
```

Open **http://localhost:5173** in your browser.

### Docker (one command)

```bash
cd HLAgent
docker-compose up
```

Open **http://localhost:5173** in your browser.

---

## ⚙️ Configuration

On first launch the browser opens an **Onboarding Wizard** that guides you through:

1. **Provider** — choose Anthropic, OpenAI-compatible, Copilot, Codex, etc.
2. **API Key** — enter credentials (stored locally in `~/.hlagent/`)
3. **Model** — select default model
4. **Workspace** — confirm working directory
5. **Done** — ready to chat

You can also configure settings directly via `Settings` in the sidebar.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HLAGENT_CONFIG_DIR` | `~/.hlagent` | Override storage directory |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI-compatible API key |
| `HLAGENT_GATEWAY_PORT` | `8000` | Gateway listen port |
| `HLAGENT_WEB_PORT` | `5173` | Web dev server port |

---

## 🌐 API Reference

The Gateway exposes a REST + WebSocket API at `http://localhost:8000`.

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/onboarding/status` | Onboarding state |
| `POST` | `/api/onboarding/init-project` | Initialise project files |

### Sessions & WebSocket

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions` | Create agent session |
| `GET` | `/api/sessions/{id}` | Get session state |
| `DELETE` | `/api/sessions/{id}` | Close session |
| `WS` | `/ws/{session_id}` | Bidirectional WebSocket |

### Auth & Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/auth/login` | API key management |
| `GET` | `/api/settings` | Read configuration |
| `PATCH` | `/api/settings` | Update configuration |
| `GET` | `/api/settings/profiles` | Provider profiles |

### Feature Modules

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST/DELETE` | `/api/cron/jobs` | Cron job management |
| `GET` | `/api/swarm/teams` | Swarm team list |
| `GET/POST` | `/api/memory/files` | Memory file management |
| `GET` | `/api/skills` | Skill list |
| `GET` | `/api/tasks` | Background tasks |
| `GET` | `/api/git/diff` | Git diff |
| `GET` | `/api/debug/doctor` | Environment diagnostics |
| `GET` | `/api/autopilot/tasks` | Autopilot tasks |

Interactive API docs: **http://localhost:8000/docs**

---

## 🖥️ Web Pages

| Route | Description |
|-------|-------------|
| `/` | Welcome page — session history |
| `/onboarding` | Setup wizard (5 steps) |
| `/chat/:id` | AI chat (WebSocket streaming) |
| `/?view=cron` | Cron scheduler |
| `/?view=swarm` | Swarm multi-agent |
| `/?view=memory` | Memory files |
| `/?view=skills` | Skills browser |
| `/?view=autopilot` | Repo Autopilot |

---

## 🔧 Development

### Run services separately

```bash
# Terminal 1 — Gateway
cd HLAgent/gateway
pip install -e ../../         # openharness-ai (editable)
pip install -e ../sdk          # hlagent-sdk (editable)
pip install -r requirements.txt  # gateway deps
uvicorn main:app --port 8000 --reload

# Terminal 2 — Web UI
cd HLAgent/web
npm install
npm run dev
```

### Run tests

```bash
# Python unit + integration tests
uv run pytest -q

# Harness E2E (requires ANTHROPIC_API_KEY)
python scripts/test_harness_features.py
```

### Project layout

```
src/openharness/   Core runtime (engine, tools, skills, permissions, swarm…)
HLAgent/
  gateway/
    main.py        FastAPI app entry point
    routers/       Route handlers (sessions, ws, cron, swarm, memory…)
    services/      Background services (cron runner, etc.)
  sdk/
    hlagent_sdk/   WebBackendHost — bridges FastAPI ↔ OpenHarness runtime
  web/
    src/
      App.tsx      Router setup
      pages/       Full-page views
      components/  Shared UI components
      stores/      Zustand state stores
```

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and PR expectations.

Areas where help is most welcome:

- **Web UI**: new views, accessibility improvements, mobile responsiveness
- **Gateway**: new API endpoints, streaming improvements
- **OpenHarness core**: tools, skills, provider support
- **Testing**: E2E scenarios, edge cases

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <em>Built on <a href="https://github.com/HKUDS/OpenHarness">OpenHarness</a> — the open-source AI Agent runtime.</em>
</p>
