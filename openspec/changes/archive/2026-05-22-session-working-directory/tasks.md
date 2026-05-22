## 1. Gateway 后端 — 工作目录分配

- [x] 1.0 在 `sessions.py` 顶部补充缺失 import：`import os`, `import shutil`, `import logging`, `import asyncio`；添加模块级 `log = logging.getLogger(__name__)`
- [x] 1.1 确认 `session_manager.py` 的 `SessionEntry` 已有 `cwd: str | None` 字段且在 `SessionManager.create()` 中赋值 — 无需新增字段，直接复用；托管判断在 `delete_session` 中通过路径前缀实现
- [x] 1.2 在 `sessions.py` 中定义模块级常量 `_workspaces_root = Path(os.environ.get("OPENHARNESS_CONFIG_DIR", Path.home() / ".hlagent")) / "workspaces"`（使用 `OPENHARNESS_CONFIG_DIR` 而非硬编码 `~/.hlagent`，与 `main.py` 保持一致）；在 `create_session` 中当 `req.cwd` 为 None 时，用 `_workspaces_root / session_id` 并 `Path.mkdir(parents=True, exist_ok=True)`
- [x] 1.3 在 `create_session` 中：当 `req.cwd` 不为 None 时，用 `Path(req.cwd).expanduser().resolve()` 规范化后验证路径存在且 `is_dir()`，否则返回 HTTP 422（detail: f"工作目录不存在或不是目录: {req.cwd}"）
- [x] 1.4 确保 `create_session` 最终传给 `AgentSessionConfig` 的 `cwd` 始终为非 None 的绝对路径字符串（`actual_cwd: str`）
- [x] 1.5 **修复响应 bug**：`create_session` 返回 `SessionSummary` 时使用 `cwd=entry.cwd or ""` 而非 `cwd=req.cwd or ""`（当前代码 `sessions.py:162` 的 bug：req.cwd=None 时前端收到空字符串）

## 2. Gateway 后端 — 会话删除清理

- [x] 2.1 在 `sessions.py` 的 `delete_session` 中：将 `host = session_mgr.get(session_id)` 替换为 `entry = session_mgr.get_entry(session_id)`，读取 `cwd_str = entry.cwd if entry else None`；**顺序要求**：必须在 `session_mgr.remove()` 之前读取 entry，否则 remove 后 entry 丢失
- [x] 2.2 若 cwd_str 非 None 且 `Path(cwd_str).resolve().is_relative_to(_workspaces_root.resolve())`（路径前缀验证；design.md 写 `startswith()` 但 `is_relative_to()` 在有符号链接时更安全），则执行清理流程：用 `try/except` 包裹 `await entry.host.stop()`（忽略 stop 失败，不阻断后续清理）→ `session_mgr.remove(session_id)` → `await asyncio.to_thread(shutil.rmtree, cwd_str, True)` ；**async I/O**：`shutil.rmtree` 必须用 `asyncio.to_thread` 包裹，避免阻塞事件循环
- [x] 2.3 若 cwd_str 为 None 或非托管路径：正常 `await host.stop(); session_mgr.remove(session_id)` 不做清理
- [x] 2.4 清理失败时（`shutil.rmtree` 抛异常）：`log.warning("Failed to remove managed workspace %s: %s", cwd_str, exc)`，不阻塞 HTTP 204 响应
- [x] 2.5 路径前缀验证为 False 时记录 `log.error("Skipping rmtree: %s not under workspaces root", cwd_str)`

## 3. Gateway 后端 — SessionEntry cwd 可读性

- [x] 3.2 更新 `list_sessions` 中 `SessionSummary` 的 `cwd` 字段：当 `host.is_ready=False` 时从 `entry.cwd` 读取（已分配的绝对路径），不再返回空字符串；与 task 1.5 保持一致的模式

## 4. Gateway 后端 — 新增 /api/fs/ls 目录列表端点

<!-- UI 审查发现：DirBrowser 需要此端点，但当前 fs.py 缺失（ListDirEntry model 已定义） -->

- [x] 4.1 在 `fs.py` 中添加 `GET /api/fs/ls` 路由（**注意**：design.md Decision 3 写"复用现有 /api/fs/ls"，但该端点实际不存在；`ListDirEntry` model 已定义但无路由，此任务是新增而非复用）；接受可选 query param `path: str | None = None`
- [x] 4.2 `path` 为 None 时使用 `Path.home()` 作为起点；否则使用 `Path(path).expanduser().resolve()`
- [x] 4.3 路由只返回**目录类型**条目（`is_dir()=True`），排除隐藏目录（以 `.` 开头），按名称**大小写不敏感**排序（`sorted(..., key=lambda e: e.name.lower())`）
- [x] 4.4 路径不存在或不是目录时返回 HTTP 404；`PermissionError` 时返回 HTTP 403（`detail: "无权访问该目录: {path}"`）；**不限制 home 目录范围**（Windows 用户项目可能在 `D:\` 等非 home 位置），只需确保路径合法可读即可
- [x] 4.5 响应 `ListDirEntry` 列表：`name`, `path`（绝对路径字符串，统一用正斜杠 `/` 作为分隔符，即 `str(p.resolve()).replace('\\', '/')`）, `is_dir=True`；统一格式兼容前端面包屑分割

## 4b. 前端 — 共享 TypeScript REST 类型

<!-- coder 审查：protocol.ts 只有 WebSocket 类型；SessionSummary 在 Sidebar.tsx 中内联定义，CreateSessionModal 和其他组件需要重用 -->

- [x] 4b.1 在 `HLAgent/web/src/types/` 下新建 `api.ts`，导出 `SessionSummary`（与后端字段一致：`session_id, model, cwd, ready, created_at, title?`）
- [x] 4b.2 在 `api.ts` 中导出 `DirListEntry`（对应 `/api/fs/ls` 响应：`name: string, path: string, is_dir: boolean`）
- [x] 4b.3 更新 `Sidebar.tsx`：移除本地 `interface SessionSummary`，改为 `import { SessionSummary } from '../types/api'`
- [x] 4b.4 `CreateSessionModal.tsx` 直接 `import { SessionSummary, DirListEntry } from '../types/api'`

## 5. 前端 — CreateSessionModal 组件

<!-- UI 审查：参照现有 PermissionModal / confirmDelete 样式系统实现 -->

- [x] 5.0 `CreateSessionModal.tsx` 文件顶部定义明确的 Props 接口：`interface Props { onCreated: (sessionId: string) => void; onClose: () => void }`；组件签名 `export default function CreateSessionModal({ onCreated, onClose }: Props)`
- [x] 5.1 新建 `HLAgent/web/src/components/CreateSessionModal.tsx`，overlay 样式与 PermissionModal 一致：`position:fixed, inset:0, zIndex:1000, background:rgba(17,17,27,0.75)`
- [x] 5.2 Dialog 样式：`background:#181825, border:1px solid #313244, borderRadius:10px, padding:1.5rem, maxWidth:520px, width:92%, boxShadow:0 8px 32px rgba(0,0,0,0.5)`
- [x] 5.3 标题"新建对话"（`1rem, fontWeight:700, color:#cdd6f4`）+ 副标题"选择 Agent 的工作目录，Agent 将在此目录读写文件和执行代码"（`0.8125rem, color:#6c7086`），比"执行文件操作"更具体，普通用户也能理解
- [x] 5.4 路径输入框：`fontFamily:monospace`，placeholder 留空，输入框右侧内联"📁 浏览"按钮（与输入框同行，`flex` 布局）
- [x] 5.5 输入框下方固定帮助文本（始终显示，非 placeholder）：`留空将自动创建临时工作目录（⚠ 删除会话时目录内容将被永久清除）`（`0.72rem, color:#6c7086`）；帮助文本中的 ⚠ 部分使用 `color:#f9e2af`（黄色警告色）强调删除后果
- [x] 5.6 422 错误时在帮助文本位置替换为红色错误行：`❌ <detail 内容>`（`color:#f38ba8`）；清除输入内容后错误消失
- [x] 5.7 Footer：左侧"取消"按钮（`background:#313244`），右侧"创建对话 →"主按钮（`background:#89b4fa, color:#1e1e2e`）；创建中时按钮 disabled + 显示 `⟳ 创建中…`
- [x] 5.8 关闭行为（参照 QuestionModal 模式）：背景遮罩层添加 `onClick={e => { if (e.target === e.currentTarget) onClose() }}`；`Escape` 键关闭；无 X 按钮（与现有 Modal 风格一致）
- [x] 5.9 键盘：`Enter`（仅在 DirBrowser **折叠**状态下）触发创建；浏览器展开时 Enter 不触发（防误操作）
- [x] 5.10 Modal 挂载后自动聚焦路径输入框（`autoFocus` 或 `useEffect + ref.current.focus()`）
- [x] 5.11 创建成功后关闭 Modal，调用 `onCreated(sessionId: string)` 回调

## 6. 前端 — DirBrowser 子组件（内嵌在 CreateSessionModal）

<!-- UI 审查：需要加载态、空目录处理、面包屑点击导航 -->

- [x] 6.1 DirBrowser 默认折叠；点击"📁 浏览"按钮切换展开/折叠（`show/hide`，无需动画，保持简单）
- [x] 6.2 展开时面板样式：`background:#11111b, border:1px solid #313244, borderRadius:6px, maxHeight:220px, overflowY:auto`
- [x] 6.3 面板顶部面包屑栏：将当前路径按 `/` 或 `\` 分割（兼容 Windows 路径，用 `/[\/\\]/` 正则拆分），每段可点击跳转（hover 色 `#89b4fa`）；最右段为当前目录名（非链接）；若超过 4 段则折叠中间段为 `…`（保留第一段和最后两段），防止面包屑溢出
- [x] 6.4 调用 `GET /api/fs/ls?path=<currentPath>` 获取目录列表；**`useEffect([currentPath])`** — 依赖数组必须包含 `currentPath`，否则 stale closure 导致总是请求初始路径；加载中显示 `⟳ 加载中…` 占位行（`color:#6c7086`）
- [x] 6.5 每条目样式：`📁 <name>` + 右侧 `›` 箭头，hover 背景 `#1e1e2e`，行高 `28px`，点击进入子目录（更新 currentPath 并重新请求）；**实时同步**：每次导航时同步更新路径输入框内容（用户不需要点"选择"就能看到目标路径）
- [x] 6.6 空目录时显示：`此目录没有子目录` （`0.75rem, color:#6c7086, padding:0.5rem 0.75rem`）
- [x] 6.7 API 失败时显示：`⚠ 无法读取目录` + 重试按钮（`color:#f9e2af`）
- [x] 6.8 面板底部两个操作按钮（`display:flex, justifyContent:space-between`）：`✓ 选择此目录`（`color:#a6e3a1, background:rgba(166,227,161,0.1), border:1px solid rgba(166,227,161,0.2)`）和 `取消浏览`（`color:#6c7086, background:none, border:none`）；点击"选择此目录"确认路径输入框当前值并折叠面板

## 7. 前端 — 接入现有创建入口

<!-- coder 审查：onNewSession 回调契约必须维持，否则 Sidebar.handleNewSession 无法添加新会话到列表 -->

- [x] 7.0 **修复 Sidebar `onNewSession` 回调契约**：Sidebar 的 `handleNewSession` 目前 `await onNewSession()` 拿到 `SessionSummary` 后 `setSessions(prev => [body, ...prev])`。改造后 `onNewSession` 变成 `void`，需要改变刷新方式。**选定方案**：Sidebar 暴露一个 `refreshSessions()` 方法（`useImperativeHandle` ref 或 AppLayout 持有 refresh callback），Modal `onCreated(sessionId)` 触发后调用；简化版：Sidebar 在 `onNewSession()` 调用后立即启动一次 `fetch('/api/sessions')` 轮询（最多 3 次，间隔 500ms），直到拿到新 session_id — 适合场景简单不引入额外架构
- [x] 7.1 在 `AppLayout.tsx` 中添加 `showCreateModal` state；将 `createAndOpenSession()` 改为 `setShowCreateModal(true)`；`onCreated` 回调中执行跳转 + 触发 Sidebar 刷新（见 7.0）；更新 `onNewSession` prop 类型为 `() => void`（同步打开 Modal，不再是 async）
- [x] 7.2 更新 `Sidebar.tsx` 的 `Props.onNewSession` 类型从 `() => Promise<unknown>` 改为 `() => void`；`handleNewSession` 不再 await 结果，改为调用后依靠 Sidebar 内部定时或外部触发来刷新列表（或通过新增 `onSessionCreated?: (body: SessionSummary) => void` prop 传入）
- [x] 7.3 在 `WelcomePage.tsx`（独立路由页）中添加 `showCreateModal` state，替换 `startNew()` 的直接 fetch 调用为弹出 Modal
- [x] 7.4 `OnboardingPage.tsx` 完成步骤中**不弹 Modal**，保持直接 `POST /api/sessions {}` — Onboarding 连贯体验优先，auto-assign 目录即可（UI 审查结论：插入 Modal 打断完成感）
- [x] 7.5 `SwarmPage.tsx` 的 `handleSingleChat()` 是程序化调用（带 `prefill` 和 `autosubmit` 参数），**不弹 Modal**，保持直接 `POST /api/sessions {}`；auto-assign 工作目录对此场景合适

## 7b. 前端 — 删除托管会话的数据安全警告

<!-- 用户流程审查发现：用户可能在临时目录里创建重要文件，删除会话时无任何警告 -->

- [x] 7b.1 在 `Sidebar.tsx` 的 `SessionSummary` 接口中确保 `cwd` 字段可读（已有 `cwd?: string`）
- [x] 7b.2 修改 `confirmDelete` 弹窗的文案逻辑：若 `sessions.find(s=>s.session_id===confirmDeleteId)?.cwd` 包含 `.hlagent/workspaces/`，则显示加强警告版本（红色边框样式）：**"此会话使用临时工作目录，删除后该目录内所有文件将被永久清除，无法恢复。"**；否则显示原有普通文案"确定删除该会话？此操作不可撤销。"
- [x] 7b.3 加强警告弹窗样式区别：border 改为 `1px solid rgba(243,139,168,0.5)`（红色），title 前加 `⚠️` 图标，提示文案使用 `color:#f38ba8`

## 8. 前端 — Sidebar 会话列表展示 cwd

<!-- UI 审查：两行方案在 220px 宽 sidebar 中密度可控，但需严格控制行高 -->

- [x] 8.1 在 `Sidebar.tsx` 的 session 条目中，title 行下方增加 cwd 展示行（仅当 `s.cwd` 非空时渲染）
- [x] 8.2 cwd 显示逻辑：若路径包含 `.hlagent/workspaces/`，显示 chip badge `临时`（`background:#313244, color:#6c7086, fontSize:0.6rem, borderRadius:3px, padding:1px 5px`），并添加 `title="此会话使用自动分配的临时工作目录，删除会话时目录内容将被永久清除"` 供 hover 提示；否则取路径末尾 2 段显示 `…/parent/child`（`fontSize:0.65rem, color:#6c7086`）
- [x] 8.3 cwd 行前加 `📁 ` 前缀（仅非临时会话时显示）；整行 `overflow:hidden, textOverflow:ellipsis, whiteSpace:nowrap`
- [x] 8.4 调整 session 按钮内 padding：从 `0.2rem` 改为 `0.15rem 0.25rem 0.15rem`，用 `flexDirection:column, alignItems:flex-start, gap:1px` 布局两行文本；**title 行**保留 `overflow:hidden, textOverflow:ellipsis, whiteSpace:nowrap, width:100%` 防止长标题溢出

## 9. 测试与验证

- [ ] 9.1 手动测试：创建会话不填 cwd → 确认 `~/.hlagent/workspaces/<id>/` 目录已创建
- [ ] 9.2 手动测试：创建会话填写有效 cwd → Sidebar 显示正确路径；Agent 文件操作在该目录执行
- [ ] 9.3 手动测试：创建会话填写不存在路径 → Modal 内显示红色 422 错误，不跳转
- [ ] 9.4 手动测试：删除托管会话 → 出现加强警告（红色边框 + ⚠️）；确认后 `workspaces/<id>/` 目录已删除
- [ ] 9.5 手动测试：删除自定义 cwd 会话 → 显示普通确认文案（无红色警告）；用户目录未被删除
- [ ] 9.6 手动测试：DirBrowser 面板导航 → 路径输入框实时同步；面包屑点击回到上级；"选择此目录"折叠面板
- [ ] 9.7 手动测试：Sidebar 托管会话显示 `临时` badge；项目会话显示截断路径
- [ ] 9.8 手动测试：Modal 键盘操作（Enter 创建、Esc 关闭、浏览器展开时 Enter 不触发创建）
- [ ] 9.9 手动测试（Windows 环境）：DirBrowser 面包屑正确解析 `C:\Users\...` 路径，每段可点击
- [ ] 9.10 手动测试：帮助文本显示删除警告（⚠ 黄色部分），留空创建后用户知晓风险
- [ ] 9.11 手动测试：DirBrowser 尝试访问无权限目录 → 显示 `⚠ 无法读取目录` 错误（来自后端 403），不崩溃
- [ ] 9.12 设计一致性验证：创建会话后 `POST /api/sessions` 响应中的 `cwd` 字段与 `GET /api/sessions` 列表中该会话的 `cwd` 字段一致（两处均来自 `entry.cwd`，非 `req.cwd`）
