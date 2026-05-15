import { useEffect, useState } from 'react'
import { useSessionStore, type WsStatus } from '../stores/sessionStore'
import { useSwarmStore } from '../stores/swarmStore'

function dot(status: WsStatus) {
  const colors: Record<WsStatus, string> = {
    ready: '#a6e3a1',
    connecting: '#f9e2af',
    disconnected: '#f38ba8',
    terminated: '#6c7086',
  }
  return <span style={{ color: colors[status] }}>●</span>
}

export default function StatusBar({ onReconnect }: { onReconnect?: () => void }) {
  const store = useSessionStore()
  const { unreadCount } = useSwarmStore()
  const state = store.appState
  const [planFlash, setPlanFlash] = useState(false)

  useEffect(() => {
    if (store.planMode !== 'plan' && store.planMode !== 'Plan Mode') {
      setPlanFlash(true)
      const t = setTimeout(() => setPlanFlash(false), 800)
      return () => clearTimeout(t)
    }
  }, [store.planMode])

  const isPlan = store.planMode === 'plan' || store.planMode === 'Plan Mode'
  const isFast = state?.fast_mode
  const mcpConnected = state?.mcp_connected ?? 0
  const mcpFailed = state?.mcp_failed ?? 0
  const model = state?.model || ''

  return (
    <div style={{
      height: '32px', display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0 0.75rem', backgroundColor: '#11111b', borderTop: '1px solid #313244',
      fontSize: '0.7rem', color: '#6c7086', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Connection status */}
      <span title={store.wsStatus}>{dot(store.wsStatus)}</span>

      {/* Model */}
      {model && <span style={{ color: '#a6adc8' }}>{model}</span>}

      {/* Plan mode */}
      {isPlan && (
        <span style={{ backgroundColor: '#f9e2af', color: '#1e1e2e', padding: '0 0.3rem', borderRadius: '3px', fontWeight: 700 }}>PLAN</span>
      )}
      {planFlash && !isPlan && (
        <span style={{ color: '#a6e3a1', fontWeight: 700 }}>PLAN OFF</span>
      )}

      {/* Fast mode */}
      {isFast && <span style={{ color: '#f9e2af' }}>⚡fast</span>}

      {/* MCP */}
      {mcpConnected > 0 && (
        <span title={`${mcpConnected} connected${mcpFailed > 0 ? `, ${mcpFailed} failed` : ''}`}>
          MCP:{mcpConnected}
          {mcpFailed > 0 && <span style={{ color: '#f38ba8' }}>+{mcpFailed}✗</span>}
        </span>
      )}

      {/* Swarm badge */}
      {unreadCount > 0 && (
        <span style={{ color: '#89dceb' }}>🔔{unreadCount}</span>
      )}

      {/* Reconnect button */}
      {store.wsStatus === 'disconnected' && onReconnect && (
        <button onClick={onReconnect} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #313244', color: '#89b4fa', padding: '0.1rem 0.4rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}>
          重连
        </button>
      )}

      {store.wsStatus === 'terminated' && (
        <span style={{ marginLeft: 'auto', color: '#6c7086' }}>会话已结束</span>
      )}
    </div>
  )
}
