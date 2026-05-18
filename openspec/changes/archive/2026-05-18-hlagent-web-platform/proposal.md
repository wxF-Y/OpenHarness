## Why

OpenHarness 目前将核心 Agent SDK、运行时逻辑与 TUI 前端紧密耦合，无法作为独立产品发布，也无法让非终端用户访问。通过将 OpenHarness 拆分为 SDK 层 + Gateway 层 + Web UI 层，构建 HLAgent 产品，可让普通用户通过现代浏览器界面使用全功能 AI Agent 平台，同时保留开发者通过 CLI 使用的能力。

## What Changes

- **新增** `HLAgent/` 顶层目录，包含三个子层：`sdk/`、`gateway/`、`web/`
- **封装**（非复制）OpenHarness 核心模块到 `HLAgent/sdk/`：通过 `pip install -e e:/AI/OpenHarness` 本地可编辑安装，创建 `WebBackendHost` 类继承 `ReactBackendHost`，仅覆盖 stdin/stdout I/O 替换为 asyncio 队列接口，**不复制源码**
- **新建** `HLAgent/gateway/` FastAPI 服务，通过 WebSocket + REST 连接 SDK 与 Web 客户端
- **新建** `HLAgent/web/` React + Vite 现代 Web UI，覆盖 TUI 中所有主要功能页面，并新增 TUI 没有的管理界面（Cron/Swarm/Memory/Skills/Autopilot/Onboarding），包含：
  - 对话视图（ConversationView → Chat Page）
  - 工具调用展示（ToolCallDisplay → Tool Call Cards，含 44 种工具类型分类展示）
  - 任务面板（TodoPanel → Task Board）
  - 群集管理（SwarmPanel → Swarm Dashboard，含团队/成员/Transcript/Mailbox 权限审批流）
  - 侧边面板（SidePanel → Sidebar）
  - 命令选择器（CommandPicker → Command Picker + CommandPalette Ctrl+K）
  - 输入组件（Composer/PromptInput → Rich Input Box）
  - 状态栏（StatusBar/Footer → Status Bar）
  - 欢迎页（WelcomeBanner → Landing/Welcome Page）
  - Markdown 渲染（MarkdownText → MDRenderer）
  - 模态框系统（ModalHost/SelectModal → PermissionModal/QuestionModal/SelectModal）
  - 权限对话框（permission_dialog → PermissionModal，含 7 种消息类型审批）
  - 转录视图（TranscriptPane → Transcript Viewer）
  - **新增**：Onboarding 向导 / Memory 管理 / Cron 任务 / Swarm 团队 / Skills 浏览 / Autopilot / 认证管理 / 设置面板
- **保留** 现有 OpenHarness TUI 不受影响（不破坏现有功能）

## Capabilities

### New Capabilities

- `hlagent-sdk`: OpenHarness 核心模块提取为独立可导入 Python SDK，含 engine、tools、memory、channels、skills、swarm、coordinator、config
- `hlagent-gateway`: FastAPI WebSocket + REST Gateway 服务，暴露 SDK 能力给外部客户端，支持会话管理、流式输出、权限控制
- `hlagent-web-ui`: React + Vite 现代 Web UI，替代 TUI 的所有页面，通过 WebSocket 与 Gateway 实时交互

### Modified Capabilities

<!-- 无现有规格文件需要修改 -->

## Impact

- `src/openharness/` 现有代码：仅读取/复制，不修改，保持向后兼容
- `frontend/terminal/` TUI：不修改，保留原有功能
- 新增 `HLAgent/` 目录（独立于现有代码）
- 依赖新增：FastAPI、uvicorn（gateway）；React、Vite、TailwindCSS（web ui）
- 需要配置 WebSocket 实时通信协议（基于现有 TUI bridge protocol 扩展）
