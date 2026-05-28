## ADDED Requirements

### Requirement: expert_role 持久化到 session snapshot
系统 SHALL 将 `expert_role` 和 `expert_role_label` 写入 session snapshot 文件，使网关重启后从磁盘恢复的 session 能保留专家标识。

#### Scenario: 新建带专家角色的 session 后对话，重启网关，专家标识可见
- **WHEN** 用户以带 `expert_role` 的配置创建 session，进行对话后网关重启，前端调用 `GET /sessions`
- **THEN** 该历史 session 在列表中展示 `expert_role` 和 `expert_role_label`，与重启前一致

#### Scenario: 无专家角色的 session 不受影响
- **WHEN** 创建 session 时未传 `expert_role`
- **THEN** snapshot 中 `expert_role` 为 null，恢复后正常显示（无专家标识），不报错

#### Scenario: 旧 snapshot 文件无 expert_role 字段时向后兼容
- **WHEN** 读取不含 `expert_role` 字段的旧 snapshot 文件
- **THEN** 系统返回 `expert_role: null`，不抛异常，session 正常展示
