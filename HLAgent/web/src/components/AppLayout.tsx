import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useUiStore, type AppView } from '../stores/uiStore'
import { useSessionStore } from '../stores/sessionStore'
import { useWebSocket } from '../hooks/useWebSocket'
import Sidebar from './Sidebar'
import StatusBar from './StatusBar'
import PermissionModal from './PermissionModal'
import QuestionModal from './QuestionModal'
import SelectModal from './SelectModal'
import ErrorToastContainer from './ErrorToast'
import CompactProgressBar from './CompactProgressBar'
import TranscriptViewer from './TranscriptViewer'
import MessageInput from './MessageInput'
import MemoryPage from '../pages/MemoryPage'
import SkillsPage from '../pages/SkillsPage'
import ExpertsPage from '../pages/ExpertsPage'
import CronPage from '../pages/CronPage'
import SwarmPage from '../pages/SwarmPage'
import AutopilotPage from '../pages/AutopilotPage'
import PermissionsPage from '../pages/PermissionsPage'
import SettingsDrawer from './SettingsDrawer'
import CreateSessionModal from './CreateSessionModal'

const FEATURES = [
  { icon: '🧠', label: '持久记忆', desc: '项目知识跨会话保存' },
  { icon: '⚡', label: '技能库', desc: '可复用 Agent 技能' },
  { icon: '🤝', label: 'Swarm 协作', desc: '多 Agent 团队并行' },
]

function WelcomeView({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e1e2e', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: '480px', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚡</div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#89b4fa', margin: '0 0 0.4rem' }}>HLAgent</h1>
        <p style={{ color: '#6c7086', margin: '0 0 2rem', fontSize: '0.875rem' }}>AI 编程助手，开箱即用</p>
        <button
          onClick={onStart}
          style={{ width: '100%', backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.75rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginBottom: '2.5rem' }}
        >
          开始新对话 →
        </button>
        <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
          {FEATURES.map((f) => (
            <div key={f.label} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>{f.icon}</div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cdd6f4', marginBottom: '0.2rem' }}>{f.label}</div>
              <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ChatViewProps {
  sessionId: string
  sendRequest: ReturnType<typeof useWebSocket>['sendRequest']
}

function ChatView({ sessionId, sendRequest }: ChatViewProps) {
  const store = useSessionStore()
  const ui = useUiStore()
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    const s = useSessionStore.getState()
    if (s.sessionId !== sessionId) {
      s.resetAndSetSession(sessionId)
    } else if (s.wsStatus === 'terminated') {
      s.setWsStatus('disconnected')
    }
  }, [sessionId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, backgroundColor: '#1e1e2e', overflow: 'hidden' }}>
      {/* ── 顶部固定行 ── */}
      <div style={{ height: '44px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825' }}>
        <span style={{ fontSize: '0.8125rem', color: '#a6adc8' }}>
          {store.appState?.model || 'HLAgent'} · {sessionId.slice(-4)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: store.wsStatus === 'ready' ? '#a6e3a1' : store.wsStatus === 'terminated' ? '#6c7086' : '#f9e2af' }}>
          {store.wsStatus === 'ready' ? '● 已连接' : store.wsStatus === 'connecting' ? '⟳ 连接中' : store.wsStatus === 'terminated' ? '● 已结束' : '● 已断开'}
        </span>
        <button
          onClick={() => setShowSettings(true)}
          title="设置"
          style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem', lineHeight: 1 }}
        >
          ⚙
        </button>
      </div>

      {/* ── 进度条 ── */}
      <CompactProgressBar phase={ui.compactPhase} />

      {/* ── 中间内容区 ── */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <TranscriptViewer items={store.transcript} assistantBuffer={store.assistantBuffer} thinkingBuffer={store.thinkingBuffer} sessionId={sessionId} />
      </div>

      {/* ── 底部固定输入框 ── */}
      <div style={{ flexShrink: 0 }}>
        <MessageInput
          busy={store.busy}
          commands={store.commands}
          sendRequest={(req) => {
            if (req.type === 'submit_line') store.setBusy(true)
            sendRequest(req)
          }}
          wsStatus={store.wsStatus}
        />
      </div>

      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
    </div>
  )
}

const VIEW_COMPONENTS: Record<Exclude<AppView, 'chat'>, React.ComponentType> = {
  memory: MemoryPage,
  skills: SkillsPage,
  experts: ExpertsPage,
  cron: CronPage,
  swarm: SwarmPage,
  autopilot: AutopilotPage,
  permissions: PermissionsPage,
}

const VALID_VIEWS: AppView[] = ['chat', 'memory', 'skills', 'experts', 'cron', 'swarm', 'autopilot', 'permissions']

export default function AppLayout() {
  const ui = useUiStore()
  const navigate = useNavigate()
  const params = useParams<{ sessionId?: string }>()
  const [searchParams] = useSearchParams()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)

  const activeSessionId = ui.activeChatSessionId
  const { sendRequest } = useWebSocket(activeSessionId)
  const viewParam = searchParams.get('view') as AppView | null

  // Sync route → uiStore on direct URL access (/chat/:id or /?view=xxx)
  // NOTE: `ui` must NOT be in deps — adding it causes a feedback loop where
  // setActiveChatSessionId(null) triggers the effect while params.sessionId
  // still holds the old value, immediately re-setting it.
  useEffect(() => {
    const { activeChatSessionId, setActiveChatSessionId, setActiveView } = useUiStore.getState()
    if (params.sessionId && activeChatSessionId !== params.sessionId) {
      setActiveChatSessionId(params.sessionId)
      setActiveView('chat')
    }
    if (viewParam && VALID_VIEWS.includes(viewParam)) {
      useUiStore.getState().setActiveView(viewParam)
    }
  }, [params.sessionId, viewParam]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleNewSession() {
    setShowCreateModal(true)
  }

  function handleSessionCreated(sessionId: string) {
    setShowCreateModal(false)
    ui.setActiveChatSessionId(sessionId)
    ui.setActiveView('chat')
    navigate(`/chat/${sessionId}`, { replace: true })
    setSidebarRefreshKey((k) => k + 1)
  }

  function handleViewChange(view: AppView) {
    ui.setActiveView(view)
  }

  function handleSelectSession(sessionId: string) {
    ui.setActiveChatSessionId(sessionId)
    ui.setActiveView('chat')
    navigate(`/chat/${sessionId}`, { replace: true })
  }

  function handleDeleteSession(sessionId: string) {
    if (ui.activeChatSessionId === sessionId) {
      ui.setActiveChatSessionId(null)
      ui.setActiveView('chat')
      navigate('/', { replace: true })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#1e1e2e', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
          activeView={ui.activeView}
          onViewChange={handleViewChange}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          activeChatSessionId={activeSessionId}
          refreshKey={sidebarRefreshKey}
        />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Chat — always mounted, hidden when other view is active */}
          <div style={{ display: ui.activeView === 'chat' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {activeSessionId
              ? <ChatView sessionId={activeSessionId} sendRequest={sendRequest} />
              : <WelcomeView onStart={handleNewSession} />
            }
          </div>

          {/* Other views with opacity fade */}
          {(Object.keys(VIEW_COMPONENTS) as Exclude<AppView, 'chat'>[]).map((view) => {
            const Component = VIEW_COMPONENTS[view]
            const isActive = ui.activeView === view
            return (
              <div
                key={view}
                style={{
                  display: isActive ? 'flex' : 'none',
                  flex: 1,
                  flexDirection: 'column',
                  overflow: 'hidden',
                  opacity: isActive ? 1 : 0,
                  transition: 'opacity 80ms ease-out',
                }}
              >
                <Component />
              </div>
            )
          })}
        </div>
      </div>

      {/* Status bar full-width */}
      {activeSessionId && ui.activeView === 'chat' && (
        <StatusBar sendRequest={sendRequest} />
      )}

      {/* Global modals */}
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
          options={ui.activeModal.options}
          multiSelect={ui.activeModal.multi_select}
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
      <ErrorToastContainer />
      {showCreateModal && (
        <CreateSessionModal
          onCreated={handleSessionCreated}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  )
}
