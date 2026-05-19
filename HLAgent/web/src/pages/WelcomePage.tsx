import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface SessionSummary {
  session_id: string
  cwd?: string
  model?: string
  ready?: boolean
}

export default function WelcomePage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.ok ? r.json() : [])
      .then(setSessions)
      .catch(() => setSessions([]))
  }, [])

  async function startNew() {
    setCreating(true)
    try {
      const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const { session_id } = await r.json()
      navigate(`/chat/${session_id}`)
    } catch {
      setCreating(false)
    }
  }

  const features = [
    { icon: '💬', title: 'AI 对话', desc: '与 Agent 自然对话，执行复杂编码任务' },
    { icon: '🧠', title: '持久记忆', desc: '项目知识跨会话持久化' },
    { icon: '⏰', title: '定时任务', desc: 'Cron 任务，Agent 定时自动执行' },
    { icon: '🤝', title: 'Swarm 协作', desc: '多 Agent 团队并行协作' },
    { icon: '✅', title: '任务追踪', desc: '实时查看所有后台任务状态' },
    { icon: '⚡', title: '技能库', desc: '可复用 Agent 技能快速扩展' },
  ]

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>⚡</div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, color: '#89b4fa', margin: '0 0 0.5rem' }}>HLAgent</h1>
        <p style={{ color: '#a6adc8', margin: 0 }}>现代 AI Agent Web 平台</p>
      </div>

      <button
        onClick={startNew}
        disabled={creating}
        style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.6 : 1, marginBottom: '2.5rem' }}
      >
        {creating ? '创建中…' : '开始新对话 →'}
      </button>

      {sessions.length > 0 && (
        <div style={{ width: '100%', maxWidth: '36rem', marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.5rem', fontWeight: 600 }}>
            本次启动的活跃会话
          </div>
          <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', overflow: 'hidden' }}>
            {sessions.slice(0, 5).map((s, i) => (
              <button
                key={s.session_id}
                onClick={() => navigate(`/chat/${s.session_id}`)}
                style={{ width: '100%', textAlign: 'left', padding: '0.75rem 1rem', background: 'none', border: 'none', borderBottom: i < Math.min(sessions.length, 5) - 1 ? '1px solid #313244' : 'none', cursor: 'pointer', color: '#cdd6f4', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
              >
                <span style={{ color: s.ready ? '#89b4fa' : '#6c7086' }}>💬</span>
                <div>
                  <div style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {s.session_id.slice(0, 12)}…
                    {!s.ready && <span style={{ fontSize: '0.7rem', color: '#6c7086' }}>(未就绪)</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>
                    {s.model || 'claude'} · {s.cwd || '.'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', width: '100%', maxWidth: '40rem', marginBottom: '2rem' }}>
        {features.map((f) => (
          <div key={f.title} style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{f.icon}</div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>{f.title}</div>
            <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem' }}>
        {[['Cron', '/cron'], ['Swarm', '/swarm'], ['专家库', '/experts'], ['Memory', '/memory'], ['Skills', '/skills'], ['权限规则', '/permissions-settings']].map(([l, p]) => (
          <button key={l} onClick={() => navigate(p)} style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer' }}>{l}</button>
        ))}
      </div>
    </div>
  )
}

