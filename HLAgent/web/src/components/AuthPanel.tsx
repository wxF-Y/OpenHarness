import { useEffect, useState } from 'react'

interface AuthStatus {
  auth_status: string
  active_profile: string
  providers: Record<string, { configured: boolean; source: string; active: boolean }>
}

interface Props {
  onClose: () => void
}

export default function AuthPanel({ onClose }: Props) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then(setStatus).catch(() => {})
  }, [])

  async function save() {
    if (!apiKey.trim()) return
    setSaving(true); setError(''); setSaved(false)
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey }),
    })
    setSaving(false)
    if (r.ok) {
      setSaved(true)
      fetch('/api/auth/status').then((r) => r.json()).then(setStatus)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError('保存失败')
    }
  }

  async function clear() {
    await fetch('/api/auth', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
    fetch('/api/auth/status').then((r) => r.json()).then(setStatus)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '10px', padding: '1.5rem', maxWidth: '420px', width: '90%', color: '#cdd6f4' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <span style={{ fontWeight: 700, color: '#89b4fa' }}>🔑 API Key 配置</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }}>×</button>
        </div>

        {status && (
          <div style={{ backgroundColor: '#11111b', borderRadius: '8px', padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.8125rem' }}>
            <span style={{ color: '#6c7086' }}>当前状态: </span>
            <span style={{ color: status.auth_status === 'configured' ? '#a6e3a1' : '#f38ba8' }}>{status.auth_status}</span>
            <span style={{ color: '#6c7086', marginLeft: '0.5rem' }}>· {status.active_profile}</span>
          </div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.25rem' }}>Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', boxSizing: 'border-box' }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="moonshot">Moonshot</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.25rem' }}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
            style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', boxSizing: 'border-box', fontFamily: 'monospace' }}
            placeholder="sk-ant-…"
          />
        </div>

        {error && <div style={{ color: '#f38ba8', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>{error}</div>}
        {saved && <div style={{ color: '#a6e3a1', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>✓ 已保存</div>}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={save} disabled={saving || !apiKey.trim()} style={{ flex: 2, backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem', fontWeight: 600, cursor: saving || !apiKey.trim() ? 'not-allowed' : 'pointer', opacity: saving || !apiKey.trim() ? 0.6 : 1 }}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={clear} style={{ flex: 1, backgroundColor: '#313244', color: '#f38ba8', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: 'pointer' }}>清除</button>
          <button onClick={onClose} style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: 'pointer' }}>关闭</button>
        </div>
      </div>
    </div>
  )
}
