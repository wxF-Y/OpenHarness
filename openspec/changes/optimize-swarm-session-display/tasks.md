## 1. 会话列表刷新机制（替换原 sessionStore 方案）

- [x] 1.1 确认 `uiStore.ts` 中 `incrementSidebarRefreshKey()` 和 `setExpertRoleLabels()` 的签名（只需读文件核对，无需修改）
- [x] 1.2 确认 `Sidebar.tsx` 的 `sessions` 本地 state 通过 `sidebarRefreshKey` 触发的刷新逻辑（只需读文件核对）

## 2. launchTeam 流程：传入 expert_role_label 并触发列表刷新

- [x] 2.1 修改 `HLAgent/web/src/utils/swarmApi.ts` 的 `launchTeam` 函数：在 `POST /api/sessions` 的请求体中加入 `expert_role_label: '🤝 ' + teamName`（后端直接持久化，刷新时自动返回，无需前端手动调用 `setExpertRoleLabels`）
- [x] 2.2 POST 成功后，调用 `uiStore.getState().incrementSidebarRefreshKey()` 触发 Sidebar 重新拉取会话列表（注：`setExpertRoleLabels` 已可省略，由后端返回值自动填充）
- [x] 2.3 在 navigate 参数中附加 `&team=${encodeURIComponent(teamName)}`，供 SwarmPage 返回时自动选中团队
- [x] 2.4 在 `launchTeam` 的错误处理分支中确保不调用上述方法（session 创建失败时保持 store 不变）

## 3. 会话列表 UI 展示团队标签（已有机制可直接复用）

- [x] 3.1 确认 `Sidebar.tsx` 中 `expert_role_label` 的渲染逻辑（第 413-417 行 / 430-434 行），确认 `uiStore.expertRoleLabels[session_id]` 注入值能正确显示
- [x] 3.2 若团队标签样式（`🤝 teamName`）在现有 `🎭 expert_role_label` 紫色徽章中显示不够直观，可考虑调整颜色或前缀图标（可选，视觉优化）

## 4. transcript 状态上移至 SwarmPage 级别

- [x] 4.1 在 `SwarmPage` 中新增 `transcriptCache: Record<string, string>` state，用于在视图切换时保留各 Agent 的 transcript 内容
- [x] 4.2 新增 `transcriptLoading: Record<string, boolean>` state，用于去重请求（避免同一 Agent 并发拉取）
- [x] 4.3 新增 `transcriptErrorKind: Record<string, 'none' | 'no-session' | 'fetch-error'>` state，区分 404（无 session）与 5xx（网络错误）两种错误类型
- [x] 4.4 提取 `loadTranscriptForAgent(agentId: string)` 函数：检查 `transcriptLoading[agentId]` 后发起请求；收到 404 时写入 `errorKind='no-session'`；其他错误写入 `errorKind='fetch-error'`；成功时写入 `transcriptCache`

## 5. SwarmAgentPanel 组件

- [x] 5.1 新建 `HLAgent/web/src/components/SwarmAgentPanel.tsx`：props 为 `{ member: Member, transcript: string, isLoading: boolean, errorKind: 'none' | 'no-session' | 'fetch-error', defaultExpanded: boolean, onSelect: () => void, onRetry: () => void }`
- [x] 5.2 实现折叠/展开功能：`active` 状态的成员 `defaultExpanded=true`，其他为 `false`
- [x] 5.3 面板头部布局：左侧 4px 彩色竖条（复用 `member.color`）+ `STATUS_ICON[member.status]` + 成员名称（点击名称文字区域调用 `onSelect()` 进入单成员详情）；右侧独立的折叠/展开箭头按钮（仅控制展开/折叠，不触发 `onSelect()`）；两个点击区域功能不同，需分别绑定事件
- [x] 5.4 错误态区分：`errorKind === 'no-session'` 时显示"等待 Agent 启动…"（不显示重试按钮）；`errorKind === 'fetch-error'` 时显示"加载失败，点击重试"并调用 `onRetry()`
- [x] 5.5 `isLoading=true` 时显示骨架占位（三行灰色横条）；transcript 为空字符串时显示"暂无执行记录"占位文案
- [x] 5.6 transcript 内容用 `MDRenderer compact` 渲染；面板展开区域设 `maxHeight: 400px; overflow-y: auto`，避免单个 Agent 占满整个右侧面板

## 6. SwarmPage 集成团队进展视图

- [x] 6.1 修改 `HLAgent/web/src/pages/SwarmPage.tsx` 的右侧详情面板逻辑：
  - 当 `teamState === 'running' || 'idle'` 且 `!selectedMember` → 渲染"团队进展"全览（含摘要栏 + 所有成员的 SwarmAgentPanel）
  - 当 `selectedMember` 存在 → 渲染单 Agent 三标签视图；tab 栏容器行内**左侧**插入"← 返回全览"按钮（无背景无边框，颜色 `#6c7086`，与非激活 tab 视觉一致），点击后 `setSelectedMember(null)`
  - 其他状态 → 保持原有"选择 Agent 查看详情"占位
- [x] 6.2 在全览顶部增加摘要状态栏：`running` 时按 `active count / (idle+stopped count)` 显示"N 个 Agent 运行中 / M 个已完成"，`idle` 时显示"✅ 全部完成（共 N 个 Agent）"
- [x] 6.3 全览视图首次挂载时，对所有成员调用 `loadTranscriptForAgent(agentId)`；所有面板都处于 `isLoading=true` 时，额外在全览顶部显示"正在加载 Agent 执行记录…"整体提示，至少一个面板有内容后移除
- [x] 6.4 监听 `swarmStore.teammates` 变化（`swarm_status` WebSocket 事件触发）时，调用 `refreshSelected()` 更新 `members`；`members` 更新后对状态发生变化的成员调用 `loadTranscriptForAgent`（注：不直接用 `SwarmTeammate.agent_id`，因为 `SwarmTeammate` 类型无此字段，需通过 REST 刷新后的 `members` 匹配）
- [x] 6.5 SwarmPage 挂载时，先执行 `refreshTeams()` 等待完成，再读取 URL searchParam `team`，若存在且在 teams 列表中则调用 `selectTeam(teamParam)`；若 teams 为空则存入 `pendingTeamSelect` state 在 `refreshTeams` 回调后处理
- [x] 6.6 确保 `teamState === 'empty' || 'configured'` 时不显示全览视图（保留原有配置流程）

## 7. AppLayout.tsx 团队 session 引导横幅（UX 改善）

- [x] 7.1 在 `HLAgent/web/src/AppLayout.tsx` 的 chat header 区域（已有 44px banner，第 85-99 行）中检测 `expertLabel.startsWith('🤝 ')`
- [x] 7.2 若是，在 header 中的 expertLabel 徽章旁增加"[查看团队进展 →]"按钮链接（紧凑内联样式）
- [x] 7.3 点击"查看团队进展 →"调用 `navigate('/?view=swarm&team=' + encodeURIComponent(teamName))`（teamName 从 expertLabel 截取 '🤝 ' 后的部分）
- [x] 7.4 非团队 session（expertLabel 不以 '🤝 ' 开头）不显示该按钮

## 8. 验证

- [ ] 8.1 启动团队后，验证左侧全局会话列表出现新 session 条目且显示团队名称标签
- [ ] 8.2 返回 SwarmPage 后（teamState 为 running/idle），验证内容区自动显示"团队进展"全览，且顶部摘要栏数字正确
- [ ] 8.3 验证每个 Agent 面板在加载中时显示骨架，agent 无 session 时显示"等待启动"，失败时显示"重试"，成功时显示 transcript
- [ ] 8.4 验证 Agent 状态变化时对应面板 transcript 自动刷新（不出现重复请求）
- [ ] 8.5 验证全览→单成员→返回全览，transcript 缓存不丢失、不重复拉取
- [ ] 8.6 在 ChatPage 查看团队 session 时，验证顶部横幅显示，且点击可正确跳转 SwarmPage 并自动选中团队
- [ ] 8.7 验证非团队 session 的 ChatPage 不显示横幅
- [ ] 8.8 验证普通 session（非 Swarm 创建）不受影响，无团队标签
- [ ] 8.9 验证 teamState 为 configured/empty 时，配置 UI 流程不受影响
- [ ] 8.10 验证从 ChatPage 点击横幅跳转时，若 teams 列表未加载完成，SwarmPage 等待加载后仍能自动选中正确团队
