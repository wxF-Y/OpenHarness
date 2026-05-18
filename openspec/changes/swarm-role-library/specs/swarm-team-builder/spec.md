## ADDED Requirements

### Requirement: 团队创建向导入口
SwarmPage SHALL 在团队列表区域提供"新建团队"按钮，点击后打开三步向导覆盖层（Step 1: 命名 → Step 2: 选专家 → Step 3: 创建中）。

#### Scenario: 打开向导
- **WHEN** 用户点击"+ 新建"按钮
- **THEN** 显示创建向导 Step 1（输入团队名和描述）

#### Scenario: 团队名非法
- **WHEN** 用户输入包含空格或特殊字符的名称并点击下一步
- **THEN** 显示内联错误"团队名只能包含字母、数字和短横线"，不进入 Step 2

#### Scenario: 直接创建空团队
- **WHEN** 用户在 Step 2 不选任何角色，点击"跳过"
- **THEN** 直接进入 Step 3，创建仅含名称的空团队

### Requirement: 角色库浏览面板
向导 Step 2 SHALL 展示角色库面板：左侧部门+角色列表（带搜索框），右侧 Markdown 预览。

#### Scenario: 浏览部门
- **WHEN** 用户进入 Step 2
- **THEN** 显示部门列表（Engineering、Design、Marketing、Game Development），每个部门默认折叠，点击展开角色列表

#### Scenario: 搜索角色
- **WHEN** 用户在搜索框输入关键词
- **THEN** 跨部门过滤匹配角色名，折叠不匹配的部门，高亮匹配文字

#### Scenario: 预览角色
- **WHEN** 用户点击某角色名称
- **THEN** 右侧面板显示该角色的 Markdown 内容（从 `/api/swarm/role-library/content` 拉取，加载中显示骨架屏）

#### Scenario: 添加角色到团队
- **WHEN** 用户勾选一个角色
- **THEN** 该角色出现在面板底部"已选成员"tag 列表，显示名称和部门标签

#### Scenario: 移除已选角色
- **WHEN** 用户点击 tag 上的 × 按钮
- **THEN** 该角色从"已选成员"列表移除，对应勾选框取消选中

### Requirement: 角色内容自动映射为 system_prompt
向导 Step 3 SHALL 先拉取每个选中角色的 Markdown 内容，再依次创建团队和成员。

#### Scenario: 创建带成员的团队（成功）
- **WHEN** 用户选择了 N 个角色并点击"创建团队"
- **THEN** Step 3 显示进度"添加成员 k/N..."，完成后关闭向导并选中新团队

#### Scenario: 创建失败
- **WHEN** API 返回错误（如团队名已存在）
- **THEN** Step 3 显示错误信息和"重试"按钮，不关闭向导

#### Scenario: 成员名称自动生成
- **WHEN** 角色被添加为成员
- **THEN** 成员 `name` = 角色文件名去掉部门前缀和 `.md`，`agent_id` = `<name>@<team_name>`；若同团队 name 重复则追加 `-2`、`-3`

### Requirement: 已配置团队的启动引导
当团队有成员但所有成员 `session_id` 均为 null 时，SwarmPage 团队详情区 SHALL 显示蓝色启动引导横幅，包含可复制的 Chat 命令和"去 Chat"按钮。

#### Scenario: 显示启动引导
- **WHEN** 选中团队的所有成员 `session_id` 均为 null
- **THEN** 成员列表上方显示横幅："/swarm start <team_name> <任务描述>" + 复制按钮 + 去 Chat 按钮

#### Scenario: 复制命令
- **WHEN** 用户点击"复制"按钮
- **THEN** 命令文本写入剪贴板，按钮短暂显示"✓ 已复制"

#### Scenario: 去 Chat
- **WHEN** 用户点击"去 Chat"按钮
- **THEN** 跳转到 `/`（首页），命令已预填到输入框（通过 URL 参数或 localStorage）

### Requirement: 一键启动团队
SwarmPage 的 configured 状态 SHALL 提供无命令的"启动团队"UI，用户仅需填写任务描述并点击按钮即可启动，无需了解 `/swarm start` 命令。

#### Scenario: 一键启动（无命令）
- **WHEN** 用户填写任务描述并点击"启动团队 →"按钮
- **THEN** 系统在后台创建 Chat session 并自动发送 `/swarm start <team> <task_desc>`，跳转到 Chat 页时命令已在执行中，用户无需手动发送任何命令

#### Scenario: 启动中加载态
- **WHEN** 用户点击"启动团队 →"
- **THEN** 按钮立即变为"⟳ 启动中..."并禁用，防止重复点击，直至导航完成

### Requirement: 专家快速对话
角色库浏览面板 SHALL 在角色预览区提供"与此专家对话"入口，点击后直接开启与该专家角色的对话，无需创建团队、无需输入命令。

#### Scenario: 与专家一键对话
- **WHEN** 用户在角色库预览面板点击"与此专家对话 →"
- **THEN** 系统创建 Chat session 并自动发送专家角色采用提示，跳转到 Chat 页后 Claude 已以该专家身份响应

#### Scenario: 专家对话准备态
- **WHEN** 用户点击"与此专家对话 →"
- **THEN** 按钮变为"⟳ 准备中..."并禁用直至跳转完成

### Requirement: 配置态下的成员管理
团队处于 configured 状态时，SwarmPage SHALL 允许添加和移除成员。

#### Scenario: 添加成员
- **WHEN** 用户点击"+ 添加成员"按钮
- **THEN** 打开角色库面板（独立弹窗，非向导），选择角色后调用 `POST /api/swarm/teams/{team}/members`

#### Scenario: 移除未运行的成员
- **WHEN** 用户点击成员卡片上的"移除"按钮，且该成员 `session_id` 为 null
- **THEN** 确认后调用 `DELETE /api/swarm/teams/{team}/members/{agent_id}`，列表刷新

#### Scenario: 不允许移除运行中的成员
- **WHEN** 用户点击成员卡片上的"移除"按钮，且该成员 `session_id` 不为 null
- **THEN** 按钮置灰，tooltip 显示"Agent 运行中，请先在 Chat 中停止"

