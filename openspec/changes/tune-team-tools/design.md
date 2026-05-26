## Context

12 个 `team_*` 工具是 Leader Agent 编排团队任务的全部工具集。当前问题：
- 术语不统一（部分描述仍用 "swarm team member"）
- 工具描述未体现工作流顺序，LLM 难以判断先后关系
- `team_create`（内存团队，协调模式）和 `team_create_run`（文件型任务运行，Swarm 主流程）容易混淆
- `team_wait` 与 `team_read_mailbox` 职责重叠说明不足

## Goals / Non-Goals

**Goals:**
- 统一术语，移除所有 "swarm" 字样
- 描述中嵌入工作流顺序引导
- 区分 team_create（内存）与 team_create_run（文件型 Swarm）
- 新工具描述更实用，含使用时机

**Non-Goals:**
- 不修改任何代码逻辑
- 不改变工具接口/参数

## Decisions

### D1：顺序标注格式
在 description 首句加前缀 `[Step N]` 或使用 "First:" / "After spawning:" 等自然语言引导，而非数字编号（避免 LLM 误解为枚举列表）。

### D2：team_create vs team_create_run 区分策略
`team_create`：标注为"协调模式专用"，用于内存中的多智能体协作。
`team_create_run`：标注为"Swarm 任务运行入口，**每次任务必须先调用**"。

### D3：team_wait vs team_read_mailbox
`team_wait`：等待所有成员完成，适用于"等全部完成再汇总"场景。
`team_read_mailbox`：读取未处理消息，适用于"实时检查单条消息"场景。

## Risks / Trade-offs

- 描述变长可能增加 token 消耗 → 控制在 3 行以内
- "Step N" 标注可能被 LLM 误读为强制顺序 → 使用自然语言引导代替数字
