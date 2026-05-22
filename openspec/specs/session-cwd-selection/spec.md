## ADDED Requirements

### Requirement: Session 创建时支持用户指定工作目录
创建 Session 时，`POST /api/sessions` 的 `cwd` 字段 SHALL 接受用户提供的绝对路径作为该会话的工作目录。若路径不存在，Gateway SHALL 返回 422 错误，不创建会话。

#### Scenario: 用户提供有效绝对路径
- **WHEN** 客户端发送 `POST /api/sessions`，body 含 `{"cwd": "/home/user/myproject"}`，该路径存在且为目录
- **THEN** 返回 HTTP 201，会话以 `/home/user/myproject` 作为 cwd 启动；Agent 的 CLAUDE.md 发现、文件操作均基于此目录

#### Scenario: 用户提供不存在的路径
- **WHEN** 客户端发送 `POST /api/sessions`，body 含 `{"cwd": "/nonexistent/path"}`
- **THEN** 返回 HTTP 422，body 含 `{"detail": "指定的工作目录不存在: /nonexistent/path"}`

#### Scenario: 用户提供的路径是文件而非目录
- **WHEN** 客户端发送 `POST /api/sessions`，body 含 `{"cwd": "/home/user/file.py"}`（指向文件）
- **THEN** 返回 HTTP 422，body 含 `{"detail": "指定的路径不是目录: /home/user/file.py"}`

### Requirement: Session 创建时未指定 cwd 则自动分配托管目录
若 `POST /api/sessions` 未传 `cwd` 或 `cwd` 为 `null`，Gateway SHALL 自动在 `~/.hlagent/workspaces/<session_id>/` 创建目录，并以此作为该会话的工作目录。

#### Scenario: 未传 cwd 自动分配
- **WHEN** 客户端发送 `POST /api/sessions`，body 为 `{}` 或不含 `cwd` 字段
- **THEN** 返回 HTTP 201；Gateway 已创建 `~/.hlagent/workspaces/<session_id>/` 目录；返回的 `cwd` 字段值为该目录的绝对路径

#### Scenario: 托管目录创建失败（磁盘满等）
- **WHEN** Gateway 尝试创建 `~/.hlagent/workspaces/<session_id>/` 时发生 I/O 错误
- **THEN** 返回 HTTP 500，body 含 `{"detail": "无法创建工作目录: <reason>"}`

### Requirement: Session 列表和详情响应包含 cwd 信息
`GET /api/sessions` 和 `GET /api/sessions/{id}` SHALL 在响应中包含每个会话的实际 cwd，便于前端展示。

#### Scenario: 列表中展示 cwd
- **WHEN** 客户端发送 `GET /api/sessions`
- **THEN** 每条 `SessionSummary` 记录的 `cwd` 字段为该会话的绝对工作目录路径（非空）
