## 1. 后端：新增团队启动 API（Gateway）— 任务团队隔离

- [x] 1.1 在 `HLAgent/gateway/routers/swarm.py` 新增 `POST /api/swarm/teams/{team_name}/start` 路由，接受 `{ task: str, model: str | None }` body
- [x] 1.2 读取模板 TeamFile，校验团队存在且有成员（否则返回 404/400）
- [x] 1.3 构建 Leader 系统提示：包含成员描述列表 + 动态任务分配指令模板 + 追加指示说明
- [x] 1.4 调用 `session_mgr.create_with_id()` 创建 Orchestrator session
- [x] 1.5 通过 `host.push_request()` 将任务内容推入 session 消息队列
- [x] 1.6-NEW **创建任务团队副本**：在 `/start` 调用时，创建 `{teamName}-{yyyymmdd-HHMMss}` 的新团队目录（克隆模板成员定义，session_id/task_id 均为 null），所有成员 spawn 和状态写入**任务团队**，不修改模板团队
- [x] 1.7 每个 spawn 成功后调用 `host._emit_swarm_status()` 推送状态
- [x] 1.8-UPDATED 返回 `{ session_id: str, task_team: str, members: list[TeamMember] }`（新增 `task_team` 字段）

## 2. 后端：session_id 回写机制

- [x] 2.1 修改 `SubprocessBackend.spawn()`：读取 `config.session_id`（已在 `TeammateSpawnConfig` 中定义），若非 None 则通过 `OPENHARNESS_SESSION_ID` 环境变量传给子进程；若 None 则预生成 UUID 并自行设置
- [x] 2.2 修改 `InProcessBackend.spawn()`：读取 `config.session_id`，若非 None 则传给 `start_in_process_teammate()` 并在 session 创建时使用；若 None 则预生成
- [x] 2.3 在 `SpawnResult` 中增加 `session_id: str` 字段（回传给 Gateway）
- [x] 2.4 在 `TeamLifecycleManager` 中新增 `update_member_session(team_name, agent_id, session_id)` 方法，更新并持久化 `team.json`

## 3. 后端：实时推送 swarm_status 事件

- [x] 3.1 在 `TeammateSpawnConfig`（`src/openharness/swarm/types.py`）中新增 `on_status_change: Callable[[list[dict]], None] | None = None` 回调字段，用于 SDK 层向 Gateway 层回调 emit；在 `/start` API 中传入绑定了 Leader `host._emit_swarm_status` 的 lambda
- [x] 3.2 在 `in_process.py` 的 finally 块（Agent 结束时）和 `_drain_mailbox` 处理 `idle_notification` 时，若 `config.on_status_change` 不为 None，调用回调传递**完整的团队成员列表**（`team_file.members.values()`，非仅变化成员），确保前端 `swarmStore.setTeammates()` 不会丢失其他成员数据
- [x] 3.3 在 `_emit_swarm_status()` 的 `swarm_teammates` 字典中增加 `last_message: str | None` 字段（来自 Agent 内存中最新一条 assistant 消息摘要），供前端 `SwarmMemberPane` 在磁盘 transcript 轮询间隔内即时预览进展
- [x] 3.4 在 `POST /api/swarm/teams/{name}/start` 的 Gateway 路由中，每个 spawn() 返回后调用 `host._emit_swarm_status()`，携带**所有** TeamMember 的完整字典列表（包含 session_id 和 status），确保前端不丢失其他成员数据
- [x] 3.5 在 `protocol.ts` 的 `SwarmTeammate` 接口中新增 `session_id?: string` 和 `last_message?: string` 字段；更新 `swarmStore.ts` 的 `setTeammates()` 确保字段透传

## 4. 前端：launchTeam 改走新 API

- [x] 4.1 修改 `HLAgent/web/src/utils/swarmApi.ts` 的 `launchTeam()`：改为 `POST /api/swarm/teams/{name}/start`，移除 prefill/autosubmit 逻辑
- [x] 4.2-UPDATED 成功后：① `uiStore.getState().setTeamSessionTask(session_id, taskDesc)` 保存任务内容；② navigate 到 `/chat/{session_id}?team={task_team}`（用响应中的 `task_team` 字段，而非模板团队名）；③ ChatPage header 显示原始模板团队名（从 `expert_role_label` 中的 `🤝 {templateName}` 获取）
- [x] 4.3 在 `uiStore.ts` 中新增 `teamSessionTask: Record<string, string>` 字段和 `setTeamSessionTask(sessionId, task)` action
- [x] 4.4 移除 `AppLayout.tsx` 中的 `prefill`/`autosubmit` URL 参数处理 useEffect（该逻辑是为 Swarm 临时添加的，`handleSingleChat` 不受影响）

## 5. 前端：成员选择栏 + 分栏 Pane 组件

- [x] 5.1 新建 `HLAgent/web/src/components/SwarmMemberBar.tsx`：水平成员选择栏，props 为 `{ members: TeamMember[], selectedMemberId: string | null, onSelect: (agentId: string | null) => void }`；初始显示"正在启动团队..."灰色文字；session_id 为 null 的 chip 透明度 0.5 + `pointer-events: none`（禁止点击）；session_id 就绪后激活为可点击；chip 溢出时 `overflow-x: auto`（隐藏滚动条）；chip 最大宽度 120px + 截断
- [x] 5.2 选中状态的 chip：原位置 chip 仅高亮边框（不就地展开），展开信息显示在选择栏**右对齐固定区域**（成员名称 + 状态 + ✕，其他 chip 位置不变）；选择栏背景 `#1e1e2e`（比 header 稍亮），上边框 `1px solid #313244`
- [x] 5.3 新建 `HLAgent/web/src/components/SwarmMemberPane.tsx`：右侧只读成员 transcript，props 为 `{ member: TeamMember, onClose: () => void }`；顶部固定 sticky 条（28px）：成员名称只读徽章 + `←` 收起按钮（右对齐），随滚动保持可见；实现智能自动滚动：距底部 < 100px 时自动追踪，用户向上滚动 > 100px 时暂停 + 显示"↓ 新内容"按钮
- [x] 5.4 `SwarmMemberPane` 每 3s 轮询 `GET /api/swarm/agents/{id}/transcript`（session_id 就绪后），接收 `swarm_status` 的 `last_message` 即时更新；组件卸载时清理轮询
- [x] 5.5 所有成员 idle/stopped 时，选择栏右侧显示 `✅ 任务已完成` 标记（来自 swarmStore 派生状态）

## 6. 前端：AppLayout ChatView 集成分栏视图

- [x] 6.1 重构 `ChatView` 布局为三层（注：`MessageInput` 需从 ChatView 直属子级迁移至 LeaderPane 内部）：
  ```
  ChatView (column)
    └─ Header (44px, full-width)
    └─ CompactProgressBar
    └─ SwarmMemberBar (36px, 仅 isTeamSession 时显示)
    └─ ContentRow (flex: 1, row) [ref=containerRef 用于 resize 计算]
         └─ LeaderPane (flexBasis=`${paneRatio*100}%`, flex-grow:0, flex-shrink:0, min-width:30%)
              └─ TranscriptViewer (flex: '1 1 0')
              └─ MessageInput (flexShrink: 0)       ← 从 ChatView 迁入
         └─ ResizeDivider (width:5px, cursor:col-resize) ← selectedMember 非 null 时
              onMouseDown → 注册 document mousemove/mouseup 监听器
              onMouseUp → 清理监听器
         └─ SwarmMemberPane (flexBasis=`${(1-paneRatio)*100}%`, flex-grow:0, flex-shrink:0, min-width:30%)
  ```
- [x] 6.2 在 `ChatView` 中增加 `selectedMemberId: string | null` state 和 `paneRatio: number` state（默认 0.5）；`SwarmMemberBar` 的 `onSelect` 更新 `selectedMemberId`；当 `selectedMemberId !== null` 时渲染 `ResizeDivider` + `SwarmMemberPane`；paneRatio 通过 `flexBasis: \`${paneRatio*100}%\`` 应用（不用 `flex: 1`，否则比例不可变）
- [x] 6.3 挂载时调用 `GET /api/swarm/teams/{teamName}` 一次加载成员列表（含 session_id），存入 `members: Record<string, TeamMember>` state；`useEffect([swarmTeammates])` 以 `name` 字段为关联键合并 WS 事件中的 `status`、`last_message`、`session_id` 更新到 members state（不替换 REST 获取的 session_id，WS session_id 优先）
  > **⚠️ Bug 修复（见 6.3-FIX）**：当前代码用 `teamName`（模板名，已去掉时间戳）fetch，模板没有 session_id，导致所有 chips 禁用
- [x] 6.3-FIX **修复成员列表 fetch 使用正确的任务团队名**：
  - `expert_role_label = "🤝 marketing-team"`（模板名，Gateway 写入）→ `taskTeamName = "marketing-team"` → 与 `teamName` 相同，无法区分
  - 任务团队名在 URL 参数 `?team=marketing-team-20260524-095500`，需用 `useSearchParams()` 读取
  - 修复：在 `ChatView` 中加 `const [chatParams] = useSearchParams(); const fetchTeamName = chatParams.get('team') || teamName`；fetch 用 `fetchTeamName`
  - 对于 7-ARCH，`chatParams.get('team')` 会是 URL-encoded 的 run_id（如 `marketing-team%2F小红书带货推广`）；decode 后含 `/`，需用新端点 `GET /api/swarm/teams/{team}/runs/{slug}` 避免路径歧义
- [x] 6.4 窄屏处理（< 900px）：`selectedMemberId !== null` 时在成员选择栏左侧显示"← Leader / {成员名} →" Toggle 按钮；单次只显示一栏；LeaderPane 默认可见
- [x] 6.5 将 header 中现有 "→ 查看进展" 按钮改为 "⊞ 管理团队"（跳转 SwarmPage）
- [x] 6.6 将 `task` 内容存入 `uiStore.teamSessionTask`；ChatView header 显示任务摘要（截断 40 字）；所有成员 idle/stopped 时更新 header 任务状态为 `✅`
- [x] 6.7 ChatPage 输入框 placeholder 改为"可向 Leader 补充说明或调整方向..."（仅团队 session，更口语化）
- [x] 6.8 收到 `swarm_status` 事件时刷新 `SwarmMemberBar` chip 状态和 `SwarmMemberPane` 内容

## 7. 前端：SwarmPage 轮询改为事件兜底

- [x] 7.1 将 SwarmPage 中 configured 状态的 3s 轮询改为：首次加载时 fetch 一次，之后监听 `swarmStore.teammates` 变化触发刷新
- [x] 7.2 保留 15s 轮询作为兜底（超过 30s 无 `swarm_status` 事件时触发一次 `refreshSelected`）
- [x] 7.3 `swarm_status` 事件中若包含 `session_id`，SwarmPage 的 members 状态直接从事件更新，不额外 fetch

## 7-NEW. 后端：任务团队副本机制（当前临时实现，待升级）

> **⚠️ 以下任务基于临时方案（时间戳命名 + 同一 teams/ 目录），后续将按决策 A/B 重构**

- [x] 7N.1 在 `TeamLifecycleManager` 新增 `clone_team(source_name, new_name)` 方法：复制源团队的 `team.json`（成员 prompt/color 等），session_id/task_id 全部置为 null，保存到 `{new_name}/team.json`
- [x] 7N.2 在 `GET /api/swarm/teams` 中新增 `template_only: bool = True` 参数（默认只返回模板团队，即名称不含时间戳的团队）；SwarmPage 调用此接口，不再显示任务副本团队
- [x] 7N.3 修改 `POST /api/swarm/teams/{name}/start`：调用 `clone_team()` 创建 `{name}-{yyyymmdd-HHMMss}` 任务副本，在副本中 spawn 成员，原模板团队完全不修改；响应新增 `task_team` 字段
- [x] 7N.4 任务副本团队在 SwarmPage 中**不显示**（保持团队列表清洁），但可通过 `GET /api/swarm/teams/{name}/tasks` 查询历史运行记录（列出所有 `{name}-*` 副本）
- [x] 7N.5 移除 `/start` 中原来的"重置成员 session_id/task_id"逻辑（被任务副本机制替代）

## 7-ARCH. 存储架构升级（决策 A + B，替代 7-NEW 的临时方案）

> **此组任务是对 7-NEW 的重构，实现后 7-NEW 的临时方案将被废弃**
>
> **✅ 选定方案 B（并发 mailbox 隔离）**：每个 run 有独立 mailbox 路径，支持同一团队并发多 run。
>
> **核心机制**：在 `TeammateSpawnConfig` 新增 `mailbox_team_path` 字段，成员据此写 idle_notification 到 run 专属目录，Leader 从同一目录读取。

### A. 目录结构分离

- [x] A.1 在 `src/openharness/swarm/mailbox.py` 新增：
  - `get_team_task_dir(team_name, run_slug)` → `<config_dir>/teams-tasks/{team_name}/{run_slug}/`
  - `get_team_task_mailbox_dir(team_name, run_slug, agent_id)` → `<config_dir>/teams-tasks/{team_name}/{run_slug}/agents/{agent_id}/inbox/`（不调用 `get_team_dir()`，直接构建路径，绕过 `_SAFE_NAME_RE`）
  - 保留 `get_team_dir()` 供模板路径（不破坏现有代码）
- [x] A.2 `TeamLifecycleManager` 新增 `list_templates()` 方法（只扫 `<config_dir>/teams/`）和 `list_tasks(team_name)` 方法（扫 `<config_dir>/teams-tasks/{team_name}/`，读各子目录的 `meta.json`）
- [x] A.3 `GET /api/swarm/teams` 改用 `list_templates()`；`GET /api/swarm/teams/{name}/tasks` 新增端点，返回该团队所有历史运行（含 `meta.json` 中的 goal 描述）

### B. Leader 创建运行目录（`swarm_create_run` 工具）+ 并发 mailbox

- [x] B.0 在 `src/openharness/swarm/types.py` 的 `TeammateSpawnConfig` 新增字段：
  ```python
  mailbox_team_path: str | None = None
  """若设置，idle_notification 写入此路径下的 leader mailbox，而非 config.team 路径。
  用于支持每个 run 拥有独立 mailbox（并发多 run 场景）。"""
  ```
- [x] B.0a 修改 `src/openharness/swarm/mailbox.py` 的 `TeammateMailbox.__init__`：新增可选参数 `inbox_dir: Path | None = None`；若设置，`get_mailbox_dir()` 直接返回此路径（创建目录），完全绕过 `get_agent_mailbox_dir()` 的名称验证。**这是比新建 `_write_mailbox_raw` helper 更优雅的方案，所有现有方法（read_all、write 等）无需修改**：
  ```python
  class TeammateMailbox:
      def __init__(self, team_name: str, agent_id: str, inbox_dir: Path | None = None):
          self.team_name = team_name
          self.agent_id = agent_id
          self._inbox_dir = inbox_dir
      def get_mailbox_dir(self) -> Path:
          if self._inbox_dir is not None:
              self._inbox_dir.mkdir(parents=True, exist_ok=True)
              return self._inbox_dir
          return get_agent_mailbox_dir(self.team_name, self.agent_id)
  ```
- [x] B.0b 修改 `src/openharness/swarm/in_process.py` 中发送 `idle_notification` 的逻辑（**仅改"成员→Leader"方向**）：
  ```python
  if config.mailbox_team_path:
      team_part, run_slug = config.mailbox_team_path.split("/", 1)
      inbox_path = get_team_task_mailbox_dir(team_part, run_slug, "leader")
      leader_mailbox = TeammateMailbox(config.team, "leader", inbox_dir=inbox_path)
  else:
      leader_mailbox = TeammateMailbox(team_name=config.team, agent_id="leader")
  await leader_mailbox.write(idle_msg)
  ```
  **不再需要 `_write_mailbox_raw()` helper**（利用 B.0a 的 `inbox_dir` 参数）
- ~~B.0c~~（已删除：SubprocessBackend 不发 idle_notification，环境变量透传无意义）
- ~~B.0d~~（已删除：`run_task_worker()` 位于 `ui/app.py` 而非 `in_process.py`，且不写 mailbox）
- [x] B.1 新建 `src/openharness/tools/swarm_create_run_tool.py`：
  - 参数：`team: str`（模板名），`goal: str`（目标描述，任意字符≤50字）
  - **run 目录名直接使用任务目标**（中文友好）：将 `goal` 中的文件系统非法字符（`/\:*?"<>|`）替换为 `-`，截断到 60 字符；同名冲突追加 `-{HHMMss}` 后缀
  - 在 run 目录创建 `meta.json`：`{"goal": goal_original, "team": team, "started_at": ...}`
  - 克隆 `teams/{team}/team.json` 成员定义到 `teams-tasks/{team}/{goal_slug}/team.json`
  - **agent_id 保持 `name@team`（模板团队名）**，避免双 `@`
  - 返回：`run_id = f"{team}/{goal_slug}"`（`/` 分隔，不含 `@`）
- [x] B.2 注册 `SwarmCreateRunTool` 到 `create_default_tool_registry()`
- [x] B.3 修改 `swarm_spawn_member` 工具：新增可选 `run_id: str | None` 参数；提供时：① team.json 读写从 `teams-tasks/{team}/{goal_slug}/` 路径；② `TeammateSpawnConfig.mailbox_team_path = run_id`（使成员写 idle_notification 到 run 专属目录）；`agent_id` 仍为 `name@template_team_name`
- [x] B.3b 修改 `swarm_list_members`、`swarm_shutdown_member` 等工具：支持 `run_id` 参数，从 `teams-tasks/` 路径读取 team.json
- [x] B.3c 修改 `swarm_wait` 工具：接受 `run_id: str | None` 参数；提供时解析为 `(team, goal_slug) = run_id.split("/", 1)`，用 `TeammateMailbox(team, "leader", inbox_dir=get_team_task_mailbox_dir(team, goal_slug, "leader"))` 读 mailbox（利用 B.0a 的 `inbox_dir` 参数完全绕过验证）；否则 fallback 到模板路径（向后兼容）
- [x] B.4 更新 `_LEADER_SYSTEM_PROMPT_TEMPLATE`：工作流第 0 步调用 `swarm_create_run(team='{team_name}', goal='<目标摘要>')` 获得 `run_id`；后续所有 swarm 工具（`swarm_spawn_member`、`swarm_wait`、`swarm_list_members`）均传入 `run_id`，实现完整的 run 级别隔离
- [x] B.5 **`/start` API 过渡到 teams-tasks 架构**：当前 1.6-NEW [x] 实现的是在 `teams/` 目录创建时间戳副本；7-ARCH 完成后，`/start` 改为在 `teams-tasks/` 创建空占位 run（无 goal，timestamp 命名），返回 `run_id` 供 ChatPage 加载；Leader 调用 `swarm_create_run` 后更新 meta.json 的 goal 字段。**此任务依赖 A.1 完成后才能修改 `/start` 的副本创建逻辑**

## 8. 验证

- [x] 8.1 点击"启动团队"后，ChatPage 显示第一条用户消息（任务内容）+ Leader 正在响应，不显示任何 `/swarm start` 命令
- [x] 8.2 ChatPage header 下方显示成员选择栏（成员 chips + 状态徽章）
- [x] 8.3 点击成员 chip，ChatPage 变为左右分栏：左侧 Leader 全功能，右侧只读成员 transcript
- [x] 8.4 右侧成员 transcript 实时更新（`last_message` 即时，磁盘轮询 3s 补全）
- [x] 8.5 点击 ✕ 或再次点击成员 chip，回到全宽 Leader 视图
- [x] 8.6 Agent spawn 成功后，成员 chip 状态徽章立即切换为 active（无需轮询）
- [x] 8.7 Agent 完成任务时，chip 状态更新为 idle，选择栏右侧显示 `✅ 全部完成`（已修正：pane 无独立 header）
- [x] 8.8 窄屏（< 900px）分栏时，Toggle 按钮可切换查看 Leader / 成员内容
- [x] 8.9 重连验证：用户刷新 ChatPage，任务消息不重复发送
- [x] 8.10 非团队 session 的 ChatPage 无成员选择栏

---

## R1. 架构修订 — 运行时隔离 + in_process 成员

> 对应 design.md 的 R1 章节，基于 s10_team_protocols 协议规范。
> **背景**：当前实现中 member 走 subprocess 且运行时状态污染模板目录，需修正。

### R1.1 成员 in_process 化

- [x] R1.1.1 `InProcessBackend._register_defaults()` 移除 `supports_swarm_mailbox` 平台检查，始终注册 `in_process` 后端（所有平台可用）
- [x] R1.1.2 `swarm_spawn_member_tool.py` 默认使用 `in_process` 后端（member.backend_type → fallback to "in_process"）
- [x] R1.1.3 修复 `_build_member_query_context` 中 `try/finally` 嵌套层级错误（当前导致 `ctx.status = "idle"` 在 finally 外部执行时序不确定）
- [x] R1.1.4 `InProcessBackend.spawn()` 中的 `query_context = await _build_member_query_context(config)` 若抛出异常，应 gracefully fallback 并返回 `SpawnResult(success=False, error=...)`

### R1.2 模板目录只存静态配置

- [x] R1.2.1 `swarm_spawn_member_tool.py` 写 session_id / task_id **只写 run 的 team.json**（`teams-tasks/{team}/{run_slug}/team.json`），不写模板目录
- [ ] R1.2.2 `TeamMember.to_dict()` / `from_dict()` 仍保留 session_id 字段（运行时 team.json 需要它），但 `TeamLifecycleManager.update_member_session()` 增加断言：只能用于 `teams-tasks/` 路径，不允许用于 `teams/` 路径
- [ ] R1.2.3 `TeamMember` 的 `status`、`is_active` 字段在模板 team.json 写入时强制 reset（不写运行时状态）：`clone_team()` 已有此逻辑，`swarm_spawn_member_tool` 的写路径也需保证
- [ ] R1.2.4 验证：启动任意团队任务后，`teams/{name}/team.json` 中 session_id 字段全为 `null`

### R1.3 成员模型继承 Leader

- [x] R1.3.1 `_build_member_query_context(config)` 优先使用 `config.model`（Leader 传入），再 fallback `load_settings().model`
- [x] R1.3.2 `swarm_spawn_member_tool.execute()` 中，`TeammateSpawnConfig.model` 从 Leader 的 `load_settings().model` 填充（若 `arguments.model` 为 None 且 member.model 也为 None）
- [x] R1.3.3 `TeamMember` 的 `model` 字段语义明确为"单独覆盖"：非 None 时优先于 Leader 模型；None 表示继承

### R1.4 所有 Mailbox 在 teams-tasks/

- [x] R1.4.1 `start_in_process_teammate`：Member 自身 inbox 当 `mailbox_team_path` 设置时使用 run 路径（已修复）
- [ ] R1.4.2 `send_agent_message` Gateway API 接受可选 `run_id` query param，写入 `teams-tasks/{run_id}/agents/{agent_id}/inbox/`（已部分实现，需验证路径拼接正确性）
- [ ] R1.4.3 验证：完成一次 in_process 成员任务后，`teams/{name}/agents/` 目录不存在或为空

### R1.5 流式输出完整性

- [x] R1.5.1 `in_process.py` 的 `_run_query_loop` 在每个 `assistant_text` delta 推送到 per-session Queue
- [x] R1.5.2 Gateway 新增 `GET /api/swarm/agents/{agent_id}/stream?run_id=...` SSE 端点
- [x] R1.5.3 `SwarmMemberPane.tsx` 使用 `EventSource` 订阅流式输出，成员 active 时实时显示
- [x] R1.5.4 `SwarmMemberPane.tsx` 使用 `TranscriptViewer` 渲染，与 Leader 视图一致
- [ ] R1.5.5 `_run_query_loop` 中 tool_start / tool_end 事件推送到 Queue，使右侧 pane 同步显示工具调用卡片
- [ ] R1.5.6 验证：成员 active 期间，右侧 pane 实时显示 delta 文本；完成后显示完整含工具调用的 transcript

### R1.6 自测

- [x] R1.6.1 [eval] 创建 in_process 成员，swarm_create_run → swarm_spawn_member(run_id) → swarm_wait：验证 mailbox 全在 tasks 目录，session_id 写入 run team.json，transcript 可加载
- [x] R1.6.2 [eval] 模板 `teams/{name}/team.json` 中 session_id 字段全为 null
- [ ] R1.6.3 [eval] 成员模型与 Leader 一致（未单独配置时）
- [ ] R1.6.4 [UI] ChatPage 右侧 SwarmMemberPane 显示流式 delta，格式与 Leader 一致

---

## CR. Coder Review 修复任务

> 基于三层 code review（CR 编号见 design.md）的阻塞和严重问题修复。

### P0 — 阻塞（功能不可用）

- [x] CR-GW-1 `AppLayout` 向 `SwarmMemberPane` 传递 `runId`：维护 `currentRunSlug` state（轮询时赋值），拼为 `runId={fetchTeamName + '/' + currentRunSlug}` 传入
- [x] CR-SDK-1 修复 `_run_query_loop` 中 done 信号与 session save 顺序：`save_snapshot` 移入 `finally:` 块，在 `stream_q.put_nowait(None)` 之前执行
- [x] CR-GW-3 修复中文 `run_slug` 被 Gateway 400 拒绝：扩展 `_SAFE_RUN_SLUG_RE` 允许 Unicode

### P1 — 严重（行为不正确）

- [x] CR-GW-2 修复 `swarm_status` 事件从工具路径未触发：改变 `SwarmMemberPane` SSE 打开条件为"有 session_id 时即尝试连接"（移除对 `memberStatus === 'active'` 的强依赖）
- [x] CR-SDK-2 修复 `ctx.status = "idle"` 和 session save 在 `finally` 外：全部移入 `_run_query_loop` 的 `finally:` 块
- [ ] CR-SDK-4 成员继承 Leader 运行时模型：`start_team` 将实际模型写入 run meta.json；`swarm_spawn_member_tool` 从 run meta.json 读取注入 `TeammateSpawnConfig.model`

### P2 — 次要

- [x] CR-GW-4 `send_message` Gateway API 需确保 run_id 路由正确：Leader 系统提示中 `send_message` 工具描述注明需同时传 `run_id`
- [x] CR-SDK-3 修复 `_run_query_loop` 中 `try:` 块缩进（2 空格 → 4 空格）
- [x] CR-SDK-5 `swarm_spawn_member_tool` 的 `run_id` 字段改为必填（移除 `default=None`），更新 description

### P3 — 建议

- [ ] CR-GW-5 SSE 重连时不删除旧队列，`_run_query_loop` 每次 put 前重查当前活跃队列
- [x] CR-UI-1 `AppLayout` 中 `latestRunSlug` 改为 `useRef<string | null>`
- [x] CR-UI-2 `parseSessionToItems` 补充 `thinking` blocks 解析，对齐 `TranscriptItem.role` 类型


