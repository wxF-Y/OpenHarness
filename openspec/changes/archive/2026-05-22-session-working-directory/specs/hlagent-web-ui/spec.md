## MODIFIED Requirements

### Requirement: Session 创建入口提供工作目录选择
Web UI 的所有"新建 Session"入口 SHALL 在提交前弹出 Session 创建对话框（CreateSessionModal），允许用户输入工作目录路径或通过内联目录浏览器选择；留空则使用服务端自动分配的托管目录。

#### Scenario: 用户点击"新建会话"弹出对话框
- **WHEN** 用户在任意入口（Sidebar 按钮、WelcomePage、OnboardingPage 完成步骤）点击"新建会话"
- **THEN** 弹出 CreateSessionModal，含工作目录输入框（占位符"留空自动分配"）、"浏览"按钮、"创建"按钮和"取消"按钮

#### Scenario: 用户填写目录路径后创建
- **WHEN** 用户在 CreateSessionModal 中输入合法路径后点击"创建"
- **THEN** 调用 `POST /api/sessions { cwd: "<path>" }`；成功则关闭 Modal 并跳转到新会话的 `/chat/<id>`

#### Scenario: 用户留空直接创建（使用托管目录）
- **WHEN** 用户在 CreateSessionModal 中未填写路径，直接点击"创建"
- **THEN** 调用 `POST /api/sessions {}` （不传 cwd）；后端自动分配托管目录；成功后跳转到 `/chat/<id>`

#### Scenario: 后端返回 422（路径无效）
- **WHEN** `POST /api/sessions` 返回 HTTP 422
- **THEN** CreateSessionModal 保持打开，输入框下方显示红色错误消息（来自响应 `detail` 字段）；不跳转

### Requirement: Session 创建对话框包含目录浏览功能
CreateSessionModal 的"浏览"按钮 SHALL 展开内联目录浏览面板，调用 `GET /api/fs/ls?path=<dir>` 展示目录列表，用户点击目录条目后填充路径输入框。

#### Scenario: 展开目录浏览面板
- **WHEN** 用户点击 CreateSessionModal 中的"浏览"按钮
- **THEN** 面板内展示当前服务端 Home 目录（调用 `/api/fs/ls` 不带 path 参数）的子目录列表；每条目显示目录名，可点击进入

#### Scenario: 点击目录条目导航
- **WHEN** 用户在浏览面板点击某个目录条目
- **THEN** 面板刷新展示该目录的子目录列表；路径输入框实时更新为当前浏览路径

#### Scenario: 点击"选择此目录"确认
- **WHEN** 用户在浏览面板点击"选择此目录"按钮
- **THEN** 路径输入框填充当前浏览路径；目录浏览面板收起

## ADDED Requirements

### Requirement: 会话列表展示 cwd（截断）
Sidebar 会话列表中每条 Session 记录 SHALL 展示该会话的 cwd 路径（截断至最后 2 段），帮助用户区分不同项目的会话。

#### Scenario: 会话条目展示截断路径
- **WHEN** 会话列表中有 `cwd` 为 `/home/user/projects/my-app` 的会话
- **THEN** 该条目展示 `…/projects/my-app`（保留末尾 2 个路径段，前缀以 `…/` 截断）

#### Scenario: 托管目录会话展示友好标签
- **WHEN** 会话的 cwd 为 `~/.hlagent/workspaces/<session_id>/`（托管目录）
- **THEN** 展示 `[临时工作区]` 而非完整路径
