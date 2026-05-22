## Why

创建新 Session 时 Agent 的工作目录默认回退到 Gateway 进程启动目录，用户无法在 Web UI 中针对不同项目开启独立会话；同时，无主项目目录的临时会话缺乏归宿，清理负担全由用户承担。

## What Changes

- 创建 Session 时提供工作目录选择器：可手动输入路径，也可浏览服务端文件系统选择目录
- 若用户不填写，Gateway 自动在 `~/.hlagent/workspaces/<session_id>/` 下创建独立目录作为该会话的 cwd
- 删除 Session（`DELETE /api/sessions/{id}`）时，若其 cwd 指向 `~/.hlagent/workspaces/` 内部，则自动删除对应目录
- 前端侧边栏和会话列表展示每个会话当前的 cwd（截断显示）

## Capabilities

### New Capabilities

- `session-cwd-selection`: Session 创建时的工作目录选择与默认自动分配能力
- `session-cwd-cleanup`: Session 删除时自动清理 `.hlagent/workspaces/` 内托管目录的能力

### Modified Capabilities

- `hlagent-gateway`: 新增 cwd 自动分配逻辑、删除 Session 时清理托管目录；`CreateSessionRequest` 行为变更
- `hlagent-web-ui`: 新增 Session 创建对话框，含工作目录输入/浏览控件

## Impact

- **后端**: `HLAgent/gateway/routers/sessions.py` — `create_session` / `delete_session` 逻辑变更；`services/session_manager.py` 需存储 `managed_cwd` 标记
- **前端**: `AppLayout.tsx`、`WelcomePage.tsx`、`OnboardingPage.tsx` — 创建会话入口需弹出目录选择对话框；`Sidebar.tsx` 会话条目显示 cwd
- **文件系统**: 引入 `~/.hlagent/workspaces/` 目录作为托管工作目录的根
- **无破坏性变更**: `cwd` 参数对外 API 保持可选，未传时行为从"回退 Gateway cwd"改为"自动分配托管目录"
