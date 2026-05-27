## MODIFIED Requirements

### Requirement: 会话列表展示团队 Session 标识
会话列表 SHALL 在展示 Orchestrator session 时附加来源团队名称标签，使用户能够区分普通 session 和通过 Swarm 启动的 session。

**实现说明**：团队标签通过 `uiStore.expertRoleLabels` 机制注入，复用 Sidebar 已有的 `expert_role_label` 渲染逻辑，无需修改后端 API。

#### Scenario: 团队 session 在会话列表中显示团队标签
- **WHEN** 通过 Swarm 启动团队创建的 session 出现在会话列表
- **THEN** 该 session 条目 SHALL 在标题行下方显示"🤝 {teamName}"标签（与专家标签同一行位置）
- **THEN** 其他非 Swarm 创建的 session 条目 SHALL NOT 显示团队标签

#### Scenario: 点击团队 session 可跳转对话
- **WHEN** 用户在左侧会话列表点击团队 Orchestrator session 条目
- **THEN** 右侧 SHALL 展示该 session 的对话内容（与普通 session 行为一致）
