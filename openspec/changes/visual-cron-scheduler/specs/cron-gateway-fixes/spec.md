## ADDED Requirements

### Requirement: delete_job 路由通过 service 层删除
`DELETE /api/cron/jobs/{name}` 端点 SHALL 调用 `services/cron.delete_cron_job(name)` 而非直接操作存储，确保经过文件锁保护。

#### Scenario: 删除存在的任务
- **WHEN** 调用 `DELETE /api/cron/jobs/my-job`，且该任务存在
- **THEN** 返回 204，任务从存储中删除，文件锁正确获取后释放

#### Scenario: 删除不存在的任务返回 404
- **WHEN** 调用 `DELETE /api/cron/jobs/nonexistent`
- **THEN** 返回 404，不修改存储

---

### Requirement: toggle_job 请求体使用 Pydantic model
`PATCH /api/cron/jobs/{name}/toggle` 端点 SHALL 接受结构化 Pydantic `ToggleRequest(enabled: bool)` 请求体，不使用裸 `dict`。

#### Scenario: 有效 toggle 请求
- **WHEN** 请求体为 `{"enabled": false}`，任务存在
- **THEN** 任务 `enabled` 字段更新为 `false`，返回更新后的任务对象

#### Scenario: 请求体类型错误时返回 422
- **WHEN** 请求体为 `{"enabled": "yes"}`（字符串而非 bool）
- **THEN** FastAPI 返回 422 Unprocessable Entity（Pydantic 自动校验）

---

### Requirement: job dict 组装逻辑统一到 service 层
创建 cron job 的 payload 组装逻辑 SHALL 提取到 `services/cron.build_cron_job_dict(...)` 纯函数，`gateway/routers/cron.py` 的 `create_job` 和 `tools/cron_create_tool.py` 的 `execute` 均调用此函数。

#### Scenario: 通过 Web UI 创建任务（路由调用）
- **WHEN** `POST /api/cron/jobs` 传入 `{name, schedule, message}`
- **THEN** 路由调用 `build_cron_job_dict`，生成的 job dict 与通过 Agent 工具创建的结构一致

#### Scenario: 通过 Agent 工具创建任务
- **WHEN** `cron_create` 工具以相同的 `name/schedule/message` 参数调用
- **THEN** 工具调用 `build_cron_job_dict`，生成的 job dict 与 Web UI 路由创建的结构一致

---

### Requirement: 暴露 next-run 查询端点
`GET /api/cron/next-run` 端点 SHALL 接受 `expr`（cron 表达式）和可选 `tz`（IANA 时区）查询参数，返回下次运行时间，无副作用。

#### Scenario: 查询有效 cron 的下次运行时间
- **WHEN** `GET /api/cron/next-run?expr=0+9+*+*+1-5&tz=Asia%2FShanghai`
- **THEN** 返回 200：`{"next_run": "2026-05-20T09:00:00+08:00", "human": "2026-05-20 周三 09:00"}`

#### Scenario: 查询无效 cron 表达式返回 422
- **WHEN** `GET /api/cron/next-run?expr=invalid`
- **THEN** 返回 422，`{"detail": "Invalid cron expression"}`

#### Scenario: 不传 tz 参数时使用 UTC
- **WHEN** `GET /api/cron/next-run?expr=0+9+*+*+*`（无 tz 参数）
- **THEN** 返回的 `next_run` 时间为 UTC 时区的 ISO 8601 字符串
