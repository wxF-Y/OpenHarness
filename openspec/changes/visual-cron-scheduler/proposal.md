## Why

当前 Cron Jobs 配置界面要求用户手写 cron 表达式（如 `0 9 * * 1-5`），对于不熟悉 cron 语法的普通用户而言门槛极高，导致配置错误率高、功能使用率低。通过引入可视化时间选择器，让用户全程鼠标操作完成调度配置。

## What Changes

- **替换 Schedule 文本输入框**：用频率选择器 + 时间选择器 + 日期选择器组合的可视化组件取代原有的单行 cron 文本框
- **新增频率模式切换**：「每天 / 工作日 / 每周 / 每月 / 自定义」五种模式，点击切换
- **新增小时/分钟下拉选择器**：替代 cron 文本输入，分别提供 0-23 小时和 0-59 分钟（5 分钟步进）的下拉列表
- **新增星期/日期选择面板**：「每周」模式显示 Mon-Sun 可点击按钮，「每月」模式显示 1-31 日期按钮
- **新增 cron 预览行**：组件底部始终显示当前设置对应的 cron 表达式（高级用户参考）
- **升级表格 Schedule 列**：从裸 cron 字符串改为人类可读描述（如"每天 09:00"、"工作日 18:30"）
- **保留「自定义」模式**：专家用户仍可直接输入原始 cron 表达式

## Capabilities

### New Capabilities

- `cron-schedule-picker`: 可视化 cron 调度时间选择器组件，支持五种频率模式、时分下拉、星期/日期面板、实时 cron 预览
- `cron-readable-display`: 将 cron 表达式转换为人类可读中文描述的工具函数，用于表格列和历史记录展示

### Modified Capabilities

- `hlagent-web-ui`: Cron Jobs 页面表单字段和表格显示列发生 UI 层变更（不涉及 spec 级别行为变更，保持 API 合约不变）

## Impact

- **修改文件**：`HLAgent/web/src/pages/CronPage.tsx`（主体修改）
- **新增文件**：`HLAgent/web/src/components/CronSchedulePicker.tsx`（新组件）
- **新增文件**：`HLAgent/web/src/utils/cronUtils.ts`（cron 表达式工具函数）
- **后端无变更**：API `/api/cron/jobs` 接口合约保持不变，前端仍发送标准 cron 字符串
- **无破坏性变更**：纯前端 UI 优化，不影响已有任务数据和后端服务
