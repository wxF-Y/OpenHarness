## ADDED Requirements

### Requirement: Agent 工具集

系统 SHALL 向 Agent session 注入三个工具：`search_codebase(query: str, top_k: int = 8)`、`grep_code(pattern: str, glob?: str, max_results: int = 50)`、`read_file(path: str, start_line?: int, end_line?: int)`。三工具的 schema、描述、参数 SHALL 符合 OpenAI / Anthropic tool-use 调用格式。

#### Scenario: 三工具均注册

- **WHEN** 一个新 chat session 创建且 RAG 已启用
- **THEN** Agent 的 tools 列表中包含三个工具，名称完全匹配

#### Scenario: search_codebase 调用流

- **WHEN** Agent 在对话中决定调 `search_codebase("用户登录校验密码", top_k=5)`
- **THEN** 系统执行混合检索并返回 5 条 JSON 结果作为 tool_result

#### Scenario: grep_code 调用流

- **WHEN** Agent 调 `grep_code("validateCredentials", glob="*.ts", max_results=20)`
- **THEN** 系统在 cwd 下执行 ripgrep 等价搜索，返回最多 20 条 `{file, line, content}` 结果

#### Scenario: read_file 区段读取

- **WHEN** Agent 调 `read_file("src/auth.ts", start_line=40, end_line=80)`
- **THEN** 系统返回该文件第 40-80 行的内容（受 fs.py 同样的安全边界约束）

### Requirement: 工具按 session 自动注入

系统 SHALL 在 session 创建时检查 RAG 配置：若该 cwd 的 `.openharness/rag/<hash>/config.json` 存在且 `enabled=true`（默认），三个工具 SHALL 被自动添加到 session 工具列表；否则不注入。注入操作 SHALL NOT 修改用户自定义的其他工具。

#### Scenario: RAG 未配置时不注入

- **WHEN** 当前 cwd 没有 RAG config 文件
- **THEN** session 创建后工具列表不含三个 RAG 工具

#### Scenario: RAG 禁用时不注入

- **WHEN** RAG config 中 `enabled=false`
- **THEN** session 工具列表不含三个 RAG 工具

#### Scenario: 不影响已有工具

- **WHEN** 用户已有自定义工具（如 cron、memory）
- **THEN** RAG 工具追加到已有列表，已有工具完全保留

### Requirement: 检索结果带源引用

`search_codebase` SHALL 在结果中提供足以让用户追溯的源信息：每条命中至少包含 `file` 路径、`start_line`、`end_line`、`symbol`（若适用）、`score`，确保 Agent 在回答时可引用源。

#### Scenario: 工具结果可被 Agent 引用

- **WHEN** Agent 收到 `search_codebase` 结果
- **THEN** 结果 JSON 字符串中每条均含 `file`、`start_line`、`end_line` 字段，Agent 可在回答中以 `file:line` 形式引用

### Requirement: 工具错误处理

工具调用失败时（索引未建立、维度不一致、provider 不可用等），SHALL 返回结构化错误 `{error: str, code: str, hint?: str}`，而 NOT 抛出异常或返回空字符串。Agent SHALL 能据此决定下一步动作。

#### Scenario: 索引未建立时友好错误

- **WHEN** RAG config 存在但 index.db 为空就调 `search_codebase`
- **THEN** 工具返回 `{error: "Index not built", code: "INDEX_EMPTY", hint: "请先在 /rag 页面点击重建"}`

#### Scenario: provider 不可用时返回原因

- **WHEN** OpenAI API 401 时调 `search_codebase`
- **THEN** 工具返回 `{error: "Embedding provider error", code: "PROVIDER_ERROR", hint: "401 Unauthorized"}`

#### Scenario: 维度不一致时拦截

- **WHEN** 切了 provider 但未重建就调 `search_codebase`
- **THEN** 工具返回 `code: "INDEX_DIM_MISMATCH"` 而不是返回错误结果

### Requirement: grep_code 安全边界

`grep_code` SHALL 仅在当前 cwd 范围内搜索，SHALL 拒绝绝对路径或 `..` 跨出 cwd 的 glob；SHALL 应用与索引相同的过滤（`.gitignore` + `.ragignore` + 二进制 + 超大文件）；SHALL 限制返回结果数（默认 50，最大 500）。

#### Scenario: 拒绝越界 glob

- **WHEN** Agent 调 `grep_code("xxx", glob="../../*.py")`
- **THEN** 工具返回 `code: "INVALID_GLOB"`，不执行搜索

#### Scenario: 复用过滤规则

- **WHEN** Agent 调 `grep_code("xxx")` 且 cwd 中有 `node_modules/`
- **THEN** 结果中不含 `node_modules/` 内的命中

#### Scenario: 结果数受限

- **WHEN** Agent 调 `grep_code("a", max_results=10000)`
- **THEN** 系统返回最多 500 条
