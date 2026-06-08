# Design: 模型 Profile 管理与 Session 级模型选择

## 架构概览

```
┌────────────────────────────────────────────────────────────────┐
│                    前端变更全景                                  │
└────────────────────────────────────────────────────────────────┘

uiStore.AppView 新增 'models'
  ↓
Sidebar "更多工具" section
  ⏰ Cron 定时任务
  🤝 Swarm 协作
  🔐 权限设置
  🧩 模型配置  ← 新增 NavItem，onClick → setActiveView('models')

AppLayout VIEW_COMPONENTS 注册 models: ModelsPage
AppLayout VALID_VIEWS 新增 'models'

CreateSessionModal
  从 GET /api/settings/profiles 加载 profile 列表
  下拉选择（留空 = 全局默认）
  POST /api/sessions { active_profile: "moonshot" | undefined }

SettingsDrawer 模型区（运行中禁用，空闲可切换）
  删除：model文本框 + base_url输入 + api_format下拉
  新增：当前 session profile 显示（只读 or 下拉切换）
        [→ 管理模型配置] 按钮跳转 ModelsPage

ModelsPage（全新页面，对齐 PermissionsPage 风格）
  Profile 列表
  Profile 编辑表单（内置仅改 api_key，自定义全字段）
  新增 / 删除（仅限自定义）
```

## 数据流

### Session 创建时模型选择

```
用户点击"新建对话"
  → CreateSessionModal 挂载
  → useEffect: GET /api/settings/profiles
  → 渲染下拉：
      [全局默认 (claude-sonnet-4-6 · Anthropic 官方)]
      [Moonshot Kimi (kimi-k2.5)]
      [Claude 订阅 (claude-opus-4-6)]
      ...
  → 用户选择后 POST /api/sessions { active_profile: "moonshot" }
  → session 固化该 profile
```

### Session 中切换 Profile（空闲时）

```
SettingsDrawer 挂载（空闲状态，busy=false）
  → GET /api/settings/profiles + GET /api/sessions/:id 获取当前 profile
  → 渲染 profile 下拉（可编辑）
  → 用户切换 → PATCH /api/sessions/:id/profile { active_profile: "..." }

SettingsDrawer 挂载（运行中，busy=true）
  → profile 下拉 disabled，显示 "Agent 运行中，暂不可切换"
```

### ModelsPage Profile CRUD

```
加载：GET /api/settings/profiles → 列表
      其中内置 profile（builtin_names 集合中的）标记为 [内置]

编辑内置 profile：
  仅显示 api_key 输入框
  PATCH /api/settings/profiles/:name { api_key: "sk-..." }

编辑自定义 profile（全字段）：
  label / api_format / base_url / default_model / api_key
  PATCH /api/settings/profiles/:name { ...全字段 }

新增 profile：
  空表单 → POST /api/settings/profiles { name, ...字段 }

删除（仅自定义）：
  DELETE /api/settings/profiles/:name
  内置 profile 无删除按钮
```

## 后端新增接口

### GET /api/settings 变更
在已有返回中增加 `active_profile` 字段。

### GET /api/settings/profiles（已存在）
返回格式保持不变，增加 `is_builtin: bool` 字段。

### PATCH /api/settings/profiles/:name
```python
class PatchProfileRequest(BaseModel):
    label: str | None = None
    api_format: str | None = None   # 含新值 "anthropic_compat"
    base_url: str | None = None
    default_model: str | None = None
    api_key: str | None = None      # 存入 settings 的 api_key 或 profile credential_slot
```
内置 profile 只允许 `api_key` 字段，其余返回 400。

### POST /api/settings/profiles
```python
class CreateProfileRequest(BaseModel):
    name: str                        # slug，校验 ^[\w\-]{1,64}$
    label: str
    api_format: str                  # anthropic | anthropic_compat | openai | openai_compat | copilot
    base_url: str | None = None
    default_model: str
    api_key: str | None = None
```
名称与内置 profile 重复返回 409。

### DELETE /api/settings/profiles/:name
内置 profile 返回 403。

### PATCH /api/sessions/:id/profile（新增）
```python
class SetProfileRequest(BaseModel):
    active_profile: str
```
仅在 session 非 busy 时允许，busy 时返回 409。

## api_format: anthropic_compat

### 语义
- `anthropic`：调用官方 Anthropic API（base_url 留空或使用官方域名）
- `anthropic_compat`：调用兼容 Anthropic SDK 协议的第三方端点（base_url 必填）
  - 场景：自建代理、AWS Bedrock Anthropic 格式、私有部署
  - 与 `anthropic` 的区别：允许任意 base_url，不做官方域名校验

### 后端处理（settings.py）
`is_anthropic_compat(api_format)` → 判断 `api_format in {"anthropic", "anthropic_compat"}`  
现有的 `is_claude_family_provider` 逻辑不变，`anthropic_compat` 走相同的 API 客户端路径，仅 base_url 来源不同。

### UI 区分
ModelsPage 编辑表单：
```
API 格式:  [▼ Anthropic Compatible (第三方兼容接口)]
            Anthropic 官方
            Anthropic Compatible ← 新增
            OpenAI Compatible
            OpenAI 标准
            GitHub Copilot
Base URL:  [必填，第三方端点地址]  ← 仅 anthropic_compat / openai_compat 时显示
```

## SettingsDrawer 简化后结构

```
⚙️ 设置
─────────────────────────────
Fast Mode ⚡
推理强度
输出风格
推理轮次
最大 Agent 轮次
Vim 模式
语音模式
─────────────────────────────
模型配置
  当前 Profile: Moonshot Kimi (kimi-k2.5)   ← 运行中只读
  [▼ 切换 Profile]                           ← 空闲时可选下拉
  [→ 管理全局模型配置]                        ← 跳转 ModelsPage
─────────────────────────────
（"默认权限模式"区域已迁移至 PermissionsPage，此处删除）
```

## PermissionsPage 变更

"默认权限模式"块从 `SettingsDrawer` 迁移到 `PermissionsPage` 顶部：

```
← 返回    🔐 权限规则

┌─ 默认权限模式 ──────────────────────────────────────────┐
│  ○ Default — 逐一确认写操作（推荐）                      │
│  ○ Plan Mode — 阻断所有写操作                            │
│  ○ Full Auto — 全部自动放行                              │
│                              [保存全局默认]              │
│  影响新会话启动时的初始权限；当前会话可用 /permissions 覆盖│
└─────────────────────────────────────────────────────────┘

工具白名单 ...（原有内容）
```

## ModelsPage 布局（参考 PermissionsPage 风格）

```
← 返回    🧩 模型配置

┌─ Profile 列表 ──────────────────────────────────────────────┐
│  ● Anthropic 官方     claude-sonnet-4-6  [内置] [编辑API Key]│
│    Claude 订阅        claude-opus-4-6   [内置] [编辑API Key] │
│    Moonshot Kimi      kimi-k2.5         [内置] [编辑API Key] │
│  ✦ 我的代理           claude-3-7-sonnet [自定义][编辑][删除] │
└─────────────────────────────────────────────────────────────┘
                                              [+ 新增 Profile]

当选中一个 profile 时，右侧或下方展开编辑表单：
  内置：仅显示 API Key 输入框 + 保存
  自定义：全字段 + 保存 + 删除
```

## 文件变更清单

### 前端
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/stores/uiStore.ts` | Edit | `AppView` 增加 `'models'` |
| `src/components/Sidebar.tsx` | Edit | "更多工具"增加🧩导航项 |
| `src/components/AppLayout.tsx` | Edit | 注册 `models` view |
| `src/components/CreateSessionModal.tsx` | Edit | 增加 profile 下拉 |
| `src/components/SettingsDrawer.tsx` | Edit | 模型区改为 profile 切换（含 busy 锁） |
| `src/pages/ModelsPage.tsx` | Create | 全新 Profile 管理页 |

### 后端（HLAgent Gateway）
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `gateway/routers/settings.py` | Edit | 新增 profiles CRUD 端点；GET返回`active_profile`+`is_builtin` |
| `gateway/routers/sessions.py` | Edit | 新增 `PATCH /:id/profile` 端点 |
| `src/openharness/config/settings.py` | Edit | 新增 `anthropic_compat` 支持 |

### 类型
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/types/api.ts` | Edit | 新增 `ProfileSummary` 接口 |
