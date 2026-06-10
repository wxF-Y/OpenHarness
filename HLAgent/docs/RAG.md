# RAG 路线图

## v1 (当前): Tool-Call RAG

- Agent 通过 `search_codebase` / `grep_code` / `read_file` 工具主动检索
- 支持 9 种代码语言 AST 切片 + Markdown heading 切片 + 文本递归切片
- 4 个 embedding provider (OpenAI / Ollama / OpenAI-Compatible / Local stub)
- 文件变更 watcher 自动增量索引
- 日费用预算 + 熔断

## v2 (计划): @-Mention

- 用户在输入框打 `@` 触发文件 / 片段补全
- 选中后走 tool 路径 (不直接拼 prompt)

## v3 (计划): Agentic 多轮检索

- query rewrite + 多轮检索
- bge-reranker / Cohere Rerank 集成
- "够不够" evaluator
