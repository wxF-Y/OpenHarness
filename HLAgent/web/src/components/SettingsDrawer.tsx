import { useEffect, useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'

interface Settings {
  fast_mode: boolean
  effort: string
  passes: number
  max_turns: number
  vim_mode: boolean
  voice_mode: boolean
  output_style: string
  model: string
  base_url?: string
  api_format?: string
  permission_mode?: string
}

interface Props {
  onClose: () => void
}

export default function SettingsDrawer({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [permMode, setPermMode] = useState<string>('default')
  const [permSaved, setPermSaved] = useState(false)
  const sessionStore = useSessionStore()
  const currentSessionMode = sessionStore.wsStatus === 'ready' ? sessionStore.planMode : null

  useEffect(() => {
    setLoadError(false)
    fetch('/api/settings').then((r) => r.json()).then((s) => {
      setSettings(s)
      setPermMode(s.permission_mode || 'default')
    }).catch(() => setLoadError(true))
  }, [])

  async function patch(updates: Partial<Settings>) {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      setSettings((s) => s ? { ...s, ...updates } : s)
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
            {/* Model */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>模型名称</label>
              <input
                type="text"
                defaultValue={settings.model || ''}
                onBlur={(e) => { if (e.target.value !== settings.model) patch({ model: e.target.value }) }}
                placeholder="gpt-4o / mimo-v2.5-pro / claude-sonnet-4-6"
                style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', boxSizing: 'border-box', fontSize: '0.8125rem' }}
              />
            </div>

            {/* Base URL */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>Base URL（第三方接口）</label>
              <input
                type="text"
                defaultValue={settings.base_url || ''}
                onBlur={(e) => { if (e.target.value !== (settings.base_url || '')) patch({ base_url: e.target.value } as never) }}
                placeholder="留空使用默认（Anthropic/OpenAI 官方）"
                style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', boxSizing: 'border-box', fontSize: '0.8125rem' }}
              />
            </div>

            {/* API Format */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>API 格式</label>
              <select
                value={settings.api_format || 'anthropic'}
                onChange={(e) => patch({ api_format: e.target.value } as never)}
                style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem', color: '#cdd6f4' }}
              >
                <option value="anthropic">Anthropic（Claude 官方）</option>
                <option value="openai_compat">OpenAI Compatible（第三方兼容接口）</option>
                <option value="openai">OpenAI（OpenAI 标准）</option>
              </select>
              <div style={{ fontSize: '0.7rem', color: '#f9e2af', marginTop: '0.2rem' }}>
                ⚠️ 小米 Mimo / DeepSeek 等第三方 API 请选 OpenAI Compatible
              </div>
            </div>

            {/* Permission Mode */}
            <div style={{ borderTop: '1px solid #313244', paddingTop: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                默认权限模式
              </label>
              <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.5rem' }}>
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
                      name="permission_mode"
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
                onClick={async () => {
                  setSaving(true)
                  try {
                    await fetch('/api/settings', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ permission_mode: permMode }),
                    })
                    setSettings((s) => s ? { ...s, permission_mode: permMode } : s)
                    setPermSaved(true)
                    setTimeout(() => setPermSaved(false), 2000)
                  } finally {
                    setSaving(false)
                  }
                }}
                disabled={saving}
                style={{ marginTop: '0.5rem', backgroundColor: permSaved ? '#a6e3a1' : '#313244', color: permSaved ? '#1e1e2e' : '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', width: '100%' }}
              >
                {permSaved ? '✓ 已保存' : '保存全局默认'}
              </button>

              {/* Current session mode comparison */}
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6c7086' }}>
                {currentSessionMode
                  ? `当前会话模式: ${currentSessionMode}${currentSessionMode !== permMode ? `（与全局默认 ${permMode} 不同）` : ''}`
                  : '暂无活跃会话'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
