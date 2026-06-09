## ADDED Requirements

### Requirement: 语料发现与过滤

系统 SHALL 在执行索引时扫描当前 cwd 目录下的所有候选文件，并按以下规则过滤：必须先应用 `.gitignore`，再应用 `.ragignore`（支持 `!` 白名单覆盖），排除二进制文件、超过 1MB 的单文件、以及不在支持扩展名列表中的文件。

#### Scenario: 排除 .gitignore 中的文件

- **WHEN** 仓库根有 `.gitignore` 内容包含 `node_modules/` 且执行全量索引
- **THEN** 索引结果中不包含任何 `node_modules/` 下文件的 chunk

#### Scenario: .ragignore 白名单覆盖 .gitignore

- **WHEN** `.gitignore` 排除 `dist/`，`.ragignore` 包含 `!dist/api.md`
- **THEN** 索引结果中包含 `dist/api.md` 的 chunks

#### Scenario: 跳过超大文件

- **WHEN** 仓库内存在一个 2MB 的 `.log` 文件
- **THEN** 索引器跳过该文件并在日志中记录"超大文件已跳过"

#### Scenario: 跳过二进制文件

- **WHEN** 仓库内存在 `.png`、`.exe`、`.zip` 文件
- **THEN** 索引器全部跳过，不尝试 chunking

### Requirement: 多策略切片

系统 SHALL 根据文件扩展名选择 chunker：代码文件（py/ts/tsx/js/go/java/cpp/h/rust）使用 tree-sitter AST chunker；Markdown 文件（md/mdx）使用 heading + 滑窗 chunker；其他文本使用递归字符 chunker；任意 chunker 失败时回退到递归字符 chunker。

#### Scenario: Python 函数被独立切片

- **WHEN** 索引一个含 3 个顶层函数的 `.py` 文件
- **THEN** 至少产生 3 个 chunk，每个 chunk 的 `kind="function"` 且 `symbol` 等于函数名

#### Scenario: 超大函数二次切分

- **WHEN** 索引一个单函数体超过 512 token 的 Python 文件
- **THEN** 该函数被切为多个 chunk，每个 chunk 头部包含 `# from <parent>` 面包屑

#### Scenario: Markdown 按 heading 切

- **WHEN** 索引一个含 `# A` `## B` `## C` 的 Markdown 文件
- **THEN** 至少产生 3 个 chunk，每个对应一个 heading 节

#### Scenario: tree-sitter 解析失败回退

- **WHEN** 索引一个语法严重损坏的 `.ts` 文件
- **THEN** 系统回退到递归字符 chunker 继续完成索引，并在日志中记录失败原因

#### Scenario: chunk 包含上下文前缀

- **WHEN** 索引一个类方法
- **THEN** 该 chunk 的 `content` 字段以 `# file: <path>\n# class <ClassName>:\n` 开头

### Requirement: 索引存储

系统 SHALL 在 `.openharness/rag/<project_hash>/index.db` 维护一个 SQLite 文件，包含 FTS5 虚表 `chunks`（用于 BM25）、`sqlite-vec` 虚表 `vec_chunks`（用于向量）、普通表 `file_meta`（文件级元数据）和 `embed_ledger`（费用记录）。`project_hash` SHALL 为 `sha256(cwd)` 的前 12 位十六进制。

#### Scenario: 首次索引创建 DB 文件

- **WHEN** 在一个新 cwd 下首次执行索引
- **THEN** `.openharness/rag/<12位 hash>/index.db` 被创建且包含 4 张表

#### Scenario: 切 cwd 隔离索引

- **WHEN** 在 cwd A 索引后切到 cwd B 执行 search
- **THEN** 搜不到 cwd A 的内容，B 有独立 DB

#### Scenario: file_meta 记录 sha 与时间

- **WHEN** 索引完一个文件
- **THEN** `file_meta` 表中该 file 的行有非空 `sha`、`mtime`、`last_indexed`、`chunk_count`

### Requirement: 增量索引与 SHA 短路

系统 SHALL 提供"增量更新"模式：仅处理满足以下任一条件的文件：（a）`file_meta` 中无记录；（b）当前文件 SHA 与记录不一致。对单 chunk SHA 与库内一致的，SHALL 跳过嵌入调用。

#### Scenario: 未变文件被跳过

- **WHEN** 全量索引后立即触发增量更新，且无文件被修改
- **THEN** 嵌入 API 调用次数为 0；`embed_ledger` 无新记录

#### Scenario: 仅变更文件被处理

- **WHEN** 用户修改 1 个文件后触发增量更新
- **THEN** 仅该文件被读取、切片、查 chunk hash；仅 hash 变化的 chunks 被嵌入与更新

#### Scenario: 部分 chunk 未变跳过嵌入

- **WHEN** 一个文件被修改但只改了一个函数（其他函数 chunk hash 不变）
- **THEN** 仅修改的函数 chunk 被重新嵌入；未变的不调嵌入 API

### Requirement: 全量重建

系统 SHALL 提供"全量重建"模式：先清空目标 `index.db` 中的 chunks/vec_chunks/chunks_fts/file_meta 表，再扫描整个 cwd 重新索引。

#### Scenario: 全量重建清空旧数据

- **WHEN** 用户点击"重建索引"
- **THEN** 旧 chunks 被删除；index.db 中只剩本次新建的数据

#### Scenario: 全量重建过程可被取消

- **WHEN** 用户在重建进行到 50% 时点击"取消"
- **THEN** 索引立即停止，已写入的部分保留（事务粒度），UI 状态回到"未完成"

#### Scenario: 取消等待当前 batch 完成

- **WHEN** 用户在一个嵌入 batch 处理中点击"取消"
- **THEN** 系统不中断当前 batch（保护已嵌入投入），等当前 batch 完成（最长 3 秒）后停止；emit 事件包含 `{done, planned, status: "cancelled"}`

### Requirement: 崩溃恢复

系统 SHALL 对每个嵌入 batch 包裹 SQLite 事务（DELETE 旧 chunks → INSERT 新 chunks/vec/fts → UPDATE file_meta）。文件级状态 SHALL 通过 `file_meta.in_progress` 标志位维护；启动时系统 SHALL 扫描该标志为 1 的孤儿记录，并自动入队 reindex 该文件。

#### Scenario: 单 batch 崩溃文件不残缺

- **WHEN** 嵌入 batch 写库到一半时进程被强杀
- **THEN** 该 batch 的所有写操作因事务回滚未生效；该文件保持上一个一致版本

#### Scenario: 启动恢复孤儿文件

- **WHEN** Gateway 启动时检测到 `file_meta.in_progress = 1` 的记录
- **THEN** 这些文件被自动加入下一次 update 队列重新索引

### Requirement: 文件变更监听

系统 SHALL 提供默认开启的 watchdog 监听器，监听 cwd 整棵目录树的 create/modify/delete 事件。事件 SHALL 经过：（1）`.gitignore` + `.ragignore` 过滤；（2）per-file 500ms 防抖；（3）每 3 秒聚合 flush；（4）最多 8 并发嵌入；（5）SHA 短路；（6）日预算熔断。

#### Scenario: 编辑器保存风暴只触发一次

- **WHEN** IDE 在 500ms 内对同一文件触发 5 次 modify 事件
- **THEN** 索引器仅对该文件执行一次增量更新

#### Scenario: watcher 可被关闭

- **WHEN** 用户在 UI 关闭 watcher 开关
- **THEN** 后续文件修改不触发任何索引；手动按钮仍可用

#### Scenario: 删除文件触发清理

- **WHEN** 用户删除一个已索引的文件
- **THEN** 该文件对应的 chunks 与 vec_chunks 行被从 DB 删除，file_meta 记录被移除

#### Scenario: 离线或 health_check 失败暂停

- **WHEN** 配置的 embed provider 在 3 次连续 health_check 失败
- **THEN** watcher 自动进入暂停态；UI 显示红点与原因；用户点"恢复"后才重启

### Requirement: 日费用预算与熔断

系统 SHALL 维护 `embed_ledger` 累计每日嵌入费用；超过用户配置的 `daily_usd` 上限时，SHALL 按 `over_budget_action`（pause | warn | hard_stop）之一处理。

#### Scenario: 超额时暂停 watcher

- **WHEN** `daily_usd=1.00` 且 `over_budget_action="pause"` 且当日累计已达 $1.00
- **THEN** watcher 自动暂停，UI 显示告警

#### Scenario: 跨日重置

- **WHEN** 进入新的一天（本地时区）
- **THEN** 当日累计费用归零，被预算暂停的 watcher 自动恢复

#### Scenario: 手动重建不受预算阻挡（warn 模式）

- **WHEN** `over_budget_action="warn"` 且已超额，用户点击"重建"
- **THEN** 重建照常执行，但 UI 弹出"今日预算已超出"提示

### Requirement: SSE 进度通道

系统 SHALL 通过 `GET /api/rag/stream` 提供 SSE 流，推送索引、watcher、模型下载的所有进度事件。事件格式 SHALL 为 JSON，包含 `stage`、`source`（manual/auto/rebuild/download）、`done`、`total`、`current_file`、`cost_usd_delta` 字段。

#### Scenario: 重建进度可被前端订阅

- **WHEN** 前端订阅 `/api/rag/stream` 期间用户触发重建
- **THEN** 前端持续收到 `{stage:"chunk"|"embed"|"write", done, total, ...}` 事件

#### Scenario: 多事件源共用一条流

- **WHEN** 同时进行模型下载与 watcher 增量
- **THEN** 两类事件均出现在同一 SSE 流，由 `source` 字段区分
