import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/sessionStore'

interface SessionSummary {
  session_id: string
  model?: string
  cwd?: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ marginBottom: '0.25rem' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#6c7086', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0.35rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        {title}
        <span style={{ fontSize: '0.6rem' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </div>
  )
}

interface Props {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  const navigate = useNavigate()
  const store = useSessionStore()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const state = store.appState

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.ok ? r.json() : [])
      .then(setSessions)
      .catch(() => {})
  }, [])

  if (collapsed) {
    return (
      <div style={{ width: '48px', backgroundColor: '#181825', borderRight: '1px solid #313244', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.5rem 0', gap: '0.75rem', flexShrink: 0 }}>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '1rem' }} title="展开侧边栏">≡</button>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }} title="首页">🏠</button>
        <button onClick={() => navigate('/cron')} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }} title="Cron">⏰</button>
        <button onClick={() => navigate('/swarm')} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }} title="Swarm">🤝</button>
        <button onClick={() => navigate('/memory')} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }} title="Memory">🧠</button>
        <button onClick={() => navigate('/skills')} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem' }} title="Skills">⚡</button>
      </div>
    )
  }

  return (
    <div style={{ width: '220px', backgroundColor: '#181825', borderRight: '1px solid #313244', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderBottom: '1px solid #313244' }}>
        <span style={{ color: '#89b4fa', fontWeight: 700, fontSize: '0.875rem' }}>⚡ HLAgent</span>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.875rem' }}>←</button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.8125rem' }}>
        {/* Status section */}
        {state && (
          <Section title="Status">
            <div style={{ padding: '0.25rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', color: '#a6adc8', fontSize: '0.75rem' }}>
              <div><span style={{ color: '#6c7086' }}>model: </span>{state.model}</div>
              <div><span style={{ color: '#6c7086' }}>cwd: </span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{state.cwd}</span></div>
              <div><span style={{ color: '#6c7086' }}>auth: </span>{state.auth_status}</div>
              <div><span style={{ color: '#6c7086' }}>mode: </span>{state.permission_mode}</div>
              {state.vim_enabled && <div style={{ color: '#f9e2af' }}>vim enabled</div>}
              {state.fast_mode && <div style={{ color: '#f9e2af' }}>⚡ fast mode</div>}
            </div>
          </Section>
        )}

        {/* Sessions section */}
        <Section title="Sessions">
          <div>
            <button
              onClick={() => navigate('/')}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#89b4fa', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              + 新建对话
            </button>
            {sessions.slice(0, 8).map((s) => (
              <button
                key={s.session_id}
                onClick={() => navigate(`/chat/${s.session_id}`)}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: store.sessionId === s.session_id ? '#89b4fa' : '#a6adc8', padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {s.session_id.slice(0, 12)}…
              </button>
            ))}
          </div>
        </Section>

        {/* MCP section */}
        {store.mcpServers.length > 0 && (
          <Section title="MCP">
            <div style={{ padding: '0 0.75rem' }}>
              {store.mcpServers.slice(0, 5).map((s) => (
                <div key={s.name} style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                  <span style={{ color: s.state === 'connected' ? '#a6e3a1' : '#f38ba8' }}>●</span>
                  <span style={{ color: '#a6adc8', marginLeft: '0.3rem' }}>{s.name}</span>
                  <span style={{ color: '#6c7086', marginLeft: '0.3rem' }}>{s.tool_count}t</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Bridge section */}
        {store.bridgeSessions.length > 0 && (
          <Section title="Bridge">
            <div style={{ padding: '0 0.75rem' }}>
              {store.bridgeSessions.slice(0, 4).map((s) => (
                <div key={s.session_id} style={{ fontSize: '0.75rem', color: '#a6adc8', marginBottom: '0.2rem' }}>
                  {s.session_id.slice(0, 8)} [{s.status}]
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Navigation */}
        <Section title="Pages">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
            {[
              ['⏰ Cron', '/cron'],
              ['🤝 Swarm', '/swarm'],
              ['🧠 Memory', '/memory'],
              ['⚡ Skills', '/skills'],
              ['🚀 Autopilot', '/autopilot'],
            ].map(([label, path]) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#a6adc8', padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
