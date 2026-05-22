## Why

专家库的目录内容目前硬编码在后端 `role_library.py` 中，无法通过云控动态更新；同时从专家库发起对话时，直接跳过了标准的新建 Session 流程（工作目录选择弹窗），导致用户无法指定工作目录，侧边栏也不实时刷新已创建的 Session，且对话界面中缺少「当前为专家对话」的视觉标识。

## What Changes

- **云控获取专家目录**：后端 `/api/swarm/role-library/catalog` 从可配置的远端 URL（云控端点）拉取目录 JSON，并以 L1/L2 缓存层保障可用性；目录 URL 通过环境变量 `HLAGENT_EXPERT_CATALOG_URL` 配置，保留现有硬编码列表作为离线 fallback。
- **专家对话走新建 Session 流程**：点击「对话 →」时弹出 `CreateSessionModal`，让用户选择工作目录后再创建 Session，与普通新建对话体验一致。
- **侧边栏实时刷新**：专家对话创建成功后，触发全局 Session 列表刷新，使新 Session 立即出现在侧边栏。
- **专家身份标识**：Session 元数据中记录关联的专家角色名称（`expert_role`），Chat 页面顶部展示专家标签，侧边栏 Session 项显示专家角色角标。

## Capabilities

### New Capabilities

- `expert-catalog-cloud-sync`：专家目录从云控远端 URL 动态拉取，支持环境变量配置和离线 fallback，保持 L1/L2 缓存结构。
- `expert-session-flow`：专家对话遵循标准新建 Session 流程，支持工作目录选择弹窗、侧边栏实时更新及专家身份标识。

### Modified Capabilities

- `hlagent-web-ui`：ExpertsPage 的「对话 →」按钮行为变更——改为弹出带预填专家上下文的 CreateSessionModal，而非直接跳转。
- `hlagent-gateway`：Session 创建 API 的响应 `SessionSummary` 新增 `expert_role?: string` 字段；`/api/swarm/role-library/catalog` 改为从远端拉取。

## Impact

- **前端**：`ExpertsPage.tsx`、`swarmApi.ts`（`startExpertChat` 改为打开弹窗）、`CreateSessionModal.tsx`（新增 `expertRole` prop）、`Sidebar.tsx`（显示专家角标）、`types/api.ts`（`SessionSummary` 新增字段）
- **后端**：`role_library.py`（catalog 改为远端拉取 + fallback）、`sessions.py`（创建接口新增 `expert_role` 字段并持久化）、`session_manager.py`（SessionEntry 新增 `expert_role`）
- **配置**：新增环境变量 `HLAGENT_EXPERT_CATALOG_URL`（可选，缺省使用内置列表）
- **无 Breaking Change**：catalog 端点响应结构不变；Session 新增字段为可选，向后兼容
