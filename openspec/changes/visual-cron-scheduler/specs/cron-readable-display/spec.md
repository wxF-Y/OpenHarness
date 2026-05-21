## ADDED Requirements

### Requirement: cron 表达式转人类可读中文描述
系统 SHALL 提供纯函数 `cronToHumanReadable(expr: string): string`，将标准 5 字段 cron 表达式转换为人类可读的中文描述字符串。

#### Scenario: 每天固定时间
- **WHEN** 传入 `"0 9 * * *"`
- **THEN** 返回 `"每天 09:00"`

#### Scenario: 工作日固定时间
- **WHEN** 传入 `"30 18 * * 1-5"`
- **THEN** 返回 `"工作日 18:30"`

#### Scenario: 每周指定单天
- **WHEN** 传入 `"0 10 * * 1"`
- **THEN** 返回 `"每周一 10:00"`

#### Scenario: 每周指定多天
- **WHEN** 传入 `"0 10 * * 1,3,5"`
- **THEN** 返回 `"每周一、三、五 10:00"`

#### Scenario: 每月指定日期
- **WHEN** 传入 `"0 8 1 * *"`
- **THEN** 返回 `"每月 1 日 08:00"`

#### Scenario: 每月 15 日
- **WHEN** 传入 `"30 9 15 * *"`
- **THEN** 返回 `"每月 15 日 09:30"`

#### Scenario: 无法识别的 cron 表达式回退显示原始字符串
- **WHEN** 传入 `"*/5 * * * *"`（或任何不匹配已知模式的表达式）
- **THEN** 返回原始 cron 字符串 `"*/5 * * * *"`（不抛出异常）

#### Scenario: 空字符串或无效输入
- **WHEN** 传入空字符串 `""` 或 `null`/`undefined`
- **THEN** 返回 `"--"`（表示未设置）

---

### Requirement: 表格 Schedule 列显示人类可读描述
Cron Jobs 列表表格的 Schedule 列 SHALL 显示 cron 表达式的人类可读中文描述，而非原始 cron 字符串。

#### Scenario: 已知模式任务的表格 Schedule 列
- **WHEN** 表格中任务的 schedule 为 `"0 9 * * 1-5"`
- **THEN** Schedule 列显示 `"工作日 09:00"`

#### Scenario: 未知模式任务的表格 Schedule 列
- **WHEN** 表格中任务的 schedule 为 `"*/30 * * * *"`
- **THEN** Schedule 列显示原始 cron 字符串 `"*/30 * * * *"`

#### Scenario: 鼠标悬停显示原始 cron 表达式
- **WHEN** 鼠标悬停在表格 Schedule 列的描述文字上
- **THEN** 浏览器 tooltip（title 属性）显示原始 cron 表达式，供高级用户查看

---

### Requirement: 上次运行和下次运行时间显示为本地时间
Cron Jobs 表格的「上次运行」和「下次运行」两列 SHALL 将 UTC ISO 字符串转换为用户本地时区（中国标准时间 CST）后显示，格式为 `MM-DD HH:mm`。历史记录中的执行时间（`started_at`）也使用同样的本地时间格式显示。

#### Scenario: 上次运行显示本地时间
- **WHEN** 表格中任务的 `last_run` 为 `"2026-05-20T00:58:00+00:00"`（UTC）
- **THEN** 上次运行列显示 `"05-20 08:58"`（CST +8）

#### Scenario: 下次运行显示本地时间
- **WHEN** 任务的 `next_run` 为 `"2026-05-21T00:53:00+00:00"`（UTC）
- **THEN** 下次运行列显示 `"05-21 08:53"`（CST +8）

#### Scenario: 历史记录时间显示本地时间
- **WHEN** 历史条目的 `started_at` 为 UTC ISO 字符串
- **THEN** 历史面板中该条目的时间显示为本地时间格式 `MM-DD HH:mm`

#### Scenario: 空值显示占位符
- **WHEN** `last_run` 或 `next_run` 为空
- **THEN** 对应列显示 `-`

---

### Requirement: 历史记录展示执行内容和结果
Cron Jobs 历史面板 SHALL 显示每次执行的完整输出内容（`stdout`），支持展开/收起长输出，并在失败时同时显示错误信息（`stderr`）。

#### Scenario: 成功执行显示 agent 输出内容
- **WHEN** 历史条目 `status = "success"` 且 `stdout` 有内容
- **THEN** 历史面板显示该条目的 `stdout` 文本，超过 3 行时默认折叠，显示「展开」按钮

#### Scenario: 失败执行显示错误信息
- **WHEN** 历史条目 `status = "failed"` 且有 `stderr` 内容
- **THEN** 以红色显示 `stderr` 内容；若同时有 `stdout` 则先显示 stdout 再显示 stderr

#### Scenario: 无输出时显示占位文字
- **WHEN** 历史条目的 `stdout` 和 `stderr` 均为空
- **THEN** 显示灰色占位文字「（无输出）」

#### Scenario: 展开/收起长输出
- **WHEN** 输出内容超过 3 行（约 200 字符）
- **THEN** 默认仅显示前 3 行并显示「展开 ▾」按钮；点击后显示全部内容并变为「收起 ▴」
