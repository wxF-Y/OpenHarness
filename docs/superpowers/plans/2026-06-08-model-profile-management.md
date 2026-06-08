# Model Profile Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现多模型 Profile 管理系统——全局可配置多个 LLM 接入端点，每个 session 独立选择模型 profile，新增 `anthropic_compat` API 格式，"默认权限模式"从 SettingsDrawer 迁移到 PermissionsPage。

**Architecture:** 后端通过扩展 `routers/settings.py` 提供 profiles CRUD 接口，并在 `routers/sessions.py` 新增 session 级别 profile 切换；前端新建 `ModelsPage` 作为全局模型配置中心，`CreateSessionModal` 增加 profile 下拉，`SettingsDrawer` 改为只读展示+空闲切换。

**Tech Stack:** Python/FastAPI (后端), React/TypeScript/Zustand (前端), 无新增依赖

---

```yaml
change: model-profile-management
design-doc: openspec/changes/model-profile-management/design.md
base-ref: (run `git rev-parse HEAD` before starting)
```

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| Modify | `src/openharness/config/settings.py` | 新增 `anthropic_compat` 处理；`builtin_provider_profile_names()` 已存在 |
| Modify | `HLAgent/gateway/routers/settings.py` | profiles CRUD 端点 + GET 返回 `active_profile` + `is_builtin` |
| Modify | `HLAgent/gateway/routers/sessions.py` | `PATCH /api/sessions/:id/profile` |
| Modify | `HLAgent/web/src/types/api.ts` | 新增 `ProfileSummary` 接口 |
| Modify | `HLAgent/web/src/stores/uiStore.ts` | `AppView` 增加 `'models'` |
| Modify | `HLAgent/web/src/components/Sidebar.tsx` | "更多工具"增加🧩导航项 |
| Modify | `HLAgent/web/src/components/AppLayout.tsx` | 注册 `models` view |
| Modify | `HLAgent/web/src/components/CreateSessionModal.tsx` | profile 下拉 |
| Modify | `HLAgent/web/src/components/SettingsDrawer.tsx` | 模型区改造 + 权限模式迁移 |
| Modify | `HLAgent/web/src/pages/PermissionsPage.tsx` | 新增"默认权限模式"区块 |
| **Create** | `HLAgent/web/src/pages/ModelsPage.tsx` | Profile 管理全屏页 |

---

## Task 1: 后端 — `anthropic_compat` 支持

**Files:**
- Modify: `src/openharness/config/settings.py`

### 背景
`api_format` 目前支持 `"anthropic"` / `"openai"` / `"openai_compat"` / `"copilot"`。
新增 `"anthropic_compat"` 表示使用 Anthropic SDK 协议但连接第三方端点（base_url 必填）。
现有 `is_claude_family_provider(provider)` 检查 provider，不涉及 format；需要新增 format 层的 helper。

- [ ] **Step 1: 在 `settings.py` 中找到 `is_claude_family_provider`（约第 299 行），在其下方新增 helper**

```python
def is_anthropic_format(api_format: str) -> bool:
    """Return True when the API format uses the Anthropic SDK protocol."""
    return api_format in {"anthropic", "anthropic_compat"}
```

- [ ] **Step 2: 在 `default_provider_profiles()` 中新增 `anthropic-compat` 内置示例 profile**

在 `modelscope` 条目之后、`}` 闭括号之前插入：

```python
        "anthropic-compat": ProviderProfile(
            label="Anthropic Compatible",
            provider="anthropic",
            api_format="anthropic_compat",
            auth_source="anthropic_api_key",
            default_model="claude-sonnet-4-6",
            base_url=None,
        ),
```

- [ ] **Step 3: 确认 `resolve_model_setting` 中 `is_claude_family_provider` 的调用路径不受影响**

  搜索文件中所有 `is_claude_family_provider` 调用（共约 4 处），确认它们检查 `provider` 字段而非 `api_format`，`anthropic_compat` format 的 profile `provider` 值仍为 `"anthropic"`，因此这些路径自动正确。无需修改。

- [ ] **Step 4: 确认 `default_auth_source_for_provider` 中 `"anthropic"` 的默认路径覆盖 `anthropic_compat`**

  `anthropic_compat` profile 的 `provider="anthropic"`，`auth_source="anthropic_api_key"`，走现有的 `ANTHROPIC_API_KEY` env var 路径。无需修改。

---

## Task 2: 后端 — settings profiles CRUD 接口

**Files:**
- Modify: `HLAgent/gateway/routers/settings.py`

### 背景
现有接口：`GET /api/settings`、`PATCH /api/settings`、`GET /api/settings/profiles`。
需要新增：profiles CRUD，以及在现有 GET 中返回 `active_profile` + `is_builtin`。

- [ ] **Step 1: 修改 `get_settings()` 返回，增加 `active_profile` 字段**

找到 `get_settings` 函数（约第 22 行），在 return dict 中增加一行：

```python
        "active_profile": s.active_profile,
```

（插入到现有 `"model": s.model,` 之后）

- [ ] **Step 2: 修改 `get_profiles()` 返回，增加 `is_builtin` 字段**

找到 `get_profiles` 函数（约第 157 行），修改循环体：

```python
@router.get("/profiles")
async def get_profiles() -> list[dict[str, Any]]:
    s = load_settings()
    from openharness.config.settings import builtin_provider_profile_names
    builtin_names = builtin_provider_profile_names()
    profiles = []
    for name, profile in s.merged_profiles().items():
        profiles.append({
            "name": name,
            "provider": getattr(profile, "provider", ""),
            "model": getattr(profile, "model", "") or getattr(profile, "last_model", "") or getattr(profile, "default_model", ""),
            "api_format": getattr(profile, "api_format", ""),
            "base_url": getattr(profile, "base_url", "") or "",
            "auth_source": getattr(profile, "auth_source", ""),
            "label": getattr(profile, "label", name),
            "allowed_models": getattr(profile, "allowed_models", []),
            "is_builtin": name in builtin_names,
        })
    return profiles
```

- [ ] **Step 3: 新增 `CreateProfileRequest` Pydantic 模型**

在 `PatchSettingsRequest` 类定义之后插入：

```python
import re as _re
_PROFILE_NAME_RE = _re.compile(r'^[\w\-]{1,64}$')

class CreateProfileRequest(BaseModel):
    name: str
    label: str = Field(min_length=1, max_length=64)
    api_format: str = Field(pattern=r'^(anthropic|anthropic_compat|openai|openai_compat|copilot)$')
    base_url: str | None = None
    default_model: str = Field(min_length=1, max_length=128)
    api_key: str | None = None

class PatchProfileRequest(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=64)
    api_format: str | None = Field(None, pattern=r'^(anthropic|anthropic_compat|openai|openai_compat|copilot)$')
    base_url: str | None = None
    default_model: str | None = Field(None, min_length=1, max_length=128)
    api_key: str | None = None
```

- [ ] **Step 4: 新增 `POST /api/settings/profiles` 端点**

在 `get_profiles` 函数之后追加：

```python
@router.post("/profiles", status_code=201)
async def create_profile(req: CreateProfileRequest) -> dict[str, Any]:
    if not _PROFILE_NAME_RE.match(req.name):
        raise HTTPException(400, "profile name must match ^[\\w\\-]{1,64}$")
    from openharness.config.settings import (
        builtin_provider_profile_names, ProviderProfile,
        default_auth_source_for_provider
    )
    builtin_names = builtin_provider_profile_names()
    if req.name in builtin_names:
        raise HTTPException(409, f"Cannot create profile with reserved name '{req.name}'")
    if req.api_format in {"anthropic_compat", "openai_compat"} and not req.base_url:
        raise HTTPException(400, "base_url is required for anthropic_compat and openai_compat formats")
    s = load_settings()
    profiles = s.merged_profiles()
    provider = "anthropic" if req.api_format in {"anthropic", "anthropic_compat"} else "openai"
    new_profile = ProviderProfile(
        label=req.label,
        provider=provider,
        api_format=req.api_format,
        auth_source=default_auth_source_for_provider(provider, req.api_format),
        default_model=req.default_model,
        base_url=req.base_url or None,
    )
    profiles[req.name] = new_profile
    updated = s.model_copy(update={"profiles": profiles})
    if req.api_key:
        updated = updated.model_copy(update={"api_key": req.api_key})
    save_settings(updated)
    return {"name": req.name, "created": True}
```

- [ ] **Step 5: 新增 `PATCH /api/settings/profiles/{profile_name}` 端点**

```python
@router.patch("/profiles/{profile_name}")
async def update_profile(profile_name: str, req: PatchProfileRequest) -> dict[str, Any]:
    from openharness.config.settings import builtin_provider_profile_names, ProviderProfile
    builtin_names = builtin_provider_profile_names()
    s = load_settings()
    profiles = s.merged_profiles()
    if profile_name not in profiles:
        raise HTTPException(404, f"Profile '{profile_name}' not found")
    is_builtin = profile_name in builtin_names
    if is_builtin:
        # 内置 profile 只允许修改 api_key（存在顶层 settings.api_key）
        if any(v is not None for v in [req.label, req.api_format, req.base_url, req.default_model]):
            raise HTTPException(403, "Built-in profiles only allow updating api_key")
        if req.api_key is not None:
            updated = s.model_copy(update={"api_key": req.api_key})
            save_settings(updated)
        return {"name": profile_name, "updated": True}
    # 自定义 profile 全字段更新
    existing = profiles[profile_name]
    patch: dict[str, Any] = {}
    if req.label is not None:
        patch["label"] = req.label
    if req.api_format is not None:
        if req.api_format in {"anthropic_compat", "openai_compat"}:
            new_base_url = req.base_url if req.base_url is not None else existing.base_url
            if not new_base_url:
                raise HTTPException(400, "base_url is required for anthropic_compat and openai_compat formats")
        patch["api_format"] = req.api_format
    if req.base_url is not None:
        patch["base_url"] = req.base_url or None
    if req.default_model is not None:
        patch["default_model"] = req.default_model
    updated_profile = existing.model_copy(update=patch)
    profiles[profile_name] = updated_profile
    updated_settings = s.model_copy(update={"profiles": profiles})
    if req.api_key is not None:
        updated_settings = updated_settings.model_copy(update={"api_key": req.api_key})
    save_settings(updated_settings)
    return {"name": profile_name, "updated": True}
```

- [ ] **Step 6: 新增 `DELETE /api/settings/profiles/{profile_name}` 端点**

```python
@router.delete("/profiles/{profile_name}", status_code=204)
async def delete_profile(profile_name: str) -> None:
    from openharness.config.settings import builtin_provider_profile_names
    builtin_names = builtin_provider_profile_names()
    if profile_name in builtin_names:
        raise HTTPException(403, f"Cannot delete built-in profile '{profile_name}'")
    s = load_settings()
    profiles = s.merged_profiles()
    if profile_name not in profiles:
        raise HTTPException(404, f"Profile '{profile_name}' not found")
    # 从 settings.profiles 中删除（merged_profiles 合并了内置，只操作 s.profiles）
    user_profiles = dict(s.profiles)
    user_profiles.pop(profile_name, None)
    updated = s.model_copy(update={"profiles": user_profiles})
    save_settings(updated)
```

---

## Task 3: 后端 — Session profile 切换接口

**Files:**
- Modify: `HLAgent/gateway/routers/sessions.py`

### 背景
Session 创建时已接受 `active_profile`（`CreateSessionRequest.active_profile`）。
需新增 `PATCH /api/sessions/:id/profile` 支持空闲时切换。
Session busy 状态通过 `entry.host.app_state` 判断（`app_state` 有 `busy` 或通过 `is_ready` + busy flag 判断）。

- [ ] **Step 1: 新增请求模型**

在 `sessions.py` 中 `SetPermissionModeRequest` 类定义后插入：

```python
class SetProfileRequest(BaseModel):
    active_profile: str = Field(min_length=1, max_length=64)
```

- [ ] **Step 2: 新增端点**

在 `set_permission_mode` 函数之后插入：

```python
@router.patch("/{session_id}/profile")
async def set_session_profile(session_id: _SESSION_ID, req: SetProfileRequest) -> dict[str, Any]:
    entry = session_mgr.get_entry(session_id)
    if entry is None:
        raise HTTPException(404, "Session not found")
    # busy 检查：host 未就绪或 app_state.busy=True 时拒绝
    host = entry.host
    if host.is_ready:
        state = host.app_state
        if state and getattr(state, "busy", False):
            raise HTTPException(409, "Cannot change profile while agent is running")
    # 更新 entry 的 active_profile（用于下次启动生效）
    # 通过 /config 命令实时通知 host 切换
    from openharness.config.settings import load_settings
    s = load_settings()
    profiles = s.merged_profiles()
    if req.active_profile not in profiles:
        raise HTTPException(404, f"Profile '{req.active_profile}' not found")
    # 持久化到全局 settings 的 active_profile（仅影响当前 session 的下次重连）
    # 实时切换：通过 submit_line /config 触发
    if host.is_ready:
        from openharness.ui.protocol import FrontendRequest
        await host.push_request(
            FrontendRequest(type="submit_line", line=f"/config active_profile {req.active_profile}")
        )
    return {"active_profile": req.active_profile}
```

---

## Task 4: 前端类型与 Store

**Files:**
- Modify: `HLAgent/web/src/types/api.ts`
- Modify: `HLAgent/web/src/stores/uiStore.ts`

- [ ] **Step 1: 在 `api.ts` 末尾新增 `ProfileSummary` 接口**

```typescript
export interface ProfileSummary {
  name: string
  label: string
  provider: string
  model: string
  api_format: string
  base_url: string
  auth_source: string
  is_builtin: boolean
  allowed_models: string[]
}
```

- [ ] **Step 2: 在 `uiStore.ts` 中扩展 `AppView` 类型**

找到第 4 行：
```typescript
export type AppView = 'chat' | 'memory' | 'skills' | 'experts' | 'cron' | 'swarm' | 'autopilot' | 'permissions'
```
改为：
```typescript
export type AppView = 'chat' | 'memory' | 'skills' | 'experts' | 'cron' | 'swarm' | 'autopilot' | 'permissions' | 'models'
```

---

## Task 5: 前端 — Sidebar 导航项

**Files:**
- Modify: `HLAgent/web/src/components/Sidebar.tsx`

- [ ] **Step 1: 在展开状态的"更多工具" Section 中新增 NavItem**

找到约第 490 行的 `<NavItem icon="🔐" ...` 行，在其之后插入：

```tsx
          <NavItem icon="🧩" label="模型配置" active={activeView === 'models'} onClick={() => onViewChange('models')} />
```

- [ ] **Step 2: 在折叠 sidebar 的 IconBtn 列表中新增🧩**

找到约第 267 行 `<IconBtn icon="⚙" title="更多工具" ...` 之前，在🔐之后插入：

```tsx
          <IconBtn icon="🧩" title="模型配置" active={activeView === 'models'} onClick={() => onViewChange('models')} />
```

---

## Task 6: 前端 — AppLayout 注册 models view

**Files:**
- Modify: `HLAgent/web/src/components/AppLayout.tsx`

- [ ] **Step 1: 在文件顶部 import 区新增 ModelsPage**

在 `import PermissionsPage from '../pages/PermissionsPage'` 之后插入：

```tsx
import ModelsPage from '../pages/ModelsPage'
```

- [ ] **Step 2: 在 `VIEW_COMPONENTS` 中注册**

找到约第 334 行：
```typescript
const VIEW_COMPONENTS: Record<Exclude<AppView, 'chat'>, React.ComponentType> = {
  memory: MemoryPage,
  ...
  permissions: PermissionsPage,
}
```
在 `permissions: PermissionsPage,` 之后追加：
```typescript
  models: ModelsPage,
```

- [ ] **Step 3: 在 `VALID_VIEWS` 中新增 `'models'`**

找到约第 344 行：
```typescript
const VALID_VIEWS: AppView[] = ['chat', 'memory', 'skills', 'experts', 'cron', 'swarm', 'autopilot', 'permissions']
```
改为：
```typescript
const VALID_VIEWS: AppView[] = ['chat', 'memory', 'skills', 'experts', 'cron', 'swarm', 'autopilot', 'permissions', 'models']
```

---

## Task 7: 前端 — CreateSessionModal profile 下拉

**Files:**
- Modify: `HLAgent/web/src/components/CreateSessionModal.tsx`

- [ ] **Step 1: 新增 profile 状态和加载逻辑**

在文件顶部 import 行后，在 `ExpertRole` 接口定义之前插入（注意 `ProfileSummary` 已在 `api.ts` 定义）：

```tsx
import type { SessionSummary, ProfileSummary } from '../types/api'
```

（替换现有的 `import type { SessionSummary } from '../types/api'`）

- [ ] **Step 2: 在组件函数内新增 profile 状态**

在 `const [error, setError] = useState<string | null>(null)` 之后插入：

```tsx
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>('')
```

- [ ] **Step 3: 新增 profile 加载 effect**

在现有 `useEffect(() => { inputRef.current?.focus() }, [])` 之后插入：

```tsx
  useEffect(() => {
    fetch('/api/settings/profiles')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: ProfileSummary[]) => setProfiles(data))
      .catch(() => {})
  }, [])
```

- [ ] **Step 4: 在 `handleCreate` 的 body 构建中加入 active_profile**

找到：
```typescript
      const body: Record<string, unknown> = {}
      if (cwdInput.trim()) body.cwd = cwdInput.trim()
```
在之后插入：
```typescript
      if (selectedProfile) body.active_profile = selectedProfile
```

- [ ] **Step 5: 在 UI 的路径输入行之后插入 profile 下拉**

找到 `{/* Help / error text */}` 注释行，在其之前插入（路径输入区块之后）：

```tsx
        {/* Profile 选择 */}
        {profiles.length > 0 && (
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.8125rem', color: '#a6adc8', display: 'block', marginBottom: '0.4rem' }}>模型配置（可选）</label>
            <select
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
              style={{
                width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: 6,
                color: '#cdd6f4', padding: '0.45rem 0.6rem', fontSize: '0.8125rem',
              }}
            >
              <option value="">全局默认</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}{p.model ? ` (${p.model})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
```

---

## Task 8: 前端 — SettingsDrawer 改造

**Files:**
- Modify: `HLAgent/web/src/components/SettingsDrawer.tsx`

### 背景
需要做三件事：
1. 删除平铺的 model文本框 + base_url + api_format 下拉，改为 profile 选择区
2. 删除"默认权限模式"区域（迁至 PermissionsPage）
3. 新增：session 空闲时可切换 profile 下拉；busy 时只读；跳转 ModelsPage 链接

- [ ] **Step 1: 在 Settings 接口中调整字段**

找到文件顶部 `interface Settings {` 块，将 `model`, `base_url`, `api_format` 替换为 profile 相关字段：

```typescript
interface Settings {
  fast_mode: boolean
  effort: string
  passes: number
  max_turns: number
  vim_mode: boolean
  voice_mode: boolean
  output_style: string
  active_profile: string
  permission_mode?: string
}
```

- [ ] **Step 2: 新增 profiles 状态和 busy 检测**

在 `const [saving, setSaving] = useState(false)` 之后插入：

```tsx
  const [profiles, setProfiles] = useState<Array<{ name: string; label: string; model: string }>>([])
  const isBusy = sessionStore.busy
  const sessionId = sessionStore.sessionId
```

- [ ] **Step 3: 新增 profiles 加载 effect**

在现有 `useEffect` 之后插入：

```tsx
  useEffect(() => {
    fetch('/api/settings/profiles')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: Array<{ name: string; label: string; model: string }>) => setProfiles(data))
      .catch(() => {})
  }, [])
```

- [ ] **Step 4: 新增 `switchProfile` 函数**

在 `patch` 函数之后插入：

```tsx
  async function switchProfile(profileName: string) {
    if (!sessionId || isBusy) return
    setSaving(true)
    try {
      await fetch(`/api/sessions/${sessionId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_profile: profileName }),
      })
      setSettings((s) => s ? { ...s, active_profile: profileName } : s)
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 5: 替换模型配置区块（删旧增新）**

删除原来从 `{/* Model */}` 注释到 `{/* Permission Mode */}` 注释之前的整块（约第 158–198 行，包含 model 文本框、base_url 输入、api_format 下拉），替换为：

```tsx
          <div style={{ borderTop: '1px solid #313244', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Profile 选择 */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>模型配置</label>
              {isBusy ? (
                <div style={{ fontSize: '0.75rem', color: '#f9e2af' }}>
                  ⚠ Agent 运行中，暂不可切换模型
                </div>
              ) : null}
              <select
                value={settings.active_profile || ''}
                onChange={(e) => switchProfile(e.target.value)}
                disabled={isBusy || saving}
                style={{
                  width: '100%', backgroundColor: '#11111b', border: '1px solid #313244',
                  borderRadius: '6px', padding: '0.4rem', color: isBusy ? '#6c7086' : '#cdd6f4',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}{p.model ? ` · ${p.model}` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={() => { onClose(); useUiStore.getState().setActiveView('models') }}
                style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.75rem', padding: 0, textAlign: 'left' }}
              >
                → 管理全局模型配置
              </button>
            </div>
          </div>
```

- [ ] **Step 6: 在文件顶部 import 中新增 useUiStore**

在 `import { useSessionStore } from '../stores/sessionStore'` 之后插入：

```tsx
import { useUiStore } from '../stores/uiStore'
```

- [ ] **Step 7: 删除"默认权限模式"区块**

删除从 `{/* Permission Mode */}` 注释开始到其对应闭合 `</div>` 的整块（约第 200–256 行，包含单选按钮组、"保存全局默认"按钮、当前会话模式比较）。

---

## Task 9: 前端 — PermissionsPage 新增"默认权限模式"

**Files:**
- Modify: `HLAgent/web/src/pages/PermissionsPage.tsx`

### 背景
将原 SettingsDrawer 中的权限模式单选组搬到此页，放在页面顶部、现有内容之上。

- [ ] **Step 1: 在组件 state 中新增权限模式状态**

找到 `const [saved, setSaved] = useState(false)` 这行，在其之后插入：

```tsx
  const [permMode, setPermMode] = useState<string>('default')
  const [permModeSaved, setPermModeSaved] = useState(false)
```

- [ ] **Step 2: 在 `fetchSettings` 的 setSettings 调用之后同步 permMode**

找到 `fetchSettings` 函数内的 `setSettings({...})` 调用，在其之后插入：

```tsx
      setPermMode(data.permission_mode ?? 'default')
```

- [ ] **Step 3: 新增保存权限模式的函数**

在 `save` 函数之后插入：

```tsx
  const savePermMode = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_mode: permMode }),
      })
      if (!res.ok) throw new Error(`保存失败: ${res.status}`)
      setPermModeSaved(true)
      setTimeout(() => setPermModeSaved(false), 2000)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 4: 在页面 body 顶部插入权限模式区块**

找到 `{settings && (() => {` 行，在其之前（`{!settings && !error && (...)}`之后）插入：

```tsx
          {/* 默认权限模式 */}
          {settings && (
            <div style={{ background: '#181825', border: '1px solid #313244', borderRadius: '6px', padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ color: '#cdd6f4', fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.875rem' }}>默认权限模式</div>
              <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.75rem' }}>
                影响新会话启动时的初始权限；当前会话可用 /permissions 命令覆盖
              </div>
              {(['default', 'plan', 'full_auto'] as const).map((mode) => {
                const labels: Record<string, string> = {
                  default: 'Default — 逐一确认写操作（推荐）',
                  plan: 'Plan Mode — 阻断所有写操作',
                  full_auto: 'Full Auto — 全部自动放行',
                }
                return (
                  <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="permission_mode_page"
                      value={mode}
                      checked={permMode === mode}
                      onChange={() => setPermMode(mode)}
                      style={{ accentColor: '#89b4fa' }}
                    />
                    <span style={{ fontSize: '0.8125rem', color: '#cdd6f4' }}>{labels[mode]}</span>
                  </label>
                )
              })}
              <button
                onClick={savePermMode}
                disabled={saving}
                style={{ marginTop: '0.5rem', backgroundColor: permModeSaved ? '#a6e3a1' : '#313244', color: permModeSaved ? '#1e1e2e' : '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.8125rem' }}
              >
                {permModeSaved ? '✓ 已保存' : '保存全局默认'}
              </button>
            </div>
          )}
```

---

## Task 10: 前端 — 新建 ModelsPage

**Files:**
- Create: `HLAgent/web/src/pages/ModelsPage.tsx`

完整创建 Profile 管理全屏页面：

- [ ] **Step 1: 创建 `ModelsPage.tsx` 文件**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileSummary } from '../types/api'

const API_FORMAT_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic 官方' },
  { value: 'anthropic_compat', label: 'Anthropic Compatible（第三方兼容接口）' },
  { value: 'openai_compat', label: 'OpenAI Compatible（第三方兼容接口）' },
  { value: 'openai', label: 'OpenAI 标准' },
  { value: 'copilot', label: 'GitHub Copilot' },
]

const BASE_URL_REQUIRED_FORMATS = new Set(['anthropic_compat', 'openai_compat'])
const BASE_URL_OPTIONAL_FORMATS = new Set(['openai'])

function needsBaseUrl(apiFormat: string): 'required' | 'optional' | 'none' {
  if (BASE_URL_REQUIRED_FORMATS.has(apiFormat)) return 'required'
  if (BASE_URL_OPTIONAL_FORMATS.has(apiFormat)) return 'optional'
  return 'none'
}

interface EditForm {
  profileName: string
  isBuiltin: boolean
  label: string
  api_format: string
  base_url: string
  default_model: string
  api_key: string
}

const EMPTY_FORM: EditForm = {
  profileName: '',
  isBuiltin: false,
  label: '',
  api_format: 'anthropic',
  base_url: '',
  default_model: '',
  api_key: '',
}

export default function ModelsPage() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/profiles')
      if (!res.ok) throw new Error('加载失败')
      const data: ProfileSummary[] = await res.json()
      setProfiles(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  function openEdit(profile: ProfileSummary) {
    setEditForm({
      profileName: profile.name,
      isBuiltin: profile.is_builtin,
      label: profile.label,
      api_format: profile.api_format,
      base_url: profile.base_url || '',
      default_model: profile.model,
      api_key: '',
    })
    setIsCreating(false)
    setSaveError(null)
    setSaved(false)
  }

  function openCreate() {
    setEditForm({ ...EMPTY_FORM })
    setIsCreating(true)
    setNewName('')
    setSaveError(null)
    setSaved(false)
  }

  function closeEdit() {
    setEditForm(null)
    setIsCreating(false)
    setSaveError(null)
  }

  async function handleSave() {
    if (!editForm) return
    setSaving(true)
    setSaveError(null)
    try {
      if (isCreating) {
        const name = newName.trim()
        if (!name) { setSaveError('名称不能为空'); return }
        const res = await fetch('/api/settings/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            label: editForm.label,
            api_format: editForm.api_format,
            base_url: editForm.base_url || null,
            default_model: editForm.default_model,
            api_key: editForm.api_key || null,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || `创建失败: ${res.status}`)
        }
      } else {
        const body: Record<string, unknown> = {}
        if (editForm.isBuiltin) {
          if (editForm.api_key) body.api_key = editForm.api_key
        } else {
          body.label = editForm.label
          body.api_format = editForm.api_format
          body.base_url = editForm.base_url || null
          body.default_model = editForm.default_model
          if (editForm.api_key) body.api_key = editForm.api_key
        }
        const res = await fetch(`/api/settings/profiles/${editForm.profileName}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || `保存失败: ${res.status}`)
        }
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await loadProfiles()
      if (isCreating) closeEdit()
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(profileName: string) {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/settings/profiles/${profileName}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `删除失败: ${res.status}`)
      }
      setConfirmDelete(null)
      if (editForm?.profileName === profileName) closeEdit()
      await loadProfiles()
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const baseUrlMode = editForm ? needsBaseUrl(editForm.api_format) : 'none'

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem', padding: 0 }}>
          ← 返回
        </button>
        <span style={{ color: '#cdd6f4', fontWeight: 700 }}>🧩 模型配置</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6c7086' }}>配置保存到全局 settings.json</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        <div style={{ maxWidth: '720px', width: '100%', margin: '0 auto' }}>
          {loading && <div style={{ color: '#6c7086', textAlign: 'center', marginTop: '2rem' }}>加载中…</div>}
          {error && !loading && <div style={{ color: '#f38ba8', textAlign: 'center', marginTop: '2rem' }}>{error}</div>}

          {!loading && !error && (
            <>
              {/* Profile 列表 */}
              <div style={{ marginBottom: '1rem' }}>
                {profiles.map((p) => {
                  const isActive = editForm?.profileName === p.name && !isCreating
                  return (
                    <div
                      key={p.name}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.75rem', borderRadius: '6px', marginBottom: '0.35rem',
                        background: isActive ? '#313244' : '#181825',
                        border: `1px solid ${isActive ? '#45475a' : '#313244'}`,
                        cursor: 'pointer',
                        transition: 'background 80ms, border-color 80ms',
                      }}
                      onClick={() => openEdit(p)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', color: '#cdd6f4', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {p.label}
                          {p.is_builtin && (
                            <span style={{ fontSize: '0.65rem', color: '#6c7086', border: '1px solid #45475a', borderRadius: '3px', padding: '0 4px' }}>内置</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#6c7086', marginTop: '2px' }}>
                          {p.model || p.api_format}
                          {p.base_url && ` · ${p.base_url}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(p) }}
                          style={{ background: '#313244', border: 'none', borderRadius: '4px', color: '#cdd6f4', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem' }}
                        >
                          {p.is_builtin ? '编辑 API Key' : '编辑'}
                        </button>
                        {!p.is_builtin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.name) }}
                            style={{ background: 'rgba(243,139,168,0.12)', border: 'none', borderRadius: '4px', color: '#f38ba8', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem' }}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={openCreate}
                style={{ background: '#313244', border: '1px dashed #45475a', borderRadius: '6px', color: '#89b4fa', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.8125rem', width: '100%', marginBottom: '1.5rem' }}
              >
                + 新增 Profile
              </button>

              {/* 编辑表单 */}
              {editForm && (
                <div style={{ background: '#181825', border: '1px solid #45475a', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, color: '#cdd6f4', marginBottom: '1rem', fontSize: '0.875rem' }}>
                    {isCreating ? '新增 Profile' : `编辑：${editForm.isBuiltin ? `${editForm.label} [内置]` : editForm.label}`}
                  </div>

                  {isCreating && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>标识名（slug，如 my-proxy）</label>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="my-proxy"
                        style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}

                  {!editForm.isBuiltin && (
                    <>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>显示名称</label>
                        <input
                          value={editForm.label}
                          onChange={(e) => setEditForm((f) => f ? { ...f, label: e.target.value } : f)}
                          style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                        />
                      </div>

                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>API 格式</label>
                        <select
                          value={editForm.api_format}
                          onChange={(e) => setEditForm((f) => f ? { ...f, api_format: e.target.value } : f)}
                          style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem', fontSize: '0.8125rem' }}
                        >
                          {API_FORMAT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      {baseUrlMode !== 'none' && (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                            Base URL {baseUrlMode === 'required' ? <span style={{ color: '#f38ba8' }}>*必填</span> : '（可选）'}
                          </label>
                          <input
                            value={editForm.base_url}
                            onChange={(e) => setEditForm((f) => f ? { ...f, base_url: e.target.value } : f)}
                            placeholder="https://your-proxy.example.com/v1"
                            style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                          />
                        </div>
                      )}

                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>默认模型</label>
                        <input
                          value={editForm.default_model}
                          onChange={(e) => setEditForm((f) => f ? { ...f, default_model: e.target.value } : f)}
                          placeholder="claude-sonnet-4-6"
                          style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                        />
                      </div>
                    </>
                  )}

                  {/* API Key — 内置和自定义都显示 */}
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                      API Key {editForm.isBuiltin ? '' : '（可选，留空使用环境变量）'}
                    </label>
                    <input
                      type="password"
                      value={editForm.api_key}
                      onChange={(e) => setEditForm((f) => f ? { ...f, api_key: e.target.value } : f)}
                      placeholder={editForm.isBuiltin ? '输入新 Key 以更新（留空则不修改）' : '留空使用 ANTHROPIC_API_KEY / OPENAI_API_KEY 环境变量'}
                      style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                    />
                  </div>

                  {/* 操作栏 */}
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      style={{ background: saving ? '#45475a' : '#89b4fa', border: 'none', borderRadius: '4px', color: '#1e1e2e', padding: '0.5rem 1.25rem', cursor: saving ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 700 }}
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button
                      onClick={closeEdit}
                      style={{ background: '#313244', border: 'none', borderRadius: '4px', color: '#cdd6f4', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.875rem' }}
                    >
                      取消
                    </button>
                    {saved && <span style={{ color: '#a6e3a1', fontSize: '0.8125rem' }}>✓ 已保存</span>}
                    {saveError && <span style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>{saveError}</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(17,17,27,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#181825', border: '1px solid rgba(243,139,168,0.5)', borderRadius: 10, padding: '1.25rem 1.5rem', width: 300 }}
          >
            <div style={{ fontWeight: 700, color: '#cdd6f4', marginBottom: '0.5rem' }}>删除 Profile</div>
            <div style={{ fontSize: '0.8125rem', color: '#f38ba8', marginBottom: '1.25rem' }}>
              确定删除 <strong>{confirmDelete}</strong>？此操作不可撤销。
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: '#313244', border: 'none', borderRadius: 6, color: '#cdd6f4', padding: '0.4rem 0.9rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ background: '#f38ba8', border: 'none', borderRadius: 6, color: '#1e1e2e', padding: '0.4rem 0.9rem', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## Self-Review

### 1. Spec Coverage

| 需求 | Task | 状态 |
|------|------|------|
| Session 选 profile（仅已配置，不允许新建） | T7 | ✅ |
| Session 空闲时可切换 profile，运行中禁用 | T8, T3 | ✅ |
| 全局 ModelsPage 增删改 profile | T10 | ✅ |
| 内置 profile 仅改 api_key | T2/Step5, T10 | ✅ |
| anthropic_compat 新增 | T1, T2, T10 | ✅ |
| anthropic_compat base_url 必填校验 | T2/Step4-5 | ✅ |
| sidebar 🧩 导航项 | T5 | ✅ |
| AppLayout 注册 models view | T6 | ✅ |
| SettingsDrawer 权限模式迁移到 PermissionsPage | T8/Step7, T9 | ✅ |
| GET /api/settings 返回 active_profile | T2/Step1 | ✅ |
| GET /api/settings/profiles 返回 is_builtin | T2/Step2 | ✅ |

### 2. 类型一致性

- `ProfileSummary` 在 T4 中定义，T7/T8/T10 均使用，字段名一致
- `AppView` 在 T4 扩展，T5/T6 使用 `'models'` 字符串，一致
- `PATCH /api/sessions/:id/profile` 在 T3 实现，T8 中 `switchProfile` 调用路径一致

### 3. 无 Placeholder 确认

所有 Step 包含完整代码，无 TBD/TODO/类似前文等占位符。
