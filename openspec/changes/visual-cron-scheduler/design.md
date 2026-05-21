## Context

OpenHarness HLAgent Web UI 的 Cron Jobs 配置页面（`CronPage.tsx`，约 172 行）当前使用裸文本输入框接受 cron 表达式。后端 API（FastAPI `/api/cron/jobs`）接收并通过 `croniter` 库验证标准 5 字段 cron 表达式，合约不变。前端无任何 UI 组件库依赖，采用纯内联 CSS + Catppuccin 深色主题配色。

## Goals / Non-Goals

**Goals:**
- 用可视化组件替代 cron 文本输入，普通用户全程鼠标操作即可完成配置
- 新增独立组件 `CronSchedulePicker`，与 `CronPage` 解耦，可复用
- 新增工具函数 `cronUtils.ts`，实现 cron → 人类可读描述的双向转换
- 表格 Schedule 列改为显示人类可读中文描述
- 保持与后端 API 合约完全兼容（仍发送标准 cron 字符串）

**Non-Goals:**
- 不修改后端 API 或数据模型
- 不引入第三方 cron 编辑器库（保持零外部 UI 依赖）
- 不支持超过月级别的复杂 cron 表达式（如 `@yearly`、`L`、`W` 等扩展语法）
- 不提供时区可视化选择器（时区字段保持文本输入）

## Decisions

### D1：纯自研组件 vs 引入第三方库

**决策**：纯自研，不引入第三方 cron 选择器库（如 `react-cron-generator`、`cron-expression-editor`）

**理由**：项目当前无 UI 组件库依赖，保持风格一致。现有需求场景（5 种频率模式 + 时分选择）复杂度可控，自研约 150-200 行代码即可覆盖。第三方库通常携带自身样式，与 Catppuccin 深色主题冲突需大量覆盖。

**备选**：引入 `react-cron-generator` — 放弃，因包体积 ~50KB gzipped + 样式冲突。

---

### D2：组件架构 — 受控 vs 非受控

**决策**：`CronSchedulePicker` 设计为受控组件（Controlled Component），对外暴露 `value: string` + `onChange: (cron: string) => void` 接口。

**理由**：`CronPage` 需要在提交前读取当前 cron 值，受控模式天然符合 React 表单惯例。`value` 传入标准 cron 字符串，组件内部解析成 UI 状态，实现双向绑定。

---

### D3：频率模式识别策略

**决策**：基于 cron 字符串的模式匹配规则识别当前所处模式，无法识别时回退到「自定义」模式。

**模式匹配规则（按优先级）：**
| 模式 | cron 模式 |
|------|---------|
| 每天 | `M H * * *` |
| 工作日 | `M H * * 1-5` |
| 每周 | `M H * * D`（D 为 `\d+(,\d+)*`，如 `1`、`1,3,5`）|
| 每月 | `M H D * *`（D 为 1-31 具体数字）|
| 自定义 | 以上均不匹配 |

**Sunday 0/7 约定（工程补充）**：UI 层统一使用 `0` 代表周日（与 `croniter` 默认一致）。`parseCronToSchedulerState` 解析时若遇到 `7`，统一替换为 `0`。`schedulerStateToCron` 生成时始终输出 `0`。

**隐式工作日约定**：`M H * * 1,2,3,4,5`（逗号枚举）和 `M H * * 1-5`（范围）语义等价，解析时两者均识别为「工作日」模式。

**理由**：消除 Sunday 方言歧义和枚举/范围表示的不一致，确保解析行为可预测。

---

### D4：cron → 人类可读描述的实现位置与接口

**决策**：在 `cronUtils.ts` 中实现 `cronToHumanReadable(expr: string, verbose?: boolean): string`，`verbose` 控制输出风格：

- `verbose=true`（默认）→ 完整句式，用于 picker 预览：`"每个工作日 09:00 重复执行"`
- `verbose=false` → 精简标签，用于表格列：`"工作日 09:00"`

供 `CronSchedulePicker`（预览行，`verbose=true`）和 `CronPage`（表格列，`verbose=false`）共用。

---

### D5：分钟下拉步进

**决策**：分钟选择器提供 0-55 以 5 分钟为步进的 12 个选项，不提供逐分钟选择。

**理由**：用户场景（定时任务）通常设置整点或 5 分钟对齐。自定义模式仍保留原始文本输入，需要精确分钟的用户可用自定义模式。

---

### D6：创建表单布局 — 水平行 vs 垂直卡片

**决策**：`CronPage` 的创建表单改为**垂直卡片布局**（`flexDirection: 'column'`），不再使用水平 flex 行。

**理由**：`CronSchedulePicker` 最少需要 3 行垂直空间（模式按钮 + 时间选择 + 预览），而「名称」和「Agent 消息」输入框是单行。在原有水平 flex 行中，`alignItems: flex-end` 会导致不同高度元素错位，视觉混乱。垂直卡片结构：名称 → Schedule（Picker 展开） → Agent 消息 → 按钮行，符合填表自上而下的阅读惯例。

---

### D7：每月日期选择方式 — 按钮网格 vs `<select>` 下拉

**决策**：「每月」模式下，日期改用 `<select>` 下拉（1-31），不使用 31 个按钮网格。

**理由**：31 个按钮在侧边栏宽度（~400px）内需要 6+ 行，占用过多垂直空间，且用户完成任务（选一天）并不需要全量可见。下拉一行搞定，与小时/分钟选择器视觉一致。

---

### D8：星期按钮标签 — 英文 vs 中文单字 vs 中文双字

**决策**：「每周」模式的星期按钮使用中文双字前缀：`周一 / 周二 / 周三 / 周四 / 周五 / 周六 / 周日`。

**理由**：单字「一 二 三 四 五 六 日」孤立出现时，初次阅读易与日期数字混淆（「一」像 1 日，「日」像星期日但在数字序列末尾语义不明）。加「周」前缀消除歧义，且双字按钮在 400px 宽度内七个仍可单行排列（每个约 36px）。英文 Mon/Tue 与页面语言不符，放弃。

---

### D9：预览区内容格式 — 描述完整性

**决策**：预览区第 1 行使用完整重复语义句式，格式为「每个X X:XX 重复执行」，例如：
- 「每天 09:00 重复执行」
- 「每个工作日 09:00 重复执行」
- 「每周三、五 14:00 重复执行」
- 「每月 1 日 09:00 重复执行」

第 2 行改为 title tooltip（鼠标悬停显示 cron 字符串），不再在界面常驻显示，以降低视觉噪音。

**理由**：「工作日 09:00」歧义：像是描述某一个时间点，而非「每次都运行」的循环语义。加上「每个/每天/每月」和「重复执行」后语义明确，普通用户一眼确认。cron 字符串对普通用户无意义，移入 tooltip 给高级用户使用，不占正文空间。

---

### D10：「高级」模式 cron 校验反馈

**决策**：高级模式文本框输入变更时，进行**字段级值域校验**（而非仅检字段数），确保与后端 `croniter.is_valid()` 语义对齐：

| 字段 | 值域 |
|------|-----|
| 分钟 | 0–59，支持 `*/N`、`A-B`、`,` 组合 |
| 小时 | 0–23 |
| 日期 | 1–31 |
| 月份 | 1–12 |
| 星期 | 0–7（`7` 等同 `0`） |

校验失败时边框变红（`#f38ba8`），预览显示「无效的 cron 表达式」，**不触发 `onChange`，且组件暴露 `onValidChange(isValid: boolean)` 回调通知父组件**，父组件应据此禁用提交按钮。

**理由**：原设计仅检字段数（`split(' ').length === 5`）会产生假阳性：如 `60 9 * * *` 字段数对但分钟值越界，客户端显示绿色而后端返回 422，比无校验体验更差。

### D11：表单字段标签语言 — 英文 vs 中文

**决策**：`CronPage.tsx` 创建表单中所有字段标签和 placeholder 改为中文：
- `Schedule *` → `执行时间 *`
- `my-job`（placeholder）→ `如：检查PR、发日报`
- 「Agent 消息」保持不变（已是中文）

**理由**：`Schedule` 是技术词汇，普通用户不知道它指时间配置还是计划表。改为「执行时间」符合用户心理模型。英文 placeholder `my-job` 对中文用户会产生格式疑惑（该不该写中文？），改为示例性中文 placeholder 消除摩擦。

---

### D12：「自定义」频率模式入口 — 平级按钮 vs 折叠链接

**决策**：「自定义」不再与「每天 / 工作日 / 每周 / 每月」四个按钮平级展示，改为在四个按钮组下方显示小字折叠链接「高级：手动输入 cron 表达式 ▸」，点击展开文本输入框。

**理由**：「自定义」和「每天/工作日」并列时，普通用户容易出于好奇点击，触发文本框后不知所措，误解整个功能复杂度。降权为折叠链接，同时达到：
1. 普通用户主路径干净，四个按钮覆盖 90% 场景
2. 高级用户仍可展开 cron 文本框，功能不缺失
3. 链接文字「手动输入 cron 表达式」自带教育效果，让用户知道展开后是什么

### D13：组件内部 State 初始化策略

**决策**：`CronSchedulePicker` 内部 state 在**组件挂载时初始化一次**（`useState(() => parseCronToSchedulerState(initialValue))`），此后由内部 state 自主驱动，`onChange` 向外同步。仅当 `value` prop 发生实质变化时，通过 `useEffect` + `prevRef` 比对重新同步：

```typescript
const prevValueRef = useRef(value)
useEffect(() => {
  if (value !== prevValueRef.current) {
    prevValueRef.current = value
    setState(parseCronToSchedulerState(value))
  }
}, [value])
```

**理由**：不使用"在 render 内直接派生 state"反模式——父组件任何无关 re-render 均会触发重新解析，导致用户正在进行的星期选择、时间编辑等中间状态被清空。

---

### D14：暴露 `GET /api/cron/next-run` 端点

**决策**：在 Gateway 新增只读端点，利用已有 `next_run_time()` 服务函数计算下次运行时间：

```
GET /api/cron/next-run?expr=0+9+*+*+1-5&tz=Asia%2FShanghai
→ 200: { "next_run": "2026-05-20T09:00:00+08:00", "human": "2026-05-20 周三 09:00" }
```

Picker 预览区在 schedule 变化时 debounce（300ms）调用此端点，展示准确的下次运行时间，替代 Issue 5 中缺失的「下次执行」确认。若端点调用失败则静默忽略，不阻塞主流程。

**理由**：服务层 `next_run_time()` 已用 `croniter` 精确计算，前端无需重写 cron 计算逻辑。零新依赖，端点无副作用可安全调用。

---

### D15：提取 payload 组装为共用服务函数

**决策**：将 `cron.py` 路由和 `cron_create_tool.py` 中重复的 job payload 组装逻辑提取到 `services/cron.py` 的纯函数 `build_cron_job_dict(name, schedule, command, message, timezone, cwd, enabled, payload_override, notify)` 中，路由和工具均调用此函数。

**理由**：当前路由使用 `setdefault` 覆盖赋值，工具使用 `setdefault` 防覆盖赋值，两者在 `message` 字段处理上行为有差异。统一到一处消除分歧，保证通过 UI 和 Agent 工具创建的任务行为一致。

---

### D16：Gateway 层轻微架构修复

**决策**：
1. `DELETE /jobs/{name}` 路由改用 `delete_cron_job(name)` service 函数（含文件锁），不再直接调用 `atomic_write_text` + `get_cron_registry_path`
2. `PATCH /jobs/{name}/toggle` 请求体改用 Pydantic `ToggleRequest(enabled: bool)` model，替代裸 `dict[str, bool]`

**理由**：路由直接操作存储违反分层职责，且绕过 service 层的文件锁（`exclusive_file_lock`），在高频并发下可能导致数据竞争。Pydantic model 补全 OpenAPI schema 文档，同时提供类型安全的请求体校验。

## Risks / Trade-offs

- **[Cron 解析局限]** → 自定义 cron 表达式传入时，若模式无法匹配，自动回退到「自定义」文本模式，不做强制解析。用户可手动编辑后预览效果。
- **[已有任务编辑]** → 表格中编辑已有任务时，需将现有 cron 字符串反解析为 UI 状态（模式 + 时间 + 星期/日期）。此处逻辑复杂度略高，需充分测试各种 cron 格式的解析路径。
- **[宽度适配]** → 选择器组件在窄侧边栏内需响应式布局，星期按钮 7 个并排可能溢出，需换行处理。

## Migration Plan

纯前端 UI 变更，无数据迁移需求：

1. 新增 `cronUtils.ts` 工具函数（无依赖）
2. 新增 `CronSchedulePicker.tsx` 组件
3. 修改 `CronPage.tsx`：
   - 替换 Schedule `<input>` 为 `<CronSchedulePicker>`
   - 表格 Schedule 列使用 `cronToHumanReadable()` 渲染
4. 本地验证：启动 dev server，手动测试五种频率模式的 cron 生成结果
5. 直接发布，无需后端配合，可随时回滚（git revert）

## Open Questions

- 「每月」模式是否需要支持多选日期（如"1 日和 15 日"）？当前方案只支持单一日期。建议首期只支持单日，后续迭代再扩展。
