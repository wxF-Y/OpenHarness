# Proposal: 模型 Profile 管理与 Session 级模型选择

## 问题背景

当前 HLAgent Web UI 的模型配置存在以下问题：

1. **Session 创建时无法选择模型**：`CreateSessionModal` 不提供模型选择，每个 session 始终使用全局默认配置。
2. **全局配置只支持单套模型**：`SettingsDrawer` 仅有平铺的 `model`/`base_url`/`api_format` 输入框，无法管理多个模型接入配置。
3. **模型配置入口分散**：模型相关设置混在 `SettingsDrawer` 中，没有独立管理界面。
4. **缺少 Anthropic Compatible 格式**：当前 `api_format` 只有 `anthropic`（官方）/ `openai_compat` / `openai`，无法区分"兼容 Anthropic 协议的第三方端点"（如代理、私有部署）与官方直连。

后端 `ProviderProfile` 系统（`settings.py`）已经完整支持多 profile 管理，`GET /api/settings/profiles` 接口已存在，`POST /api/sessions` 已接受 `active_profile` 参数——此次改动主要是**前端 UI 补齐** + **后端新增 `anthropic_compat` 格式支持**。

## 目标

1. Session 创建时从全局已配置的 profile 列表中选择模型，不允许在创建弹窗内新建 profile。
2. 每个 session 在创建时固化自己的模型配置（profile），agent loop 未运行时可切换，运行中不允许修改。
3. 全局配置新增独立的"模型配置"页（`ModelsPage`），支持对 profile 进行完整 CRUD（内置 profile 仅允许修改 API Key）。
4. 在 `api_format` 中新增 `anthropic_compat` 值，表示兼容 Anthropic 协议的第三方端点（需填 base_url）。
5. `SettingsDrawer` 中的模型配置区域改为只读展示，引导用户去 `ModelsPage` 管理。
6. 左侧 sidebar "更多工具" section 新增"🧩 模型配置"导航项。

## 范围

### 包含
- 前端：`CreateSessionModal` 增加 profile 下拉选择
- 前端：新建 `ModelsPage`（独立全屏页）
- 前端：`Sidebar` 增加 `models` 导航项
- 前端：`AppLayout` 注册 `models` view
- 前端：`uiStore` `AppView` 类型新增 `'models'`
- 前端：`SettingsDrawer` 模型区改为只读 + 跳转链接（保留运行中禁用/空闲可切换的逻辑）
- 前端：新增 `PATCH /api/settings/profiles` 接口调用（新增/更新 profile）
- 前端：新增 `DELETE /api/settings/profiles/:name` 接口调用（删除自定义 profile）
- 后端：`settings.py` `api_format` 新增 `anthropic_compat` 值及对应处理
- 后端：`settings.py` `GET /api/settings` 返回 `active_profile` 字段
- 后端：`routers/settings.py` 新增 `PATCH /api/settings/profiles/:name` 端点
- 后端：`routers/settings.py` 新增 `DELETE /api/settings/profiles/:name` 端点（仅限非内置 profile）
- 后端：`SettingsDrawer` 需要的 session 级别 profile 切换（`PATCH /api/sessions/:id/profile`）

### 不包含
- API Key 的 keyring 存储 UI（本期只存文件，keyring 集成留后续）
- Profile 的 `allowed_models` 列表管理
- Profile 导入/导出
