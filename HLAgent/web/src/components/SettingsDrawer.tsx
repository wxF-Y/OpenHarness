import { useEffect, useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'

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

interface Props {
  onClose: () => void
}

export default function SettingsDrawer({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profiles, setProfiles] = useState<Array<{ name: string; label: string; model: string }>>([])
  const [profileSwitched, setProfileSwitched] = useState(false)
  const [profileWarning, setProfileWarning] = useState<string | null>(null)
  const sessionStore = useSessionStore()
  const isBusy = sessionStore.busy
  const sessionId = sessionStore.sessionId

  useEffect(() => {
    setLoadError(false)
    fetch('/api/settings').then((r) => r.json()).then((s) => {
      setSettings(s)
      // 如果有活跃 session，用 session 的 profile 覆盖全局默认
      if (sessionId) {
        fetch(`/api/sessions/${sessionId}/profile`)
          .then((r) => r.ok ? r.json() : Promise.reject())
          .then((data: { active_profile: string }) => {
            if (data.active_profile) {
              setSettings((prev) => prev ? { ...prev, active_profile: data.active_profile } : prev)
            }
          })
          .catch(() => {})
      }
    }).catch(() => setLoadError(true))
  }, [sessionId])

  useEffect(() => {
    fetch('/api/settings/profiles')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: Array<{ name: string; label: string; model: string }>) => setProfiles(data))
      .catch(() => {})
  }, [])

  async function patch(updates: Partial<Settings>) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        // 保存失败：不更新本地状态，下次抽屉打开会重新拉取
        setLoadError(true)
        return
      }
      setSettings((s) => s ? { ...s, ...updates } : s)
    } finally {
      setSaving(false)
    }
  }

  async function switchProfile(profileName: string) {
    if (!sessionId || isBusy) return
    setSaving(true)
    setProfileWarning(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_profile: profileName }),
      })
      if (res.ok) {
        setSettings((s) => s ? { ...s, active_profile: profileName } : s)
        const data = await res.json().catch(() => ({}))
        if (data.warning) {
          setProfileWarning(data.warning)
        } else {
          setProfileSwitched(true)
          setTimeout(() => setProfileSwitched(false), 3000)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ width: '320px', backgroundColor: '#181825', borderLeft: '1px solid #313244', height: '100%', overflowY: 'auto', padding: '1.5rem', color: '#cdd6f4' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <span style={{ fontWeight: 700, color: '#89b4fa' }}>⚙️ 设置</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }}>×</button>
        </div>
        {loadError
          ? <div style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>加载失败，请检查服务是否运行</div>
          : <div style={{ color: '#6c7086', fontSize: '0.8125rem' }}>加载中…</div>
        }
      </div>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ width: '320px', backgroundColor: '#181825', borderLeft: '1px solid #313244', height: '100%', overflowY: 'auto', padding: '1.5rem', color: '#cdd6f4' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <span style={{ fontWeight: 700, color: '#89b4fa' }}>⚙️ 设置</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }}>×</button>
        </div>

        {saving && <div style={{ color: '#f9e2af', fontSize: '0.75rem', marginBottom: '0.5rem' }}>保存中…</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Fast Mode */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Fast Mode ⚡</div>
              <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>缩短响应，减少工具调用</div>
            </div>
            <button
              onClick={() => patch({ fast_mode: !settings.fast_mode })}
              style={{ width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer', backgroundColor: settings.fast_mode ? '#a6e3a1' : '#313244', transition: 'background-color 0.2s', flexShrink: 0 }}
            />
          </div>

          {/* Effort */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>推理强度</label>
            <select
              value={settings.effort}
              onChange={(e) => patch({ effort: e.target.value })}
              style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem', color: '#cdd6f4' }}
            >
              <option value="low">Low — 快速，低强度</option>
              <option value="medium">Medium — 平衡（默认）</option>
              <option value="high">High — 深度推理</option>
            </select>
          </div>

          {/* Output Style */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>输出风格</label>
            <select
              value={settings.output_style}
              onChange={(e) => patch({ output_style: e.target.value })}
              style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem', color: '#cdd6f4' }}
            >
              <option value="default">Default</option>
              <option value="codex">Codex</option>
            </select>
          </div>

          {/* Passes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>推理轮次: {settings.passes}</label>
            <input
              type="range" min={1} max={5} step={1}
              value={settings.passes}
              onChange={(e) => patch({ passes: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: '#89b4fa' }}
            />
          </div>

          {/* Max Turns */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>最大 Agent 轮次: {settings.max_turns}</label>
            <input
              type="range" min={1} max={30} step={1}
              value={settings.max_turns}
              onChange={(e) => patch({ max_turns: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: '#89b4fa' }}
            />
          </div>

          {/* Vim Mode */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Vim 模式</div>
            <button
              onClick={() => patch({ vim_mode: !settings.vim_mode })}
              style={{ width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer', backgroundColor: settings.vim_mode ? '#a6e3a1' : '#313244', transition: 'background-color 0.2s', flexShrink: 0 }}
            />
          </div>

          {/* Voice Mode */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>语音模式</div>
            <button
              onClick={() => patch({ voice_mode: !settings.voice_mode })}
              style={{ width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer', backgroundColor: settings.voice_mode ? '#a6e3a1' : '#313244', transition: 'background-color 0.2s', flexShrink: 0 }}
            />
          </div>

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
                    {p.label}{p.model ? ` · ${p.model.length > 14 ? p.model.slice(0, 14) + '…' : p.model}` : ''}
                  </option>
                ))}
              </select>
              {profileSwitched && (
                <div style={{ fontSize: '0.72rem', color: '#a6e3a1', marginTop: '0.3rem' }}>
                  ✓ 已切换，下条消息起生效
                </div>
              )}
              {profileWarning && (
                <div style={{ fontSize: '0.72rem', color: '#f9e2af', marginTop: '0.3rem' }}>
                  ⚠ {profileWarning}
                </div>
              )}
              <button
                onClick={() => { onClose(); useUiStore.getState().setActiveView('models') }}
                style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.75rem', padding: 0, textAlign: 'left' as const }}
              >
                → 管理全局模型配置
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
