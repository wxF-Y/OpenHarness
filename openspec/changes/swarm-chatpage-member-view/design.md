## Context

当前 Swarm 协作的三个核心痛点：

1. **启动机制不优雅**：`launchTeam()` 通过 `navigate('/chat/...?prefill=/swarm+start+...&autosubmit=1')` 绕行，ChatPage 会短暂显示一条 `/swarm start` 命令。这是工程临时方案，普通用户看到命令行感到困惑。

2. **跨页面体验割裂**：用户在 ChatPage 看 Leader 对话，但成员 transcript 只能回 SwarmPage 才能看。两个页面维护不同的状态，体验不连贯。

3. **session_id 断链**：Agent spawn 后 `TeamMember.session_id` 从未被回写，导致 `GET /api/swarm/agents/{id}/transcript` 始终 404，SwarmPage 的全览面板无法展示内容（前次变更已做 UI 支持，但缺底层数据）。

**关键数据流约束**（来自代码审查）：
- Gateway 进程内：`session_mgr` 追踪 session，`ReactBackendHost` 管理 WebSocket，两者同进程
- SDK 层：`SubprocessBackend` 创建独立进程（session_id 对 Gateway 不可见），`InProcessBackend` 在同进程 asyncio Task 运行
- WebSocket：已有 `swarm_status` 事件，`_emit_swarm_status()` 方法存在但调用时机不足

## Goals / Non-Goals

**Goals:**
- 新增 `POST /api/swarm/teams/{name}/start` API，Gateway 侧原子化完成启动
- Agent spawn 时将 session_id 回写 TeamMember（补全 task 10.1）
- ChatPage 内嵌 SwarmMemberPanel：可折叠侧边栏，展示各成员实时 transcript
- 状态变化时通过 `swarm_status` WebSocket 实时推送（主动 emit），减少轮询
- Leader 系统提示注入动态任务分发模板，引导 Leader 规划后分派

**Non-Goals:**
- 不修改 SDK 底层的 Mailbox 通信机制
- 不新增数据库或消息队列
- 不实现完整的"任务看板"（Kanban）管理界面
- 不修改已有团队/成员的 CRUD API

## Decisions

### 决策 1：启动 API 设计 — 模板团队 + 任务团队隔离

**⚠️ 注意**：以下图示展示的是**当前临时实现**（7-NEW，已完成），最终方案是 7-ARCH（`teams-tasks/` 独立目录 + Leader 创建 run）。

**当前临时实现（7-NEW，已上线）**：
```
teams/
├── marketing-team/          ← 模板（永不修改）
│   └── team.json
└── marketing-team-20260524-095500/  ← 任务副本（时间戳命名）
    └── team.json            ← session_id/task_id 写入此处
```

**目标最终架构（7-ARCH，待实现）**：
```
teams/
└── marketing-team/team.json         ← 模板
teams-tasks/
└── marketing-team/
    └── 小红书带货推广/               ← run 目录（goal 命名）
        ├── team.json                ← session_id/task_id
        └── meta.json                ← {"goal": "...", ...}
```

**API**（当前已实现）：
```
POST /api/swarm/teams/{teamName}/start
body: { task: "任务描述", model?: string }

响应: { session_id: string, task_team: string, members: TeamMember[] }
```

前端 `launchTeam()` 改为：
- POST 拿到 `{ session_id, task_team }`
- navigate 到 `/chat/{session_id}?team={task_team}`（用任务团队名，不用模板名）
- 侧边栏和 ChatPage 头部显示：`🤝 {templateName} · {task}...`（展示模板名更友好）

**废弃**：`/start` 前的"重置 session_id/task_id"逻辑（已临时实现，现在由任务团队机制替代）

### 决策 2：session_id 回写时机 — spawn 完成后立即同步写 team.json

**方案**：在 `SubprocessBackend.spawn()` 和 `InProcessBackend.spawn()` 中：
- 生成确定性 `session_id`（spawn 前预先生成 UUID），传给子进程/协程作为会话标识
- spawn 返回 `SpawnResult` 时附带 `session_id`
- Gateway 收到 `SpawnResult` 后立即调用 `TeamLifecycleManager.update_member_session_id(agent_id, session_id)`

这样 spawn 完成 → `team.json` 立即有 session_id → transcript API 可用。

**备选**：在 `idle_notification` 里携带 session_id。缺点：Agent 运行期间无法访问 transcript。

### 决策 3：ChatPage 团队视图 — 分栏对比布局（替代 Drawer 方案）

**用户明确的交互模型**：

```
团队模式默认状态（全宽 Leader）:
┌─────────────────────────────────────────────────────┐
│ Header: 🤝 y · 分析代码质量...  [⊞ 管理团队]  ● 已连接 │
│ ─────────────────────────────────────────────────── │
│ [成员选择栏] ai-engineer 🟢  ai-data-remed... 🟡      │
│ ─────────────────────────────────────────────────── │
│                                                     │
│        Leader 会话（全宽，可输入追加指示）            │
│                                                     │
└─────────────────────────────────────────────────────┘

选中成员后（左右分栏）:
┌──────────────────────┬──────────────────────────────┐
│ Header（全宽）                                        │
│ ──────────────────── │ ──────────────────────────── │
│ [成员选择栏] ai-engineer ✓ 🟢  ai-data-remed... 🟡   │
│ ──────────────────── │ ──────────────────────────── │
│  Leader（左侧 50%）   │  ai-engineer（右侧 50%）      │
│  Leader 会话内容      │  成员 transcript（只读）       │
│                      │  🟢 active · 最后更新: 3s 前   │
│  [输入追加指示...]    │  [无输入框 - 只读]             │
└──────────────────────┴──────────────────────────────┘
```

**方案细节**：
- **成员选择栏**：在 Header 下方（固定 36px 高，仅团队模式显示），水平排列成员 chips（名称 + 状态徽章）；点击选中，高亮激活；再次点击取消选中，回到全宽 Leader 视图
- **分栏触发**：选中任一成员 chip 时，右侧展开该成员的 session transcript（只读）
- **分栏比例**：默认 50/50，两栏都可独立滚动；左侧 Leader 保留输入框
- **右侧成员栏**：只读，顶部显示成员名称 + 状态 + 最后更新时间；滚动自动 stick 到底部（实时追踪）；有"关闭 ✕"按钮取消选中
- **窄屏（< 900px）**：分栏时显示 Toggle 按钮切换查看（不压缩到不可用）

**替代旧方案**：移除竖向 Tab + Drawer（SwarmMemberDrawer.tsx），改为成员选择栏 + 分栏视图（`SwarmSplitView`）

**组件重命名**：`SwarmMemberDrawer.tsx` → `SwarmMemberBar.tsx`（成员选择栏）+ `SwarmMemberPane.tsx`（右侧只读 transcript 栏）

## UI 设计审查（分栏方案）

### 问题 1：session_id 未就绪时 Chip 可点击导致误操作（高优先级）

**现象**：成员 chip 在 `session_id = null`（Agent 尚未 spawn）时显示 `⏳`，当前 spec 允许点击并展示右侧 pane 的"正在准备..."动画。用户点击 `⏳` chip 却什么都看不到，会以为交互有问题。

**决策**：session_id 为 null 的 chip **禁止点击**（`pointer-events: none`，透明度 0.5），视觉上明显区分"可交互"和"准备中"状态。spawn 成功（session_id 设置）后 chip 自动变为可点击状态并显示状态徽章。

### 问题 2：成员 pane 自动滚动与用户主动阅读冲突（高优先级）

**现象**：规格说"内容 SHALL 自动 scroll 至底部（实时追踪）"。当用户向上滚动查看成员的历史内容时，3s 轮询触发后会强制把用户拖回底部，打断阅读。

**决策**：智能自动滚动策略：
- 当用户**在底部附近**（距底部 < 100px）时，自动滚动到底部
- 当用户**主动向上滚动**（超过 100px）时，**暂停**自动滚动，显示"↓ 新内容"悬浮按钮
- 用户点击"↓ 新内容"或主动滚回底部时，恢复自动滚动
- 更新 Scenario "成员 transcript 实时显示"中的行为

### 问题 3：成员选择栏横向溢出策略未定义（中优先级）

**现象**：团队成员 ≥ 5 时，36px 横条的水平空间不足以排列所有 chips。当前设计未说明溢出处理方式。

**决策**：
- 默认所有 chips 在一行内，若溢出则水平滚动（`overflow-x: auto`，隐藏滚动条，支持触摸/鼠标横扫）
- chip 最大宽度 120px，超出名称截断 + `...`，hover 显示完整名称 tooltip

### 问题 4：右侧成员 pane 的小 header 叠加视觉层级过重（中优先级）

**现象**：当前布局：44px(全局header) + 36px(成员选择栏) + 成员 pane 自身的 header(约 36px) = 116px chrome，在右侧内容区上方叠了三层 header，视觉层级混乱且浪费垂直空间。

**决策**：移除成员 pane 的独立小 header，将成员信息整合进选择栏：
- 成员选择栏选中某成员后，**选中 chip 展开**显示状态徽章 + 最后更新时间（chip 变宽）
- ✕ 关闭按钮放在选中 chip 右侧
- 右侧 pane 不需要自己的 header，直接从内容区开始

更新后：44px(header) + 36px(成员选择栏，含成员信息) = 80px，减少了一层。

### 问题 5：两栏之间需要明确的分隔线（中优先级）

**现象**：spec 和 tasks 中没有提到 LeaderPane 和 SwarmMemberPane 之间的视觉分隔。两栏紧贴时用户难以感知边界，内容会视觉上混合。

**决策**：
- 两栏之间设 `1px solid #313244` 分隔线（与项目现有 border 颜色一致）
- 分隔线可作为 resize handle（鼠标悬停变为 `col-resize` cursor，支持拖动调节比例）；初始 50/50，最小每栏 30%
- 在 tasks 6.1 中补充分隔线和 resize handle

### 问题 6：36px 成员选择栏初始状态需要过渡处理（低优先级）

**现象**：用户刚进入团队 ChatPage，成员选择栏已显示但所有 chips 均为禁用的 `⏳` 状态，整行看起来是一排灰色的无法点击按钮——让用户觉得功能未加载。

**决策**：成员选择栏初始状态：
- 左侧显示"正在启动团队..."文字（灰色小字，36px 行内）+ 各 chip（灰色禁用）
- spawn 成功逐个激活 chip 后，"正在启动"文字渐隐消失
- 所有 chip 激活后显示完整成员选择栏（无额外文字）

## UX 审查（普通用户路径视角）

### 问题 1：右侧 pane 无 header 但 spec 中"任务完成"显示在"pane header"—矛盾（已修正）

**现象**：上一轮 UI 设计审查决定"移除 pane 独立 header"，但 spec 的"任务完成状态更新" Scenario 中仍写"右侧 pane header SHALL 显示 ✅"。

**修正**：任务完成标记改为显示在**成员选择栏右侧**（`✅ 全部完成`），已更新 spec。

### 问题 2：右侧 pane 无 header 导致用户滚动后失去上下文（高优先级）

**现象**：用户展开右侧成员 pane 后，往上滚动查看历史内容，成员选择栏可能不在视野内。此时用户看着一堆 Markdown 内容，不知道这是哪个成员在执行什么。

**修正**：保留一个轻量 **sticky 28px 条**（不是完整 header）：成员名称只读徽章 + `←` 收起按钮（右对齐）。这比完整 header 更节省空间，但解决了上下文丢失问题。已更新 spec，新增"成员 pane 顶部固定名称标识"Scenario。

### 问题 3：选中 chip "就地展开"导致布局跳动（中优先级）

**现象**：用户点击 chip 后，该 chip 在原位置展开（变宽）显示更多信息，会把其他 chip 向右推移，产生明显的布局跳动，破坏稳定感。

**修正**：选中 chip 的展开信息**右对齐显示在选择栏固定区域**（不在原位置展开），其他 chip 位置不变。已更新 spec，新增"选中 chip 展开位置不影响其他 chip 布局"Scenario。

### 问题 4："向 Leader 发送追加指示..." placeholder 表意不清（中优先级）

**现象**：普通用户看到"追加指示"不知道是什么意思，会以为自己需要写类似 `/swarm start` 这样的命令，或者觉得不需要再操作了。

**修正**：改为更口语化的表述：**"给 Leader 发消息，追加说明或调整方向..."**（更长但意义明确）或简化版 **"可向 Leader 补充说明..."**

### 问题 5：选择栏背景色与 header 融为一体（低优先级）

**现象**：选择栏（header 下方）和 header 如果用相同背景色（`#181825`），视觉上融为一体，用户可能不注意到成员选择栏的存在，以为那行灰色内容是 header 的一部分。

**修正**：选择栏用 `#1e1e2e`（比 header 的 `#181825` 稍亮），并在上边框加 `1px solid #313244` 分隔线，视觉上清晰区分 header 和成员选择栏。

### 决策 4：实时状态推送 — 在 spawn 和状态变化时主动 emit

**方案**：在以下时机调用 `_emit_swarm_status()`：
1. 每个 Agent spawn 成功后（包含新的 session_id）
2. Agent 状态变化时（via `idle_notification` 处理逻辑）
3. 前端收到 `swarm_status` 事件后，更新 `swarmStore.teammates`，触发 Drawer 刷新

前端移除 SwarmPage 的 3s/15s 轮询，改为纯事件驱动。

### 决策 5：Leader 动态任务分发 — 系统提示注入

**方案**：在 `POST /api/swarm/teams/{name}/start` 构建 Leader 系统提示时，注入：

```
你是团队 {teamName} 的 Lead Agent。
团队成员：
{members_description}

工作流程：
1. 理解用户的任务需求
2. 将任务分解为具体的子任务
3. 根据每个成员的专长将子任务分派给合适的成员（使用 delegate_task 工具）
4. 收集成员的完成通知，整合结果，向用户汇报
```

这样 Leader 会根据实际任务动态规划分派，而非固定工作流。

## Risks / Trade-offs

- **[风险] SubprocessBackend session_id 预生成**：子进程需要接受外部传入的 session_id 并使用它（而不是自己生成），需要修改子进程启动参数。如果子进程已有特殊 session_id 生成逻辑，需谨慎合并。
- **[风险] Gateway 直接 spawn Agent** 需要理解 `/swarm start` 斜杠命令的现有处理路径，避免重复逻辑或绕过必要检查。
- **[取舍] SwarmMemberDrawer 宽度压缩 ChatPage**：展开后 ChatPage 内容区域变窄。在窄屏（<1200px）上需要 Drawer 覆盖而非推挤。
- **[取舍] 移除 prefill/autosubmit 是 BREAKING 变更**：单独对话（handleSingleChat）也用 prefill 机制，需单独保留。

## UI 设计审查

### 问题 1：Drawer 触发按钮位置 — 44px Header 已拥挤（高优先级）

**现象**：当前 ChatView header（44px）已有：模型名、expert label 徽章（含"→ 查看进展"按钮）、WS 状态、设置按钮。设计文档中"在 chat 区域右侧渲染触发按钮"措辞模糊，若放入 header 会进一步拥挤。

**决策**：触发按钮应使用**右侧竖向 Tab**（不在 header 内），即在 chat 内容区域的右边框中间放一个竖向细条按钮（宽 20px，高 60px），显示 `🤝 N`。点击后 Drawer 从右侧 slide in。这样不占 header 空间，且发现性好。

**同时**：header 中现有的"→ 查看进展"按钮保留但改为"↗ SwarmPage"（导航到完整 SwarmPage），与 Drawer 功能差异化（Drawer = 快速查看，SwarmPage = 完整管理）。

### 问题 2：ChatPage 启动后空白聊天 — 用户无任务上下文（高优先级）

**现象**：新 API 启动后 ChatPage 不显示任何 `/swarm start` 命令。用户导航到空白聊天，不知道 Leader 在执行什么任务。之前的 prefill 虽然是命令行风格，但起码让用户知道任务内容。

**决策**：在 ChatPage 顶部 header 的 expert label 行旁显示任务摘要（截断 40 字）：
```
🤝 y · 分析代码质量...
```
或在 chat 区域顶部插入一个"任务卡片"（系统消息样式）：
```
╔══════════════════════╗
║ 🚀 团队任务已启动    ║
║ 分析代码质量         ║
╚══════════════════════╝
```
需要把 `task` 参数从 `/start` 响应传到前端并存储（`uiStore` 或 `teamSessionTask`）。

### 问题 3：Drawer 布局需要重构 ChatView 结构（中优先级）

**现象**：当前 ChatView 是 `flexDirection: column`：Header → TranscriptViewer → MessageInput。要在右侧加 260px Drawer 且 Drawer 不遮挡 MessageInput，需要把 TranscriptViewer + MessageInput 包在一个 `flexDirection: row` 的容器里：

```
ChatView (column)
  └─ Header (44px, full-width)
  └─ CompactProgressBar (full-width)
  └─ ContentRow (flex: 1, row)           ← 新增包裹层
       └─ ChatColumn (flex: 1, column)
            └─ TranscriptViewer
            └─ MessageInput
       └─ SwarmMemberDrawer (260px | 0px)
```

否则 MessageInput 会被 Drawer 遮挡，或 Drawer 会撑到整个屏幕高度（包含 header）。

### 问题 4：Drawer 展开时 Transcript 内容过窄（中优先级）

**现象**：260px 宽的 Drawer 显示每个成员的 Markdown transcript（含代码块、表格、长段落），可读性极差。

**决策**：
- Drawer 默认展示"成员列表 + 最后一条消息预览（前 80 字）"（折叠态）
- 展开单个成员时：只显示最近 5 条消息，超出显示"查看完整记录 →"链接（跳到 SwarmPage 该成员的 Transcript 标签）
- Drawer 成员面板 `maxHeight: 200px`，内部独立滚动

### 问题 5："→ 查看进展"与 Drawer 功能重叠导致导航混乱（中优先级）

**现象**：现在 ChatPage header 有"→ 查看进展"（去 SwarmPage）。新增 Drawer 后，两者都是"查看团队成员内容"入口，用户不清楚区别。

**决策**：明确差异化：
- **Drawer**（ChatPage 内嵌）：快速查看各成员最新进展，适合"边看 Leader 对话边瞥一眼成员"
- **SwarmPage**（跳转）：完整的团队管理，包括 Mailbox 审批权限请求、历史记录
- Header 中"→ 查看进展"按钮改文案为"⊞ 管理团队"，视觉上与 Drawer 触发区分开

### 问题 6：Drawer 初始空状态 — "等待启动" 不够有信息量（低优先级）

**现象**：用户刚进入 ChatPage，所有成员 session_id 都是 null，Drawer 全部显示"等待启动…"。用户不知道启动是否成功，不知道要等多久。

**决策**：
- 初始状态显示：成员名称 + 角色描述 + `⏳ 正在准备...` 动画点（3 个点 fade in/out）
- spawn 成功后（`swarm_status` 事件到来）立即切换为 `🟢 active` 状态
- 整个 Drawer 顶部增加团队启动进度条：`0/N 成员就绪` → `1/N 成员就绪` → ... → `全部就绪`

### 问题 7：任务在 API 调用后从 SwarmPage 丢失上下文（低优先级）

**现象**：用户在 SwarmPage 的任务输入框写了任务描述，点击"启动团队"。之后无论在 ChatPage 还是回 SwarmPage，原来输入的任务内容消失了（`teamTaskDesc` state 清空）。

**决策**：
- `/start` API 成功后，将 `task` 内容存入 `uiStore` 的 `teamSessionTask: Record<session_id, string>` 字段
- ChatPage header 的任务摘要从此处读取
- SwarmPage "查看上次任务"也可从此读取，让用户了解当前团队正在执行什么

---

## UX 审查（用户路径视角）

### 问题 8：ChatPage 空白等待 — Leader 不会自动开始工作（关键架构缺陷）

**现象（最高优先级）**：新 API 创建 session 并注入系统提示，但**没有发送任何用户消息**。Claude API 需要用户消息才会响应——系统提示注入任务内容后，Leader 仍在等待第一条用户消息才能开始工作。用户进入 ChatPage 看到空白的"发送消息开始对话"，不知道是否应该自己输入，不知道任务是否在执行。

**决策**：`/start` API 在创建 session 后，需要额外执行一次"发送第一条用户消息"：

```python
# 方案：API 在创建 session 后自动发送任务作为第一条用户消息
await session_send_message(session_id, task)
# 用户在 ChatPage 看到的第一条消息：
# 「你」: 请帮我分析代码质量
# Leader: 好的，我将协调团队...（开始工作）
```

这样 ChatPage 进入时显示的是**有内容的对话**，用户能立即知道任务已开始，不需要再输入任何东西。与之前 `/swarm start` 命令相比，用户看到的是自然的中文对话而非技术命令。

### 问题 9：竖向 Tab 发现性极差（高优先级）

**现象**：20px 宽的竖向 Tab 位于内容区右边框，普通用户根本不会去看页面边缘区域。第一次使用时，用户不知道有成员面板可以查看。

**决策**：
- 首次进入团队 ChatPage 时，Tab 按钮做 **2 秒脉冲动画**（发光 + 轻微扩张）引导用户注意
- Tab 按钮悬停时显示 tooltip：`"查看团队成员进展"`
- 首次展开后取消动画（存入 `localStorage` 标记）

### 问题 10：Leader 工作期间用户不知道能不能发消息（中优先级）

**现象**：ChatPage 底部有消息输入框。团队任务在自动执行中，用户是否应该发消息？发了会怎样？Leader 能收到吗？设计未说明。

**决策**：
- 任务执行期间，输入框保持可用（用户可以给 Leader 发追加指示）
- 输入框 placeholder 改为"向 Leader 发送追加指示..."（区别于普通对话的"发送消息"）
- Leader 的系统提示中应说明："用户可能会发送追加指示，请响应并按需更新分配"

### 问题 11：任务完成后没有明确的结束信号（中优先级）

**现象**：Leader 汇总完成后，用户不清楚任务是否结束。Drawer 的"✅ 全部就绪"只表示 spawn 成功，不表示任务完成。用户可能会困惑地在 ChatPage 等待，或者错过完成通知。

**决策**：
- Leader 系统提示中应包含结束时的约定格式（如"任务完成，汇总如下："开头的段落）
- 当所有成员状态变为 `idle/stopped` 时，Drawer 进度条改为"✅ 任务已完成"（区别于"全部就绪"的 spawn 状态）
- ChatPage 顶部 header 同步更新任务状态徽章：`🔄 执行中` → `✅ 已完成`

### 问题 12："查看完整记录 →" 跳走打断任务观察（低优先级）

**现象**：用户在 Drawer 展开某成员的 transcript，看到"查看完整记录 →"，点击后跳转到 SwarmPage。此时用户离开了 ChatPage，Leader 的对话进度丢失。

**决策**：
- "查看完整记录 →" 改为打开一个**浮层 Modal**（而非导航跳转），在 Modal 里展示完整 transcript
- 保留"在 SwarmPage 中打开 ↗"作为可选的完整页面链接
- 这样用户关闭 Modal 后仍回到 ChatPage 继续观察 Leader

---

## 三层接口分析（Coder 视角）

### 层级架构确认

```
UI (React/TypeScript)
  └─ swarmApi.ts            → POST /api/swarm/teams/{name}/start
  └─ SwarmMemberDrawer.tsx  → GET /api/swarm/teams/{name} + GET /api/swarm/agents/{id}/transcript
  └─ swarmStore.ts          → 订阅 swarm_status 事件

Gateway (Python FastAPI)
  └─ routers/swarm.py       → 新增 /start 路由
  └─ session_mgr            → create_with_id(session_id, AgentSessionConfig)
  └─ WebBackendHost         → push_request() + _emit_swarm_status()

SDK (Python openharness)
  └─ swarm/subprocess_backend.py → spawn() 需回传 session_id
  └─ swarm/in_process.py         → spawn() 需回传 session_id
  └─ swarm/types.py              → TeammateSpawnConfig.session_id (已有字段)
  └─ ui/backend_host.py          → _emit_swarm_status() (已定义未调用)
```

### 发现 1：`session_mgr.create_with_id()` 支持系统提示 ✅

**验证**：`session_mgr.create_with_id(session_id, config: AgentSessionConfig)` 接受 `AgentSessionConfig`，其中包含 `system_prompt: str | None`。Leader 的系统提示可以在 API 创建 session 时直接注入，无需额外步骤。返回值是 `(session_id, WebBackendHost)` 元组——这个 `host` 引用对后续的 `push_request()` 和 `_emit_swarm_status()` 调用非常关键，**必须由 API 处理函数保存并使用**。

### 发现 2：发送第一条用户消息可通过 `host.push_request()` 实现 ✅（但有时序约束）

**验证**：`WebBackendHost.push_request(FrontendRequest(type="submit_line", line=task))` 将消息推入 session 的内部队列。消息在用户 WebSocket 连接建立后自动处理（先进先出）。

**时序约束**：
1. `/start` API 创建 session → 调用 `push_request(task)` 入队
2. 用户 navigate 到 ChatPage，WebSocket 连接
3. session 处理队列中的 task 消息，Leader 开始响应

**关键风险**：`push_request()` 是同步方法，但 session 处理是 async 的。需确认：若用户在 Leader 开始响应前断开/重连，队列中的消息是否会丢失或重复处理。需要在 tasks 中加验证步骤。

### 发现 3：`TeammateSpawnConfig.session_id` 字段已存在 ✅（只需接线）

**验证**：`src/openharness/swarm/types.py` 中的 `TeammateSpawnConfig` 已定义：
```python
session_id: str | None = None
"""Explicit session ID (generated if not provided)."""
```

这意味着预生成 UUID 并传入的设计已被架构预留。**需要做的仅是**：
1. 在 `InProcessBackend.spawn()` 中读取 `config.session_id` 并使用（而非自生成）
2. 在 `SubprocessBackend.spawn()` 中通过 `OPENHARNESS_SESSION_ID` 环境变量透传
3. 在 `SpawnResult` 中新增 `session_id: str` 字段并返回

### 发现 4：`_emit_swarm_status()` 已定义但从未被调用 ⚠️（实现量被低估）

**验证**：`src/openharness/ui/backend_host.py` 中方法存在，但整个代码库中**没有任何地方调用它**。设计文档中"确保 spawn 后立即 emit"和"idle_notification 处理时 emit"的描述，意味着需要找到并修改以下位置：

1. **spawn 成功后**：在 `POST /api/swarm/teams/{name}/start` 的 Gateway 路由中，每个 `spawn()` 返回后，用 Leader 的 `host._emit_swarm_status()`
2. **Agent idle 时**：在 `in_process.py` 的 `_drain_mailbox()` 或 `finally` 块中，通过某种机制通知 Gateway 发 emit。问题：`in_process.py` 在 SDK 层，没有直接引用 Gateway 的 `WebBackendHost`；需要通过回调（callback）或全局 context 变量传递 emit 函数

**需要更新 tasks 3.1**：补充"如何从 in_process 回调 Gateway 的 `_emit_swarm_status()`"的具体方案（建议：`TeammateSpawnConfig` 中增加 `on_status_change: Callable | None` 回调字段）。

### 发现 5：`SwarmTeammate` 前端类型缺少 `session_id` 字段 ⚠️

**验证**：`protocol.ts` 中的 `SwarmTeammate` 接口：
```typescript
export interface SwarmTeammate {
  name: string
  status: SwarmStatus      // 'running' | 'idle' | 'done' | 'error'
  duration?: number
  task?: string
}
```

设计要求 `_emit_swarm_status()` 的事件包含 `session_id`，但前端类型没有此字段。`SwarmMemberDrawer` 需要 `session_id` 来调用 transcript API。

**需要**：
- 在 `SwarmTeammate` 中新增 `session_id?: string` 字段
- 在 `swarmStore.ts` 中的 `setTeammates()` 处理逻辑确保字段透传
- 后端 `_emit_swarm_status()` 中 teammates 字典包含 `session_id`

### 发现 6：运行中的 Agent transcript 是内存实时数据，磁盘 snapshot 有延迟 ⚠️

**验证**：Agent 执行时 transcript 在 `QueryEngine._messages` 内存中维护，仅在以下时机写入磁盘：用户中断、会话完成、定期快照保存点。

**影响**：Drawer 的 3s 轮询通过 `GET /api/swarm/agents/{id}/transcript` 读取磁盘数据。对于**正在执行的 Agent**，每隔几十秒才会有新数据，3s 轮询大量是空转请求，且数据明显滞后。

**可接受的短期方案**：保持 3s 轮询，但在 `swarm_status` 事件中附带最后一条消息的预览（而非全量 transcript），这样不需要磁盘读取就能给用户即时反馈。spec 中应补充此说明。

**需要更新 tasks 3.3**：`swarm_status` 事件的 `swarm_teammates` 中增加 `last_message: str | None` 字段（来自内存的最新一条 assistant 消息摘要）。

### 更新后的 tasks 关联

| 原任务 | 发现问题 | 需要调整 |
|--------|---------|---------|
| 1.5 发送第一条用户消息 | push_request() 队列时序有风险 | 增加验证步骤 |
| 2.1-2.3 session_id 回写 | 字段已有，只需接线 | 简化任务描述 |
| 3.1 _emit_swarm_status | 从未被调用，需要回调机制 | 在 SpawnConfig 加 callback |
| 3.3 teammates 含 session_id | 前端 SwarmTeammate 类型缺此字段 | 新增前端类型更新任务 |
| 5.4 transcript 轮询 | 运行中数据滞后，3s 轮询大量空转 | swarm_status 附带 last_message |

---

## 三层接口分析（分栏方案新增 Coder 审查）

### 发现 A：AppLayout ChatView 当前结构与分栏重构兼容，但 MessageInput 需迁移（中优先级）

**验证**（代码行 82-138）：
```
ChatView (column, flex: 1, minHeight: 0)
  └─ Header (44px, flexShrink: 0)
  └─ CompactProgressBar
  └─ TranscriptViewer (flex: '1 1 0', minHeight: 0)   ← 目前在 ChatView 直属子级
  └─ MessageInput (flexShrink: 0)                      ← 目前在 ChatView 直属子级
```

重构为分栏后，`MessageInput` 需要移入 `LeaderPane` 内部（`LeaderPane` 是 column，TranscriptViewer + MessageInput）。这是结构性移动，需确认 `MessageInput` 的 props（`sendRequest`、`wsStatus` 等）能正常从 `ChatView` 透传到新位置。无 API 变更，但需注意移动后 `StatusBar` 组件（AppLayout line 269-271）仍依赖 `activeView === 'chat'` 独立渲染，不需要改。

### 发现 B：`paneRatio` 用 CSS flex-grow 实现有精度问题，建议用 flexBasis（中优先级）

**问题**：task 6.2 描述的 `paneRatio: number` state 用 `flex: 1` 实现。若两栏都是 `flex: 1`，比例锁死在 50/50，无法响应拖动。

**正确实现**：
```tsx
// LeaderPane
style={{ flexBasis: `${paneRatio * 100}%`, flexGrow: 0, flexShrink: 0, minWidth: '30%' }}
// SwarmMemberPane  
style={{ flexBasis: `${(1 - paneRatio) * 100}%`, flexGrow: 0, flexShrink: 0, minWidth: '30%' }}
```

或者更简单：`flex: `${paneRatio} 0 0`` vs `flex: `${1 - paneRatio} 0 0``

**需要更新 task 6.2**：明确说明 paneRatio 通过 `flexBasis` 应用，而非 `flex: 1`。

### 发现 C：ResizeDivider 需要文档级事件监听，不能只绑在 div 上（中优先级）

**问题**：task 6.1 提到 `ResizeDivider` 支持拖动。但如果 `mousemove`/`mouseup` 只绑在 divider 上，鼠标移出 divider 区域（正常拖动时会发生）后就停止响应。

**正确实现**：
```tsx
const startResize = (e: React.MouseEvent) => {
  const startX = e.clientX
  const startRatio = paneRatio
  const totalWidth = containerRef.current.offsetWidth
  
  const onMove = (e: MouseEvent) => {
    const delta = (e.clientX - startX) / totalWidth
    setPaneRatio(Math.min(0.7, Math.max(0.3, startRatio + delta)))
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
```

**需要更新 task 6.1**：补充"document 级 mousemove/mouseup 监听"的实现说明。

### 发现 D：两套数据源（REST members + WS teammates）需要明确合并策略（高优先级）

**问题**：`ChatView` 同时使用两个数据源：
- `members` state（来自 `GET /api/swarm/teams/{teamName}`）：含 `session_id`，但不含 `last_message`
- `swarmStore.teammates`（来自 WS `swarm_status`）：含 `session_id`（task 3.5 后）、`last_message`

task 6.3 说"订阅 swarmStore.teammates 更新 members 中的状态字段"，但没有明确合并键（用 `agent_id`？`session_id`？`name`？）。

**决策**：以 `agent_id` 为合并键（`TeamMember.agent_id = "name@team"` 格式），在 `useEffect([swarmTeammates])` 中：
```typescript
setMembers(prev => {
  const updated = { ...prev }
  for (const t of swarmTeammates) {
    const key = Object.keys(updated).find(k => updated[k].name === t.name)
    if (key) updated[key] = { ...updated[key], status: t.status, last_message: t.last_message, session_id: t.session_id ?? updated[key].session_id }
  }
  return updated
})
```

**需要更新 task 6.3**：补充合并策略（以 `name` 字段作为关联键，因为 SwarmTeammate 没有 agent_id 格式化的字段）。

### 发现 E：`swarmStore.setTeammates()` 完整替换，需保证事件总发全量（中优先级）

**问题**：`swarmStore.setTeammates(teammates)` 是 `set({ teammates })`（完整替换）。如果某次 `swarm_status` 事件只包含一个发生变化的 Agent，其他 Agent 的信息会被清空。

**当前代码**：`_emit_swarm_status(self, teammates: list[dict])` 由调用方决定传入哪些 teammate。任务 3.4 和 3.2 的实现必须每次都传入**所有** TeamMember 的字典列表，而非仅变化的成员。

**需要更新 task 3.2 和 3.4**：明确要求 `_emit_swarm_status` 调用时传入完整的团队成员列表（`team_file.members.values()`），不能只传变化的成员。

### 发现 F：page refresh 后 `uiStore.teamSessionTask` 丢失（低优先级）

**问题**：`uiStore.teamSessionTask` 是内存 state，刷新页面后丢失。ChatView header 的任务摘要在刷新后消失。

**可接受方案**：将 task 内容追加到 `expert_role_label`，格式改为 `🤝 {teamName}|{task}` (用 `|` 分隔)。Sidebar 显示时截断 task 部分，ChatView header 从 `expert_role_label` 解析 task 内容。这样 task 内容随 session 持久化到后端，刷新不丢失。

**更简单方案**：不存 task 摘要，刷新后 header 只显示 `🤝 teamName`（退回到无 task 摘要状态）。这是可接受的降级，不影响核心功能。建议选此方案，减少复杂度。

---

## 存储架构深化（架构方向决策）

### 决策 A：模板与运行数据分目录存储

**问题**：当前所有数据（模板定义 + 任务运行记录）混在 `~/.hlagent/teams/` 下，依靠命名后缀（`-YYYYMMDD-HHMMSS`）区分，不利于跨机器复用，且随任务增多该目录会膨胀。

**决策**：分离为两个顶层目录：

```
~/.hlagent/
├── teams/                          ← 模板定义（可跨机器复制复用）
│   ├── marketing-team/
│   │   └── team.json               ← 成员定义，永不被任务运行修改
│   └── research-team/
│       └── team.json
└── teams-tasks/                    ← 任务运行记录（机器特定，含 session_id 等）
    └── marketing-team/
        ├── 小红书带货推广/            ← 目录名 = 任务目标（人类可读）
        │   ├── team.json            ← 克隆的成员 + 本次运行的 session_id/task_id
        │   └── meta.json            ← {"goal": "小红书带货推广", "started_at": ...}
        └── AI工具市场调研/
            ├── team.json
            └── meta.json
```

**目录命名规则**：
- 目录名直接使用任务目标（`goal`），中文、英文均可
- 替换文件系统非法字符（`/ \ : * ? " < > |`）为 `-`
- 若同名目录已存在，自动追加短时间戳后缀 `{goal}-{HHMMss}` 保证唯一性
- 目录名最大 60 字符（按字节），超出截断

**为什么可以用中文？**：
- `_SAFE_NAME_RE`（仅允许 ASCII 的正则）只用于**模板团队** `get_team_dir()`
- `get_team_task_dir()` 是新建函数，自行定义命名规则，不受此约束
- Windows NTFS、Linux ext4、macOS APFS 均支持 Unicode 目录名

**`ls` 效果示例**：
```bash
$ ls ~/.hlagent/teams-tasks/marketing-team/
小红书带货推广/
AI工具市场调研/
智能日历APP推广方案/
```

**跨机器复用场景**：
```bash
# 机器 B 想复用机器 A 的团队定义
cp -r machine-a:~/.hlagent/teams/marketing-team ~/.hlagent/teams/
# 运行记录无需复制，机器 B 直接在 teams-tasks/ 下生成自己的
```

**优点**：
- `teams/` 目录小且干净，只存团队定义（prompt/color/members），便于版本管理
- `teams-tasks/` 目录存所有运行历史，目录名即任务目标，一目了然，无需查看 meta.json
- SwarmPage 只扫描 `teams/`，不再需要过滤时间戳目录
- `GET /api/swarm/teams/{name}/tasks` 从 `teams-tasks/{name}/` 列出历史

**需要更新的代码路径**：
- `get_config_dir()` 当前返回 `~/.hlagent`；新增 `get_teams_dir()` → `~/.hlagent/teams/` 和 `get_teams_tasks_dir()` → `~/.hlagent/teams-tasks/`
- `TeamLifecycleManager`：区分 `list_templates()`（扫 teams/）和 `list_tasks(team_name)`（扫 teams-tasks/team_name/）
- `clone_team()` 改为 `create_run(template_name, run_slug)` → 写入 `teams-tasks/{template_name}/{run_slug}/`
- Gateway `/start` API 写入 `teams-tasks/`；`/teams` API 只读 `teams/`

### 决策 B：由 Leader 决定任务运行目录名

**问题**：当前任务目录名 `marketing-team-20260524-095500` 纯时间戳，看不出这次运行的目的，历史记录难以人工检索。

**决策**：Leader 负责创建运行目录，名称由 Leader 根据任务目标生成，格式为 `{goal-slug}@{team-name}`：

**工作流程变更**：

```
旧流程：
  /start API → 立即克隆 → marketing-team-20260524-095500 → spawn 成员

新流程：
  /start API → 创建 Orchestrator session，传入 team 名和任务描述
             ↓
  Leader 接收任务 → 用 swarm_create_run 工具创建运行目录
             ↓
  swarm_create_run(team="marketing-team", goal="小红书带货推广")
  → 创建 teams-tasks/marketing-team/小红书带货推广@marketing-team/
             ↓
  Leader 用 swarm_spawn_member(run="小红书带货推广@marketing-team") 启动成员
```

**`swarm_create_run` 工具设计**：
```python
# 新工具
swarm_create_run(
    team: str,          # 模板团队名
    goal: str,          # 目标描述（Leader 提炼，不超过 30 字）
) -> str                # 返回 run_id，如 "小红书带货推广@marketing-team"
# 内部：从 teams/{team} 克隆到 teams-tasks/{team}/{slug}@{team}/
```

**命名规则**：
- `goal` 由 Leader 提炼（≤ 20 汉字或 30 ASCII 字符），替换非法路径字符为 `-`
- 最终目录名：`{goal-slug}@{team-name}`（`@` 作为分隔符，与 agent_id 格式一致）
- 例：`小红书带货推广@marketing-team`、`AI工具调研@research-team`

**好处**：
- 历史记录一目了然（`ls ~/.hlagent/teams-tasks/marketing-team/` 直接看到任务列表）
- Leader 的自主性更强（了解任务 → 命名 → 执行）
- 便于人工查找特定任务的运行记录

**待实现任务（追加到 tasks.md）**：
- 新增 `get_teams_dir()` / `get_teams_tasks_dir()` 路径函数
- `TeamLifecycleManager` 区分 templates 和 tasks
- 新增 `swarm_create_run` 工具（替代 `/start` 中的 `clone_team` 调用）
- 更新 Leader 系统提示：第一步调用 `swarm_create_run` 创建运行目录
- 更新 `swarm_spawn_member` 接受 `run` 参数（运行目录名）而非 `team`（模板名）

---

## 三层接口 Coder Review（架构重构方向）

### 发现 1：配置目录实际来自环境变量覆盖，文档中 `~/.hlagent/` 不准确（中优先级）

**验证**：`get_config_dir()` 的解析顺序：① `OPENHARNESS_CONFIG_DIR` 环境变量 → ② `~/.openharness/`。  
实际用户机器上通过 `OPENHARNESS_CONFIG_DIR=~/.hlagent` 环境变量覆盖。设计文档中写死 `~/.hlagent` 路径不准确，应写 `<config_dir>`。

**影响**：`get_teams_dir()` / `get_teams_tasks_dir()` 设计时必须基于 `get_config_dir()` 而非硬编码路径，`clone_team()` 已正确使用了此约定。

### 发现 2：`get_team_dir()` 定义在 mailbox.py，team_lifecycle.py 直接导入——分目录会导致两者不一致（高优先级）

**验证**：
```python
# mailbox.py
def get_team_dir(team_name: str) -> Path:
    return get_config_dir() / "teams" / team_name  # 只认 teams/

# team_lifecycle.py
from openharness.swarm.mailbox import get_team_dir  # 复用 mailbox 的路径
```

**问题**：当 tasks 移到 `teams-tasks/` 目录时，成员的 mailbox（inbox）仍然会写入 `teams/` 路径，因为 mailbox 不区分 template 和 run。

**需要更新**：
- `get_team_dir()` 需要能区分 template 团队和 run 团队
- 或新增 `get_team_task_dir(team, run_slug)` 专用于 teams-tasks 路径
- mailbox.py 中需要有对应的 `get_team_task_mailbox_dir()` 以便 run 成员的消息写入正确路径

### 发现 3：`_SAFE_NAME_RE` 仅限制**模板团队**目录名，`teams-tasks/` 不受约束（已修正）

**原始结论（错误）**：认为 `_SAFE_NAME_RE` 会阻止中文 goal 名。

**修正后的正确结论**：
```python
# mailbox.py — _SAFE_NAME_RE 只在 get_team_dir() 中使用
def get_team_dir(team_name: str) -> Path:  # ← 仅用于 teams/ 模板目录
    if not _SAFE_NAME_RE.match(team_name):
        raise ValueError(...)
```

新建的 `get_team_task_dir(team, goal_slug)` **不调用** `get_team_dir()`，不受此正则约束。

**结论**：`teams-tasks/` 的子目录名可以直接使用中文任务目标，只需过滤文件系统非法字符（`/ \ : * ? " < > |`）即可。无需时间戳，无需 ASCII 转写。

**更新后的目录名规则**（见决策 A 已更新）：
- 目录名 = 任务目标（`goal`），直接使用中文
- 替换非法字符为 `-`，截断到 60 字符
- 同名冲突时追加 `-{HHMMss}` 后缀

### 发现 4：run_id 用 `@` 作分隔符会导致 agent_id 出现双 `@`（严重，高优先级）

**当前代码**：
```python
# swarm_spawn_member_tool.py
agent_id = f"{arguments.member}@{arguments.team}"

# gateway routes
parts = agent_id.split("@", 1)  # 只 split 一次
name, team = parts[0], parts[1]
```

**决策 B 的问题**：若 run_id = `小红书带货推广@marketing-team`，则：
```python
agent_id = f"paid-social@小红书带货推广@marketing-team"
# split("@", 1) → ("paid-social", "小红书带货推广@marketing-team")
# read_team_file("小红书带货推广@marketing-team") → _SAFE_NAME_RE 失败
```

**所有受影响的代码路径**：
- `GET /api/swarm/agents/{agent_id}/transcript` 中 `agent_id.split("@", 1)`
- `swarm_list_members_tool.py` 中 `agent_id.split("@")[0]`
- `swarm_shutdown_member_tool.py` 构建 `agent_id`
- `read_mailbox_tool.py` 中 `TeammateMailbox(team, "leader")`

**解决方案**：run 层面不使用 `@` 分隔，改用其他约定。推荐：
- run_id 格式：`{team_name}/{run_slug}`（斜杠分隔，类似路径）
- agent_id 保持 `name@team_name`（team_name 仍是模板名）
- run 的信息单独用 `run_id` 参数传递，不混入 agent_id

### 发现 5：`swarm_wait` 用 `TeammateMailbox(team, "leader")` 监听 leader mailbox — run 迁移后路径变化（中优先级）

**当前实现**：
```python
mailbox = TeammateMailbox(arguments.team, "leader")
# 读取 ~/<config_dir>/teams/{team}/agents/leader/inbox/
```

若 run 成员写入的是 `teams-tasks/{team}/{run_slug}/agents/leader/inbox/`，而 `swarm_wait` 仍读 `teams/{team}/agents/leader/inbox/`，则永远收不到 `idle_notification`。

**关联影响**：`in_process.py` 中的 `idle_notification` 写入：
```python
leader_mailbox = TeammateMailbox(team_name=config.team, agent_id="leader")
```
`config.team` 是什么值？若是 run_id，路径正确；若仍是模板名，路径错误。

**需要统一**：所有 mailbox 操作（读/写/subscribe）必须使用相同的 `team_name`（模板名 or run_id），不能混用。

### 发现 6：`swarm_create_run` 前成员选择栏加载时序（已明确）

**正确行为（确认）**：

```
用户点击"启动团队" → ChatPage
        │
        ├─ 立即：从模板 team.json 加载成员 → SwarmMemberBar 显示禁用 chips
        │         chip 显示成员名但为灰色 + pointer-events:none（session_id = null）
        │
        ├─ Leader 运行：调用 swarm_create_run → teams-tasks/{run}/ 创建
        │
        ├─ 3s 轮询：GET /tasks → 发现新 run → GET /runs/{slug} → 替换 members state
        │
        └─ Leader 调用 swarm_spawn_member → run team.json 写入 session_id
                   → chips 激活（可点击，SSE 可连接）
```

**关键设计**：
- **模板成员先行**：`/start` API 返回团队名，ChatPage 立即用模板 team.json 渲染成员 chips（禁用态），给用户"团队已就绪"的即时反馈
- **渐进激活**：chips 在 `session_id` 写入 run team.json 后自动从禁用变可点击（3s 轮询或 swarm_status 事件驱动）
- **不需要占位 run**：`/start` 不创建 run 目录，run 由 Leader 通过 `swarm_create_run` 工具创建（名称由 Leader 根据任务目标决定）

**`SwarmMemberBar` 渲染规则**：
```
session_id = null  →  chip 灰色，cursor:not-allowed，opacity:0.5
session_id 非空   →  chip 激活（绿色/黄色状态徽章），可点击打开 SwarmMemberPane
```

**当前实现状态**：`AppLayout.tsx` 的三阶段 useEffect 已实现此逻辑，但 CR-GW-3（中文 run_slug 被 400 拒绝）导致第二阶段轮询永远拿不到 run 数据，chip 始终停留在禁用态。修复 CR-GW-3 后此流程应正常工作。

### 更新后的任务关联

| 发现 | 影响任务 | 建议修改 |
|------|---------|---------|
| `get_team_dir()` 在 mailbox.py，需区分 template/run | A.1, A.2 | 在 mailbox.py 新增 `get_team_task_dir(team, run_slug)` |
| 中文 goal 名触发 `_SAFE_NAME_RE` 失败 | B.1 | **已修正**：`get_team_task_dir()` 新函数不受约束，可直接用中文 |
| agent_id 双 `@` 问题 | B.1, B.3, B.4 | run_id 改用 `{team}/{slug}` 格式，agent_id 保持 `name@team` |
| `swarm_wait` mailbox 路径不一致（**新发现：严重**） | B.1, B.3, B.4, B.5 | 见发现 7 |
| Leader 先建 run 的时序空窗 | B.5 | `/start` 创建空占位 run，Leader 再填入 goal |

### 发现 7：`idle_notification` mailbox 路径与 run 目录不在同一位置（严重，高优先级）

**代码验证**：

```python
# in_process.py - 成员完成后发送 idle_notification
leader_mailbox = TeammateMailbox(team_name=config.team, agent_id="leader")
await leader_mailbox.write(idle_msg)
# 写入路径：<config>/teams/{config.team}/agents/leader/inbox/
```

```python
# swarm_wait_tool.py - Leader 等待 idle_notification
mailbox = TeammateMailbox(arguments.team, "leader")
messages = await mailbox.read_all(unread_only=True)
# 读取路径：<config>/teams/{arguments.team}/agents/leader/inbox/
```

**决策 B 的问题**：

当 Leader 调用 `swarm_spawn_member(team="marketing-team", run_id="marketing-team/小红书带货推广")` 时：
- `config.team = "marketing-team"`（模板名）
- 成员的 `idle_notification` 写入：`teams/marketing-team/agents/leader/inbox/`
- Leader 的 `swarm_wait(run_id="marketing-team/小红书带货推广")` 读取：`teams-tasks/marketing-team/小红书带货推广/agents/leader/inbox/`
- **两个路径不同，Leader 永远等不到 idle_notification！**

**根本原因**：`in_process.py` 的 mailbox 目标硬编码为 `config.team`，不知道 run_id 的存在。要解决此问题必须修改 SDK 层。

**解决方案（三选一）**：

方案 A（**未选用**，最小改动但不支持并发）：**保持模板邮箱，不分离 mailbox**
- `swarm_spawn_member` 中 `config.team` 仍用模板名
- 成员 idle_notification 写入 `teams/marketing-team/agents/leader/inbox/`
- `swarm_wait(team="marketing-team")` 从同一路径读取（不传 run_id）
- teams-tasks 目录只存 team.json 状态，不存 mailbox
- 代价：不支持同一团队的并发多 run（mailbox 会混淆）

**解决方案（✅ 已选方案 B）：在 `TeammateSpawnConfig` 加 `mailbox_team_path` 字段**

```python
# types.py — 新增字段
mailbox_team_path: str | None = None
# 若设置，in_process.py 将 idle_notification 写入此路径，而非 config.team 路径
```

**完整数据流（方案 B）**：

```
swarm_spawn_member(team="marketing-team", run_id="marketing-team/小红书带货推广")
  → config.team = "marketing-team"                    # agent_id = researcher@marketing-team
  → config.mailbox_team_path = "marketing-team/小红书带货推广"  # mailbox 写入 run 目录

成员完成任务（in_process.py）：
  → 检测 config.mailbox_team_path 有值
  → 写入 teams-tasks/marketing-team/小红书带货推广/agents/leader/inbox/

swarm_wait(run_id="marketing-team/小红书带货推广")：
  → 读取 teams-tasks/marketing-team/小红书带货推广/agents/leader/inbox/
  → 路径匹配 ✅，Leader 收到 idle_notification
```

**支持并发 run**：两个 run 各有独立 mailbox，互不干扰。

方案 C（复杂，完整隔离）：**run 专属 mailbox 路径整体重构**
- 修改 `get_agent_mailbox_dir()` 支持外部路径参数
- 代价：最大，涉及 mailbox 架构变更

---

## 三层接口分析（方案 B 最终 Coder Review）

### 发现 8：成员接收 Leader 消息的 mailbox ≠ idle_notification mailbox（重要澄清）

**代码验证**（`in_process.py`）：
```python
# 成员读取 Leader 下发的消息（_drain_mailbox）
mailbox = TeammateMailbox(team_name=config.team, agent_id=agent_id)
# 路径：<config>/teams/{config.team}/agents/{agent_id}/inbox/  ← 成员自己的 inbox

# 成员向 Leader 发送 idle_notification
leader_mailbox = TeammateMailbox(team_name=config.team, agent_id="leader")
# 路径：<config>/teams/{config.team}/agents/leader/inbox/  ← leader 的 inbox
```

**结论**：两条通信方向是**完全独立的 mailbox**：
- Leader → 成员：写入 `teams/{team}/agents/{member_id}/inbox/`（成员用 `_drain_mailbox` 读取）
- 成员 → Leader：写入 `teams/{team}/agents/leader/inbox/`（`idle_notification`，Leader 用 `swarm_wait` 读取）

**方案 B 的影响范围**：`mailbox_team_path` 字段只需改变"成员 → Leader"方向（`idle_notification`）的写入路径。  
"Leader → 成员"方向（`swarm_send_message`）的 mailbox 路径不需要改变，成员仍从模板团队路径收消息。

**需要在 tasks.md B.0b 中澄清**：只修改 idle_notification 的写入路径，leader→member 的 `send_message` 路径不变。

### 发现 9：SubprocessBackend 无法透传 `mailbox_team_path` 给子进程（高优先级）

**代码验证**（`spawn_utils.py`）：
```python
def build_inherited_env_vars() -> dict[str, str]:
    return {
        "OPENHARNESS_AGENT_TEAMS": "1",
        "CLAUDE_CODE_COORDINATOR_MODE": "0",
        "ANTHROPIC_API_KEY": ...,
        "ANTHROPIC_BASE_URL": ...,
        # ... 代理/证书等
        # ← 没有 CLAUDE_CODE_TEAM_NAME、OPENHARNESS_MAILBOX_PATH 等
    }
```

子进程通过环境变量读取 team 信息（`permission_sync.py`）：
```python
def get_team_name() -> str | None:
    return os.environ.get("CLAUDE_CODE_TEAM_NAME")
```

**问题**：`subprocess_backend.py` 不设置 `CLAUDE_CODE_TEAM_NAME`，子进程不知道自己的 `mailbox_team_path`，无法写到正确路径。

**解决方案**：在 `subprocess_backend.py` 的 spawn 中，若 `config.mailbox_team_path` 有值，添加到 env：
```python
if extra_env is None:
    extra_env = {}
extra_env["OPENHARNESS_MAILBOX_TEAM_PATH"] = config.mailbox_team_path or config.team
```
子进程（in_process worker）读取此环境变量决定写入路径。

**需要新增任务 B.0c**：`subprocess_backend.py` 中透传 `mailbox_team_path` 到子进程环境变量。

### 发现 10：子进程 in_process 与独立进程 subprocess 代码路径不同（中优先级）

**验证**：
- `InProcessBackend`：在同一进程运行 `start_in_process_teammate()`，可直接读取 Python 对象字段 `config.mailbox_team_path`
- `SubprocessBackend`：fork 新进程，新进程运行 `run_task_worker()`（`ui/app.py`），该函数通过 stdin 读 prompt，**不直接接收** `TeammateSpawnConfig` 对象

**影响**：
- InProcess 改动：修改 `in_process.py` 的 `idle_notification` 代码，读 `config.mailbox_team_path` → **直接可用**
- Subprocess 改动：需要在 spawn 时把 `mailbox_team_path` 写入环境变量，子进程的 task_worker 再读 env → **需要额外步骤**

**`subprocess_backend` 目前转发 `session_id` 的方式**（可参考）：
```python
# spawn_utils.py 中 session_id 通过 OPENHARNESS_SESSION_ID 环境变量传递
if config.session_id:
    extra_env["OPENHARNESS_SESSION_ID"] = config.session_id
```
`mailbox_team_path` 可以用同样模式透传。

### 更新后的 tasks 关联（最终版）

| 发现 | 影响任务 | 需要修改 |
|------|---------|---------|
| 两个通信方向 mailbox 独立 | B.0b | 只改 idle_notification 写入路径，send_message 路径不变 |
| SubprocessBackend 不发 idle_notification（`run_task_worker()` 静默退出）| B.0c/B.0d 已删除 | `swarm_wait` 通过 task_mgr 状态检测 subprocess 完成，mailbox 只用于 InProcessBackend |
| `_write_mailbox_raw` / `_read_mailbox_raw` 导致代码重复 | **新增 B.0a** | `TeammateMailbox.__init__` 加 `inbox_dir: Path | None` 参数，绕过验证，复用所有现有方法 |
| `swarm_wait(run_id)` 读 mailbox 需绕过 `TeammateMailbox` 验证 | B.3c（更新） | 用 B.0a 的 `inbox_dir=...` 参数实例化 `TeammateMailbox`，无需独立函数 |
| **ChatView 用模板名（无 session_id）fetch 成员 — 当前已部署 Bug** | **新增 6.3-FIX** | 改用 `taskTeamName`（任务团队名）fetch；7-ARCH 下需新 API 端点避免 run_id 中 `/` 造成路径歧义 |

---

## 架构修订（R1）— 基于 s10_team_protocols 协议和运行时隔离要求

> **触发原因**：当前实现中 member 仍走 subprocess + 运行时状态污染模板目录，与 s10 协议的核心设计背离。
> **修订日期**：2026-05-25

### R1.1 成员必须使用 in_process 后端

**协议依据（s10）**：
- Leader 和 Member 共存同进程（s10 用 `threading.Thread`，我们用 `asyncio.Task`）
- 共享同一 API 客户端实例（`client = Anthropic(...)`，全局唯一）
- 通过进程内 MessageBus（我们的 TeammateMailbox）直接通信，无跨进程 IPC 开销

**设计决策**：
- `swarm_spawn_member_tool` 和 `/start` API 默认使用 `in_process` backend
- `InProcessBackend._register_defaults()` 移除平台检查，始终注册 `in_process`
- `_build_member_query_context()` 构建轻量 QueryContext（仅角色提示 + 环境信息，无全局 skill 文件加载）
- 成员通过 asyncio Task 运行，支持实时 SSE 流式输出

### R1.2 模板目录（teams/）只存静态配置

**原则（对应 s10 的 config.json vs inbox/ 分离）**：

```
teams/{name}/team.json          ← 静态配置（只写一次，永不修改）
                                   包含：name, description, members[]{name, role, color, model, prompt}
                                   不包含：session_id, task_id, status, cwd

teams-tasks/{name}/{run_slug}/  ← 运行时目录（每次任务创建新目录）
  team.json                     ← 运行时成员状态（session_id, task_id, status, cwd）
  meta.json                     ← {goal, team, started_at, run_id}
  agents/
    leader/inbox/               ← Leader 的 idle_notification 接收 mailbox
    {member_name}@{team}/inbox/ ← Member 自身的 inbox（Leader 发任务给 Member 用）
```

**关键约束**：
- 任何带 `session_id`、`task_id`、`status` 的写操作，目标必须是 `teams-tasks/` 下的 `team.json`
- `swarm_spawn_member_tool` 写 session_id → 只写 run team.json，不写模板
- `TeamLifecycleManager.update_member_session` 调用只允许在 run 目录上下文中使用

### R1.3 成员模型继承 Leader 模型

**设计**：
- `TeammateSpawnConfig.model` 字段携带 Leader 当前使用的模型
- `swarm_spawn_member_tool` 从 Leader 的 settings 读取当前 model，注入到 `TeammateSpawnConfig.model`
- `_build_member_query_context(config)` 优先使用 `config.model`，再 fallback 到 `load_settings().model`
- 如成员在 `team.json` 中设置了 `model` 字段（非 None），则以成员配置为准（单独覆盖能力）

**优先级**：`member.model`（模板配置）> `config.model`（继承 Leader）> `settings.model`（全局默认）

### R1.4 所有 Mailbox 在 teams-tasks/ 目录

**两个方向的 mailbox 均隔离到 run 目录**：

| Mailbox | 路径 | 用途 |
|---------|------|------|
| Leader inbox | `teams-tasks/{team}/{run}/agents/leader/inbox/` | Member 完成后发 `idle_notification` 给 Leader |
| Member inbox | `teams-tasks/{team}/{run}/agents/{member_id}/inbox/` | Leader 发任务/消息给 Member |

**实现要点**：
- `start_in_process_teammate` 已修复：当 `config.mailbox_team_path` 设置时，member 自身 inbox 使用 run 路径 ✓
- `send_agent_message` API 需接受 `run_id` 参数，写入 run 目录下的 member inbox
- 模板目录 `teams/{name}/agents/` 不应被创建

### R1.5 流式输出架构（in_process 实现）

```
asyncio Task (_run_query_loop)
      │ text delta
      ▼
per-session asyncio.Queue  ──→  SSE endpoint  ──→  EventSource (SwarmMemberPane)
                                              TranscriptViewer 实时渲染
      │ done / session save
      ▼
session_storage.save_snapshot()  ──→  transcript endpoint (静态加载)
```

---

## Coder Review — UI/Gateway/SDK 三层接口审查

> **审查日期**：2026-05-25
> **审查范围**：SDK(`swarm/`)、Gateway(`HLAgent/gateway/`)、UI(`HLAgent/web/src/`) 三层
> **评级说明**：🔴 阻塞（功能不可用）/ 🟠 严重（行为不正确）/ 🟡 次要（影响质量）/ 🟢 建议（改善代码质量）

---

### SDK 层（`src/openharness/swarm/`）

#### 🔴 CR-SDK-1：`_run_query_loop` 中 session save 与 SSE done 信号存在 race condition

**位置**：`in_process.py:482-502`

**问题**：
```python
finally:
    # 1. 先发 done 信号给 SSE 订阅者
    stream_q.put_nowait(None)

ctx.status = "idle"  # 在 finally 外！

# 2. 然后才保存 session
DEFAULT_SESSION_BACKEND.save_snapshot(...)
```

SSE 收到 `None`（done）后，前端立即调用 `loadFullTranscript()` → 请求 `/transcript?run_id=...`，但此时 `save_snapshot` 尚未执行，session 文件不存在，transcript 端点返回 404。

**正确顺序**：先 `save_snapshot`，再发 `done` 信号。

**修复方向**：将 `save_snapshot` 移到 `finally` 块内，在 `stream_q.put_nowait(None)` 之前执行。

---

#### 🔴 CR-SDK-2：`ctx.status = "idle"` 和 session save 在 `finally` 之外，取消时不执行

**位置**：`in_process.py:488-502`

**问题**：`ctx.status = "idle"` 和整个 session save 块都在 `try/finally` 结构之外。当 `_run_query_loop` 因 `return`（取消/shutdown）提前退出时，这两行都不执行：
- 成员状态永远是 `"running"`（外层 `start_in_process_teammate` 的 `finally` 设为 `"stopped"`，但 idle 路径丢失）
- session 不保存 → transcript 对于被取消的成员永远是 404

**修复方向**：将 `ctx.status = "idle"` 和 session save 全部移入 `_run_query_loop` 的 `finally:` 块。

---

#### 🟠 CR-SDK-3：`_run_query_loop` 的 `try:` 代码块缩进错误（2 空格）

**位置**：`in_process.py:425-480`

**问题**：
```python
    try:
      async for event, usage in run_query(query_context, messages):  # 2 空格缩进
        if usage is not None:
            ...  # 4 空格缩进
```

`try:` 下一级只有 2 空格，与项目其余代码（4 空格）不一致。虽然 Python 不报错（只要一致），但内层逻辑混合了 2/4 空格，严重影响可读性和 diff 审查。

---

#### 🟠 CR-SDK-4：成员模型未继承 Leader 运行时模型

**位置**：`swarm_spawn_member_tool.py:98` + `in_process.py:_build_member_query_context`

**问题链**：
1. Leader 调用 `swarm_spawn_member(team=..., member=..., task=..., run_id=...)`，工具定义中 `model` 参数是可选的
2. `TeammateSpawnConfig.model = arguments.model`（可能为 None）
3. `_build_member_query_context` 做 `settings.merge_cli_overrides(model=config.model)`，当 `config.model=None` 时，读取 `load_settings().model`（全局默认）
4. **问题**：Leader session 可能有 profile override 或临时模型，成员无法感知，固定使用全局 settings

**期望行为**：成员使用与 Leader 相同的运行时模型（由 `start_team` 中的 `req.model` 或 Leader 当前 session model 决定）。

**修复方向**：`start_team` API 返回时将实际模型写入 run meta.json；`swarm_spawn_member_tool` 从 run meta.json 读取并填充 `TeammateSpawnConfig.model`。

---

#### 🟡 CR-SDK-5：`swarm_spawn_member_tool` 中 `resolved_run_id` 必传但描述未反映

**位置**：`swarm_spawn_member_tool.py:24-32, 57-67`

**问题**：`run_id` 字段的 pydantic description 写的是 "Optional"，但实现里强制要求（缺少则返回 error）。这会让 LLM 认为可以不传，实际调用时报错让 Leader 困惑。

**修复方向**：将 description 改为明确要求：`"run_id from swarm_create_run (required). Format: '{team}/{goal_slug}'."` 并将字段默认值去掉（`run_id: str`，无 `= Field(default=None,...)`）。

---

#### 🟡 CR-SDK-6：`InProcessBackend.spawn` 中 `_build_member_query_context` 异常未处理

**位置**：`in_process.py:InProcessBackend.spawn`

**问题**：`query_context = await _build_member_query_context(config)` 若抛出异常（如 API 客户端配置错误），会直接传播到 `asyncio.create_task(...)` 的外层，导致整个 spawn 崩溃而非返回 `SpawnResult(success=False)`。

---

### Gateway 层（`HLAgent/gateway/routers/swarm.py`）

#### 🔴 CR-GW-1：`AppLayout` 未向 `SwarmMemberPane` 传递 `runId`，导致 SSE 和 transcript 完全不工作

**位置**：`AppLayout.tsx:302`

**问题**：
```tsx
<SwarmMemberPane member={selectedMember} onClose={() => setSelectedMemberId(null)} />
// runId 未传！
```

`SwarmMemberPane` 的 SSE 逻辑：
```tsx
if (!sessionId || !runId || memberStatus !== 'active') {
    // SSE 永远不会打开
}
```
Transcript 加载：
```tsx
const qs = runId ? `?run_id=${encodeURIComponent(runId)}` : ''
// runId 为 undefined → 走模板路径 → session_id 为 null → 404
```

**影响**：右侧成员 pane 永远显示空，SSE 不建立，transcript 永远加载不到。这是当前最严重的 UI bug。

**修复方向**：`AppLayout` 需维护 `currentRunSlug` state（轮询时获得），传给 `SwarmMemberPane` 作为 `runId={`${fetchTeamName}/${currentRunSlug}`}`。

---

#### 🔴 CR-GW-2：`swarm_status` WS 事件未从 `swarm_spawn_member_tool` 发出，SSE 永远不触发

**位置**：`in_process.py:start_in_process_teammate:on_status_change`

**问题链**：
1. `SwarmMemberPane` 的 SSE 只在 `memberStatus === 'active'` 时打开
2. `memberStatus` 来自 `swarmStore.teammates`，由 `swarm_status` WS 事件更新
3. `swarm_status` 由 `config.on_status_change` 回调触发
4. **但 `swarm_spawn_member_tool` 创建的 `TeammateSpawnConfig` 没有设置 `on_status_change`**（只有旧的 `/start` handler 里设置了）

因此：通过 Leader tools 启动的成员，`swarmTeammates` 不会更新 → `memberStatus` 永远是初始值 → SSE 条件 `memberStatus === 'active'` 永远不满足 → 流式输出永远不打开。

**修复方向**：`swarm_spawn_member_tool` 需要访问 Leader session 的 host 对象来绑定 `on_status_change`；或改为前端轮询 run team.json 的 `status` 字段来驱动 SSE 开启条件。

---

#### 🟠 CR-GW-3：`run_slug` 包含中文时 `get_team_run` 端点拒绝请求

**位置**：`swarm.py:get_team_run`

**问题**：`_SAFE_SEGMENT_RE = re.compile(r'^[a-zA-Z0-9_\-\.]{1,128}$')` 只允许 ASCII。但 `swarm_create_run` 的 goal slug 直接用任务目标文本（包含中文），如 `333/农业投资研究`。Gateway 前端用 `encodeURIComponent` 编码后，`_SAFE_SEGMENT_RE` 校验失败（`%E5%86%9C...` 无法通过）。

实际结果：`GET /api/swarm/teams/333/runs/农业投资研究` → 400 Bad Request，前端轮询永远得不到 run 数据，chips 永远禁用。

**修复方向**：允许 Unicode 字符在 path validation 中（扩展正则），或在 `swarm_create_run_tool` 中对中文字符做 URL-safe slugify（替换为 ASCII）。

---

#### 🟠 CR-GW-4：`send_message` Gateway API 不传 `run_id` 时消息写模板目录，成员收不到

**位置**：`swarm.py:send_agent_message`

**问题**：Leader 在 `send_message` 工具调用中不传 `run_id`（工具签名中 `run_id` 是可选的），消息写入 `teams/{team}/agents/{member}/inbox/`。但成员 mailbox 在 `teams-tasks/{team}/{run_slug}/agents/{member}/inbox/`，消息永远送达不了。

**修复方向**：`send_message` 工具的 description 应明确要求传入 `run_id`（与 `swarm_spawn_member` 保持一致）；或 Gateway 端 fallback 扫描最近 run。

---

#### 🟡 CR-GW-5：SSE `stream_agent_output` 的 `cleanup_stream_queue` 可能导致后续 SSE 连接立即失败

**位置**：`swarm.py:stream_agent_output` + `in_process.py:cleanup_stream_queue`

**问题**：SSE 连接断开时调用 `cleanup_stream_queue(session_id)` 删除队列。如果前端网络抖动重连，新的 SSE 连接调用 `get_or_create_stream_queue(session_id)` 会创建新队列，但 `_run_query_loop` 已经持有对旧队列的引用（delta 写入旧队列），新队列永远收不到数据。

**修复方向**：SSE 重连时不删除旧队列，或 `_run_query_loop` 每次 push 前重新查找最新队列引用。

---

### UI 层（`HLAgent/web/src/`）

#### 🟠 CR-UI-1：`latestRunSlug` 是 `useEffect` 内部的 `let` 变量，React strict mode 下会重置

**位置**：`AppLayout.tsx:118`

**问题**：
```typescript
useEffect(() => {
    let latestRunSlug: string | null = null  // 每次 effect 重运行都重置
    const pollRun = () => {
        if (slug === latestRunSlug) return  // 优化失效
```

React Strict Mode 会 mount → unmount → remount，导致 `latestRunSlug` 被重置，去重逻辑失效，每次都重新 fetch run team.json。应改为 `useRef`。

---

#### 🟡 CR-UI-2：`parseSessionToItems` 未处理 `thinking` blocks 和 `tool_result` 角色

**位置**：`SwarmMemberPane.tsx:15-54`

**问题**：
1. `thinking` type blocks（extended thinking 模型输出）被忽略
2. session JSON 中成员为 `assistant` 角色时包含的 tool_use blocks，会被解析为 `role: "tool"`，但随即又会被 `TranscriptViewer` 的 `groupToolPairs` 函数尝试配对 `tool_result`，而 `tool_result` 来自 `role: "tool"` 的消息，但我们把它解析为 `role: "tool_result"`——实际上应该对应 TranscriptItem 的 `role: "tool_result"`，才能被正确配对。需要仔细对齐 `TranscriptItem` 的 role 类型定义与 session JSON 格式。

---

#### 🟡 CR-UI-3：SSE 打开条件 `memberStatus === 'active'` 依赖 WS 事件，但 WS 事件未正确触发（同 CR-GW-2）

**位置**：`SwarmMemberPane.tsx:80`

**说明**：此问题与 CR-GW-2 联动。即使 CR-GW-1（runId 未传）被修复，SSE 仍因 `memberStatus` 未更新而不触发。需要同时修复 CR-GW-2 或改变 SSE 打开条件为"有 session_id 时即连接"。

---

### 接口契约问题汇总

| 接口 | 发送方 | 接收方 | 问题 |
|------|--------|--------|------|
| `TeammateSpawnConfig.model` | `swarm_spawn_member_tool` | `_build_member_query_context` | 工具参数 model ≠ Leader 运行时 model |
| `TeammateSpawnConfig.on_status_change` | 工具调用路径 | `start_in_process_teammate` | 工具路径未设置，swarm_status 事件不触发 |
| SSE done 信号 vs session save | `_run_query_loop` | `SwarmMemberPane.loadFullTranscript` | done 先于 save，transcript 404 |
| `runId` prop | `AppLayout` | `SwarmMemberPane` | 未传，所有依赖 runId 的功能失效 |
| `run_slug` in URL | Frontend `encodeURIComponent` | Gateway `_SAFE_SEGMENT_RE` | 中文 slug 被 400 拒绝 |
| `send_message` run_id | Leader tool call | `send_agent_message` | 可选但实际必须，消息路由错误 |

### 优先修复顺序

| 优先级 | ID | 描述 |
|--------|-----|------|
| P0 | CR-GW-1 | runId 未传给 SwarmMemberPane，所有成员视图功能失效 |
| P0 | CR-SDK-1 | SSE done 早于 session save，transcript 必然 404 |
| P0 | CR-GW-3 | 中文 run_slug 被 Gateway 400 拒绝，成员 chips 永远不激活 |
| P1 | CR-GW-2 | swarm_status 事件未从工具路径触发，SSE 条件不满足 |
| P1 | CR-SDK-2 | 取消/异常时 session 不保存，ctx.status 不更新 |
| P1 | CR-SDK-4 | 成员未继承 Leader 运行时模型 |
| P2 | CR-GW-4 | send_message 不传 run_id，消息丢失 |
| P2 | CR-SDK-3 | try 块缩进错误，代码质量 |
| P3 | CR-GW-5 | SSE 重连后队列失效 |
| P3 | CR-UI-1 | latestRunSlug 应用 useRef |
| P3 | CR-UI-2 | parseSessionToItems 未处理 thinking blocks |


- 成员运行期间：SSE 实时推送 delta，`TranscriptViewer` 渲染（与 Leader 视图一致）
- 成员完成后：SSE 发 `done`，前端加载完整 session transcript

