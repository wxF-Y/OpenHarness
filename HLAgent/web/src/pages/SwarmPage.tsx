import { useEffect, useState } from 'react'
import MDRenderer from '../components/MDRenderer'

interface TeamSummary {
  name: string
  description: string
  member_count: number
  lead_agent_id?: string
}

interface Member {
  agent_id: string
  name: string
  status?: string
  agent_type?: string
  model?: string
  color?: string
  session_id?: string
  worktree_path?: string
  plan_mode_required?: boolean
}

interface MailboxMsg {
  id: string
  type: string
  sender: string
  payload: Record<string, unknown>
  timestamp: number
  read: boolean
}

const STATUS_ICON: Record<string, string> = {
  active: '🟢',
  idle: '🟡',
  stopped: '⬛',
  running: '🟢',
  done: '✅',
  error: '🔴',
}

export default function SwarmPage() {
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [members, setMembers] = useState<Record<string, Member>>({})
  const [selectedMember, setSelectedMember] = useState<string | null>(null)
  const [view, setView] = useState<'transcript' | 'mailbox'>('transcript')
  const [transcript, setTranscript] = useState<string>('')
  const [mailbox, setMailbox] = useState<MailboxMsg[]>([])
  const [msgText, setMsgText] = useState('')

  useEffect(() => {
    fetch('/api/swarm/teams').then((r) => r.json()).then(setTeams).catch(() => {})
  }, [])

  async function selectTeam(name: string) {
    setSelectedTeam(name)
    setSelectedMember(null)
    const r = await fetch(`/api/swarm/teams/${encodeURIComponent(name)}`)
    const data = await r.json()
    setMembers(data.members || {})
  }

  async function selectMember(agentId: string) {
    setSelectedMember(agentId)
    loadTranscript(agentId)
    loadMailbox(agentId)
  }

  async function loadTranscript(agentId: string) {
    try {
      const r = await fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/transcript`)
      if (r.ok) { const d = await r.json(); setTranscript(d.transcript || '') }
      else setTranscript('')
    } catch { setTranscript('') }
  }

  async function loadMailbox(agentId: string) {
    try {
      const r = await fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/messages?unread_only=false`)
      if (r.ok) setMailbox(await r.json())
    } catch { setMailbox([]) }
  }

  async function sendMessage(agentId: string) {
    if (!msgText.trim()) return
    await fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msgText, sender: 'leader' }),
    })
    setMsgText('')
    loadMailbox(agentId)
  }

  async function approvePermission(agentId: string, requestId: string, approved: boolean) {
    await fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/permission-response`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, approved }),
    })
    loadMailbox(agentId)
  }

  const MSG_ICON: Record<string, string> = {
    user_message: '✉️',
    permission_request: '⚠️',
    permission_response: '✅',
    sandbox_permission_request: '🌐',
    shutdown: '🔴',
    idle_notification: '🟡',
  }

  return (
    <div style={{ height: '100vh', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#89dceb', fontWeight: 700 }}>🤝 Swarm Teams</span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Team list */}
        <div style={{ width: '180px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#6c7086', fontWeight: 700, textTransform: 'uppercase' }}>Teams</div>
          {teams.map((t) => (
            <div
              key={t.name}
              onClick={() => selectTeam(t.name)}
              style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', backgroundColor: selectedTeam === t.name ? '#313244' : 'transparent', borderBottom: '1px solid #1e1e2e' }}
            >
              <div style={{ fontSize: '0.8125rem', color: selectedTeam === t.name ? '#89b4fa' : '#cdd6f4' }}>{t.name}</div>
              <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{t.member_count} members</div>
            </div>
          ))}
          {teams.length === 0 && <div style={{ padding: '0.75rem', color: '#6c7086', fontSize: '0.75rem', textAlign: 'center' }}>无团队</div>}
        </div>

        {/* Members grid */}
        <div style={{ width: '260px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0, padding: '0.5rem' }}>
          {!selectedTeam && <div style={{ padding: '1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>选择团队</div>}
          {Object.values(members).map((m) => (
            <div
              key={m.agent_id}
              onClick={() => selectMember(m.agent_id)}
              style={{ marginBottom: '0.5rem', padding: '0.6rem', borderRadius: '8px', cursor: 'pointer', backgroundColor: selectedMember === m.agent_id ? '#313244' : '#181825', border: `2px solid ${selectedMember === m.agent_id ? '#89b4fa' : '#313244'}`, borderLeft: `4px solid ${m.color || '#45475a'}` }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                <span>{STATUS_ICON[m.status || 'idle'] || '⬛'}</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{m.name}</span>
              </div>
              {m.agent_type && <div style={{ fontSize: '0.7rem', color: '#89b4fa' }}>{m.agent_type}</div>}
              {m.model && <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{m.model}</div>}
              {m.plan_mode_required && <div style={{ fontSize: '0.7rem', color: '#f9e2af' }}>📋 Plan Mode</div>}
              {m.worktree_path && <div style={{ fontSize: '0.7rem', color: '#a6e3a1' }}>🌿 {m.worktree_path.split('/').pop()}</div>}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedMember && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7086', fontSize: '0.875rem' }}>选择 Agent 查看详情</div>}
          {selectedMember && (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid #313244', flexShrink: 0 }}>
                <button onClick={() => setView('transcript')} style={{ backgroundColor: view === 'transcript' ? '#313244' : 'none', border: 'none', color: view === 'transcript' ? '#89b4fa' : '#6c7086', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}>📋 Transcript</button>
                <button onClick={() => setView('mailbox')} style={{ backgroundColor: view === 'mailbox' ? '#313244' : 'none', border: 'none', color: view === 'mailbox' ? '#89b4fa' : '#6c7086', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}>
                  📬 Mailbox{mailbox.filter((m) => !m.read).length > 0 && <span style={{ backgroundColor: '#f38ba8', color: '#1e1e2e', borderRadius: '10px', padding: '0 0.3rem', marginLeft: '0.3rem', fontSize: '0.7rem' }}>{mailbox.filter((m) => !m.read).length}</span>}
                </button>
              </div>

              <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
                {view === 'transcript' && (
                  transcript ? <MDRenderer content={transcript} compact /> : <div style={{ color: '#6c7086', fontSize: '0.875rem' }}>暂无对话记录</div>
                )}
                {view === 'mailbox' && (
                  <div>
                    {mailbox.map((msg) => (
                      <div key={msg.id} style={{ marginBottom: '0.5rem', padding: '0.5rem 0.75rem', backgroundColor: '#181825', borderRadius: '6px', border: `1px solid ${msg.read ? '#313244' : '#45475a'}`, fontWeight: msg.read ? 400 : 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                          <span>{MSG_ICON[msg.type] || '📨'}</span>
                          <span style={{ fontSize: '0.75rem', color: '#89b4fa' }}>{msg.sender}</span>
                          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#6c7086' }}>{new Date(msg.timestamp * 1000).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: '#a6adc8' }}>
                          {msg.type === 'user_message' && String(msg.payload.text || '').slice(0, 200)}
                          {msg.type === 'permission_request' && (
                            <div>
                              <div>🔧 {String(msg.payload.tool_name || '')} — {String(msg.payload.description || '').slice(0, 100)}</div>
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                                <button onClick={() => approvePermission(selectedMember, String(msg.payload.request_id), true)} style={{ backgroundColor: '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>批准</button>
                                <button onClick={() => approvePermission(selectedMember, String(msg.payload.request_id), false)} style={{ backgroundColor: '#f38ba8', color: '#1e1e2e', border: 'none', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>拒绝</button>
                              </div>
                            </div>
                          )}
                          {msg.type === 'idle_notification' && String(msg.payload.summary || '')}
                          {msg.type === 'shutdown' && '🔴 关闭请求'}
                        </div>
                      </div>
                    ))}
                    {mailbox.length === 0 && <div style={{ color: '#6c7086', fontSize: '0.875rem' }}>邮箱为空</div>}
                  </div>
                )}
              </div>

              {/* Message input */}
              <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #313244', display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <input
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage(selectedMember)}
                  placeholder="发消息给 Agent…"
                  style={{ flex: 1, backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', fontSize: '0.8125rem' }}
                />
                <button onClick={() => sendMessage(selectedMember)} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}>发送</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

