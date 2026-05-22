## ADDED Requirements

### Requirement: 删除 Session 时自动清理托管工作目录
`DELETE /api/sessions/{id}` SHALL 在会话关闭后，检查该会话的 cwd 是否位于 `~/.hlagent/workspaces/` 下；若是，则递归删除该目录。用户自定义 cwd（非托管路径）SHALL 不被删除。

#### Scenario: 删除托管会话时清理目录
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话的 cwd 为 `~/.hlagent/workspaces/<session_id>/`
- **THEN** 返回 HTTP 204；`~/.hlagent/workspaces/<session_id>/` 目录已被递归删除

#### Scenario: 删除自定义 cwd 会话时不清理用户目录
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话的 cwd 为用户指定的 `/home/user/myproject`
- **THEN** 返回 HTTP 204；`/home/user/myproject` 目录保持不变

#### Scenario: 托管目录已不存在时幂等处理
- **WHEN** `DELETE /api/sessions/{id}` 触发清理，但 `~/.hlagent/workspaces/<session_id>/` 目录已不存在（如手动删除）
- **THEN** 返回 HTTP 204（幂等），不报错，不影响会话关闭流程

#### Scenario: 清理目录失败时不阻塞会话删除
- **WHEN** `DELETE /api/sessions/{id}` 触发清理，但目录删除因权限等原因失败
- **THEN** 返回 HTTP 204（会话仍正常关闭）；Gateway 记录 WARNING 日志，不向客户端返回错误

### Requirement: 托管目录路径仅限 workspaces 前缀内
Gateway SHALL 在执行托管目录清理前，验证目标路径以 `~/.hlagent/workspaces/` 开头（规范化后比较），防止路径遍历导致误删用户文件。

#### Scenario: 路径验证阻止遍历攻击
- **WHEN** 内部逻辑因任何原因产生路径如 `~/.hlagent/workspaces/../data/` 
- **THEN** 规范化后路径不匹配 workspaces 前缀，删除操作被跳过并记录 ERROR 日志
