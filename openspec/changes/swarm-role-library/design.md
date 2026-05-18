## Context

HLAgent 的 Swarm 页面当前只读：显示已有团队，用 mailbox 与成员通信。但创建带成员的团队完全依赖 Chat Agent（通过 `team_create` 工具），普通用户无法从 Web UI 自行组建专业 Swarm 团队。

agency-agents-zh 提供了 215 个结构化的专家角色 Markdown 文件，托管在 GitHub。每个角色文件的内容天然适合作为 Swarm 成员的 `system_prompt`。需要一个网关层 API 拉取这些文件，并在前端提供浏览和选择界面。

## Goals / Non-Goals

**Goals:**
- Gateway 提供 `/api/swarm/role-library` 端点，从 GitHub raw 拉取角色库索引和内容，本地缓存
- 前端 SwarmPage 新增"创建带成员的团队"向导：选角色 → 配置成员 → 创建
- 角色 Markdown 内容自动填入成员的 `system_prompt`
- 支持刷新缓存（手动触发）

**Non-Goals:**
- 不自动派生/启动子 Agent（启动仍由 Chat Agent 触发，只做持久化配置）
- 不支持除 agency-agents-zh 以外的第三方角色库（本期）
- 不实现角色编辑器

## Decisions

### D1: 角色库数据源 — GitHub API vs raw 内容

选择 **GitHub raw content**（`raw.githubusercontent.com`）+ 本地缓存，而非 GitHub API。

**URL 格式**：
```
https://raw.githubusercontent.com/jnMetaCode/agency-agents-zh/main/<dept>/<filename>.md
```

**请求参数**：
- `timeout=10`（秒），超时视为网络失败
- 不设 Authorization header（public repo，无速率限制）
- 若 `HTTPS_PROXY` / `https_proxy` 环境变量存在，使用系统代理

**失败处理**：
```
缓存命中   → 直接返回，不请求网络
缓存未命中 → 请求 GitHub raw
  ├─ 成功 → 写磁盘缓存，返回内容
  ├─ 超时 → HTTP 503，body: { "error": "fetch_timeout", "cached": false }
  └─ 非 200 → HTTP 502，body: { "error": "upstream_error", "status": <upstream_code> }
```

### D2: 目录索引 — 动态爬取 vs 静态清单

选择**静态清单内嵌到 Gateway**，以 Python 列表常量形式定义。

**数据结构**：
```python
AGENT_CATALOG: list[dict] = [
    {
        "id": "engineering",           # 部门 ID（URL 安全）
        "label": "工程",               # 显示名
        "agents": [
            {
                "name": "frontend-developer",        # 不含 dept 前缀和扩展名
                "path": "engineering/engineering-frontend-developer.md",  # GitHub 路径
                "description": "前端开发工程师",     # 简短描述（来自文件名推导）
            },
            ...
        ],
    },
    ...
]
```

**命名规则**：`name` = 文件名去掉 `<dept>-` 前缀和 `.md` 后缀。
例：`engineering-frontend-developer.md` → `name: "frontend-developer"`。

**部门列表**（按文件统计）：

| 部门 id | label | 预期文件数 |
|---------|-------|-----------|
| engineering | 工程 | 35 |
| design | 设计 | 8 |
| marketing | 市场运营 | 26 |
| game-development | 游戏开发 | 5+ |
| finance | 财务 | 待确认 |
| specialized | 专项专家 | 35+ |

**清单维护策略**：
- `AGENT_CATALOG` 定义在 `routers/role_library.py` 顶部
- 提供 `GET /api/swarm/role-library/catalog/refresh` 端点（POST），从 GitHub README.md 重新解析部门目录（渐进增强，Phase 2）
- 本期只内嵌 engineering / design / marketing / game-development 四个部门

### D3: 内容缓存 — 内存 vs 磁盘

选择**两级缓存**：L1 进程内 LRU + L2 磁盘。

**L1 内存 LRU（进程生命周期）**：
- 使用 `functools.lru_cache(maxsize=50)` 包装磁盘读取函数
- key = `path`（字符串），value = Markdown 字符串
- Gateway 重启后 L1 清零，L2 补充

**L2 磁盘缓存**：
```
~/.hlagent/role-library/
  engineering/
    frontend-developer.md
    backend-architect.md
  design/
    ui-designer.md
  ...
```
- 文件路径 = `~/.hlagent/role-library/<path>`（直接映射 GitHub 路径）
- **无 TTL**：缓存永久有效，仅通过 `DELETE /api/swarm/role-library/cache` 手动刷新
- 写入时创建父目录（`mkdir -p`）

**缓存查找顺序**：
```
1. L1 lru_cache(path) 命中？→ 返回
2. L2 ~/.hlagent/role-library/<path> 存在？→ 读取，填入 L1，返回
3. 请求 GitHub raw → 写 L2，填 L1，返回
```

**`DELETE /cache` 行为**：
- 删除 `~/.hlagent/role-library/` 下所有文件（保留目录结构）
- 调用 `_read_cached.cache_clear()` 清除 L1
- 返回 `{ "cleared_files": <count> }`

### D4: 团队创建流程 — 纯前端 vs 后端向导

选择**前端三步向导 + REST API**。向导在 SwarmPage 内通过模态覆盖层实现，不跳页。

**完整向导流程**：

```
Step 1: 命名
  ├─ 输入团队名（kebab-case 校验，不允许空格）
  ├─ 输入描述（可选）
  └─ 点击"下一步" → Step 2

Step 2: 选专家（可选）
  ├─ 左侧：部门折叠列表 + 角色搜索框
  ├─ 中间：角色列表（勾选框 + 名称 + 简介）
  ├─ 右侧：选中角色的 Markdown 预览（点击角色名展开）
  ├─ 底部：已选成员 tag 列表（可删除）
  ├─ "跳过" → 直接 Step 3（空团队）
  └─ "下一步" → Step 3

Step 3: 创建中
  ├─ 调用 POST /api/swarm/teams → 创建团队
  ├─ 逐个调用 POST /api/swarm/teams/{team}/members → 添加成员
  ├─ 显示进度（"添加成员 2/3..."）
  ├─ 成功 → 关闭向导，选中新团队，刷新列表
  └─ 失败 → 显示错误，保留向导（可重试）
```

**API 调用顺序**（Step 3）：
```
POST /api/swarm/teams  { name, description }
  ↓ 成功（201）
for each selected_role:
  fetch /api/swarm/role-library/content?path=<role.path>  → 获取 Markdown
  POST /api/swarm/teams/{team}/members  { name, prompt, color, agent_type }
```

成员 `color` 从调色板按顺序分配：`["blue","green","yellow","red","purple","cyan"]`

### D5: 团队使用流程 — 配置态 vs 运行态（修订版）

**核心原则**：用户无需了解 `/swarm start` 命令，一切通过点击完成。

**团队状态机**：

```
configured  →  running  →  idle（完成）
（有成员，        （Agent      （任务结束，
 无 session）     已派生）      等待下一轮）
```

**一键启动设计**（`configured` 状态）：

```
┌─────────────────────────────────────────────────────────┐
│ 🚀 dev-team 已就绪，告诉团队要做什么：                  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 描述你希望团队完成的任务...                      │    │
│  │                                                  │    │
│  └─────────────────────────────────────────────────┘    │
│                                       [启动团队 →]       │
└─────────────────────────────────────────────────────────┘
```

- **无命令文本**：不显示 `/swarm start` 命令，用户只需描述任务
- **"启动团队"按钮**：点击后在后台完成 session 创建 + 命令发送，跳转至 Chat 页面时团队已在运行
- **任务描述非必填**：留空时使用默认占位 `/swarm start <team_name>`（对用户不可见）

**成员管理（配置态下）**：
- 团队详情页显示成员列表 + "添加成员"按钮（打开角色库面板）
- 每个成员卡片有"移除"按钮（调用 `DELETE /api/swarm/teams/{team}/members/{agent_id}`）
- 已运行的成员（`session_id≠null`）不允许通过 UI 删除，只能发 `shutdown` 消息

### D6: 成员创建时的命名规范

为避免 `agent_id` 冲突，成员名生成规则：

```
角色 path: "engineering/engineering-frontend-developer.md"
  → dept:   "engineering"
  → name:   "frontend-developer"      (去 dept 前缀和 .md)
  → agent_id: "frontend-developer@<team_name>"
  → color:  按 index 从调色板取

同一团队内若有重复 name（用户选了两个同名角色）：
  → 追加序号：frontend-developer-2@<team_name>
```

## Risks / Trade-offs

- **GitHub 访问**：部分网络环境无法访问 raw.githubusercontent.com → 缓存内容降级，目录仍可用；提示用户配置代理
- **清单过时**：agency-agents-zh 新增角色不会自动出现 → 提供"刷新清单"按钮，从 GitHub 拉取最新 `README.md` 重新解析（渐进增强）
- **system_prompt 大小**：部分角色 Markdown 较长（~3KB），Swarm 启动时 token 消耗增加 → 可接受，不做截断

## Flow Review — Resolved Design Gaps

### R1: 一键启动机制（autosubmit 流）

**原设计**："去 Chat" 跳转后用户仍需手动发送命令，不符合"点击即启动"要求。

**新机制**：`autosubmit` URL 参数，ChatPage 在 WS ready 后自动发送 prefill 内容，用户跳转时命令已在执行中。

```
点击"启动团队" →
  1. POST /api/sessions {}              → { session_id }
  2. 拼接命令: `/swarm start <team> <task_desc>` （对用户不可见）
  3. navigate(`/chat/${session_id}?prefill=<encoded>&autosubmit=1`)

ChatPage mount 时:
  pendingAutosubmit = searchParams.get('prefill')  // 存入 state
  
useEffect([wsStatus, pendingAutosubmit]):
  if wsStatus === 'ready' && pendingAutosubmit:
    sendRequest({ type: 'submit_line', line: pendingAutosubmit })
    setPendingAutosubmit(null)   // ← 关键：立即清除，防止 WS 重连后重复发送
```

**为什么不能在 mount 时直接发送**：WebSocket 连接是异步的（`disconnected → connecting → ready`），mount 时 `wsStatus` 仍为 `'connecting'`，`sendRequest` 会被丢弃。必须等待 `wsStatus === 'ready'` 后才发送。

**"启动团队"按钮实现**：
```typescript
async function launchTeam(teamName: string, taskDesc: string) {
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const { session_id } = await r.json()
  const cmd = taskDesc.trim()
    ? `/swarm start ${teamName} ${taskDesc.trim()}`
    : `/swarm start ${teamName}`
  navigate(`/chat/${session_id}?prefill=${encodeURIComponent(cmd)}&autosubmit=1`)
}
```

此函数提取至 `HLAgent/web/src/utils/swarmApi.ts`，供 `TeamCreationWizard`、`SwarmPage` configured 横幅、idle 横幅"开始新任务"共同复用。

**"开始新任务"（D10 中的 idle 状态）同样使用此机制**：创建新 session，autosubmit。

### R2: 专家快速对话（单专家一键启动）

用户可直接从角色库面板或成员卡片点击"与此专家对话"，无需创建团队，无需输入命令。

**触发入口**：
1. **角色库预览面板右下角**："与此专家对话 →" 按钮（浏览专家时可直接使用）
2. **成员卡片**（configured 状态，`session_id=null`）："单独对话" 按钮

**实现**：

```
点击"与此专家对话" →
  1. fetchRoleContent(role.path)        → Markdown 字符串（取缓存）
  2. POST /api/sessions {}              → { session_id }
  3. 构造 intro 消息（普通用户消息，非 slash 命令）：
     intro = `请你扮演以下专家角色，所有回复都以该角色的视角和知识体系来回答：\n\n${markdownContent.slice(0, 3000)}`
  4. navigate(`/chat/${session_id}?prefill=${encodeURIComponent(intro)}&autosubmit=1`)
```

**角色注入方式说明**：角色通过**普通用户消息**注入（非 system_prompt），因为当前 session API 不支持启动时自定义 system_prompt。Claude 会在该会话中以专家身份响应，但在极长对话后可能偏离角色定义——这是已知限制，可接受。

**按钮加载态**：点击后按钮显示 `⟳ 准备中...`，session 创建完成后跳转（避免用户多次点击）。

### R3c: 状态机覆盖 — "开始新任务"与数据驱动状态的协调

`idle` 状态由数据决定（`所有成员 session_id≠null + status=idle`）。"开始新任务"按钮需要将 UI 切回 configured 横幅，但数据没有变化，会导致 UI 在下次渲染时跳回 idle。

**解决方案**：引入 `forceConfiguredView: Set<string>` 前端 state（按团队名 key）：

```typescript
const [forceConfiguredView, setForceConfiguredView] = useState<Set<string>>(new Set())

function deriveDisplayState(team: string, members: Record<string, Member>): TeamDisplayState {
  if (forceConfiguredView.has(team)) return 'configured'   // ← 覆盖优先
  return deriveTeamState(members)  // empty / configured / running / idle
}

// "开始新任务"点击时
setForceConfiguredView(s => new Set([...s, teamName]))
clearTaskDesc(teamName)

// 轮询检测到某成员 status 变为 active 时（新任务已开始运行）
setForceConfiguredView(s => { const n = new Set(s); n.delete(teamName); return n })
```

此 state 仅影响 UI 渲染，不修改后端数据，也不持久化。

### R2b: Step 3 创建失败的部分回滚策略

当 `POST /api/swarm/teams` 成功但某个成员添加失败时：

- **不回滚团队**（团队已存在于磁盘，属于有效状态）
- 前端将 `createdTeamName` 保存至组件 state 跨重试持久
- 重试从失败的成员开始（跳过已成功添加的，通过对比 `failedRoles` vs 已添加列表）
- 界面显示：`"dev-team 已创建，但 2/3 个成员添加失败 [重试] [手动添加]"`
- "手动添加" → 关闭向导，导航到新团队详情页（已有成员 1/3）

```typescript
// Step 3 关键 state
const [createdTeamName, setCreatedTeamName] = useState<string | null>(null)
const [succeededRoles, setSucceededRoles] = useState<SelectedRole[]>([])
const [failedRoles, setFailedRoles]   = useState<SelectedRole[]>([])
```

重试时：仅遍历 `failedRoles`，`POST /api/swarm/teams` 跳过（已存在 → 409 → 正常继续）。

### R3: SwarmPage 固定三栏布局（主页面）

```
┌──────────────────────────────────────────────────────────┐
│ Header: 🤝 Swarm Teams                                    │
├────────┬──────────┬──────────────────────────────────────┤
│ 180px  │  260px   │          flex-1                      │
│ Teams  │ Members  │  Detail (transcript / mailbox)       │
│        │          │                                      │
└────────┴──────────┴──────────────────────────────────────┘
```

- 三栏均独立滚动，`overflow-y: auto`，`height: 100%`
- 向导覆盖在此三栏之上（`position: fixed; inset: 0; z-index: 50`）

### R3b: 向导 Step 2 内部布局（三面板，独立于主三栏）

Step 2 是全屏覆盖层，内部自带三面板布局：

```
┌────────────────────────────────────────────────────────────┐
│  [← 返回]  Step 2: 选择专家成员           [跳过] [下一步] │
├──────────────┬──────────────────┬─────────────────────────┤
│   220px      │     280px        │         flex-1          │
│  部门列表    │   角色列表        │    Markdown 预览        │
│  + 搜索框    │  (勾选 + 名称)   │   (点击角色名加载)      │
├──────────────┴──────────────────┴─────────────────────────┤
│  已选：[frontend-developer ×] [backend-architect ×]  (N个)│
└────────────────────────────────────────────────────────────┘
```

- 搜索框有内容时：所有部门展开，过滤匹配项，不匹配的部门折叠并显示为灰色
- 搜索清空时：恢复折叠状态

### R4: RoleLibraryPanel 双模式

`RoleLibraryPanel` 接受 `mode` prop：

```typescript
type RoleLibraryPanelProps = {
  mode: 'wizard'    // 向导 Step 2：外部控制导航（无确认按钮）
       | 'picker'   // 独立添加成员：内部有"添加 N 个成员"确认按钮
  selectedRoles: SelectedRole[]
  onToggle: (role: RoleAgent) => void
  onConfirm?: (roles: SelectedRole[]) => Promise<void>  // picker 模式专用
  onClose?: () => void
}
```

- `picker` 模式：点击"添加 N 个成员"后，调用 `onConfirm`（外部执行 API），完成后关闭
- `wizard` 模式：无确认按钮，选中状态由父组件 Step 2 管理

### R5: 角色列表渲染与搜索行为

总量 ~75 项，不引入虚拟滚动库。

- 搜索 `input.oninput` 即时过滤（无防抖）
- 有搜索词时：匹配部门自动展开，不匹配的折叠+灰显部门标题
- 无结果时：显示"未找到匹配角色 🔍"空状态
- 搜索清空：还原各部门展开/折叠状态

### R6: 团队四状态（新增 empty）

原设计漏了"无成员"状态：

| 状态 | 判断条件 | UI 展示 |
|------|----------|---------|
| `empty` | `members` 为空 | 空状态 + "添加成员"引导 |
| `configured` | 有成员，所有 `session_id=null` | 蓝色横幅 + 启动指引 |
| `running` | 至少一个 `session_id≠null` + `status=active` | 绿点 + 实时状态 |
| `idle` | 有 `session_id` 但 `status=idle/stopped` | 灰色 + "已完成" |

`empty` 状态时，成员区显示：

```
┌──────────────────────────────────────┐
│   👤  暂无成员                        │
│   [+ 从角色库添加成员]               │
└──────────────────────────────────────┘
```

### D7: 一键启动横幅的任务描述输入

（替代原"显示命令文本 + 复制"的方案）

`configured` 状态横幅完全隐藏 `/swarm start` 命令，用户只看到友好的任务描述界面：

```
┌─────────────────────────────────────────────────────────┐
│ 🚀 dev-team 已就绪                                      │
│   frontend-developer · backend-architect · ui-designer  │
│                                                          │
│  告诉团队要做什么：                                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 帮我实现用户登录功能，包含 JWT 鉴权...           │    │
│  └─────────────────────────────────────────────────┘    │
│  任务描述留空时使用默认行为                              │
│                                       [启动团队 →]       │
└─────────────────────────────────────────────────────────┘
```

- **成员摘要**：横幅顶部显示成员名列表（最多 3 个，超出显示"+ N 个"），让用户确认团队构成
- **任务描述 textarea**：2 行高，placeholder "描述你希望团队完成的任务..."
- **"启动团队"按钮**：点击 → 调用 `launchTeam()`（R1 流程），按钮变为"⟳ 启动中..."（禁用）
- **命令完全隐藏**：`/swarm start <team> <task>` 在后台拼接，用户不可见、不可复制
- **任务描述 state**：`teamTaskDesc: Record<string, string>`，各团队草稿独立保存

### D8: 运行中状态 — 实时监控机制

`running` 状态目前仅描述展示绿点，没有数据刷新策略。

**自动轮询**：选中团队后，若团队处于 `running` 状态，每 15 秒自动调用 `GET /api/swarm/teams/{team}` 刷新成员状态。

**成员卡片增量信息**：
```
┌──────────────────────────────────────┐
│ 🟢 frontend-developer                │
│    工程部门角色                       │
│    gpt-4o                            │
│    最近活跃: 38秒前                  │  ← joined_at 暂用，session 有则取 last_active
│                            [消息 ✉️] │
└──────────────────────────────────────┘
```

- 手动刷新：成员列表顶部显示小型"⟳ 刷新"按钮 + "上次更新 X 秒前"
- 轮询仅在 `running` 状态激活，`configured`/`idle` 状态不轮询
- 页面切离（unmount）时清除 `setInterval`

### D9: 成员角色定义查看

成员卡片上增加"查看角色 →"入口，让用户验证创建时写入的 system_prompt 是否符合预期。

**触发方式**：成员卡片右上角小图标按钮 `📄`（仅当 `prompt` 字段非空时显示）

**展示位置**：右侧详情面板的第三个 Tab（`📄 角色定义`），与 Transcript / Mailbox 平级：

```
[📋 Transcript]  [📬 Mailbox]  [📄 角色定义]
```

面板内容：
- 渲染 `member.prompt` 的 Markdown（使用现有 `MDRenderer` 组件）
- 顶部显示 `<member.name> 的角色定义`
- 若 `prompt` 为空，显示"未配置角色定义"

**数据来源**：`GET /api/swarm/teams/{team}` 已返回完整 `members`（含 `prompt` 字段），无需新增端点。

### D10: 空闲/完成后的引导流程

当团队所有成员 `status=idle/stopped` 且存在 `session_id`（曾运行过），展示任务完成横幅：

```
┌─────────────────────────────────────────────────────────┐
│ ✅ dev-team 任务已完成                                   │
│                                                          │
│  [查看 Lead 对话]          [开始新任务]                  │
└─────────────────────────────────────────────────────────┘
```

**"查看 Lead 对话"按钮**：
- 若团队有 `lead_agent_id`，选中该成员并切换到 Transcript tab
- 若无 lead（所有成员平级），选中第一个有 `session_id` 的成员

**"开始新任务"按钮**：
- 将团队状态视图切回 `configured` 横幅，并清空任务描述草稿（D7 的 `teamTaskDesc`）
- 逻辑上：团队在 configured/running/idle 之间循环；"开始新任务"只是 UI 重置，不修改 team.json
- 实际不需要后端 API，仅是 `setTeamView('configured')` 的 UI 状态切换

**状态判断新增 `done` 状态**：

| 状态 | 判断条件 | UI 展示 |
|------|----------|---------|
| `empty` | `members` 为空 | 空状态 + "添加成员"引导 |
| `configured` | 有成员，所有 `session_id=null` | 蓝色横幅 + 任务描述输入 + 启动指引 |
| `running` | 至少一个 `session_id≠null` + `status=active` | 绿点 + 15s 轮询 |
| `idle` | 有 `session_id`，所有 `status=idle/stopped` | 完成横幅（D10） |

（原 `idle` 状态拆分为"任务完成横幅"，行为比原设计更明确）

## Migration Plan

纯增量：新增路由、新增 UI 组件，不修改现有 Swarm 数据结构。无迁移风险。

## UX Design — 用户体验细节

### U1: Step 1 — 团队名输入体验

**问题**：kebab-case 约束对普通用户不友好，输入 "My Dev Team" 才报错。

**解决方案**：输入时**实时 slugify**（不阻止输入，同步转换）：

```
用户输入:    "My Dev Team 2024"
实时显示:    团队ID：my-dev-team-2024   ← 灰色提示行，实时更新
```

- 实际存储和创建时使用转换后的 slug，不使用原始输入
- 输入框下方显示小字：`仅支持小写字母、数字和连字符，如 dev-team`
- slug 函数：`input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`

### U2: Step 2 — 初始状态与信息层次

**问题**：三栏布局复杂，用户不知道从哪里开始。

**初始状态设计**：

```
┌──────────────┬──────────────────┬──────────────────────────┐
│  部门列表     │  角色列表         │  ← 右侧初始态            │
│  [工程] ▶    │  (请先选择左侧   │                          │
│  [设计] ▶    │   部门)          │   点击左侧部门            │
│  [市场] ▶    │                  │   浏览角色               │
│  [游戏] ▶    │                  │                          │
│              │                  │   点击角色名称            │
│  🔍 搜索     │                  │   查看详细介绍            │
└──────────────┴──────────────────┴──────────────────────────┘
```

- 页面顶部显示步骤指引：`选择专家 → 点击角色名预览 → 勾选加入团队`
- 默认**不展开**任何部门，引导用户自行选择
- 搜索框 placeholder：`搜索所有部门角色...`

### U3: Step 2 — 部门展开 + 勾选交互

**问题**：勾选（添加到团队）和点击（预览）的区别不清晰。

**解决方案**：将两个操作明确分离：

```
角色行布局：
  [☐]  frontend-developer         前端开发工程师   [预览 →]
  [☑]  backend-architect          后端架构师       [预览 →]
```

- **勾选框**：添加/移除成员（左侧）
- **"预览 →" 按钮**：加载右侧 Markdown 预览（右侧）
- 勾选后行背景高亮（`rgba(137,180,250,0.12)`），无需点击预览也能知道已选

**选择数量引导**：Step 2 顶部显示 `已选 2 个专家（建议 2-5 个）`

### U4: Step 2 — 搜索体验

- 搜索激活时，**自动展开**所有有匹配结果的部门
- 不匹配的部门折叠 + 部门标题变灰（保留存在感，不消失）
- 匹配的角色名中关键词高亮（`<mark>` 样式）
- 右上角显示 `共找到 N 个角色` 计数
- 搜索框右侧有 `×` 清空按钮（搜索框有内容时才显示）

### U5: Step 3 — 进度与等待体验

**问题**：用户不知道需要等多久，也不知道失败在哪一步。

**进度条设计**：

```
正在创建团队...

  ✓ 创建团队 dev-team
  ⟳ 获取角色内容 (2/3)...        ← 当前步骤，旋转动画
  ○ 添加成员
  ○ 完成

  [━━━━━━━━━━━━━━━░░░░░░░░]  40%
```

- 每个子步骤有独立状态：`○ 待完成 / ⟳ 进行中 / ✓ 成功 / ✗ 失败`
- **失败时显示具体原因**：`✗ 添加成员 backend-architect 失败：网络超时`
- 不显示预计时间（不可预测），但显示 `已用时 5s` 避免用户以为卡死

**失败后的操作**：

```
⚠️ dev-team 已创建，但 1 个成员添加失败

  ✓ frontend-developer — 已添加
  ✗ backend-architect  — 网络超时 [查看详情]

  [← 返回编辑]   [重试失败项]   [完成（跳过失败项）]
```

- "返回编辑"：关闭向导，进入 dev-team 详情页（已有 1 个成员），可手动添加
- "重试失败项"：仅重试失败的成员，不重新创建团队
- "完成"：跳过失败，接受部分成功

### U6: 向导返回导航

**问题**：用户进入 Step 2 后发现想改团队名，没有返回路径。

```
Step 1: 命名  ─────▶  Step 2: 选专家  ─────▶  Step 3: 创建中
   ✓ 已完成                ◉ 当前                  ○ 待完成

               [← 返回]                     [不允许返回]
```

- Step 2 → Step 1："← 返回" 按钮（角色选择状态**保留**，用户改名后回来不需要重选）
- Step 3 开始后：**禁止返回**（创建操作已开始，返回不安全），仅允许"失败后返回"

**Esc/X 取消**：
- 在 Step 1/2：点 X 或按 Esc 关闭向导，已选角色丢弃，弹确认对话框（"确定取消？已选的角色将清空"）
- 在 Step 3 创建完成后：X 关闭同"完成"

### U7: 角色库加载失败 UX

GitHub 不可达时（Step 2 打开），不应让用户面对空白页面：

```
─────────────────────────────────────
⚠️ 角色库暂时无法加载

   raw.githubusercontent.com 连接失败

   • 检查网络连接
   • 或配置 HTTPS_PROXY 环境变量
   • 如有本地缓存，已缓存的角色仍可使用

   [重试]   [跳过，手动创建]
─────────────────────────────────────
```

- 加载中：骨架屏（部门列表行占位符 3 个）
- **已有本地缓存**：即使 GitHub 不可达，缓存的角色仍显示（带"离线"标签）

### U8: 团队列表 — 新建团队高亮

创建完成后，新团队应在列表中**自动选中并高亮**（而不是让用户去找）：

- 列表重新排序（`list_teams` 按字母排序）→ 新团队可能不在顶部
- 解决方案：关闭向导时，`setSelectedTeam(newTeamName)` 直接选中
- 视觉：新创建的团队行闪烁高亮 1.5s（CSS animation `pulse`）后恢复正常
