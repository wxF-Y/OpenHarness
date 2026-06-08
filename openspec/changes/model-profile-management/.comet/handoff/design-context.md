# Design Context: model-profile-management

<!-- comet:generated mode=compact change=model-profile-management phase=design date=2026-06-08 -->

## Source Artifacts

| File | SHA256 |
|------|--------|
| openspec/changes/model-profile-management/proposal.md | `61410a93` |
| openspec/changes/model-profile-management/design.md | `2af2d562` |
| openspec/changes/model-profile-management/tasks.md | `db69d81b` |

## Problem Statement
<!-- source: proposal.md lines 1-20 -->

当前 HLAgent Web UI 的模型配置存在四个问题：Session 创建无模型选择、全局只支持单套模型配置、模型配置入口分散、缺少 `anthropic_compat` 格式。后端 `ProviderProfile` 系统已完整，此次主要是前端 UI 补齐 + 后端新增 `anthropic_compat`。

## Architecture Decisions
<!-- source: design.md -->

**前端新增 `ModelsPage`**（全屏独立页，对齐 PermissionsPage 风格）挂在 sidebar "更多工具" section；`AppView` 新增 `'models'`。

**Session Profile 固化**：创建时选 profile → POST 时携带 `active_profile` → session 整个生命周期使用该套配置；空闲时可通过 `PATCH /api/sessions/:id/profile` 切换，`busy=true` 时禁用。

**SettingsDrawer 简化**：删除 model 文本框 + base_url + api_format；改为 profile 只读展示 / 空闲可切换下拉 + 跳转 ModelsPage；"默认权限模式"区域整体迁移到 PermissionsPage。

**`anthropic_compat`（方案B）**：新增 `api_format` 值，语义为兼容 Anthropic 协议的第三方端点，与 `anthropic` 使用相同 API 客户端，base_url 必填。

## Backend New Endpoints
<!-- source: design.md Backend 新增接口 -->

- `PATCH /api/settings/profiles/:name` — 更新 profile（内置只允许 api_key）
- `POST /api/settings/profiles` — 新增自定义 profile
- `DELETE /api/settings/profiles/:name` — 删除自定义 profile（内置 → 403）
- `PATCH /api/sessions/:id/profile` — session 级别切换 profile（busy → 409）
- `GET /api/settings` 增加 `active_profile` 返回字段
- `GET /api/settings/profiles` 增加 `is_builtin: bool` 字段

## Key Constraints
<!-- source: design.md + conversation -->

1. 内置 profile（builtin_provider_profile_names() 集合）仅允许修改 api_key
2. session busy=true 时 PATCH /api/sessions/:id/profile 返回 409
3. anthropic_compat profile 的 base_url 为必填，缺少时保存返回 400
4. CreateSessionModal 不允许新建 profile，只能选择已有的
5. ModelsPage 删除按钮仅对自定义 profile 显示

## Task Summary
<!-- source: tasks.md -->

- B1-B3: 后端（settings.py + routers/settings.py + routers/sessions.py）
- F1-F4: 前端基础（类型、store、sidebar、AppLayout）
- F5-F7: 前端核心（CreateSessionModal、SettingsDrawer、ModelsPage）
- F8: PermissionsPage 接收"默认权限模式"

## Files to Change

### Frontend
- `src/stores/uiStore.ts` — AppView + 'models'
- `src/components/Sidebar.tsx` — 🧩 NavItem
- `src/components/AppLayout.tsx` — 注册 models view
- `src/components/CreateSessionModal.tsx` — profile 下拉
- `src/components/SettingsDrawer.tsx` — 模型区改造 + 权限模式迁移
- `src/pages/ModelsPage.tsx` — **新建**
- `src/pages/PermissionsPage.tsx` — 接收"默认权限模式"
- `src/types/api.ts` — ProfileSummary 接口

### Backend
- `src/openharness/config/settings.py` — anthropic_compat
- `HLAgent/gateway/routers/settings.py` — profiles CRUD
- `HLAgent/gateway/routers/sessions.py` — PATCH /:id/profile
