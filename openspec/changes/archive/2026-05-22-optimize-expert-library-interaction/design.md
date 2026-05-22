## Context

HLAgent 专家库功能由三层组成：

1. **目录层**（`role_library.py`）：当前 `AGENT_CATALOG` 是 140+ 条目的 Python 硬编码列表，每次更新需重新部署服务。
2. **内容层**：角色 Markdown 文件从 CDN/GitHub 按需拉取，已有 L1（内存）+ L2（磁盘）缓存，运行良好。
3. **对话入口**（`ExpertsPage.tsx` + `swarmApi.ts`）：点击「对话 →」直接调 `POST /api/sessions { role_prefix }` 并跳转，跳过了 `CreateSessionModal`（工作目录选择弹窗），且无专家身份元数据。

现有 `CreateSessionModal` 支持工作目录选择，普通新建对话路径完整；专家对话单独绕开了这个流程，导致体验断层。

## Goals / Non-Goals

**Goals:**

- 专家目录通过云控 URL 动态获取，无需重新部署即可新增/修改专家
- 专家发起对话时复用 `CreateSessionModal`，与普通新建对话体验一致（含工作目录选择）
- Session 创建成功后侧边栏实时刷新，不需用户手动刷新
- Chat 页面及侧边栏显示专家身份标识（角色名称）

**Non-Goals:**

- 不改变角色 Markdown 内容的获取方式（CDN fallback 链不变）
- 不引入用户级专家收藏或自定义角色功能
- 不修改 Swarm 团队创建流程
- 不做云控认证/鉴权（URL 为公开可读端点）

## Decisions

### D1：目录使用同仓库 `catalog.json`，复用现有 CDN→GitHub fallback 链

**背景**：角色内容已从 `https://github.com/jnMetaCode/agency-agents-zh` 拉取，使用以下双源 fallback：
```python
_CONTENT_SOURCES = [
    "https://cdn.jsdelivr.net/gh/jnMetaCode/agency-agents-zh@main",   # 国内 CDN，优先
    "https://raw.githubusercontent.com/jnMetaCode/agency-agents-zh/main",  # GitHub 原始地址，fallback
]
```
目录应同样来自该仓库，存为 `catalog.json`（与角色 Markdown 同仓库管理）。

**方案**：直接调用 `_fetch_content("catalog.json")` 获取目录 JSON 文本，再用 `CatalogOut.model_validate_json()` 解析。整套 L1/L2 缓存、proxy 支持、超时、CDN→GitHub fallback 全部复用，**零额外代码**。

```python
_CATALOG_PATH = "catalog.json"

async def _get_catalog() -> CatalogOut:
    custom_url = os.environ.get("HLAGENT_EXPERT_CATALOG_URL")
    if custom_url:
        # 企业私有部署可覆盖，见 _fetch_catalog_from_url
        result = await _fetch_catalog_from_url(custom_url)
        if result is not None:
            return result
        log.warning("Custom catalog URL failed, falling back to built-in")
    else:
        try:
            text = await _fetch_content(_CATALOG_PATH)   # CDN → GitHub，自动缓存
            return CatalogOut.model_validate_json(text)
        except Exception as e:
            log.warning("Remote catalog fetch failed: %s, using built-in", e)
    # 离线兜底
    return CatalogOut(departments=[RoleDepartmentOut(...) for dept in AGENT_CATALOG])
```

**选项对比（已决定）：**
- **方案 A（本方案）**：`catalog.json` 与角色内容同仓库，复用 `_fetch_content` 基础设施。默认无需配置，国内用户走 CDN，海外/离线走 GitHub 或内置列表。
- 方案 B（原方案）：`HLAGENT_EXPERT_CATALOG_URL` 必填，每次部署需额外配置。
- 方案 C：本地 JSON 文件，无法动态更新。

`HLAGENT_EXPERT_CATALOG_URL` **降为可选的企业私有覆盖**：不设置时使用 `catalog.json` + `_CONTENT_SOURCES` 链；设置后优先使用自定义 URL（同样支持 proxy + timeout + fallback 到内置列表）。

### D2：专家对话改为先弹 CreateSessionModal，再传入 `expertRole` 上下文

**选项对比：**
- 方案 A（本方案）：`ExpertsPage` 点击「对话 →」后弹出扩展版 `CreateSessionModal`，modal 内部处理创建和跳转，同时携带 `role_prefix`、`expert_role`、`expert_role_label`。
- 方案 B：在 ExpertsPage 内嵌入工作目录输入框，不弹 modal。

**选择方案 A 的理由：** 复用已有 modal 逻辑（目录选择、422 错误处理、键盘快捷键），减少重复代码；用户心智模型一致（「新建对话」均经过同一弹窗）。

`CreateSessionModal` 新增可选 prop（完整签名）：
```typescript
interface Props {
  onCreated: (sessionId: string) => void
  onClose: () => void
  expertRole?: {
    name: string         // 机器名，如 "frontend-developer"
    description: string  // 中文描述，如 "前端开发工程师"
    dept: string         // 部门 label，如 "工程"（不是 id）
    rolePrefix: string   // 角色 Markdown 内容（前 3000 字符）
  }
}
```
当 `expertRole` 存在时（专家模式）：
- 标题改为「与 {description} 开始对话」
- 展示专家信息摘要区（description + dept，不显示英文机器名）
- 原副标题"选择 Agent 的工作目录…"不显示
- 工作目录标签改为「代码目录（如需处理文件，可选）」
- 帮助文字去掉 ⚠ 图标
- 确认按钮改为「开始对话 →」
- 请求 body 附加 `role_prefix`、`expert_role`（name）、`expert_role_label`（description）

### D3：`expert_role` + `expert_role_label` 双字段存入 SessionEntry

**问题**：`expert_role` 存储机器名（如 `"frontend-developer"`），侧边栏需要展示中文描述（如 `"前端开发工程师"`）。Sidebar 独立渲染，不持有专家目录数据，若依赖前端 catalog 解析会产生隐式依赖。

**方案**：后端创建 Session 时同时存储人类可读标签，前端直接使用，无需二次查表。

`SessionSummary` 新增两个字段：
```python
expert_role: str | None = None        # 机器名，如 "frontend-developer"
expert_role_label: str | None = None  # 人类可读描述，如 "前端开发工程师"
```
`CreateSessionRequest` 同样新增两个字段：
```python
expert_role: str | None = None
expert_role_label: str | None = None
```
`SessionEntry` 存储两个字段；`list_sessions` 端点一并返回。

前端传入：`expert_role = role.name`（如 `"frontend-developer"`），`expert_role_label = role.description`（如 `"前端开发工程师"`）。

### D4：侧边栏刷新和 expert_role_label 跨组件共享通过 uiStore 实现

**问题**：现有 `Sidebar` 的 `sessions` 列表是组件局部 state，通过 `refreshKey` prop（由 `AppLayout` 管理）触发刷新。`ExpertsPage` 是 AppLayout 的子组件，无直接访问 `setSidebarRefreshKey` 的途径；`ChatView` 也无法读取 Sidebar 的局部 `sessions` 来获取 `expert_role_label`。

**方案**：向 `uiStore` 添加两个轻量字段：

```typescript
// uiStore.ts 新增
sidebarRefreshKey: number                      // 每次 +1 触发 Sidebar 重新拉取
expertRoleLabels: Record<string, string>       // sessionId → expert_role_label 映射

incrementSidebarRefreshKey: () => void
setExpertRoleLabels: (labels: Record<string, string>) => void
```

**Sidebar**：effect 依赖数组增加 `ui.sidebarRefreshKey`；拉取完成后调用 `ui.setExpertRoleLabels(...)` 填充映射：
```tsx
useEffect(() => {
    fetch('/api/sessions')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((data: SessionSummary[]) => {
            setSessions(data)
            const labels: Record<string, string> = {}
            for (const s of data) {
                if (s.expert_role_label) labels[s.session_id] = s.expert_role_label
            }
            ui.setExpertRoleLabels(labels)
        })
}, [refreshKey, ui.sidebarRefreshKey])  // ← 两个 key 均可触发
```

**ExpertsPage.handleExpertCreated**：调用 `ui.incrementSidebarRefreshKey()` 触发侧边栏刷新。

**ChatView**：读取 `ui.expertRoleLabels[sessionId]` 获取 expert label（无需额外请求）。

## Code Architecture Notes

### Gateway：expert_role / expert_role_label 不进入 AgentSessionConfig

`AgentSessionConfig`（SDK 层）只负责 agent 运行时配置（model、cwd、system_prompt 等）。`expert_role` 和 `expert_role_label` 是纯 Gateway 元数据，**不得**传入 `AgentSessionConfig`。

实现模式：在 `sessions.py` 的 `create_session` 中，先调用 `session_mgr.create_with_id(session_id, config)` 创建 host，再从 `get_entry(session_id)` 拿到 entry，**直接在 entry 上设置字段**：
```python
session_mgr.create_with_id(session_id, config)
entry = session_mgr.get_entry(session_id)
if entry and req.expert_role:
    entry.expert_role = req.expert_role
    entry.expert_role_label = req.expert_role_label
```
这样 `SessionManager.create_with_id` 签名无需改动，不影响其他调用方（`create()` 方法和测试代码）。

### 云控目录 fetch：复用现有 proxy + timeout 模式

`_fetch_catalog_from_url` 应与 `_fetch_content` 采用相同的 `client_kwargs` 构建方式：
```python
proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
client_kwargs: dict[str, Any] = {"timeout": 10.0}
if proxy_url:
    client_kwargs["proxy"] = proxy_url
async with httpx.AsyncClient(**client_kwargs) as client:
    resp = await client.get(url)
    ...
```

### ExpertsPage：dept 传 label 不传 id

`expertModalConfig.dept` 应存部门的人类可读标签（如 `"工程"`），不是机器 id（`"engineering"`）。
在构建 `expertModalConfig` 时做映射：
```tsx
const deptLabel = catalog?.departments.find(d => d.id === deptId)?.label ?? deptId
setExpertModalConfig({ name: role.name, description: role.description, dept: deptLabel, rolePrefix: content })
```

## Risks / Trade-offs

- **云控 URL 不可达** → 使用内置硬编码 fallback，降级无感。缓存命中时不影响已启动的实例。
- **目录 JSON 格式版本不兼容** → 启动时做 schema 验证（Pydantic 解析），失败则 fallback 到内置列表并记录警告日志。
- **CreateSessionModal 弹窗增加操作步骤** → 用户需多一次点击（选择工作目录或直接确认）。可通过默认展示「留空自动分配」降低摩擦感；这是必要的体验一致性代价。
- **expert_role 字段在旧客户端** → 字段为可选，旧客户端忽略即可，无 Breaking Change。

## Migration Plan

1. 后端先发布：`SessionSummary`/`CreateSessionRequest` 新增 `expert_role`/`expert_role_label`（可选字段，向后兼容）。
2. 后端 catalog 端点默认从 `catalog.json`（CDN→GitHub）动态拉取；`HLAGENT_EXPERT_CATALOG_URL` 为可选企业私有覆盖；远端不可达时回退内置列表，用户无感知。
3. 前端更新 `CreateSessionModal`（新增 `expertRole` prop），更新 `ExpertsPage`（改为弹 modal），更新 `Sidebar` 和 Chat 页面（显示专家标识）。
4. 无数据库迁移，SessionEntry 仅内存结构变更。

**回滚**：删除环境变量 `HLAGENT_EXPERT_CATALOG_URL` 即恢复使用内置列表；前端回滚 commit 即可，旧 `startExpertChat` 路径不依赖新字段。

## UI Design Notes

### 专家对话 Modal 结构（专家模式）

**用户语言原则**：多数专家场景（营销策略、UX 分析等）与"代码目录"无关；即便是技术场景，用户的目标是"开始聊"，不是"配置环境"。Modal 应以"开始对话"为主视觉目标，工作目录为次要的可选补充。

三项关键文案调整：
1. **确认按钮**：`创建对话 →` → `开始对话 →`（用户语言，描述目标而非操作）
2. **工作目录标签**：`工作目录（可选）` → `代码目录（如需处理文件，可选）`（解释用途，帮助用户判断是否需要填写）
3. **帮助文字**：去掉 `⚠` 警告图标，改为平实说明（⚠ 图标让用户以为"留空"是危险操作）：
   `留空时将自动创建工作区，删除会话时一并清理`

最终 Modal 布局：

```
┌─────────────────────────────────────────┐
│ 与 前端开发工程师 开始对话               │  ← 标题（1rem, bold, #cdd6f4）
├─────────────────────────────────────────┤
│ 🎭 前端开发工程师                       │  ← 专家信息区（#cba6f7, 0.875rem）
│    工程                                 │  ← 部门标签（#6c7086, 0.75rem，仅显示中文部门名）
├─────────────────────────────────────────┤
│ 代码目录（如需处理文件，可选）           │  ← 标签（轻量化，说明用途）
│ [___________________________] [📁 浏览] │
│                                         │
│ 留空时将自动创建工作区，删除会话时一并清理 │  ← 帮助文字（无 ⚠，平实说明）
├─────────────────────────────────────────┤
│ [取消]              [开始对话 →]        │  ← 主按钮用"开始对话"
└─────────────────────────────────────────┘
```

- **Modal 副标题只显示部门名（如 `工程`），不显示机器名（如 `frontend-developer`）**：kebab-case 英文名对中文用户没有实际意义，且与页面其他位置的中文风格不符。`expertRole.dept` 已是 label（见 task 5.1），直接渲染即可，无需附带 `expertRole.name`。
- 副标题 "选择 Agent 的工作目录，Agent 将在此目录读写文件和执行代码" 在专家模式下**不显示**（专家信息区已提供上下文，技术性描述对非工程师用户造成不必要的认知负担）
- 无需加"🎭 专家模式"角标文字（避免冗余）

### Chat Header 专家芯片

ChatView 顶部 header（44px）当前布局：
```
[{model} · {id[-4:]}] ......... [● wsStatus] [⚙]
```
芯片插入位置：在模型文本之后，marginLeft: auto 的 wsStatus 之前：
```
[{model} · {id[-4:]}] [🎭 前端开发工程师] ......... [● wsStatus] [⚙]
```
芯片样式：
```css
background: #313244;
color: #cba6f7;
border-radius: 4px;
padding: 0.1rem 0.4rem;
font-size: 0.7rem;
white-space: nowrap;
max-width: 160px;
overflow: hidden;
text-overflow: ellipsis;
```

### 侧边栏专家角标

Session 条目现有文字层级：标题（session label）位于第一行，时间/状态在第二行。专家角标作为第三行（可选）：
```
前端项目开发                ← session label（0.8125rem）
刚刚                        ← 时间（0.7rem, #6c7086）
🎭 前端开发工程师            ← 专家角标（0.7rem, #cba6f7，max-width: 100%, ellipsis）
```
字号建议 **0.7rem**（而非原设计 0.65rem），保持可读性。超出一行则截断，不换行。

**三行密度问题**：当专家对话使用托管目录时，侧边栏条目会同时出现「标题 + 临时标签 + 专家角标」三行，在 220px 宽度下非常拥挤。**设计决策**：

- 若 `session.is_managed === true` 且 `session.expert_role_label` 非空 → **只显示专家角标，不显示「临时」标签**（专家标签已足够区分该 session 的性质，「临时」标签冗余）
- 若 `session.is_managed === false`（用户指定目录）且 `session.expert_role_label` 非空 → **两行均显示**（路径和专家身份都有价值）
- 若无 `expert_role_label` → 维持现有逻辑（「临时」或路径，不变）

```
// 有专家标识 + 托管目录：2 行
前端项目开发
🎭 前端开发工程师

// 有专家标识 + 用户目录：3 行
前端项目开发
📁 /Users/dev/myproject
🎭 前端开发工程师

// 无专家标识：现有逻辑不变
普通对话
临时
```

### 「对话 →」点击的 Loading 状态

当用户点击角色列表中的「对话 →」（该角色未预览，roleContent 未加载）时：
1. 按钮立即切换为 "⟳ 准备中"（setBusyPath），用户有即时反馈
2. 后台 fetch roleContent（通常 < 1s，CDN 或磁盘缓存）
3. Fetch 完成后关闭 busy 状态并打开 Modal
4. 若 fetch 失败（网络错误/503），按钮恢复正常并在列表上方显示 chatError toast

**用户视角**：用户看到按钮"⟳ 准备中"时不了解"在准备什么"。由于通常 < 1s 完成，这不是严重问题；但如网速慢导致等待 > 2s，用户可能怀疑点击是否生效。**建议**：若 fetch 时间超过 500ms，在列表顶部或 toast 区显示一条轻提示"正在加载专家资料…"，完成后自动消失，不需要用户操作。这是增强项，不影响核心功能。

预览区的「与此专家对话 →」由于 roleContent 已加载，直接打开 Modal（无 loading 步骤），是更流畅的用户路径；建议在专家库使用指引中提示用户"点击专家名称预览后，可直接点击开始对话"。

## Open Questions（已解答）

- **云控目录 URL 的具体地址由谁维护？** 目录文件 `catalog.json` 由 `jnMetaCode/agency-agents-zh` 仓库维护，与角色内容文件同仓库。国内用户通过 jsDelivr CDN 访问（`cdn.jsdelivr.net/gh/jnMetaCode/...`），海外用户通过 `raw.githubusercontent.com` 访问。无需额外部署配置；企业私有部署可设置 `HLAGENT_EXPERT_CATALOG_URL` 指向内网镜像。
- **侧边栏标识样式**：采用第三行小标签方案（见上方 UI Design Notes）。
- **Chat 顶栏样式**：采用模型名后内联 chip 方案（见上方 UI Design Notes）。
