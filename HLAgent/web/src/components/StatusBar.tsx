import { useEffect, useState } from 'react'
import { useSessionStore, type WsStatus } from '../stores/sessionStore'
import { useSwarmStore } from '../stores/swarmStore'
import type { FrontendRequest } from '../types/protocol'

function dot(status: WsStatus) {
  const colors: Record<WsStatus, string> = {
    ready: '#a6e3a1',
    connecting: '#f9e2af',
    disconnected: '#f38ba8',
    terminated: '#6c7086',
  }
  return <span style={{ color: colors[status] }}>●</span>
}

interface PermBadgeProps {
  mode: string
  canClick: boolean
  onClick: () => void
}

function PermBadge({ mode, canClick, onClick }: PermBadgeProps) {
  const isPlan = mode === 'plan' || mode === 'Plan Mode'
  const isAuto = mode === 'full_auto' || mode === 'Auto'

  const label = isPlan ? 'PLAN' : isAuto ? 'auto' : 'default'
  const color = isPlan ? '#f9e2af' : isAuto ? '#a6e3a1' : '#6c7086'
  const bg = isPlan ? '#f9e2af' : 'transparent'
  const textColor = isPlan ? '#1e1e2e' : color

  return (
    <span
      onClick={canClick ? onClick : undefined}
      title={canClick ? '点击切换权限模式' : undefined}
      style={{
        backgroundColor: bg,
        color: textColor,
        padding: '0 0.3rem',
        borderRadius: '3px',
        fontWeight: isPlan ? 700 : undefined,
        cursor: canClick ? 'pointer' : 'default',
        border: !isPlan ? `1px solid ${color}33` : 'none',
        fontSize: '0.65rem',
        userSelect: 'none',
      }}
    >
      {label}
    </span>
  )
}

export default function StatusBar({
  onReconnect,
  sendRequest,
}: {
  onReconnect?: () => void
  sendRequest?: (req: FrontendRequest) => void
}) {
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
  const isReady = store.wsStatus === 'ready'

  function handlePermClick() {
    if (!isReady || !sendRequest) return
    sendRequest({ type: 'select_command', command: 'permissions' })
  }

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

      {/* Permission mode badge — only when WS session active */}
      {isReady && (
        <PermBadge
          mode={store.planMode}
          canClick={isReady && !!sendRequest}
          onClick={handlePermClick}
        />
      )}

      {/* Plan mode flash on exit */}
      {planFlash && !isPlan && (
        <span style={{ color: '#a6e3a1', fontWeight: 700, fontSize: '0.65rem' }}>PLAN OFF</span>
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

