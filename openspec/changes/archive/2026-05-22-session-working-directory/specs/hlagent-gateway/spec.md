## MODIFIED Requirements

### Requirement: Gateway 支持完整会话管理 REST API
Gateway SHALL 提供以下 REST 端点管理 Agent 会话：
- `POST /api/sessions` — 创建新会话，支持传递 `model`、`cwd`（可选，未传则自动分配托管目录）、`permission_mode`、`system_prompt`、`max_turns` 参数；若 `cwd` 指向不存在路径或非目录，返回 422
- `GET /api/sessions/{session_id}` — 获取会话当前完整 AppState（含 model、provider、auth_status、cwd、fast_mode、plan_mode 等）
- `DELETE /api/sessions/{session_id}` — 关闭会话并清理资源；若该会话使用托管 cwd（位于 `~/.hlagent/workspaces/` 下），一并递归删除该目录
- `GET /api/sessions/{session_id}/commands` — 获取该会话可用的命令列表

#### Scenario: 创建会话时未指定 cwd
- **WHEN** 客户端发送 `POST /api/sessions`，body 不含 `cwd` 字段
- **THEN** 返回 HTTP 201；`cwd` 自动设为新建的 `~/.hlagent/workspaces/<session_id>/`；响应中的 `cwd` 字段反映该路径

#### Scenario: 删除会话触发托管目录清理
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话 cwd 在 `~/.hlagent/workspaces/` 下
- **THEN** 返回 HTTP 204；对应 workspaces 子目录已递归删除

#### Scenario: 删除会话不清理用户自定义目录
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话 cwd 为用户指定路径
- **THEN** 返回 HTTP 204；用户指定的 cwd 目录不受影响
