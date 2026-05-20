import { useEffect, useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import type { AppView } from '../stores/uiStore'

interface SessionSummary {
  session_id: string
  model?: string
  cwd?: string
  ready?: boolean
  created_at?: number
  title?: string
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function sessionLabel(s: SessionSummary, index: number): string {
  if (s.title?.trim()) return s.title.trim()
  const time = s.created_at ? relativeTime(s.created_at) : null
  if (time) return time
  return `对话 #${index + 1}`
}

const PULSE_STYLE = `
@keyframes hlagent-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`

function Section({
  title,
  defaultOpen = true,
  forceOpen,
  onOpen,
  badge,
  children,
}: {
  title: string
  defaultOpen?: boolean
  forceOpen?: boolean
  onOpen?: () => void
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isOpen = forceOpen !== undefined ? forceOpen : open
  const [hover, setHover] = useState(false)

  function toggle() {
    if (forceOpen !== undefined) {
      onOpen?.()
    } else {
      setOpen((o) => !o)
    }
  }

  return (
    <div style={{ marginTop: '0.125rem' }}>
      <button
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          color: hover ? '#cdd6f4' : '#6c7086',
          fontSize: '0.65rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          padding: '0.45rem 0.75rem 0.3rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: hover ? '#252535' : 'transparent',
          transition: 'color 80ms ease-out, background-color 80ms ease-out',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {title}
          {badge}
        </span>
        <span style={{
          width: '16px',
          height: '16px',
          borderRadius: '4px',
          backgroundColor: hover ? '#313244' : '#1e1e2e',
          border: '1px solid #313244',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background-color 80ms ease-out',
        }}>
          <svg
            width="8" height="8" viewBox="0 0 8 8"
            style={{
              transition: 'transform 150ms ease-out',
              transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          >
            <path d="M1 2.5L4 5.5L7 2.5" stroke={hover ? '#89b4fa' : '#6c7086'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div style={{ paddingBottom: '0.25rem' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        borderLeft: active ? '2px solid #89b4fa' : hover ? '2px solid #45475a' : '2px solid transparent',
        color: active ? '#cdd6f4' : hover ? '#cdd6f4' : '#a6adc8',
        backgroundColor: active ? '#45475a' : hover ? '#2a2a3d' : 'transparent',
        padding: '0.3rem 0.75rem 0.3rem calc(0.75rem - 2px)',
        cursor: 'pointer',
        fontSize: '0.8125rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        transition: 'background-color 80ms ease-out, color 80ms ease-out, border-color 80ms ease-out',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

interface Props {
  collapsed: boolean
  onToggle: () => void
  activeView: AppView
  onViewChange: (view: AppView) => void
  onSelectSession: (sessionId: string) => void
  onNewSession: () => Promise<unknown>
  activeChatSessionId: string | null
}

export default function Sidebar({
  collapsed,
  onToggle,
  activeView,
  onViewChange,
  onSelectSession,
  onNewSession,
  activeChatSessionId,
}: Props) {
  const sessionStore = useSessionStore()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newSessionId, setNewSessionId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  async function handleDeleteSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation()
    setDeletingId(sessionId)
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId))
    } finally {
      setDeletingId(null)
    }
  }

  const isBusy = sessionStore.busy

  // Update current session's title from the first user transcript message
  useEffect(() => {
    if (!activeChatSessionId) return
    const firstUserMsg = sessionStore.transcript.find((t) => t.role === 'user')
    if (!firstUserMsg?.text?.trim()) return
    const title = firstUserMsg.text.trim().slice(0, 40)
    setSessions((prev) => prev.map((s) =>
      s.session_id === activeChatSessionId && !s.title ? { ...s, title } : s
    ))
  }, [activeChatSessionId, sessionStore.transcript.length])

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { setSessions(data); setSessionsLoading(false) })
      .catch(() => { setSessionsError(true); setSessionsLoading(false) })
  }, [])

  async function handleNewSession() {
    setCreating(true)
    try {
      const body = await onNewSession() as SessionSummary
      const sid = body?.session_id
      if (sid) {
        setSessions((prev) => [body, ...prev])
        setNewSessionId(sid)
        setTimeout(() => setNewSessionId(null), 1200)
      }
    } finally {
      setCreating(false)
    }
  }

  // Collapsed icon-only sidebar
  if (collapsed) {
    return (
      <div style={{
        width: '48px',
        backgroundColor: '#181825',
        borderRight: '1px solid #313244',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0.5rem 0',
        gap: '4px',
        flexShrink: 0,
      }}>
        <style>{PULSE_STYLE}</style>
        <IconBtn icon="≡" title="展开侧边栏" onClick={onToggle} />
        <IconBtn icon="＋" title="新建对话" onClick={handleNewSession} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', paddingTop: '0.25rem' }}>
          <IconBtn icon="🧠" title="Memory" active={activeView === 'memory'} onClick={() => onViewChange('memory')} />
          <IconBtn icon="⚡" title="Skills" active={activeView === 'skills'} onClick={() => onViewChange('skills')} />
          <IconBtn icon="🎭" title="专家库" active={activeView === 'experts'} onClick={() => onViewChange('experts')} />
          <IconBtn
            icon="⚙"
            title="更多工具"
            onClick={() => { onToggle(); setAdvancedOpen(true) }}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{
      width: '220px',
      backgroundColor: '#181825',
      borderRight: '1px solid #313244',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      <style>{PULSE_STYLE}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem 0.5rem', borderBottom: '1px solid #313244', flexShrink: 0 }}>
        <span style={{ color: '#cdd6f4', fontWeight: 700, fontSize: '0.875rem', letterSpacing: '-0.01em' }}>
          <span style={{ color: '#89b4fa' }}>⚡</span> HLAgent
        </span>
        <button
          onClick={onToggle}
          title="折叠侧边栏"
          style={{
            background: 'none',
            border: '1px solid #313244',
            borderRadius: '5px',
            color: '#6c7086',
            cursor: 'pointer',
            padding: '0.2rem 0.35rem',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '1px',
          }}
          onMouseEnter={(e) => { (e.currentTarget.style.borderColor = '#45475a'); (e.currentTarget.style.color = '#a6adc8') }}
          onMouseLeave={(e) => { (e.currentTarget.style.borderColor = '#313244'); (e.currentTarget.style.color = '#6c7086') }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M7.5 2L4 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4.5 2L1 6L4.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.8125rem', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 对话 section */}
        <Section
          title="对话"
          badge={isBusy
            ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#a6e3a1', display: 'inline-block', animation: 'hlagent-pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
            : null
          }
        >
          {/* New session button */}
          <div style={{ padding: '0.3rem 0.75rem 0.2rem' }}>
            <button
              onClick={handleNewSession}
              disabled={creating}
              style={{
                width: '100%',
                textAlign: 'left',
                border: '1px solid #313244',
                borderRadius: '5px',
                backgroundColor: 'transparent',
                color: creating ? '#6c7086' : '#89b4fa',
                padding: '0.3rem 0.6rem',
                cursor: creating ? 'not-allowed' : 'pointer',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <span>{creating ? '⟳' : '＋'}</span>
              <span>{creating ? '创建中…' : '新建对话'}</span>
            </button>
          </div>

          {/* Session list */}
          {sessionsLoading && (
            <div style={{ padding: '0.2rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: '24px', backgroundColor: '#313244', borderRadius: '4px', opacity: 0.4 }} />
              ))}
            </div>
          )}
          {!sessionsLoading && !sessionsError && sessions.length === 0 && (
            <div style={{ padding: '0.25rem 0.75rem 0.3rem 1rem', color: '#6c7086', fontSize: '0.72rem' }}>暂无历史对话</div>
          )}
          {!sessionsLoading && sessions.slice(0, 10).map((s, i) => {
            const isActive = s.session_id === activeChatSessionId
            const isNew = s.session_id === newSessionId
            const isHovered = hoveredSessionId === s.session_id
            const isDeleting = deletingId === s.session_id
            return (
              <div
                key={s.session_id}
                onMouseEnter={() => setHoveredSessionId(s.session_id)}
                onMouseLeave={() => setHoveredSessionId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderLeft: isActive ? '2px solid #89b4fa' : isHovered ? '2px solid #45475a' : '2px solid transparent',
                  backgroundColor: isNew ? '#f9e2af22' : isActive ? '#45475a' : isHovered ? '#2a2a3d' : 'transparent',
                  transition: 'background-color 80ms ease-out, border-color 80ms ease-out',
                }}
              >
                <button
                  onClick={() => onSelectSession(s.session_id)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    color: isActive ? '#cdd6f4' : isHovered ? '#cdd6f4' : '#7f849c',
                    padding: '0.2rem 0.25rem 0.2rem calc(1rem - 2px)',
                    cursor: 'pointer',
                    fontSize: '0.72rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {sessionLabel(s, i)}
                </button>
                <button
                  onClick={(e) => handleDeleteSession(e, s.session_id)}
                  disabled={isDeleting}
                  title="删除会话"
                  style={{
                    flexShrink: 0,
                    background: 'none',
                    border: 'none',
                    color: '#6c7086',
                    cursor: isDeleting ? 'not-allowed' : 'pointer',
                    padding: '0.2rem 0.5rem 0.2rem 0.25rem',
                    fontSize: '0.7rem',
                    opacity: isHovered || isDeleting ? 1 : 0,
                    transition: 'opacity 100ms ease-out',
                    lineHeight: 1,
                  }}
                >
                  {isDeleting ? '⟳' : '×'}
                </button>
              </div>
            )
          })}
        </Section>

        {/* 分隔线 */}
        <div style={{ height: '1px', backgroundColor: '#313244', margin: '0.25rem 0.75rem' }} />

        {/* 助手工具 section */}
        <Section title="助手工具">
          <NavItem icon="🧠" label="Memory" active={activeView === 'memory'} onClick={() => onViewChange('memory')} />
          <NavItem icon="⚡" label="Skills" active={activeView === 'skills'} onClick={() => onViewChange('skills')} />
          <NavItem icon="🎭" label="专家库" active={activeView === 'experts'} onClick={() => onViewChange('experts')} />
        </Section>

        {/* 分隔线 */}
        <div style={{ height: '1px', backgroundColor: '#313244', margin: '0.25rem 0.75rem' }} />

        {/* 更多工具 section — expanded by default */}
        <Section
          title="更多工具"
          defaultOpen={true}
          forceOpen={advancedOpen || undefined}
          onOpen={() => setAdvancedOpen((o) => !o)}
        >
          <NavItem icon="⏰" label="Cron 定时任务" active={activeView === 'cron'} onClick={() => onViewChange('cron')} />
          <NavItem icon="🤝" label="Swarm 协作" active={activeView === 'swarm'} onClick={() => onViewChange('swarm')} />
          <NavItem icon="🚀" label="Autopilot" active={activeView === 'autopilot'} onClick={() => onViewChange('autopilot')} />
          <NavItem icon="🔐" label="权限设置" active={activeView === 'permissions'} onClick={() => onViewChange('permissions')} />
        </Section>
      </div>
    </div>
  )
}

function IconBtn({
  icon,
  title,
  active,
  onClick,
}: {
  icon: string
  title: string
  active?: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        background: 'none',
        border: 'none',
        color: active ? '#89b4fa' : hover ? '#cdd6f4' : '#6c7086',
        backgroundColor: active ? '#313244' : hover ? '#2a2a3d' : 'transparent',
        cursor: 'pointer',
        fontSize: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 80ms ease-out, color 80ms ease-out',
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  )
}
