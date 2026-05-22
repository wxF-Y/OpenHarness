## 1. 后端：Session API 新增 expert_role / expert_role_label 字段

- [x] 1.1 在 `sessions.py` 的 `CreateSessionRequest` 中新增 `expert_role: str | None = Field(None, max_length=100)` 和 `expert_role_label: str | None = Field(None, max_length=100)`（加长度约束防止过长字符串进入内存）
- [x] 1.2 在 `SessionEntry`（`session_manager.py`）中新增 `expert_role: str | None = None` 和 `expert_role_label: str | None = None` 字段（`@dataclass`，两个字段加在 `model` 字段之后）
- [x] 1.3 **不修改 `create_with_id` 签名**；在 `sessions.py` 的 `create_session` 中，调用 `session_mgr.create_with_id(session_id, config)` 后，通过 `entry = session_mgr.get_entry(session_id)` 获取 entry 并直接赋值：`entry.expert_role = req.expert_role; entry.expert_role_label = req.expert_role_label`（仅当 entry 非 None 时）
- [x] 1.4 在 `SessionSummary` Pydantic 模型中新增 `expert_role: str | None = None` 和 `expert_role_label: str | None = None` 字段
- [x] 1.5 在 `list_sessions` 端点的 `results.append(SessionSummary(...))` 调用中加入 `expert_role=entry.expert_role, expert_role_label=entry.expert_role_label`
- [x] 1.6 在 `create_session` 的返回 `SessionSummary(...)` 中加入 `expert_role=req.expert_role, expert_role_label=req.expert_role_label`（确保创建响应也包含这两个字段）

## 2. 后端：专家目录远程拉取支持

- [x] 2.1 在 `role_library.py` 中新增常量 `_CATALOG_PATH = "catalog.json"`，新增 `_fetch_catalog_from_url(url: str)` 异步函数（复用 proxy+timeout 模式，解析为 `CatalogOut`，失败返回 `None` 并记录 WARNING）；该函数仅供 `HLAGENT_EXPERT_CATALOG_URL` 覆盖场景使用
- [x] 2.2 新增 `_get_catalog()` 异步函数，优先级如下：
  1. 若设置了 `HLAGENT_EXPERT_CATALOG_URL` → 调用 `_fetch_catalog_from_url(url)`；失败则 fallback 到 CDN/GitHub 路径再到内置列表
  2. **默认**：调用 `await _fetch_content(_CATALOG_PATH)`（复用现有 `_CONTENT_SOURCES` CDN→GitHub fallback 链 + L1/L2 缓存），将返回的 JSON 文本用 `CatalogOut.model_validate_json()` 解析；解析失败则 fallback 到内置列表
  3. 离线兜底：返回内置 `AGENT_CATALOG` 构建的 `CatalogOut`
- [x] 2.3 目录缓存由 `_fetch_content("catalog.json")` 自动处理（L1 key 为字符串 `"catalog.json"`，L2 文件为 `_CACHE_ROOT/catalog.json`）；本任务**不需要额外实现**，仅作标注确认，确保 task 2.5 使用正确的 key 名
- [x] 2.4 修改 `GET /api/swarm/role-library/catalog` 端点：改为调用 `await _get_catalog()` 并序列化返回
- [x] 2.5 扩展 `DELETE /api/swarm/role-library/cache`：现有 `_l1_clear()` 已清除全部 L1（含 "catalog.json"），`rglob("*")` 已删除全部磁盘文件（含 catalog.json）；无需额外代码，已验证覆盖
- [x] 2.6 更新 `get_content` 端点：白名单改为在请求时动态从 `_get_catalog()` 获取（已通过 L1 缓存，O(1)）；移除死代码 `_VALID_PATHS`

## 3. 前端：types/api.ts 更新

- [x] 3.1 在 `SessionSummary` interface 中新增 `expert_role?: string | null` 和 `expert_role_label?: string | null` 字段

## 3b. 前端：uiStore.ts 新增共享状态

- [x] 3b.1 向 `uiStore.ts` 的 `UiState` interface 新增两个字段：`sidebarRefreshKey: number`（初始值 0）和 `expertRoleLabels: Record<string, string>`（初始值 `{}`）
- [x] 3b.2 向 `uiStore.ts` 新增两个 action：`incrementSidebarRefreshKey: () => void`（`sidebarRefreshKey` 自增 1）和 `setExpertRoleLabels: (labels: Record<string, string>) => void`（全量替换映射表）

## 4. 前端：CreateSessionModal 支持专家模式

- [x] 4.1 在 `CreateSessionModal` 的 `Props` 接口中新增 `expertRole?: { name: string; description: string; dept: string; rolePrefix: string }` 可选 prop（新增 `dept` 字段用于信息区副标题）
- [x] 4.2 当 `expertRole` 存在时，弹窗标题从「新建对话」改为「与 {expertRole.description} 开始对话」；**隐藏**副标题"选择 Agent 的工作目录，Agent 将在此目录读写文件和执行代码"（对非技术用户造成认知负担）
- [x] 4.3 当 `expertRole` 存在时，在工作目录输入区上方渲染专家信息区：`🎭 {description}`（#cba6f7, 0.875rem）+ 仅显示部门名 `{dept}`（#6c7086, 0.75rem，**不显示机器名 `name`**），下方加一条分隔线（border-bottom: 1px solid #313244）
- [x] 4.4 在 `handleCreate` 中，当 `expertRole` 存在时请求 body 附加 `role_prefix`、`expert_role`（name）、`expert_role_label`（description）字段
- [x] 4.5 专家模式下文案三处调整：工作目录标签改为「代码目录（如需处理文件，可选）」；帮助文字改为「留空时将自动创建工作区，删除会话时一并清理」（去掉 ⚠ 图标）；确认按钮文字改为「开始对话 →」（而非「创建对话 →」）

## 5. 前端：ExpertsPage 改为弹 Modal 而非直接跳转

- [x] 5.1 在 `ExpertsPage` 中新增 `expertModalConfig` state，类型为 `{ name: string; description: string; dept: string; rolePrefix: string } | null`，初始值 `null`；注意 `dept` 字段存**部门 label**（如 `"工程"`），不是 id（`"engineering"`）
- [x] 5.2 重写 `startChat(role, content)` 函数：
  - 若 `previewRole?.role.path === role.path && previewContent` 则直接用已有 content（无需 fetch）
  - 否则 `setBusyPath(role.path)` 后 `await fetchRoleContent(role.path)`
  - fetch 成功后 `setBusyPath(null)`，然后 `setExpertModalConfig({ name: role.name, description: role.description, dept: catalog?.departments.find(d => d.agents.some(a => a.path === role.path))?.label ?? '', rolePrefix: content })`
  - fetch 失败时 `setBusyPath(null); setChatError('加载专家内容失败，请重试')`，不打开 Modal
- [x] 5.3 在 ExpertsPage 渲染中，当 `expertModalConfig` 非 null 时渲染 `<CreateSessionModal expertRole={expertModalConfig} onCreated={handleExpertCreated} onClose={() => setExpertModalConfig(null)} />`
- [x] 5.4 实现 `handleExpertCreated(sessionId)`：调用 `useUiStore.getState().incrementSidebarRefreshKey()`，然后 `navigate('/chat/${sessionId}')`
- [x] 5.5 `startExpertChat` 仍被 `RoleLibraryPanel.tsx`（Swarm 流程）使用，保留不删除
- [x] 5.6 更新 ExpertsPage header 副标题：将 `"选择专家直接开始对话"` 改为 `"选择专家，配置并开始对话"`
- [x] 5.7 更新 ExpertsPage 右侧预览区空状态提示：将 `"或直接点击"对话 →"立即开始"` 改为 `"或点击「对话 →」配置工作目录后开始"`

## 6. 前端：侧边栏显示专家角标

- [x] 6.1 在 `Sidebar.tsx` 的 Session 条目渲染中，将现有路径/临时标签逻辑改为三路分支：
  - 若 `s.expert_role_label` 非空 且 `s.is_managed === true` → 只渲染专家角标（跳过「临时」标签，避免三行拥挤）
  - 若 `s.expert_role_label` 非空 且 `s.is_managed === false` → 先渲染路径行（`📁 {path}`），再渲染专家角标
  - 若 `s.expert_role_label` 为空 → 维持现有逻辑（「临时」或路径）
- [x] 6.2 专家角标样式：颜色 `#cba6f7`，字号 `0.7rem`，单行截断（overflow: hidden; text-overflow: ellipsis; white-space: nowrap），直接使用 `s.expert_role_label`

## 7. 前端：Chat 页面显示专家身份标识

- [x] 7.1 在 `ChatView`（`AppLayout.tsx`）中，通过 `useUiStore()` 读取 `ui.expertRoleLabels[sessionId]` 获取 `expert_role_label`（无需额外网络请求；Sidebar 每次拉取 `/api/sessions` 后会同步填充此 map）
- [x] 7.2 当 `expert_role_label` 非空时，在 ChatView 顶部 header 的模型名称文本之后（wsStatus indicator 之前）插入内联 chip：`🎭 {expert_role_label}`，样式：`background: #313244, color: #cba6f7, borderRadius: 4px, padding: 0.1rem 0.4rem, fontSize: 0.7rem, maxWidth: 160px, overflow: hidden, textOverflow: ellipsis, whiteSpace: nowrap`

## 8. 前端：Session 列表刷新机制

- [x] 8.1 在 `Sidebar.tsx` 中将 `useUiStore()` 引入，在 `useEffect` 依赖数组中**追加** `ui.sidebarRefreshKey`（保留原有 `refreshKey` prop 依赖，二者均可独立触发拉取）；拉取成功后调用 `useUiStore.getState().setExpertRoleLabels(...)` 更新映射表
- [x] 8.2 确认 `AppLayout.handleSessionCreated` 仍调用 `setSidebarRefreshKey((k) => k+1)`（prop 路径，无需改动）；`ExpertsPage.handleExpertCreated` 调用 `ui.incrementSidebarRefreshKey()`（store 路径）；两者都会触发 Sidebar 重新拉取

## 9. 验证

- [ ] 9.1 在浏览器中验证：专家库「对话 →」弹出 Modal，可选择工作目录，创建后跳转到 Chat 页面
- [ ] 9.2 验证：Chat 页面顶部显示专家标识；侧边栏显示专家角标
- [ ] 9.3 验证：侧边栏在专家 Session 创建后立即刷新（无需手动刷新）
- [ ] 9.4 验证：**不设置** `HLAGENT_EXPERT_CATALOG_URL`，专家库正常展示目录内容（来自 CDN/GitHub 远端 `catalog.json` 或内置 fallback）
- [ ] 9.5 验证：设置 `HLAGENT_EXPERT_CATALOG_URL` 指向自定义地址后，专家目录内容由该 URL 提供
- [ ] 9.6 验证：`HLAGENT_EXPERT_CATALOG_URL` 不可达（或 `catalog.json` 远端 404）时，专家库正常展示内置列表，无报错
- [ ] 9.7 验证：`DELETE /api/swarm/role-library/cache` 清除缓存后，下次请求重新拉取远端 `catalog.json`（`X-Cache: MISS` 响应头）
