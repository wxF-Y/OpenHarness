import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

interface PathRule {
  pattern: string
  allow: boolean
}

interface PermissionSettings {
  permission_mode: string
  allowed_tools: string[]
  denied_tools: string[]
  path_rules: PathRule[]
  denied_commands: string[]
}

function TagList({
  title,
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string
  items: string[]
  onAdd: (val: string) => void
  onRemove: (idx: number) => void
  placeholder: string
}) {
  const [input, setInput] = useState('')

  const submit = () => {
    const v = input.trim()
    if (v) { onAdd(v); setInput('') }
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ color: '#cdd6f4', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>{title}</div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          style={{ flex: 1, background: '#313244', border: '1px solid #45475a', borderRadius: '4px', color: '#cdd6f4', padding: '0.35rem 0.6rem', fontSize: '0.8125rem', outline: 'none' }}
        />
        <button
          onClick={submit}
          style={{ background: '#89b4fa', border: 'none', borderRadius: '4px', color: '#1e1e2e', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
        >
          添加
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {items.map((item, i) => (
          <span key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#313244', border: '1px solid #45475a', borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: '#cdd6f4' }}>
            <code style={{ color: '#89b4fa' }}>{item}</code>
            <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        {items.length === 0 && <span style={{ color: '#6c7086', fontSize: '0.75rem' }}>（空）</span>}
      </div>
    </div>
  )
}

function PathRuleList({
  rules,
  onAdd,
  onRemove,
}: {
  rules: PathRule[]
  onAdd: (rule: PathRule) => void
  onRemove: (idx: number) => void
}) {
  const [pattern, setPattern] = useState('')
  const [allow, setAllow] = useState(true)

  const submit = () => {
    const p = pattern.trim()
    if (p) { onAdd({ pattern: p, allow }); setPattern('') }
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ color: '#cdd6f4', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>路径规则 (path_rules)</div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <input
          value={pattern}
          onChange={e => setPattern(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="glob 模式，如 ~/.ssh/**"
          style={{ flex: 1, minWidth: '180px', background: '#313244', border: '1px solid #45475a', borderRadius: '4px', color: '#cdd6f4', padding: '0.35rem 0.6rem', fontSize: '0.8125rem', outline: 'none' }}
        />
        <select
          value={allow ? 'allow' : 'deny'}
          onChange={e => setAllow(e.target.value === 'allow')}
          style={{ background: '#313244', border: '1px solid #45475a', borderRadius: '4px', color: '#cdd6f4', padding: '0.35rem 0.5rem', fontSize: '0.8125rem', outline: 'none' }}
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <button
          onClick={submit}
          style={{ background: '#89b4fa', border: 'none', borderRadius: '4px', color: '#1e1e2e', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
        >
          添加
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {rules.map((rule, i) => (
          <div key={`${rule.allow ? 'allow' : 'deny'}:${rule.pattern}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#313244', border: '1px solid #45475a', borderRadius: '4px', padding: '0.3rem 0.6rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: rule.allow ? '#a6e3a1' : '#f38ba8', minWidth: '36px' }}>{rule.allow ? 'allow' : 'deny'}</span>
            <code style={{ flex: 1, color: '#cdd6f4', fontSize: '0.8125rem' }}>{rule.pattern}</code>
            <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}>×</button>
          </div>
        ))}
        {rules.length === 0 && <span style={{ color: '#6c7086', fontSize: '0.75rem' }}>（无规则）</span>}
      </div>
    </div>
  )
}

export default function PermissionsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<PermissionSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [permMode, setPermMode] = useState<string>('default')
  const [permModeSaved, setPermModeSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error('加载失败')
      const data = await res.json()
      setSettings({
        permission_mode: data.permission_mode ?? 'default',
        allowed_tools: data.allowed_tools ?? [],
        denied_tools: data.denied_tools ?? [],
        path_rules: data.path_rules ?? [],
        denied_commands: data.denied_commands ?? [],
      })
      setPermMode(data.permission_mode ?? 'default')
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowed_tools: settings.allowed_tools,
          denied_tools: settings.denied_tools,
          path_rules: settings.path_rules,
          denied_commands: settings.denied_commands,
        }),
      })
      if (!res.ok) throw new Error(`保存失败: ${res.status}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const update = (patch: Partial<PermissionSettings>) =>
    setSettings(prev => prev ? { ...prev, ...patch } : prev)

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

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem', padding: 0 }}
        >
          ← 返回
        </button>
        <span style={{ color: '#cdd6f4', fontWeight: 700 }}>🔐 权限规则</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          {error && !settings && (
            <div style={{ color: '#f38ba8', fontSize: '0.875rem', textAlign: 'center', marginTop: '3rem' }}>{error}</div>
          )}

          {!settings && !error && (
            <div style={{ color: '#6c7086', fontSize: '0.875rem', textAlign: 'center', marginTop: '3rem' }}>加载中…</div>
          )}

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

          {settings && (() => {
            return (
              <>
                {/* 工具白名单 */}
                <TagList
                  title="工具白名单 (allowed_tools)"
                  items={settings.allowed_tools}
                  onAdd={v => update({ allowed_tools: [...settings.allowed_tools, v] })}
                  onRemove={i => update({ allowed_tools: settings.allowed_tools.filter((_, idx) => idx !== i) })}
                  placeholder="工具名，如 bash、read_file"
                />

                {/* 工具黑名单 */}
                <TagList
                  title="工具黑名单 (denied_tools)"
                  items={settings.denied_tools}
                  onAdd={v => update({ denied_tools: [...settings.denied_tools, v] })}
                  onRemove={i => update({ denied_tools: settings.denied_tools.filter((_, idx) => idx !== i) })}
                  placeholder="工具名，如 write_file、edit_file"
                />

                {/* 路径规则 */}
                <PathRuleList
                  rules={settings.path_rules}
                  onAdd={r => update({ path_rules: [...settings.path_rules, r] })}
                  onRemove={i => update({ path_rules: settings.path_rules.filter((_, idx) => idx !== i) })}
                />

                {/* 禁止命令 */}
                <TagList
                  title="禁止命令 (denied_commands)"
                  items={settings.denied_commands}
                  onAdd={v => update({ denied_commands: [...settings.denied_commands, v] })}
                  onRemove={i => update({ denied_commands: settings.denied_commands.filter((_, idx) => idx !== i) })}
                  placeholder="glob 模式，如 rm -rf*、git push --force"
                />

                {/* 操作栏 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid #313244' }}>
                  <button
                    onClick={save}
                    disabled={saving}
                    style={{ background: saving ? '#45475a' : '#89b4fa', border: 'none', borderRadius: '4px', color: '#1e1e2e', padding: '0.5rem 1.25rem', cursor: saving ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 700 }}
                  >
                    {saving ? '保存中…' : '保存规则'}
                  </button>
                  {saved && <span style={{ color: '#a6e3a1', fontSize: '0.8125rem' }}>✓ 已保存</span>}
                  {error && <span style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>{error}</span>}
                  <span style={{ marginLeft: 'auto', color: '#45475a', fontSize: '0.75rem' }}>规则保存到全局 settings.json，新会话生效</span>
                </div>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
