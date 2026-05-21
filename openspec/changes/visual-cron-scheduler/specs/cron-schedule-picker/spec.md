## ADDED Requirements

### Requirement: 可视化频率模式选择（主路径四按钮 + 高级折叠）
CronSchedulePicker 组件 SHALL 提供「每天 / 工作日 / 每周 / 每月」四种主路径频率模式的点击切换，并在下方提供折叠式「高级：手动输入 cron 表达式 ▸」链接入口，展开后进入自定义模式。

#### Scenario: 默认模式为工作日
- **WHEN** CronSchedulePicker 组件挂载，未传入 `value` prop 或传入 `0 9 * * 1-5`
- **THEN** 「工作日」模式按钮高亮选中，时间显示为 09:00，预览显示「每个工作日 09:00 重复执行」

#### Scenario: 点击模式按钮切换频率
- **WHEN** 用户点击「每天」按钮（当前为「工作日」模式）
- **THEN** 「每天」按钮高亮，cron 表达式更新为 `M H * * *`（保留原有时分），预览更新为「每天 HH:MM 重复执行」，`onChange` 回调触发

#### Scenario: 切换到「每周」模式显示星期选择器
- **WHEN** 用户点击「每周」按钮
- **THEN** 显示「周一 周二 周三 周四 周五 周六 周日」七个可点击按钮，默认选中「周一」

#### Scenario: 切换到「每月」模式显示日期下拉
- **WHEN** 用户点击「每月」按钮
- **THEN** 显示 1-31 的 `<select>` 下拉选择器，默认选中 1

#### Scenario: 点击「高级」链接展开自定义 cron 输入
- **WHEN** 用户点击四个模式按钮下方的「高级：手动输入 cron 表达式 ▸」链接
- **THEN** 链接变为「▾ 收起」，下方展开单行文本输入框，预填当前 cron 表达式；四个主模式按钮变为非高亮（去选中状态）

#### Scenario: 收起高级 cron 输入框
- **WHEN** 用户点击「▾ 收起」链接
- **THEN** 文本输入框隐藏；如当前文本框中 cron 与某已知模式匹配，自动激活对应按钮；否则默认恢复「工作日」模式

---

### Requirement: 时间选择器（小时和分钟下拉）
CronSchedulePicker 组件 SHALL 提供小时（0-23）和分钟（0/5/10/.../55）两个独立下拉选择器，替代 cron 文本输入中的时间部分。

#### Scenario: 选择小时更新 cron 表达式
- **WHEN** 用户从小时下拉中选择「14」
- **THEN** cron 表达式中小时字段更新为 `14`，`onChange` 回调触发，预览区同步更新

#### Scenario: 选择分钟更新 cron 表达式
- **WHEN** 用户从分钟下拉中选择「30」
- **THEN** cron 表达式中分钟字段更新为 `30`，`onChange` 回调触发，预览区同步更新

#### Scenario: 小时下拉提供 24 个选项（补零格式）
- **WHEN** 用户展开小时下拉
- **THEN** 显示 00、01、02 … 23 共 24 个选项

#### Scenario: 分钟下拉提供 5 分钟步进选项
- **WHEN** 用户展开分钟下拉
- **THEN** 显示 00、05、10、15、20、25、30、35、40、45、50、55 共 12 个选项

---

### Requirement: 每周模式星期多选（周X 双字标签）
在「每周」模式下，CronSchedulePicker 组件 SHALL 提供「周一 周二 周三 周四 周五 周六 周日」七个双字按钮，支持多选，至少须选中一天。

#### Scenario: 点击星期按钮切换选中状态
- **WHEN** 用户在「每周」模式下点击「周三」按钮（当前未选中）
- **THEN** 「周三」按钮高亮，cron 表达式星期字段更新为已选星期的数字列表（如 `1,3`），`onChange` 回调触发

#### Scenario: 不允许取消最后一个已选星期
- **WHEN** 用户点击唯一选中的星期按钮（如只选了「周一」）
- **THEN** 按钮保持选中状态，cron 表达式不变，不触发 `onChange`

#### Scenario: 多选生成正确 cron 字符串
- **WHEN** 用户在「每周」模式下选中「周一」（1）、「周三」（3）、「周五」（5）
- **THEN** 生成的 cron 表达式星期字段为 `1,3,5`（升序逗号分隔），完整示例：`0 9 * * 1,3,5`

---

### Requirement: 每月模式日期下拉单选
在「每月」模式下，CronSchedulePicker 组件 SHALL 提供 1-31 的 `<select>` 下拉选择器，单选一天。

#### Scenario: 选择日期更新 cron 表达式
- **WHEN** 用户在「每月」模式下从下拉中选择「15」
- **THEN** cron 表达式日期字段更新为 `15`，`onChange` 回调触发

#### Scenario: 默认选中每月 1 日
- **WHEN** 用户切换到「每月」模式
- **THEN** 日期下拉默认显示「1」，生成 cron 为 `M H 1 * *`（M/H 保留当前分/时）

---

### Requirement: 预览区完整语义描述
CronSchedulePicker 组件 SHALL 在时间选择器下方实时显示一行完整语义描述，格式包含频次词和「重复执行」后缀，让用户清晰确认循环语义。cron 原始字符串改为悬停 tooltip。

#### Scenario: 每天模式预览
- **WHEN** 用户选择「每天」模式，时间 09:00
- **THEN** 预览区显示「每天 09:00 重复执行」

#### Scenario: 工作日模式预览
- **WHEN** 用户选择「工作日」模式，时间 18:30
- **THEN** 预览区显示「每个工作日 18:30 重复执行」

#### Scenario: 每周多选模式预览
- **WHEN** 用户选择「每周」模式，勾选「周三」「周五」，时间 10:00
- **THEN** 预览区显示「每周三、五 10:00 重复执行」

#### Scenario: 每月模式预览
- **WHEN** 用户选择「每月」模式，日期 15，时间 08:00
- **THEN** 预览区显示「每月 15 日 08:00 重复执行」

#### Scenario: 鼠标悬停预览文字显示 cron 字符串
- **WHEN** 用户将鼠标悬停在预览描述文字上
- **THEN** 浏览器 tooltip（title 属性）显示对应的原始 cron 表达式（如 `30 18 * * 1-5`）

#### Scenario: 任意选择变更时实时更新预览
- **WHEN** 用户更改任意时间、频率或日期选项
- **THEN** 预览描述立即同步更新，不需要提交

---

### Requirement: 高级 cron 模式校验反馈（字段值域级）
在高级（自定义）模式展开状态下，CronSchedulePicker 组件 SHALL 对用户输入的 cron 表达式进行字段值域级校验（与后端 `croniter.is_valid()` 语义对齐），给予视觉反馈，并通过 `onValidChange` 通知父组件当前有效性。

#### Scenario: 字段数不足时边框变红
- **WHEN** 用户在自定义文本框中输入字段数少于 5 的字符串（如 `* * *`）
- **THEN** 文本框边框变为红色（`#f38ba8`），预览区显示红色提示「无效的 cron 表达式」，不触发 `onChange`，`onValidChange(false)` 触发

#### Scenario: 字段值越界时边框变红
- **WHEN** 用户输入字段数正确但值域越界的字符串（如 `60 9 * * *` 分钟为 60，或 `0 25 * * *` 小时为 25）
- **THEN** 文本框边框变为红色，预览区显示「无效的 cron 表达式」，不触发 `onChange`，`onValidChange(false)` 触发

#### Scenario: 输入有效 cron 表达式时恢复正常
- **WHEN** 用户修改文本框内容使其通过字段值域校验（如 `*/15 * * * *`）
- **THEN** 边框恢复正常颜色，预览区显示对应描述，触发 `onChange` 回调，`onValidChange(true)` 触发

#### Scenario: 父组件收到 onValidChange(false) 时禁用提交按钮
- **WHEN** `CronSchedulePicker` 处于高级模式且当前表达式无效，`onValidChange(false)` 已触发
- **THEN** 父组件（`CronPage`）的「创建」按钮处于禁用状态（`disabled`），无法提交

---

### Requirement: 受控组件接口（含 state 稳定性保证）
CronSchedulePicker 组件 SHALL 接受 `value`、`onChange` 和可选 `onValidChange` prop，作为受控组件使用。内部 state 在挂载时初始化一次，`value` prop 变化时通过 `useEffect` 同步，父组件无关 re-render 不重置用户正在进行的操作。

#### Scenario: 传入已知 cron 字符串时正确反解析 UI 状态
- **WHEN** 父组件传入 `value="30 18 * * 1-5"`
- **THEN** 组件显示「工作日」模式，小时选中 18，分钟选中 30，预览显示「每个工作日 18:30 重复执行」

#### Scenario: 传入无法识别的 cron 字符串时展开高级模式
- **WHEN** 父组件传入 `value="*/15 * * * *"`
- **THEN** 组件自动展开高级输入框并预填 `*/15 * * * *`，四个主模式按钮无高亮

#### Scenario: 父组件无关 re-render 不重置用户选择
- **WHEN** 用户在「每周」模式下已选中「周三」「周五」，此时父组件因其他 state 变化触发 re-render（`value` prop 未变）
- **THEN** 组件内部星期选中状态保持不变，用户操作不丢失

#### Scenario: value prop 实质变化时同步更新内部状态
- **WHEN** 父组件将 `value` prop 从 `"0 9 * * 1-5"` 改为 `"0 10 * * *"`（如切换到不同任务的编辑）
- **THEN** 组件内部 state 更新：模式切换到「每天」，小时更新为 10

#### Scenario: Sunday 用 0 表示，7 被规范化
- **WHEN** 父组件传入 `value="0 9 * * 7"`（7 代表周日）
- **THEN** 组件解析为「每周」模式，「周日」按钮高亮，内部统一存储为 `0`

#### Scenario: 工作日逗号枚举与范围表示均识别为工作日模式
- **WHEN** 父组件传入 `value="0 9 * * 1,2,3,4,5"`
- **THEN** 组件显示「工作日」模式（与 `0 9 * * 1-5` 等价）

#### Scenario: 用户操作触发 onChange 回调
- **WHEN** 用户更改任意有效选项
- **THEN** `onChange(newCronExpression: string)` 被调用，参数为完整合法的 cron 表达式
