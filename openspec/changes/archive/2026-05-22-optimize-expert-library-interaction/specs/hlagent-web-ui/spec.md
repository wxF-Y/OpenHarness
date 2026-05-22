## MODIFIED Requirements

### Requirement: Web UI 的专家库支持从云控动态获取目录
Web UI 中的专家库（ExpertsPage）SHALL 从 `/api/swarm/role-library/catalog` 获取目录数据；当后端云控 URL 可用时，目录内容由云控驱动；前端感知无变化，无需修改请求逻辑。

#### Scenario: 目录由云控更新后前端自动呈现新内容
- **WHEN** 后端云控 URL 返回了新的目录 JSON，且缓存失效后前端重新请求 `/api/swarm/role-library/catalog`
- **THEN** ExpertsPage 展示最新的专家列表，无需重新部署前端或后端

#### Scenario: 云控不可达时前端行为不变
- **WHEN** 后端云控 URL 不可达，后端使用内置列表响应
- **THEN** ExpertsPage 正常展示内置专家列表，用户无感知

## ADDED Requirements

### Requirement: ExpertsPage 发起对话时弹出 CreateSessionModal
ExpertsPage 的「对话 →」按钮 SHALL 弹出扩展版 `CreateSessionModal` 而非直接创建 Session；Modal 显示专家上下文信息，并在创建时携带 `role_prefix` 和 `expert_role`。

**注意**：由于不再直接跳转，ExpertsPage 中所有涉及"直接开始"语义的文案 SHALL 同步更新，避免对用户造成误导。

#### Scenario: 点击「对话 →」弹出专家对话 Modal
- **WHEN** 用户在 ExpertsPage 点击任一专家的「对话 →」按钮
- **THEN** 页面弹出 `CreateSessionModal`，标题显示「与 {expert.description} 开始对话」；工作目录输入框和浏览按钮均可交互

#### Scenario: 预览区「与此专家对话 →」按钮行为一致
- **WHEN** 用户在专家预览面板点击「与此专家对话 →」
- **THEN** 同样弹出 `CreateSessionModal`（专家模式），行为与列表区「对话 →」按钮一致

#### Scenario: ExpertsPage 空状态提示文案更新
- **WHEN** 右侧预览区无选中专家（空状态）
- **THEN** 提示文字显示「点击专家名称预览详情，或点击「对话 →」配置工作目录」（不再写"立即开始"，与现在需要过弹窗的流程一致）

#### Scenario: ExpertsPage header 副标题更新
- **WHEN** 用户进入专家库页面
- **THEN** header 副标题显示「选择专家，配置并开始对话」（不再写"直接开始对话"）

#### Scenario: Modal 创建成功后跳转并刷新侧边栏
- **WHEN** `CreateSessionModal`（专家模式）成功创建 Session
- **THEN** 页面跳转到 `/chat/{sessionId}`；全局 Session 列表立即刷新，侧边栏显示新 Session

### Requirement: CreateSessionModal 支持专家模式
`CreateSessionModal` SHALL 接受可选的 `expertRole` prop；当该 prop 存在时，组件以专家模式渲染：顶部显示专家信息摘要区，并在创建请求中附加 `role_prefix`、`expert_role`、`expert_role_label` 字段。专家模式下文案使用用户语言（目标导向），避免技术术语。

#### Scenario: 专家模式下 Modal 标题与信息区变更
- **WHEN** `CreateSessionModal` 以 `expertRole` prop 渲染
- **THEN** 标题显示「与 {expertRole.description} 开始对话」而非「新建对话」；标题下方渲染专家信息区：`🎭 {expertRole.description}`（0.875rem, #cba6f7）+ `{expertRole.name} · {expertRole.dept}`（0.75rem, #6c7086）；副标题"选择 Agent 的工作目录，Agent 将在此目录读写文件和执行代码"**不显示**（技术性描述对非工程师用户造成认知负担）；无需添加"专家模式"角标文字

#### Scenario: 专家模式下工作目录区使用用户友好文案
- **WHEN** `CreateSessionModal` 以 `expertRole` prop 渲染
- **THEN** 工作目录标签显示「代码目录（如需处理文件，可选）」；帮助文字为「留空时将自动创建工作区，删除会话时一并清理」（无 ⚠ 图标，⚠ 图标使用户误认为留空是危险操作）；确认按钮文字为「开始对话 →」（非「创建对话 →」，与用户目标一致）

#### Scenario: 专家模式下创建请求携带专家字段
- **WHEN** 用户在专家模式 Modal 中点击「开始对话 →」
- **THEN** 请求 body 包含 `role_prefix`（专家 Markdown 内容前 3000 字符）、`expert_role`（专家 name 字段，如 `"frontend-developer"`）、`expert_role_label`（专家 description 字段，如 `"前端开发工程师"`）

#### Scenario: 角色内容加载失败时不打开 Modal
- **WHEN** ExpertsPage 点击「对话 →」触发 roleContent fetch 失败
- **THEN** 不打开 Modal；在专家库页面顶部显示 chatError toast："加载专家内容失败，请重试"；按钮恢复正常状态
