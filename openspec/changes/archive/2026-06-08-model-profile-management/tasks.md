# Tasks: 模型 Profile 管理与 Session 级模型选择

## 后端

- [x] **B1** `src/openharness/config/settings.py`：新增 `anthropic_compat` 处理
  - `is_anthropic_family_format(api_format)` helper：`api_format in {"anthropic", "anthropic_compat"}`
  - `anthropic_compat` 使用与 `anthropic` 相同的 API 客户端，不做官方域名校验
  - `default_provider_profiles()` 中注释标记哪些是内置 profile

- [x] **B2** `gateway/routers/settings.py`：完善 profiles 相关接口
  - `GET /api/settings` 返回增加 `active_profile` 字段
  - `GET /api/settings/profiles` 返回每个 profile 增加 `is_builtin: bool` 字段
  - `POST /api/settings/profiles` 新增 profile（名称不能与内置重复）
  - `PATCH /api/settings/profiles/:name` 更新 profile（内置只允许 `api_key`）
  - `DELETE /api/settings/profiles/:name` 删除 profile（内置返回 403）

- [x] **B3** `gateway/routers/sessions.py`：新增 `PATCH /api/sessions/:id/profile`
  - 请求体：`{ active_profile: str }`
  - session busy 时返回 409
  - 更新 session 的 active_profile（通过 session_mgr）

## 前端基础

- [x] **F1** `src/types/api.ts`：新增 `ProfileSummary` 接口
  ```typescript
  interface ProfileSummary {
    name: string
    label: string
    provider: string
    model: string
    api_format: string
    base_url?: string
    is_builtin: boolean
    allowed_models: string[]
  }
  ```

- [x] **F2** `src/stores/uiStore.ts`：`AppView` 类型增加 `'models'`

- [x] **F3** `src/components/Sidebar.tsx`：
  - "更多工具" section 增加 `<NavItem icon="🧩" label="模型配置" active={activeView === 'models'} onClick={() => onViewChange('models')} />`
  - 折叠 sidebar 的 IconBtn 区域同步增加 🧩 图标

- [x] **F4** `src/components/AppLayout.tsx`：
  - `VIEW_COMPONENTS` 注册 `models: ModelsPage`
  - `VALID_VIEWS` 增加 `'models'`
  - 导入 `ModelsPage`

## 前端核心功能

- [x] **F5** `src/components/CreateSessionModal.tsx`：增加 profile 下拉选择
  - 挂载时 `GET /api/settings/profiles` 加载列表
  - 下拉选项：`[全局默认]` + 各 profile（显示 `label (model)`）
  - 创建时传 `active_profile`（选"全局默认"时不传该字段）
  - 加载失败时隐藏下拉（降级为无 profile 选择）

- [x] **F6** `src/components/SettingsDrawer.tsx`：模型区改造
  - 删除现有 model文本框 + base_url输入 + api_format下拉
  - 新增：显示当前 session 的 active profile（profile label + model）
  - 新增：profile 切换下拉
    - `busy=true`：disabled，提示"Agent 运行中，暂不可切换"
    - `busy=false`：可选，选择后调用 `PATCH /api/sessions/:id/profile`
  - 新增：`[→ 管理模型配置]` 按钮，点击关闭 Drawer 并 `setActiveView('models')`

- [x] **F7** `src/pages/ModelsPage.tsx`：新建 Profile 管理页
  - 页面结构对齐 `PermissionsPage`（顶部 header + 滚动 body）
  - Profile 列表展示（内置标记 [内置]）
  - 内置 profile 编辑：仅显示 API Key 输入框
  - 自定义 profile 编辑：全字段（label / api_format / base_url / default_model / api_key）
  - api_format 下拉包含 `anthropic_compat` 选项
  - base_url 仅在 `anthropic_compat` / `openai_compat` / `openai` 时显示（anthropic 官方不需要）
  - 新增 profile 按钮：展开空表单
  - 删除按钮：仅自定义 profile 显示，需确认对话

## 前端连线

- [x] **F8** `src/components/SettingsDrawer.tsx`：将"默认权限模式"区域迁移到 `PermissionsPage`
  - SettingsDrawer 中删除权限模式单选组 + "保存全局默认"按钮
  - PermissionsPage 顶部增加"默认权限模式"设置块（从 SettingsDrawer 搬过来的内容）

## 验收标准

- [x] 新建 session 弹窗有 profile 下拉，选择后 session 使用对应模型
- [x] session 空闲时 SettingsDrawer 可切换 profile，运行中 disabled
- [x] ModelsPage 可对自定义 profile 进行增删改，内置 profile 只能改 api_key
- [x] ModelsPage profile 编辑表单中 `api_format` 有 `Anthropic Compatible` 选项
- [x] `anthropic_compat` format 的 profile 必须填 base_url，否则保存时报错
- [x] 左侧 sidebar "更多工具"出现🧩导航项，可进入 ModelsPage
- [x] SettingsDrawer 中无模型文本框，有 profile 切换下拉和跳转链接
- [x] SettingsDrawer 中无"默认权限模式"区域，该内容移至 PermissionsPage
