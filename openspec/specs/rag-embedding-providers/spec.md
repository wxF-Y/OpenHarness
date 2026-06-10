## ADDED Requirements

### Requirement: EmbedProvider 抽象

系统 SHALL 定义统一的 `EmbedProvider` 接口（Python Protocol），包含以下方法：`embed(texts: list[str]) -> list[Vector]`、`health_check() -> tuple[bool, str]`、`estimate_cost(tokens: int) -> float`，以及属性 `name: str`、`dimensions: int`、`max_batch_tokens: int`。所有内置 provider 与未来扩展 SHALL 实现该接口。

#### Scenario: 所有内置 provider 实现接口

- **WHEN** 加载任意内置 provider（openai/ollama/local/openai-compatible）
- **THEN** 它实现完整的 `EmbedProvider` 接口，且 `health_check` 返回二元组

#### Scenario: health_check 返回失败原因

- **WHEN** provider 连不上目标服务
- **THEN** `health_check()` 返回 `(False, "<具体错误，如 401/ECONNREFUSED>")`

### Requirement: 四个内置 Provider

系统 SHALL 内置以下 4 个 provider 实现：
1. **openai**：调用 OpenAI / 自定 base 的 `/v1/embeddings`，默认模型 `text-embedding-3-small`，dimensions 可配（512/1024/1536）。
2. **ollama**：调用本地 Ollama `/api/embeddings`，默认 base `http://localhost:11434`，模型从 `/api/tags` 动态发现。
3. **local**：使用 `sentence-transformers` 加载 HF 模型，默认 `BAAI/bge-m3`，自动探测设备（cuda/mps/cpu），默认 fp16，lazy 加载，idle 60min 自动卸载。
4. **openai-compatible**：用户填 `api_base` + `api_key` + `model` + `dimensions`，按 OpenAI 协议调用。

#### Scenario: OpenAI provider 默认配置

- **WHEN** 创建 openai provider 不指定参数
- **THEN** 使用 `text-embedding-3-small`，dimensions=1536，api_base 取自 settings 中已有 LLM profile

#### Scenario: Ollama 模型自动发现

- **WHEN** 用户在 UI 选择 Ollama provider 并填入 base URL
- **THEN** UI 展示从 `/api/tags` 拉取的模型列表，未安装模型显示 [拉取] 按钮

#### Scenario: Local provider lazy 加载

- **WHEN** 创建 local provider 后未调用 embed
- **THEN** sentence-transformers 模型未加载入内存

#### Scenario: Local provider 首次嵌入触发加载

- **WHEN** 首次调用 `local_provider.embed([...])`
- **THEN** 模型加载入内存（首次 5-15s），后续调用使用已加载模型

#### Scenario: Local provider idle 卸载

- **WHEN** local provider 连续 60 分钟未被调用
- **THEN** 模型从内存释放，下次调用重新加载

### Requirement: Profile ID 自动生成

系统 SHALL 为每个新创建的 embed profile 生成 ID，格式为 `emb_<provider>_<6位hex随机>`（例 `emb_openai_7k2f9a`）。ID SHALL 在 `settings.embed_profiles[]` 中 UNIQUE，碰撞时重新生成。用户 SHALL NOT 能编辑 ID，仅能编辑 display name。

#### Scenario: 创建 profile 自动生成 ID

- **WHEN** 用户在 UI 保存新 embed profile
- **THEN** 系统生成 `emb_<provider>_<6位>` ID 并写入；用户无需输入 ID

#### Scenario: Display name 与 ID 分离

- **WHEN** 用户编辑 profile 的 display name
- **THEN** display name 更新但 ID 保持不变

#### Scenario: ID 在 settings 中唯一

- **WHEN** 创建多个 profile
- **THEN** 所有 ID 互不重复（碰撞时系统重新生成）

### Requirement: Profile 配置存储

系统 SHALL 在 `~/.openharness/settings.json` 维护全局 `embed_profiles[]` 数组；API key 字段 SHALL 经过 `auth/storage.py` 加密存储；per-project 配置 `.openharness/rag/<project_hash>/config.json` 仅存 `embed_profile_id` 引用，不重复存敏感字段。

#### Scenario: API key 加密存储

- **WHEN** 用户输入 OpenAI API key 并保存
- **THEN** 写入的 settings.json 中 key 字段为加密形态，原文不可见

#### Scenario: 多项目共享同一 profile

- **WHEN** 用户在两个不同 cwd 都选用同一 profile id
- **THEN** 两个 cwd 的 RAG config 都只存 id 引用；修改 profile 在两个项目都生效

### Requirement: 测试连接

系统 SHALL 提供 `POST /api/rag/embed/test` 端点，接受临时 provider 配置（或 profile id），执行一次 `health_check` 与一次 `embed(["hello"])`，返回 `{ok: bool, latency_ms: int, dimensions: int, error?: str}`。前端 SHALL 在用户保存前强制调用该端点；只有返回 `ok=true` 时才允许保存。

#### Scenario: 连接成功返回真实维度

- **WHEN** 用户配置正确的 provider 并点击"测试连接"
- **THEN** 返回 `{ok: true, dimensions: <实际值>, latency_ms: <实测>}`

#### Scenario: 连接失败给出具体原因

- **WHEN** API key 错误
- **THEN** 返回 `{ok: false, error: "401 Unauthorized"}`，UI 显示错误并禁用保存按钮

#### Scenario: 未测试通过禁止保存

- **WHEN** 用户未点击"测试连接"或测试失败时点击"保存"
- **THEN** 前端拒绝提交；后端如收到也返回 400

### Requirement: 维度变更强制重建

系统 SHALL 在用户切换 active embed profile 且新 profile 的 `dimensions` 与现有 index 不一致时，弹出二次确认对话框；确认后 SHALL 触发全量重建并阻塞检索直到完成。

#### Scenario: 维度不变切换无需重建

- **WHEN** 用户从一个 1536 维 OpenAI profile 切到另一个 1536 维 OpenAI profile
- **THEN** 无需重建，新 profile 立即生效

#### Scenario: 维度变化需确认重建

- **WHEN** 用户从 1536 维 OpenAI 切到 1024 维 Ollama bge-m3
- **THEN** UI 弹出"维度从 1536 → 1024，需重建索引（约 X 分钟）"确认对话框

#### Scenario: 取消重建保留原 profile

- **WHEN** 用户在维度确认对话框中点"取消"
- **THEN** active profile 保持不变，索引正常可用

### Requirement: HuggingFace 镜像默认配置

系统 SHALL 在 Gateway 启动早期执行 `os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")`；用户 SHALL 能通过环境变量预设或 UI 设置覆盖。设置优先级（高 → 低）：环境变量 > settings.json 中 `hf_endpoint` > 默认 `https://hf-mirror.com`。

#### Scenario: 默认走国内镜像

- **WHEN** 用户未设任何 HF 镜像配置即首次下载 local 模型
- **THEN** 下载请求发往 `https://hf-mirror.com`

#### Scenario: 环境变量优先

- **WHEN** 启动 Gateway 前已设 `HF_ENDPOINT=https://huggingface.co`
- **THEN** 系统不覆盖此值，下载走官方源

#### Scenario: UI 可切换镜像

- **WHEN** 用户在 UI 选择"官方"并保存
- **THEN** settings.json 中 `hf_endpoint` 更新；下次启动 Gateway 生效（需重启提示）

### Requirement: Local Provider 模型下载

系统 SHALL 提供 `POST /api/rag/embed/download` 端点，触发后台使用 `huggingface_hub.snapshot_download` 拉取指定模型文件到本地缓存目录（默认 `~/.cache/huggingface/hub`）。下载进度 SHALL 通过 SSE 推送。下载前 SHALL 检查磁盘剩余 ≥ 2 × 模型大小，不足时拒绝并报错。

#### Scenario: 下载进度可被前端订阅

- **WHEN** 用户点击 [下载模型] 并订阅 SSE
- **THEN** UI 显示进度条：`{stage:"download", file, pct, speed_mbps}`

#### Scenario: 磁盘不足拒绝下载

- **WHEN** 剩余磁盘 < 2 × 模型大小
- **THEN** API 返回 507 Insufficient Storage，UI 显示原因

#### Scenario: 断网续传

- **WHEN** 下载中途网络中断后恢复
- **THEN** 系统从已下载部分续传（依赖 huggingface_hub 客户端原生能力），不重头开始

### Requirement: Query 向量缓存

系统 SHALL 在 provider 调用层包装 LRU(2048, TTL 24h) 缓存，key 由 `provider_id + dimensions + sha256(query)` 组成。仅对单条 query 类调用启用；批量索引调用 SHALL 绕过缓存。

#### Scenario: Provider 间缓存隔离

- **WHEN** 同一 query 字符串先用 provider A 调用，再用 provider B 调用
- **THEN** 两次都触发真实嵌入，互不复用缓存条目

#### Scenario: 维度变化使缓存自然失效

- **WHEN** 同 provider 的 `dimensions` 配置从 1536 改为 512
- **THEN** 旧 key 因 dimensions 段不匹配而无法命中，下次调用重新嵌入

#### Scenario: 批量索引不污染缓存

- **WHEN** 索引器对 100 个 chunks 批量嵌入
- **THEN** 缓存中不留下这 100 条 chunk 的条目；缓存仅服务于 query 类调用
