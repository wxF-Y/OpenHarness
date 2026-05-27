## Context

当前 SwarmPage 的"启动团队"流程会创建一个新 session 并**立即导航离开**到 `/chat/{session_id}`（Orchestrator 的对话页），但这个 session_id 从未通知给全局的会话列表 store（`sessionStore`），导致左侧侧边栏的会话分组中看不到该会话。

SwarmPage 布局为三栏：**左侧 180px 团队列表** → **中间 260px 成员列表+状态 Banner** → **右侧 flex:1 详情面板**。详情面板目前只有三个固定标签（Transcript、Mailbox、角色定义），且 Transcript 仅在用户主动点击某个 Agent 成员卡片后才加载一次，不支持实时刷新；对于多个 Agent 同时运行的场景，无法一目了然地看到每个 Agent 的进展。

**关键的导航流程约束**：`launchTeam()` 调用后会 `navigate('/chat/{session_id}?prefill=...&autosubmit=1')`，用户离开 SwarmPage。因此"团队进展"面板只有当用户**主动返回** SwarmPage 后才可见，不是启动后的即时视图。

**技术栈约束**：
- 前端：React + Zustand（sessionStore / swarmStore）
- 实时通道：WebSocket（后端推送 `swarm_status` 事件）
- 后端 API：已有 `/api/swarm/agents/{agent_id}/transcript`，无需新增端点

## Goals / Non-Goals

**Goals:**

- 启动团队后，Orchestrator session 出现在左侧全局会话列表（附带团队名称标签）
- 用户返回 SwarmPage 后，内容区可查看所有 Agent 成员的 transcript，且在 `swarm_status` 事件触发时自动刷新
- 对已有 SwarmPage 三栏布局改动最小，不破坏当前 Team List / Member Panel 交互

**Non-Goals:**

- 不重构 sessionStore 的底层存储结构
- 不新增后端 WebSocket 事件或 API 端点
- 不实现 Agent transcript 的历史归档或导出
- 不修改 Agent 执行后端（InProcessBackend / SubprocessBackend）
- 不在 ChatPage 内**嵌入完整 Swarm 进展视图**（添加轻量导航横幅除外，见 UX 考量问题 1）

## Decisions

### 决策 1：session 注册时机与机制 — 在 `launchTeam` 内触发 Sidebar 刷新

**架构现实**（经代码审查更正）：

`sessionStore`（`stores/sessionStore.ts`）管理的是**当前激活 session 的状态**（transcript、wsStatus、appState），**不含 session 列表**。Session 列表由 `Sidebar.tsx` 本地 `useState<SessionSummary[]>` 持有，并在 `uiStore.sidebarRefreshKey` 变化时重新 `GET /api/sessions` 刷新。

**选择**：在 `swarmApi.ts` 的 `launchTeam` 中，拿到 `session_id` 后立即调用 `uiStore.getState().incrementSidebarRefreshKey()`，触发 Sidebar 重新拉取会话列表；随后执行 `navigate`。同时将 `teamName` 写入 `SessionSummary` 需要**后端支持**——后端在 `/api/sessions` 的响应中附加 `team_name` 字段（如已有 `expert_role_label` 的先例）。

**备选 A**：仅在前端 `Sidebar.tsx` 中拦截 URL 变化检测并局部注入一条假 session 条目。
**备选 B**：`launchTeam` 导航后不做任何通知，依赖用户手动刷新。

**原因**：
- 备选 A 会在 Sidebar 中引入对路由的直接依赖，且假条目缺少后端字段（cwd、is_managed 等）会导致渲染不一致；
- 备选 B 是现状，会话列表无法感知团队 session；
- 选择方案复用了已有的 `sidebarRefreshKey` 机制（已在其他场景使用），改动范围最小；
- `team_name` 字段后端已有 `expert_role_label` 的先例，添加成本低。

**注意**：若不想修改后端，可退而在 Sidebar 层通过 `uiStore.expertRoleLabels` 机制将 `teamName` 注入到指定 `session_id` 的标签显示，完全在前端解决，无需后端变更。

### 决策 2：内容区多 Agent 展示方式 — "团队进展"视图替换"选择 Agent 查看详情"默认状态

**选择**：当 `teamState === 'running' | 'idle'` 时，右侧详情面板**整体切换**为"团队进展"视图，展示每个 Agent 成员的可折叠 `SwarmAgentPanel` 卡片（纵向排列，可独立滚动）。用户点击某个 Agent 卡片后仍可进入单成员的 Transcript / Mailbox / 角色定义 三标签视图（新增"← 返回全览"按钮）。

**备选 A**：在现有三标签页上新增"团队进展"第四个标签。
**备选 B**：两种视图并列展示（Team 全览在左，单 Agent 详情在右）。

**原因**：
- 备选 A 的标签模式用户仍需手动切换，无法实现"一眼看到所有 Agent 状态"的目标；
- 备选 B 会压缩 transcript 可读宽度（已有 180px + 260px 占用），在 1200px 屏幕上不可行；
- 整体切换方案复用了已有 `selectedMember` 路由逻辑，改动集中；
- **交互连贯性**：当 teamState 从 `running` 降为 `idle`，中间 Banner 已提供"查看 Lead 对话"和"开始新任务"快捷入口，全览视图与之配合而非重叠。

**"← 返回全览"按钮的视觉位置**（经 UI 设计视角补充）：

单成员详情视图已有一行 tab 栏（Transcript / Mailbox / 角色定义）。"← 返回全览"按钮应放在 **tab 栏上方同一行的左侧**，与 tab 栏保持同一 `borderBottom` 线，复用 tab 栏的容器行（`display: flex; gap: 0.5rem`）。按钮样式：无背景、无边框、颜色 `#6c7086`，与现有 tab 非激活态一致，不喧宾夺主。点击后按钮本身消失（因为返回全览后 selectedMember 为 null，tab 栏整行不再显示）。

**摘要栏文案的状态映射**（经 UI 设计视角补充）：
- `active` count → "运行中"；`idle` + `stopped` count → "已完成"
- 例：3 个 active、1 个 idle、1 个 stopped → "3 个 Agent 运行中 / 2 个已完成"

### 决策 3：transcript 刷新触发 — 由 `swarm_status` WebSocket 事件驱动，15s 轮询兜底

**选择**：监听已有的 `swarm_status` 事件。收到事件后，对状态发生变化的 Agent 触发重新获取 transcript。对静默期（Agent 长时间无输出但仍 active）由已有 15s 轮询同步 `members` 状态后触发刷新。

**备选**：页面级独立定时器（5s 轮询）统一刷新所有成员 transcript。

**原因**：事件驱动比独立轮询更及时；5s 独立轮询在 N 个 Agent 场景下会产生 N 条并发请求，流量不可控。

### 决策 4："团队进展"视图的入口层级 — 不影响 teamState 为 `configured` 时的操作流程

**当前代码分析**：中间列的 Banner 区域承担了状态引导功能（configured → 启动表单，idle → 快捷操作），右侧详情面板目前仅响应 `selectedMember`。

**选择**：右侧面板新增一个顶层判断：
```
if (teamState === 'running' || teamState === 'idle') && !selectedMember:
  → 显示"团队进展"全览
else if selectedMember:
  → 显示单 Agent 三标签视图（含"← 返回"按钮）
else:
  → 显示"选择 Agent 查看详情"占位
```
这样不修改 `configured` / `empty` 状态下的任何现有流程。

## Risks / Trade-offs

- **[风险] sessionStore 接口不兼容**：**此风险已消除**。设计评审确认 `sessionStore` 不含 session 列表，正确做法是触发 `uiStore.incrementSidebarRefreshKey()`。
- **[风险] 后端需要返回 team_name 字段**：**此风险已消除**。直接在 `POST /api/sessions` 的 body 中传入 `expert_role_label: '🤝 ' + teamName`，后端已有此字段且会持久化，Sidebar 刷新时自动加载。无需修改后端，无需前端调用 `setExpertRoleLabels()`。
- **[风险] transcript 拉取并发量过高**（N 个 Agent 同时收到 swarm_status 事件）→ 以 `agent_id` 为 key 做请求去重（若当前已有飞行中请求则跳过），避免重复请求。
- **[风险] 用户在 SwarmPage 之外无法感知 Agent 进展** → 用户启动后被导航至 ChatPage（Orchestrator 对话），无法立即看到 Agent 面板；缓解：会话列表中标注团队标签，引导用户知道可返回 SwarmPage 查看。此问题是后续优化点（如 ChatPage 内嵌 mini-swarm-status 组件）。
- **[取舍] 折叠面板占用垂直空间** → Agent 数量 > 5 时需考虑默认折叠非 active Agent；当前阶段实现此默认策略（active 展开，其他折叠），避免首次渲染时内容爆炸。
- **[取舍] 全览与单成员视图的状态切换** → 切换时 `selectedMember` 会被设为 null；需确保"← 返回"按钮不会丢失 transcript 缓存（组件卸载时数据丢失），建议将 transcript 状态上移至 SwarmPage 级别 Map，而非放在 SwarmAgentPanel 本地 state。
- **[取舍] 会话列表中的团队 session 与普通 session 视觉区分** → 本次仅附加团队名称标签，不新建独立分组，降低 sessionStore 改动范围。

## UI 交互流程（修正后）

```
[用户在 SwarmPage]
  → 选择团队 → 团队已配置 → 填写任务描述 → 点击"启动团队"
      ↓
  [launchTeam() 执行]
  ① POST /api/sessions (body: { expert_role_label: '🤝 teamName' }) → 拿到 session_id
  ② uiStore.incrementSidebarRefreshKey()  ← 触发 Sidebar 重新 GET /api/sessions（后端已持久化 expert_role_label，刷新自动加载）
  ③ navigate('/chat/{session_id}?prefill=...&autosubmit=1&team={teamName}')  ← 携带 team param 供返回时自动选中
      ↓
  [Sidebar 触发刷新，会话列表出现新条目，带"🤝 teamName"标签]
      ↓
  [用户在 AppLayout ChatView，Orchestrator 开始执行 /swarm start]
  [AppLayout header 显示"🤝 teamName 团队任务运行中 — [查看团队进展 →]"横幅]
      ↓（用户可选：点击横幅链接，或点击侧边栏"🤝 Swarm 协作"，或通过会话列表导航）
  [用户导航到 SwarmPage（URL 携带 ?team=teamName），SwarmPage 自动选中该团队]
  [teamState 为 running/idle]
  ④ 右侧面板自动显示"团队进展"全览
  ⑤ 每个 Agent 卡片加载 transcript（errorKind 区分 no-session / fetch-error）
  ⑥ WebSocket swarm_status 事件 → 触发 refreshSelected() → 刷新 members → 触发 loadTranscriptForAgent
```

## UX 考量（用户视角审查）

### 问题 1：启动后用户迷失方向（高优先级）

**现象**：用户点击"启动团队"后，被立即导航到 ChatPage（Orchestrator 对话）。ChatPage 看起来和普通对话完全一样，用户不知道 Swarm 团队是否真的在运行，不知道需要返回 SwarmPage 才能看到 Agent 进展面板。

**缺失的反馈**：
- 导航前没有"正在启动…"的过渡提示
- ChatPage 中没有任何视觉暗示"这是一个 Swarm 团队任务"
- 会话列表中的 "🤝 teamName" 标签太小，容易被忽略

**建议补充到 tasks**：
- ChatPage 中对团队 session 显示一条固定提示横幅："🤝 团队任务运行中 — [查看团队进展 →]"，点击跳转到 SwarmPage 并自动选中该团队
- 启动按钮点击后显示"正在启动…"并保持禁用，成功后再导航（现有 `launchBusy` 状态已有，但缺少加载反馈文案）

### 问题 2：返回 SwarmPage 后不知道该选哪个团队（中优先级）

**现象**：用户从 ChatPage 点击侧边栏 "🤝 swarm" 导航到 SwarmPage 时，团队列表不会自动选中刚才启动的团队，用户需要手动在左侧团队列表找到并点击正确的团队，才能看到"团队进展"全览。

**建议补充到 tasks**：
- 在 `launchTeam` 执行 navigate 时，同时在 uiStore 中写入 `lastLaunchedTeam`（新增字段）；SwarmPage 挂载时读取并调用 `selectTeam(lastLaunchedTeam)`
- 或更简单：SwarmPage 在 `teamState === 'running'` 的团队前加脉冲绿点动画，让用户一眼找到正在运行的团队（不需要新增 store 字段）

### 问题 3：全览视图缺少整体进度感知（中优先级）

**现象**：当前设计的"团队进展"全览是一列 Agent 卡片，每个卡片独立展示 transcript，用户无法快速判断：整个任务完成了多少、哪个 Agent 卡住了、整体是否还在运行。

**建议补充到 specs**：
- 全览视图顶部增加一行摘要状态栏："N 个 Agent 运行中 / M 个已完成"
- 状态栏在 teamState === 'idle' 时显示"✅ 全部完成"

### 问题 4：Agent 面板 transcript 是原始 Markdown 文本，可读性差（低优先级）

**现象**：transcript 内容是 Markdown 格式的完整对话记录（工具调用、代码块、思维链等），对普通用户来说阅读负担重，不容易提取出"这个 Agent 做了什么"的摘要。

**建议**（后续优化，当前 Non-Goal）：
- 在卡片折叠状态下只显示最后一条 assistant 消息的前 100 字作为预览
- 记录为后续优化点，不纳入本次实现

### 问题 5：Mailbox 权限请求无全局通知（低优先级）

**现象**：Agent 发出权限请求时，只有在 SwarmPage → 点击对应成员 → Mailbox 标签中才能看到，用户在 ChatPage 或其他页面完全感知不到，任务可能因此卡住。

**现有机制**：swarmStore 已有 `pendingPermissions` 计数，但未在全局 UI（如 NavItem 徽章）中展示。

**建议**（后续优化，当前 Non-Goal）：
- Sidebar 中 "🤝 Swarm 协作" NavItem 在 `pendingPermissions > 0` 时显示红色数字徽章
- 记录为后续优化点

### 问题 6：从 ChatPage 点击"查看团队进展 →"后，SwarmPage 无团队选中时的空状态体验差（中优先级）

**现象**：用户点击 AppLayout 横幅的"查看团队进展 →"，导航到 `/?view=swarm&team=xxx`。此时 SwarmPage 尚未加载完成，团队列表 API 请求还在进行中，会出现短暂的"选择团队"空占位，或更糟——如果 URL param 在 `useEffect` 中比 `fetch('/api/swarm/teams')` 先处理完，`selectTeam` 会找不到目标（teams 列表为空），导致自动选中失败。

**建议补充到 tasks**：
- SwarmPage 挂载时，应先等 `refreshTeams()` 完成后再处理 URL `team` param，避免 teams 列表为空时调用 `selectTeam` 无效
- 或在 `selectTeam` 中加入兜底：若 teams 未加载，将 param 存入 `pendingTeamSelect` state，`refreshTeams` 完成后再处理

### 问题 7：全览视图首次出现时无任何过渡提示（低优先级）

**现象**：用户返回 SwarmPage 后，从"启动中"的 `configured` Banner 直接切换到"团队进展"全览，所有 Agent 面板同时显示骨架加载态，体验较突兀，不知道当前是"正在加载"还是"还没有内容"。

**建议补充到 tasks**：
- 全览视图顶层在所有面板都处于 `isLoading=true` 时，显示一行整体提示："正在加载 Agent 执行记录…"，替代单独显示 N 个骨架
- 当至少有一个面板有内容后，移除顶层提示，各面板独立显示

### 问题 8：任务描述输入框没有字数限制或截断提示（低优先级）

**现象**：中间 Banner 中的 `textarea`（任务描述）没有字数限制，用户可能粘贴超长文本。`launchTeam` 中虽然有 `safeTask.replace(/[\r\n]+/g, ' ')` 清理，但没有对总长度做截断，可能导致生成的 `/swarm start <team> <很长的描述>` 命令在某些情况下超出 URL 或 API 限制。

**建议**（低优先级，可在 task 2.1 中顺带处理）：
- textarea 加 `maxLength` 或在 UI 层限制为 500 字，超出时显示字数提示
- `launchTeam` 的 `safeTask` 做截断：`safeTask.slice(0, 500)`

## 三层接口分析（Coder 视角）

### 层级架构确认

```
UI (React/TypeScript)
  └─ swarmApi.ts          → REST: /api/swarm/*, /api/sessions
  └─ useWebSocket.ts      → WS:  swarm_status 事件 (SwarmTeammate[])
  └─ swarmStore.ts        → 状态: teammates (SwarmTeammate[]) + memberDetails (TeamMember)

Gateway (Python FastAPI)
  └─ routers/swarm.py     → GET /agents/{id}/transcript, GET /teams/{name}
  └─ routers/sessions.py  → POST /sessions → SessionSummary

SDK (Python openharness)
  └─ swarm/team_lifecycle.py  → TeamMember 持久化 (JSON)
  └─ swarm/in_process.py      → active→idle 状态变化，idle_notification 到 mailbox
  └─ ui/backend_host.py       → _emit_swarm_status() 推送 swarm_status 事件
```

### 问题 1：SwarmTeammate 与 TeamMember 类型不一致（高优先级）

**发现**：WebSocket 事件推送的 `SwarmTeammate`（UI 类型 `protocol.ts`）与 REST API 返回的 `TeamMember`（`swarmStore.ts`）是两个完全不同的类型：

```typescript
// protocol.ts — 来自 WebSocket 事件
export interface SwarmTeammate {
  name: string
  status: SwarmStatus      // 'running' | 'idle' | 'done' | 'error'
  duration?: number
  task?: string
}

// swarmStore.ts — 来自 REST API GET /teams/{name}
export interface TeamMember {
  agent_id: string
  session_id?: string      // 拉取 transcript 必需
  status?: 'active' | 'idle' | 'stopped'
  // ...15+ 字段
}
```

**影响**：
- 设计文档中的"监听 swarmStore teammates 变化触发 transcript 刷新"在实现上有歧义：`swarmStore.teammates` 存的是 `SwarmTeammate[]`（无 `agent_id`），而 transcript API 需要 `agent_id`（格式 `name@team`）
- `SwarmTeammate.status` 枚举值（`running/idle/done/error`）与 `TeamMember.status`（`active/idle/stopped`）不一致，`deriveTeamState()` 用的是 `TeamMember.status`，不依赖 `SwarmTeammate`

**结论**：transcript 刷新触发应基于 SwarmPage 本地的 `members: Record<string, Member>`（来自 REST 轮询），而非 `swarmStore.teammates`（WebSocket 推送）。`swarm_status` WebSocket 事件的实际作用是触发 SwarmPage 主动调用 `refreshSelected()`，间接触发 transcript 更新。

**需要更新 tasks 6.3**：改为监听 `swarmStore.teammates` 变化后调用 `refreshSelected()`，刷新 members 后再对状态变化的 member 触发 `loadTranscriptForAgent`。

### 问题 2：`GET /transcript` 端点依赖 `session_id`，而 Agent 刚启动时 `session_id` 可能为 null（中优先级）

**发现**：
```python
# swarm.py
@router.get("/agents/{agent_id}/transcript")
async def get_agent_transcript(agent_id: str):
    member = team.members[agent_id_str]
    if not member.session_id:
        raise HTTPException(status_code=404, detail="Agent has no session_id")
```

**影响**：当 teamState 变为 `running` 时，部分成员可能刚刚启动，`session_id` 尚未写入 `team.json`。此时调用 transcript API 会返回 404，前端面板需要处理这个特殊情况。

**需要更新 tasks 5.4**：`hasError` 需区分"404 尚无 session"（显示"等待 Agent 启动…"而非"加载失败"）和"5xx 网络错误"（显示"加载失败，重试"）。

### 问题 3：ChatPage 顶部横幅的实现位置是 AppLayout.tsx，不是 ChatPage.tsx（中优先级）

**发现**：项目中不存在独立的 `ChatPage.tsx`。Chat 视图集成在 `AppLayout.tsx` 中，顶部 44px header 区域已有 expertRoleLabel 的显示逻辑（读取 `ui.expertRoleLabels[sessionId]`）。

**结论**：tasks 7.x 中"在 ChatPage 中检测"应改为"在 `AppLayout.tsx` 的 chat header 中检测"。实现成本更低——只需在已有的 `expertLabel` 判断基础上增加 `expertLabel.startsWith('🤝 ')` 的分支渲染。

### 问题 4：`launchTeam` 未向 `POST /api/sessions` 传入 `expert_role_label`（中优先级）

**发现**：`POST /api/sessions` 支持在请求体中传入 `expert_role_label`，该值会由后端返回，Sidebar 刷新时会自动加载到 `uiStore.expertRoleLabels`。

```python
class CreateSessionRequest(BaseModel):
    expert_role_label: str | None = None  # 已有，可直接使用
```

**结论**：`launchTeam` 可以**直接在 POST body 中传 `expert_role_label`**，无需在前端调用 `uiStore.setExpertRoleLabels()`——刷新 sidebar 时后端已自动返回。两步操作可合并为一步：

```typescript
// 更简洁的做法
const r = await fetch('/api/sessions', {
  method: 'POST',
  body: JSON.stringify({ expert_role_label: '🤝 ' + teamName })
})
// 之后 incrementSidebarRefreshKey() 足够，无需额外 setExpertRoleLabels
```

**需要更新 tasks 2.1**：将步骤拆分为"传入 expert_role_label 到 POST body"和"仅调用 incrementSidebarRefreshKey 刷新列表"。

### 问题 5：`uiStore` 无 `lastLaunchedTeam`，需新增（低优先级）

**发现**：`uiStore` 当前无 `lastLaunchedTeam` 字段，`swarmStore` 有 `selectTeam` action 但 SwarmPage 自己维护了 `selectedTeam` 本地 state（两套状态）。

**结论**：最简路径是**不使用 uiStore**，而是在 `launchTeam` 的 URL 参数中附加 `from=/swarm` + `team=teamName`，SwarmPage 挂载时读 URL searchParam 自动 selectTeam。这复用了已有的 `?from=` 参数模式（`startExpertChat` 中已有先例），零新增 store 字段。

**需要更新 tasks 7.3**：改为通过 URL searchParam 传递 teamName，SwarmPage 挂载 `useEffect` 读取并自动选中。
