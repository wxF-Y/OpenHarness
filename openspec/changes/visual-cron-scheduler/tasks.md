## 1. 工具函数层（前端）

- [x] 1.1 新建 `HLAgent/web/src/utils/cronUtils.ts`，实现 `cronToHumanReadable(expr: string, verbose?: boolean): string`：`verbose=true`（默认）输出完整句式「每个工作日 09:00 重复执行」，`verbose=false` 输出精简标签「工作日 09:00」
- [x] 1.2 在 `cronUtils.ts` 中实现 `parseCronToSchedulerState(expr: string): SchedulerState`：解析时将 `7`（Sunday）规范化为 `0`，将 `1,2,3,4,5` 等价识别为「工作日」模式
- [x] 1.3 在 `cronUtils.ts` 中实现 `schedulerStateToCron(state: SchedulerState): string`，生成时 Sunday 统一输出 `0`
- [x] 1.4 在 `cronUtils.ts` 中实现 `isValidCronExpression(expr: string): boolean`，进行**字段值域校验**（分钟 0-59、小时 0-23、日期 1-31、月份 1-12、星期 0-7），而非仅检字段数，确保与后端 `croniter.is_valid()` 语义对齐
- [x] 1.5 在 `cronUtils.ts` 中定义并导出 `SchedulerState` 类型（含 `mode`, `hour`, `minute`, `weekdays`, `monthDay`, `rawExpr`, `showAdvanced` 字段）和 `FrequencyMode` 枚举

## 2. CronSchedulePicker 组件

- [x] 2.1 新建 `HLAgent/web/src/components/CronSchedulePicker.tsx`，定义 props 接口：`value: string`、`onChange: (cron: string) => void`、`onValidChange?: (isValid: boolean) => void`
- [x] 2.2 实现四个主路径频率模式按钮（每天 / 工作日 / 每周 / 每月），按钮下方添加「高级：手动输入 cron 表达式 ▸」折叠链接（小字，`#6c7086`）
- [x] 2.3 实现小时下拉选择器（00-23，共 24 选项）和分钟下拉选择器（00-55，5 分钟步进，共 12 选项）
- [x] 2.4 实现「每周」模式下「周一 周二 周三 周四 周五 周六 周日」七个双字星期按钮，支持多选，禁止取消最后一个选中项
- [x] 2.5 实现「每月」模式下 1-31 日期 `<select>` 下拉选择器（单选，与小时/分钟样式一致）
- [x] 2.6 实现高级折叠区域：展开后调用 `isValidCronExpression` 进行字段值域校验；无效时边框变红并显示「无效的 cron 表达式」，同时调用 `onValidChange(false)`；有效时调用 `onValidChange(true)`
- [x] 2.7 实现预览区：调用 `cronToHumanReadable(expr, true)` 显示完整语义描述（颜色 `#a6adc8`），描述文字添加 `title={cronExpression}` tooltip；高级模式无效时显示红色「无效的 cron 表达式」
- [x] 2.8 使用 `useState(() => parseCronToSchedulerState(value))` 初始化内部 state（D13 模式），配合 `useEffect` + `prevValueRef` 仅在 `value` prop 实质变化时同步，防止父组件无关 re-render 重置用户操作
- [x] 2.9 为所有选择器元素添加内联样式，保持与 Catppuccin 深色主题一致（参考 `CronPage.tsx` 现有配色变量）
- [x] 2.10 实现 debounce（300ms）调用 `GET /api/cron/next-run?expr=...` 获取下次运行时间，在预览区描述下方显示「下次执行：YYYY-MM-DD 周X HH:mm」（灰色小字）；接口调用失败时静默忽略

## 3. CronPage 集成

- [x] 3.1 将 `CronPage.tsx` 的创建表单从水平 flex 行改为垂直卡片布局（字段从上到下：任务名称 → 执行时间 → Agent 消息 → 按钮行）
- [x] 3.2 将字段标签 `Schedule *` 改为 `执行时间 *`，名称字段 placeholder `my-job` 改为 `如：检查PR、发日报`
- [x] 3.3 在 `CronPage.tsx` 中导入 `CronSchedulePicker` 和 `cronToHumanReadable`，添加 `scheduleValid` state（初始 `true`）
- [x] 3.4 将 `newSchedule` 文本输入框替换为 `<CronSchedulePicker value={newSchedule} onChange={setNewSchedule} onValidChange={setScheduleValid} />`
- [x] 3.5 将「创建」按钮的 `disabled` 条件从 `creating || !newName.trim()` 改为 `creating || !newName.trim() || !scheduleValid`，确保高级模式无效表达式时无法提交
- [x] 3.6 将表格 Schedule 列渲染改为 `cronToHumanReadable(job.schedule, false)`（精简标签），并添加 `title={job.schedule}` tooltip
- [x] 3.7 验证新任务提交时向 `POST /api/cron/jobs` 发送合法 cron 字符串（`newSchedule` 值）

## 4. Gateway / SDK 修复

- [x] 4.1 `gateway/routers/cron.py` — `delete_job` 端点改用 `delete_cron_job(name)` service 函数，移除直接引用 `atomic_write_text` 和 `get_cron_registry_path` 的代码
- [x] 4.2 `gateway/routers/cron.py` — 新增 `ToggleRequest(BaseModel)` Pydantic model（`enabled: bool`），将 `toggle_job` 参数从 `dict[str, bool]` 改为 `req: ToggleRequest`
- [x] 4.3 `services/cron.py` — 提取 `build_cron_job_dict(name, schedule, ...)` 纯函数，封装 payload 组装逻辑（kind/message/notify/cwd 等字段）
- [x] 4.4 `gateway/routers/cron.py` — `create_job` 路由改调 `build_cron_job_dict`，移除内联 payload 组装代码
- [x] 4.5 `tools/cron_create_tool.py` — `execute` 方法改调 `build_cron_job_dict`，移除内联 payload 组装代码
- [x] 4.6 `gateway/routers/cron.py` — 新增 `GET /api/cron/next-run` 端点，接受 `expr: str` 和 `tz: str | None` 查询参数，调用 `next_run_time()` 返回 `{"next_run": ..., "human": ...}`，对无效表达式返回 422

## 5. 验证与测试

- [x] 5.1 启动开发服务器（`cd HLAgent/web && npm run dev`），手动验证四种主路径模式的 cron 生成与预览描述
- [x] 5.2 测试垂直表单布局和字段标签中文化
- [x] 5.3 测试 `isValidCronExpression`：`60 9 * * *` 应返回 false（分钟越界）；`*/5 * * * *` 应返回 true；`0 25 * * *` 应返回 false（小时越界）
- [x] 5.4 测试高级模式无效时「创建」按钮被禁用；有效后恢复可点击
- [x] 5.5 测试父组件 re-render 不重置用户已选星期：选「周三」「周五」后触发父组件无关状态更新，选中状态保持
- [x] 5.6 测试 Sunday 规范化：传入 `0 9 * * 7` 应识别为「每周」模式，「周日」高亮
- [x] 5.7 测试工作日逗号枚举：传入 `0 9 * * 1,2,3,4,5` 应识别为「工作日」模式
- [x] 5.8 测试表格 Schedule 列：精简标签显示、tooltip 显示原始 cron 表达式
- [x] 5.9 测试 `GET /api/cron/next-run`：有效 cron 返回 200 含 next_run；无效返回 422
- [x] 5.10 测试 `DELETE /jobs/{name}` 并发安全：确认通过 service 层调用（含锁）
- [x] 5.11 测试 `PATCH /toggle` Pydantic 校验：`{"enabled": "yes"}` 返回 422

## 6. 时间本地化（新增）

- [x] 6.1 在 `CronPage.tsx` 中添加纯函数 `toLocalTime(iso: string): string`，将 UTC ISO 字符串转换为本地时区 `MM-DD HH:mm` 格式（使用 `Intl.DateTimeFormat` 或 `Date.toLocaleString`，无需引入外部库）
- [x] 6.2 将表格「上次运行」列的渲染从 `job.last_run.slice(0, 16)` 改为 `toLocalTime(job.last_run)`
- [x] 6.3 将表格「下次运行」列的渲染从 `job.next_run.slice(0, 16)` 改为 `toLocalTime(job.next_run)`
- [x] 6.4 将历史面板中 `h.started_at?.slice(0, 16)` 改为 `toLocalTime(h.started_at)`

## 7. 历史执行内容展示（新增）

- [x] 7.1 修正 `HistoryEntry` 接口：将 `output?: string` 改为 `stdout?: string` 和 `stderr?: string`（与后端 `cron_history.jsonl` 实际字段对齐）
- [x] 7.2 在 `CronPage.tsx` 中新增 `HistoryOutputBlock` 组件，显示单条历史的输出内容：`stdout` 以正常色显示，`stderr` 以红色显示，超过 200 字符时默认折叠并提供展开/收起按钮
- [x] 7.3 将历史面板中每条记录的输出展示从简单 `h.output.slice(0, 100)` 替换为 `<HistoryOutputBlock stdout={h.stdout} stderr={h.stderr} />`
- [x] 7.4 无输出时显示灰色「（无输出）」占位文字
