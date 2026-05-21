import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import TranscriptViewer from '../components/TranscriptViewer'
import MessageInput from '../components/MessageInput'
import StatusBar from '../components/StatusBar'
import PermissionModal from '../components/PermissionModal'
import QuestionModal from '../components/QuestionModal'
import SelectModal from '../components/SelectModal'
import CompactProgressBar from '../components/CompactProgressBar'
import ErrorToastContainer from '../components/ErrorToast'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const store = useSessionStore()
  const ui = useUiStore()
  const { sendRequest } = useWebSocket(sessionId || null)

  const prefill = searchParams.get('prefill') ?? ''
  const autosubmit = searchParams.get('autosubmit') === '1'

  const ALLOWED_BACK_PATHS = ['/', '/experts', '/swarm'] as const
  const rawFrom = searchParams.get('from') ?? '/'
  const fromPath = (ALLOWED_BACK_PATHS as readonly string[]).includes(rawFrom) ? rawFrom : '/'
  const backLabel = fromPath === '/experts' ? '← 专家库' : fromPath === '/swarm' ? '← Swarm' : '← 首页'

  // For autosubmit: store pending command, fire when WS becomes ready
  const [pendingAutosubmit, setPendingAutosubmit] = useState<string | null>(
    autosubmit && prefill ? prefill : null,
  )

  useEffect(() => {
    if (sessionId) {
      const s = useSessionStore.getState()
      if (s.sessionId !== sessionId) {
        s.reset()
      } else if (s.wsStatus === 'terminated') {
        s.setWsStatus('disconnected')
      }
      s.setSessionId(sessionId)
    }
  }, [sessionId])

  // Fire autosubmit when WS is ready; clear immediately to prevent re-fire on reconnect
  useEffect(() => {
    if (store.wsStatus === 'ready' && pendingAutosubmit) {
      sendRequest({ type: 'submit_line', line: pendingAutosubmit })
      store.setBusy(true)
      setPendingAutosubmit(null)
    }
  }, [store.wsStatus, pendingAutosubmit, sendRequest])

  if (!sessionId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6c7086' }}>
        无效会话。<button onClick={() => navigate('/')} style={{ marginLeft: '0.5rem', color: '#89b4fa', background: 'none', border: 'none', cursor: 'pointer' }}>返回</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#1e1e2e' }}>
      {/* Top bar */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <button onClick={() => navigate(fromPath)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.875rem' }}>{backLabel}</button>
        <span style={{ color: '#45475a' }}>|</span>
        <span style={{ fontSize: '0.8125rem', color: '#a6adc8' }}>
          {store.appState?.model || 'HLAgent'} · {sessionId.slice(0, 8)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: store.wsStatus === 'ready' ? '#a6e3a1' : store.wsStatus === 'terminated' ? '#6c7086' : '#f9e2af' }}>
          {store.wsStatus === 'ready' ? '● 已连接' : store.wsStatus === 'connecting' ? '⟳ 连接中' : store.wsStatus === 'terminated' ? '● 已结束' : '● 已断开'}
        </span>
      </div>

      {/* Compact progress bar */}
      <CompactProgressBar phase={ui.compactPhase} />

      {/* Transcript */}
      <TranscriptViewer items={store.transcript} assistantBuffer={store.assistantBuffer} />

      {/* Input — pass prefill only when NOT autosubmit */}
      <MessageInput
        busy={store.busy}
        commands={store.commands}
        sendRequest={(req) => {
          if (req.type === 'submit_line') store.setBusy(true)
          sendRequest(req)
        }}
        wsStatus={store.wsStatus}
        initialValue={!autosubmit && prefill ? prefill : undefined}
      />

      {/* Status bar */}
      <StatusBar sendRequest={sendRequest} />

      {/* Modals */}
      {ui.activeModal?.kind === 'permission' && (
        <PermissionModal
          toolName={ui.activeModal.tool_name}
          reason={ui.activeModal.reason}
          toolInput={ui.activeModal.tool_input}
          requestId={ui.activeModal.request_id}
          sendRequest={sendRequest}
          onClose={() => ui.setActiveModal(null)}
        />
      )}
      {ui.activeModal?.kind === 'question' && (
        <QuestionModal
          question={ui.activeModal.question}
          requestId={ui.activeModal.request_id}
          sendRequest={sendRequest}
          onClose={() => ui.setActiveModal(null)}
        />
      )}
      {ui.activeModal?.kind === 'select' && (
        <SelectModal
          title={ui.activeModal.title}
          command={ui.activeModal.command}
          options={ui.activeModal.options}
          sendRequest={sendRequest}
          onClose={() => ui.setActiveModal(null)}
        />
      )}

      {/* Error toasts */}
      <ErrorToastContainer />
    </div>
  )
}
