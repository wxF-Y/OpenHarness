## ADDED Requirements

### Requirement: 专家对话遵循标准新建 Session 流程
从专家库发起对话时，系统 SHALL 弹出 `CreateSessionModal`（工作目录选择弹窗），用户确认后再创建 Session；不得跳过弹窗直接创建 Session 并跳转。弹窗顶部 SHALL 显示专家信息摘要区（角色描述 + 机器名）。

#### Scenario: 点击「对话 →」先加载内容再弹窗
- **WHEN** 用户点击角色列表中某专家的「对话 →」按钮（该角色尚未加载预览内容）
- **THEN** 按钮立即切换为"⟳ 准备中"状态；系统后台 fetch roleContent；fetch 完成后打开 `CreateSessionModal`（专家模式）

#### Scenario: 点击「对话 →」时内容已在预览区加载
- **WHEN** 用户点击角色列表中某专家的「对话 →」按钮，且该角色已在右侧预览区加载内容
- **THEN** 直接使用已加载的 roleContent，立即打开 `CreateSessionModal`（专家模式），无需重新 fetch

#### Scenario: roleContent 加载失败时不打开弹窗
- **WHEN** fetch roleContent 请求返回错误（网络超时、503 等）
- **THEN** 按钮恢复正常状态；专家库顶部显示错误 toast "加载专家内容失败，请重试"；不打开 Modal

#### Scenario: 弹窗显示专家信息摘要区及用户友好文案
- **WHEN** `CreateSessionModal` 以 `expertRole` prop 渲染
- **THEN** 弹窗顶部标题显示「与 {description} 开始对话」；标题下方显示专家信息区：`🎭 {description}`（0.875rem, #cba6f7）以及 `{name} · {dept}`（0.75rem, #6c7086）；信息区与工作目录输入区之间有分隔线；工作目录标签显示「代码目录（如需处理文件，可选）」；帮助文字不显示 ⚠ 图标，内容为「留空时将自动创建工作区，删除会话时一并清理」；确认按钮文字为「开始对话 →」（非「创建对话 →」）

#### Scenario: 用户选择工作目录后创建 Session
- **WHEN** 用户在弹窗中输入或浏览选择工作目录后点击「开始对话 →」
- **THEN** 调用 `POST /api/sessions { cwd, role_prefix, expert_role, expert_role_label }`；成功后跳转到 `/chat/{sessionId}`

#### Scenario: 用户留空工作目录直接创建
- **WHEN** 用户在弹窗中不填工作目录，直接点击「开始对话 →」
- **THEN** 调用 `POST /api/sessions { role_prefix, expert_role, expert_role_label }`（无 cwd）；Session 使用自动分配的托管目录；成功后跳转

#### Scenario: 用户点击取消关闭弹窗
- **WHEN** 用户点击「取消」按钮或按 Escape 键
- **THEN** 弹窗关闭，返回专家库页面，不创建任何 Session

### Requirement: 专家对话创建成功后侧边栏实时刷新
系统 SHALL 在专家对话 Session 创建成功后，立即触发全局 Session 列表刷新，使新 Session 在侧边栏中立即可见，无需用户手动刷新页面。

#### Scenario: 新专家 Session 立即出现在侧边栏
- **WHEN** `CreateSessionModal`（专家模式）成功创建 Session 并触发 `onCreated` 回调
- **THEN** 侧边栏 Session 列表在 1 秒内更新，新 Session 显示在列表顶部

### Requirement: 专家对话在侧边栏和 Chat 页面显示专家身份标识
系统 SHALL 在以下位置显示专家身份标识，均使用 `expert_role_label`（服务端存储的人类可读描述），不依赖前端 catalog 实时映射：
- 侧边栏：专家 Session 条目显示第三行标签（`🎭 {expert_role_label}`）
- Chat 页面顶部 header：在模型名与连接状态之间显示内联 chip

#### Scenario: 侧边栏显示专家角标（使用服务端描述）
- **WHEN** Session 的 `expert_role_label` 字段非空
- **THEN** 侧边栏该 Session 条目在时间行下方显示第三行标签，内容为 `🎭 {expert_role_label}`，颜色 `#cba6f7`，字号 0.7rem，单行截断（ellipsis）

#### Scenario: Chat 页面顶部显示专家标识
- **WHEN** 用户进入一个 `expert_role_label` 非空的 Session 对话页
- **THEN** Chat 顶部 header 在模型名称文本之后（wsStatus indicator 之前）显示内联 chip，内容 `🎭 {expert_role_label}`，样式为 `background: #313244, color: #cba6f7, border-radius: 4px, font-size: 0.7rem`，max-width: 160px 并 ellipsis 截断

#### Scenario: 普通对话不显示专家标识
- **WHEN** Session 的 `expert_role_label` 字段为 null 或空
- **THEN** 侧边栏和 Chat 页面均不显示任何专家相关标识
