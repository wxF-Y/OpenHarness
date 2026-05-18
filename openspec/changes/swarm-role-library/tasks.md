## 1. Gateway 角色库 API

- [x] 1.1 创建 `HLAgent/gateway/routers/role_library.py`，实现 `AGENT_CATALOG` 常量（覆盖 engineering/design/marketing/game-development 四部门，结构：`[{id, label, agents: [{name, path, description}]}]`，`path` 为 GitHub 相对路径如 `engineering/engineering-frontend-developer.md`）；**数据来源**：浏览 `https://github.com/jnMetaCode/agency-agents-zh` 的文件树获取各部门文件名；命名规则：`name = 文件名去掉 '<dept>-' 前缀和 '.md'`（例：`engineering-frontend-developer.md` → `name: "frontend-developer"`），`description` 可从文件名推导中文描述
- [x] 1.2 实现 `GET /api/swarm/role-library/catalog` 端点，返回 `{ departments: AGENT_CATALOG }`，无需网络请求
- [x] 1.3 实现 `GET /api/swarm/role-library/content?path=<path>` 端点：L1 lru_cache(50) + L2 磁盘缓存(`~/.hlagent/role-library/<path>`) + GitHub raw 拉取(timeout=10s)，响应头 `X-Cache: HIT|MISS`，失败返回 503/502；**安全**：接收 `path` 后先校验其是否存在于 `AGENT_CATALOG` 中，否则 400；写磁盘前用 `Path.resolve()` 验证目标路径前缀为 `~/.hlagent/role-library/`，防止路径穿越攻击
- [x] 1.4 实现 `DELETE /api/swarm/role-library/cache` 端点，清空磁盘缓存文件并调用 `cache_clear()`，返回 `{ cleared_files: N }`
- [x] 1.5 在 `HLAgent/gateway/main.py` 注册 `role_library.router`

## 2. Gateway 成员管理 API

- [x] 2.1 在 `HLAgent/gateway/routers/swarm.py` 新增 `POST /api/swarm/teams/{team}/members` 端点，接收 `{ name, prompt, model, color }`，端点内部构造 `TeamMember`：`agent_id = f"{name}@{team}"`、`backend_type = "subprocess"`、`joined_at = time.time()`、其余字段从请求体取值（`color` 默认取 `MEMBER_COLOR_PALETTE[当前成员数 % 6]`，`MEMBER_COLOR_PALETTE = ["blue","green","yellow","red","purple","cyan"]`）；调用 `TeamLifecycleManager.add_member()` 写入 team.json；若团队不存在返回 404
- [x] 2.2 新增 `DELETE /api/swarm/teams/{team}/members/{agent_id}` 端点；调用 `remove_member()` 前先读取成员，若 `member.session_id is not None` 返回 409（`"member is running, send shutdown first"`）；成员不存在返回 404
- [x] 2.3 ~~修改后端~~ — `GET /api/swarm/teams` 已在 [swarm.py:32] 返回 `created_at`，**无需后端改动**；前端 `TeamSummary` 新增 `created_at: number` 已由任务 3.1 的 `swarm.ts` 覆盖，本任务删除

## 3. 前端类型与 API 工具函数

- [x] 3.1 新建 `HLAgent/web/src/types/swarm.ts`，添加以下接口和常量：`RoleAgent { name, path, description }`、`RoleDepartment { id, label, agents: RoleAgent[] }`、`RoleCatalog { departments: RoleDepartment[] }`、`SelectedRole { role: RoleAgent; dept: string }`、`TeamDisplayState = 'empty' | 'configured' | 'running' | 'idle'`、`TeamSummary { name, description, member_count, lead_agent_id?, created_at }`、`Member { agent_id, name, status?, agent_type?, model?, color?, session_id?, worktree_path?, plan_mode_required?, prompt? }`、`MailboxMsg { id, type, sender, payload: Record<string, unknown>, timestamp, read }`、`export const MEMBER_COLOR_PALETTE = ['blue','green','yellow','red','purple','cyan'] as const`；**迁移**：删除 `SwarmPage.tsx` 第 4–39 行的本地 `TeamSummary`、`Member`、`MailboxMsg` 接口及 `STATUS_ICON` 常量定义，改为 `import type { TeamSummary, Member, MailboxMsg, TeamDisplayState } from '../types/swarm'`（`STATUS_ICON` 是纯 UI 常量可留在 SwarmPage，无需迁移）
- [x] 3.2 新建 `HLAgent/web/src/utils/swarmApi.ts`，封装 `fetchCatalog()`、`fetchRoleContent(path)` 函数（来自原 roleLibraryApi 设计）以及共享的 `launchTeam(teamName, taskDesc, navigate)` 函数：内部执行 `POST /api/sessions {}` 获取 `session_id`，拼接命令（`/swarm start <team> <taskDesc>`，taskDesc 为空时只用团队名），然后 `navigate('/chat/${session_id}?prefill=<encoded>&autosubmit=1')`；`launchTeam` 供 `TeamCreationWizard`、`SwarmPage` 的 configured 横幅、idle 横幅"开始新任务"共同复用

## 4. 角色库浏览组件

- [x] 4.1 新建 `HLAgent/web/src/components/RoleLibraryPanel.tsx`，Props 接口：`{ mode: 'wizard'|'picker', selectedRoles: SelectedRole[], onToggle: (role: RoleAgent) => void, onConfirm?: (roles: SelectedRole[]) => Promise<void>, onClose?: () => void }`；角色行分离勾选（☐ 添加，调用 `onToggle`）和"预览 →"（加载右侧 Markdown）；wizard 模式：无确认按钮，勾选状态由父组件通过 `selectedRoles`/`onToggle` 管理（支持 Step 2→1 返回后保留已选）；picker 模式：底部"添加 N 个成员"确认按钮 + 调用 `onConfirm(selectedRoles)`
- [x] 4.2 角色库加载状态：初始骨架屏（3 个占位行），GitHub 不可达时显示错误面板（原因 + [重试] + [跳过]），有本地缓存时显示"离线"标签并允许使用
- [x] 4.3 角色搜索：`<input onChange={handleSearch} />` 即时过滤（React onChange 事件，非 DOM oninput）；有搜索词时匹配部门自动展开（含匹配数 badge），不匹配部门折叠+灰显；关键词高亮（`<mark>`）；显示"共 N 个结果"；搜索框右侧 × 清空按钮（有内容时显示）；无结果显示空状态"未找到匹配角色 🔍"

## 5. 团队创建向导

- [x] 5.0 在 `HLAgent/web/src/components/MessageInput.tsx` 的 `Props` 接口中新增 `initialValue?: string`，组件 `useState('')` 改为 `useState(initialValue ?? '')`，并在 `useEffect([initialValue])` 中当外部传入新值时同步更新 `input`（避免覆盖用户正在编辑的内容，仅在 `initialValue` 变化且当前 input 为空时设置）
- [x] 5.1 新建 `HLAgent/web/src/components/TeamCreationWizard.tsx`，实现三步向导状态机（`wizardStep: 'name'|'roles'|'creating'|null`）；在 `SwarmPage.tsx` 中引用该组件替代原有简单创建弹窗（SwarmPage 只负责控制向导的 open/close 及完成后的 `selectTeam`）
- [x] 5.2 Step 1（name）：输入框实时 slugify（`toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')`，去掉首尾连字符），下方灰色预览"团队ID: my-dev-team"，提示"仅支持小写字母、数字和连字符"，Enter 或"下一步"进入 Step 2
- [x] 5.3 Step 2（roles）：嵌入 `RoleLibraryPanel(mode=wizard)`；顶部步骤指引"选择专家 → 点击预览 → 勾选加入"；角色行分离勾选（添加）和"预览 →"（右侧展开）；顶部显示"已选 N 个（建议 2-5 个）"；底部显示已选 tags + "← 返回" + "跳过" + "下一步"
- [x] 5.4 Step 3（creating）：显示子步骤状态列表（○/⟳/✓/✗）+ 进度条 + 已用秒数；创建序列：① `POST /api/swarm/teams { name, description }` → ② 对每个 `selectedRoles[index]`：`fetchRoleContent(role.path)` + `POST members { name: role.name, prompt: markdown, color: MEMBER_COLOR_PALETTE[index % 6] }`（顺序执行，非并行）；失败时显示"已创建但 N 个成员失败"+ 三个操作按钮（返回编辑/重试失败项/完成跳过）；保存 `createdTeamName`+`succeededRoles`+`failedRoles` 跨重试持久
- [x] 5.5 在 `ChatPage.tsx` 中实现 autosubmit 流（需从 `react-router-dom` 补充引入 `useSearchParams`）：mount 时读取 `prefill` 和 `autosubmit` URL 参数；若 `autosubmit=1` 且 `prefill` 非空，将 prefill 存入 `pendingAutosubmit` state（不立即发送）；在 `useEffect([wsStatus, pendingAutosubmit])` 中，当 `wsStatus === 'ready'` 且 `pendingAutosubmit` 非空时调用 `sendRequest({ type: 'submit_line', line: pendingAutosubmit })` 并立即将 `pendingAutosubmit` 置为 null（防止 WS 重连后重复发送）；若仅有 `prefill`（无 autosubmit），则通过 `initialValue` prop 传给 `MessageInput`（用户手动发送）
- [x] 5.6 向导 X/Esc 取消：Step 1/2 时弹确认对话框"确定取消？已选角色将清空"；向导内返回导航：Step 2 有"← 返回 Step 1"且保留已选角色；Step 3 开始后禁止返回
- [x] 5.7 向导关闭后调用 `selectTeam(newTeamName)`（而非 `setSelectedTeam`，需触发成员数据加载），并触发 150ms 高亮 pulse 动画

## 6. Swarm 页面完善

- [x] 6.1 团队列表空状态改为引导卡片（图标 + "创建你的第一个 Swarm 团队" + 按钮）
- [x] 6.2 团队列表项显示成员数和创建时间（`new Date(t.created_at*1000).toLocaleDateString()`）
- [x] 6.3 成员列表 4 态：`empty`（无成员）显示"暂无成员 + 添加引导"；`configured`（有成员，所有 `session_id=null`）显示 configured 横幅（见 6.4）；`running`（至少一个 `session_id≠null` + `status=active`）显示🟢轮询监控（见 7.1）；`idle`（所有成员均有 `session_id` 且全为 `idle/stopped`）显示任务完成横幅（见 7.3）；状态计算优先查 `forceConfiguredView` 覆盖，再按数据派生；**页面 mount 时**若 `selectedTeam` 非空，自动调用 `selectTeam(selectedTeam)` 刷新成员数据（确保从 Chat 页返回后能正确检测到 running 状态并触发 7.1 轮询）
- [x] 6.4 configured 状态横幅（D7 设计）：显示团队名 + 成员摘要（最多 3 个成员名，超出"+N 个"）+ 任务描述 textarea（placeholder "描述你希望团队完成的任务..."）+ "启动团队 →"按钮；点击后调用 `launchTeam(team, taskDesc)`：创建 session → navigate to `/chat/${session_id}?prefill=<cmd>&autosubmit=1`（autosubmit=1 表示 Chat 页自动发送）；按钮点击后变为"⟳ 启动中..."（禁用）；**不显示任何命令文本**，命令在后台拼接；任务描述 state 为 `teamTaskDesc: Record<string, string>`
- [x] 6.5 删除团队按钮（调用 `DELETE /api/swarm/teams/{team}`），确认后刷新列表
- [x] 6.6 配置态下每个成员卡片显示"移除"按钮（session_id 为 null 时可用），调用 `DELETE /api/swarm/teams/{team}/members/{agent_id}`；前端调用时使用 `encodeURIComponent(agentId)`（因 agent_id 含 `@`）
- [x] 6.7 团队详情页显示"+ 添加成员"按钮（configured 状态），点击打开独立角色库弹窗（`RoleLibraryPanel mode='picker'`，非向导）；`onConfirm(selectedRoles)` 回调执行以下序列：① 对每个 `SelectedRole` 调用 `fetchRoleContent(role.path)` 获取 Markdown（复用缓存）→ ② `POST /api/swarm/teams/{team}/members { name: role.name, prompt: markdown, color: MEMBER_COLOR_PALETTE[(currentMemberCount + index) % 6], model: undefined }` → ③ 全部完成后调用 `selectTeam(team)` 刷新成员列表；期间显示进度（"添加中 k/N..."）；失败时显示错误，已成功的成员不回滚

## 7. 运行中监控与完成后引导

- [x] 7.1 running 状态下 15s 自动轮询：使用 `useEffect([selectedTeam, teamState], ...)` — 当 `selectedTeam` 非空且 `teamState === 'running'` 时启动 `setInterval(refreshSelected, 15000)`，effect cleanup 中 `clearInterval`（确保团队切换或状态变化时旧 interval 被清除，新 interval 按新条件重新决定是否启动）；成员列表顶部显示"⟳ 刷新"手动按钮 + "上次更新 Xs 前"文字
- [x] 7.2 成员卡片新增"📄"图标按钮（`member.prompt` 非空时显示），详情面板新增第三个 Tab `📄 角色定义`；Tab 内用 `MDRenderer` 渲染 `member.prompt`（Markdown），数据来自已有的 `GET /api/swarm/teams/{team}` 响应，无需新端点
- [x] 7.3 团队状态新增 `idle`（完成）横幅：当所有成员均有 `session_id` 且 `status` 全为 `idle/stopped` 时，替换蓝色横幅为完成横幅 "✅ <team_name> 任务已完成"，包含两个按钮：a) "查看 Lead 对话" — 选中 `lead_agent_id` 成员并切换到 Transcript Tab，若无 lead 则选第一个有 `session_id` 的成员；b) "开始新任务" — 清空 `teamTaskDesc[team]` 并将该团队加入 `forceConfiguredView: Set<string>` state，使 UI 覆盖显示 configured 横幅；running 状态轮询检测到某成员 `status=active` 时，清除该团队的 `forceConfiguredView` 条目（无需在团队切换时清除，不同团队的覆盖条目互不干扰）

## 8. 专家快速对话

- [x] 8.1 在 `RoleLibraryPanel` 的 Markdown 预览面板右下角新增"与此专家对话 →"按钮（仅当某角色已加载预览时显示）；点击后：获取角色内容（已有缓存则复用）→ 创建 session（`POST /api/sessions {}`）→ 构造 intro 消息 `"请你扮演以下专家角色，所有回复都以该角色的视角和知识体系来回答：\n\n${roleMarkdown.slice(0, 3000)}"` → navigate to `/chat/${session_id}?prefill=<encoded_intro>&autosubmit=1`；**注意**：角色通过普通用户消息注入（非 system_prompt），Claude 在极长对话后可能偏离角色定义，这是当前 session API 的已知限制；按钮点击后变为"⟳ 准备中..."（禁用，防止多次点击）
- [x] 8.2 在 `SwarmPage` 成员卡片（`configured` 状态，`session_id=null`）新增"单独对话"按钮；点击后从 `member.prompt` 直接构造 intro `"请你扮演以下专家角色，所有回复都以该角色的视角和知识体系来回答：\n\n${member.prompt.slice(0, 3000)}"` → 创建 session（`POST /api/sessions {}`）→ `navigate('/chat/${session_id}?prefill=${encodeURIComponent(intro)}&autosubmit=1')`；若 `member.prompt` 为空则按钮置灰并 tooltip "此成员无角色定义"；按钮点击后变为"⟳ 准备中..."防重复点击
