import { useState } from 'react'
import { useSwarmStore } from '../stores/swarmStore'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m${s}s`
}

const STATUS_ICON: Record<string, string> = {
  running: '🟢',
  idle: '🟡',
  done: '✅',
  error: '🔴',
}

export default function SwarmPanel() {
  const { teammates, notifications } = useSwarmStore()
  const [collapsed, setCollapsed] = useState(false)

  if (teammates.length === 0 && notifications.length === 0) return null

  const activeCount = teammates.filter((t) => t.status === 'running').length

  if (collapsed) {
    return (
      <div style={{ padding: '0.35rem 0.75rem', borderTop: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
        <span style={{ color: '#89dceb' }}>⚡</span>
        <span style={{ color: '#6c7086' }}>Swarm: {teammates.length} agents ({activeCount} active)</span>
        <button onClick={() => setCollapsed(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.7rem' }}>展开</button>
      </div>
    )
  }

  return (
    <div style={{ borderTop: '1px solid #313244', fontSize: '0.8125rem' }}>
      <div style={{ padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ color: '#89dceb' }}>⚡</span>
        <span style={{ fontWeight: 600, color: '#cdd6f4', fontSize: '0.75rem' }}>Swarm</span>
        <span style={{ color: '#6c7086', fontSize: '0.7rem' }}>({activeCount}/{teammates.length})</span>
        <button onClick={() => setCollapsed(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.7rem' }}>折叠</button>
      </div>

      {teammates.map((t) => (
        <div key={t.name} style={{ padding: '0.25rem 0.75rem', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
          <span style={{ flexShrink: 0 }}>{STATUS_ICON[t.status] || '⬛'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline' }}>
              <span style={{ color: t.status === 'running' ? '#a6e3a1' : t.status === 'error' ? '#f38ba8' : '#cdd6f4', fontWeight: 600 }}>{t.name}</span>
              {t.duration !== undefined && (
                <span style={{ color: '#6c7086', fontSize: '0.7rem' }}>{formatDuration(t.duration)}</span>
              )}
            </div>
            {t.task && (
              <div style={{ color: '#6c7086', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.task.slice(0, 60)}{t.task.length > 60 ? '…' : ''}
              </div>
            )}
          </div>
        </div>
      ))}

      {notifications.length > 0 && (
        <div style={{ borderTop: '1px solid #1e1e2e', padding: '0.25rem 0.75rem' }}>
          <div style={{ color: '#6c7086', fontSize: '0.7rem', marginBottom: '0.2rem' }}>通知</div>
          {notifications.slice(-3).map((n, i) => (
            <div key={i} style={{ fontSize: '0.75rem', color: '#a6adc8', marginBottom: '0.1rem' }}>
              <span style={{ color: '#6c7086' }}>[{n.from}] </span>
              {n.message.slice(0, 70)}{n.message.length > 70 ? '…' : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
