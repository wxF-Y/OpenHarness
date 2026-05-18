# HLAgent — AI Agent Web Platform

基于 [OpenHarness](https://github.com/HKUDS/OpenHarness) 的现代 Web 平台，提供浏览器界面访问全功能 AI Agent。

## 架构

```
HLAgent/
├── sdk/       # hlagent-sdk Python 包 (WebBackendHost)
├── gateway/   # FastAPI 服务 (WebSocket + REST API)
└── web/       # React + Vite + TailwindCSS 前端
```

## 快速启动

### 1. 安装依赖

```bash
# 安装 OpenHarness 本地包
pip install -e e:/AI/OpenHarness

# 安装 hlagent-sdk
pip install -e ./sdk

# 安装 Gateway 依赖
cd gateway && pip install fastapi uvicorn websockets croniter

# 安装 Web 依赖
cd web && npm install
```

### 2. 启动 Gateway

```bash
cd gateway
uvicorn main:app --port 8000 --reload
```

### 3. 启动 Web UI

```bash
cd web
npm run dev
```

访问 http://localhost:5173

## Gateway API 端点

### 系统
- `GET /health` — 健康检查
- `GET /api/onboarding/status` — 初始化状态
- `POST /api/onboarding/init-project` — 初始化项目文件

### 会话 & WebSocket
- `POST /api/sessions` — 创建 Agent 会话
- `GET /api/sessions/{id}` — 获取会话状态
- `DELETE /api/sessions/{id}` — 关闭会话
- `WS /ws/{session_id}` — WebSocket 双向通信

### 认证 & 设置
- `GET/POST /api/auth/login` — API Key 管理
- `GET /api/settings` — 读取配置
- `PATCH /api/settings` — 更新配置
- `GET /api/settings/profiles` — Provider profiles

### 功能模块
- `GET/POST/DELETE /api/cron/jobs` — Cron 任务管理
- `GET /api/swarm/teams` — Swarm 团队列表
- `GET/POST /api/memory/files` — Memory 文件管理
- `GET /api/skills` — 技能列表
- `GET /api/tasks` — 后台任务
- `GET /api/git/diff` — Git diff
- `GET /api/debug/doctor` — 环境诊断
- `GET /api/autopilot/tasks` — Autopilot 任务

## Web 功能页面

| 路由 | 功能 |
|------|------|
| `/` | 欢迎页，历史会话 |
| `/onboarding` | 初始化向导 (5步) |
| `/chat/:id` | AI 对话 (WebSocket) |
| `/cron` | 定时任务管理 |
| `/swarm` | Swarm 团队协作 |
| `/memory` | Memory 文件管理 |
| `/skills` | Skills 浏览 |
| `/autopilot` | Repo Autopilot |
