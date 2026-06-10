import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useUiStore, type AppView } from '../stores/uiStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSwarmStore } from '../stores/swarmStore'
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
import SwarmMemberBar from './SwarmMemberBar'
import SwarmMemberPane from './SwarmMemberPane'
import MemoryPage from '../pages/MemoryPage'
import SkillsPage from '../pages/SkillsPage'
import ExpertsPage from '../pages/ExpertsPage'
import CronPage from '../pages/CronPage'
import SwarmPage from '../pages/SwarmPage'
import AutopilotPage from '../pages/AutopilotPage'
import PermissionsPage from '../pages/PermissionsPage'
import ModelsPage from '../pages/ModelsPage'
import RagPage from '../pages/RagPage'
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
  const navigate = useNavigate()
  const [showSettings, setShowSettings] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [members, setMembers] = useState<Record<string, import('../stores/swarmStore').TeamMember>>({})
  const [paneRatio, setPaneRatio] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const expertLabel = ui.expertRoleLabels[sessionId]
  const isTeamSession = expertLabel?.startsWith('🤝 ')
  const taskTeamName = isTeamSession ? expertLabel.slice(2).trim() : null
  // Strip task-run timestamp suffix (e.g. "marketing-team-20260524-095500" → "marketing-team")
  const teamName = taskTeamName?.replace(/-\d{8}-\d{6}$/, '') ?? null
  const taskContent = ui.teamSessionTask[sessionId]
  const teammates = useSwarmStore((s) => s.teammates)
  const allDone = isTeamSession && Object.keys(members).length > 0 &&
    Object.values(members).every((m) => {
      const t = teammates.find((x) => x.name === m.name)
      const status = t?.status ?? m.status
      return status === 'idle' || status === 'stopped' || status === 'done'
    })

  useEffect(() => {
    const s = useSessionStore.getState()
    if (s.sessionId !== sessionId) {
      s.resetAndSetSession(sessionId)
    } else if (s.wsStatus === 'terminated') {
      s.setWsStatus('disconnected')
    }
  }, [sessionId])

  // Load team members if this is a team session.
  // Initial state: load template members (no session_ids, chips disabled).
  // Once Leader calls swarm_create_run and a run appears, poll for that run's
  // team.json which has real session_ids, and replace the member state.
  const [chatParams] = useSearchParams()
  const fetchTeamName = chatParams.get('team') || teamName

  // Load template members on mount (shows chip names, disabled until run appears)
  useEffect(() => {
    if (!isTeamSession || !fetchTeamName) return
    fetch(`/api/swarm/teams/${encodeURIComponent(fetchTeamName)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.members) setMembers(data.members) })
      .catch(() => {})
  }, [isTeamSession, fetchTeamName])

  // Poll for latest run — load members FROM run team.json which has real session_ids.
  // Also tracks currentRunSlug to pass as runId to SwarmMemberPane for SSE/transcript.
  // Re-fetches the run whenever any member still has session_id=null (spawn in progress).
  const currentRunSlugRef = useRef<string | null>(null)
  const [currentRunSlug, setCurrentRunSlug] = useState<string | null>(null)

  useEffect(() => {
    if (!isTeamSession || !fetchTeamName) return

    const pollRun = () => {
      fetch(`/api/swarm/teams/${encodeURIComponent(fetchTeamName)}/runs`)
        .then((r) => r.ok ? r.json() : null)
        .then((runs: Array<{ run_slug: string }> | null) => {
          if (!runs || runs.length === 0) return
          const slug = runs[0].run_slug
          const slugChanged = slug !== currentRunSlugRef.current
          // Re-fetch if: (a) slug changed, OR (b) any member still has no session_id
          const anyNullSession = Object.values(members).some((m) => !m.session_id)
          if (!slugChanged && !anyNullSession) return
          if (slugChanged) {
            currentRunSlugRef.current = slug
            setCurrentRunSlug(slug)
          }
          return fetch(`/api/swarm/teams/${encodeURIComponent(fetchTeamName)}/runs/${encodeURIComponent(slug)}`)
            .then((r) => r.ok ? r.json() : null)
        })
        .then((runData: { members?: Record<string, import('../stores/swarmStore').TeamMember> } | null | undefined) => {
          if (!runData?.members) return
          setMembers(runData.members)
        })
        .catch(() => {})
    }
    const interval = setInterval(pollRun, 3000)
    pollRun()
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeamSession, fetchTeamName])

  // Merge WS swarm_status events (for in-process members that emit events)
  useEffect(() => {
    if (!isTeamSession) return
    setMembers((prev) => {
      const updated = { ...prev }
      for (const t of teammates) {
        const key = Object.keys(updated).find((k) => updated[k].name === t.name)
        if (key) {
          updated[key] = {
            ...updated[key],
            status: (t.status as import('../stores/swarmStore').TeamMember['status']) ?? updated[key].status,
            session_id: t.session_id ?? updated[key].session_id,
          }
        }
      }
      return updated
    })
  }, [teammates, isTeamSession])

  // Resize divider handlers
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startRatio = paneRatio
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) return
      const totalWidth = containerRef.current.offsetWidth
      const delta = (ev.clientX - startX) / totalWidth
      setPaneRatio(Math.min(0.7, Math.max(0.3, startRatio + delta)))
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const selectedMember = selectedMemberId ? members[selectedMemberId] : null
  const isSplit = isTeamSession && !!selectedMember

  const headerTaskLabel = isTeamSession
    ? (taskContent ? `🤝 ${teamName} · ${taskContent.slice(0, 40)}${taskContent.length > 40 ? '...' : ''}` : `🤝 ${teamName}`)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, backgroundColor: '#1e1e2e', overflow: 'hidden' }}>
      {/* ── 顶部固定行 ── */}
      <div style={{ height: '44px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825' }}>
        <span style={{ fontSize: '0.8125rem', color: '#a6adc8' }}>
          {store.appState?.model || 'HLAgent'} · {sessionId.slice(-4)}
        </span>
        {expertLabel && (
          <span style={{
            background: '#313244',
            color: isTeamSession ? (allDone ? '#a6e3a1' : '#89dceb') : '#cba6f7',
            borderRadius: '4px',
            padding: '0.1rem 0.4rem',
            fontSize: '0.7rem',
            whiteSpace: 'nowrap',
            maxWidth: '240px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}>
            {isTeamSession ? (allDone ? `✅ ${teamName}` : headerTaskLabel) : `🎭 ${expertLabel}`}
            {isTeamSession && teamName && (
              <button
                onClick={() => navigate(`/?view=swarm&team=${encodeURIComponent(teamName)}`)}
                style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.7rem', padding: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
                title="管理团队"
              >
                ⊞ 管理团队
              </button>
            )}
          </span>
        )}
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

      {/* ── 成员选择栏（仅团队 session）── */}
      {isTeamSession && Object.keys(members).length > 0 && (
        <SwarmMemberBar
          members={members}
          selectedMemberId={selectedMemberId}
          onSelect={setSelectedMemberId}
          allDone={!!allDone}
        />
      )}

      {/* ── 内容区（分栏或全宽）── */}
      <div ref={containerRef} style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>
        {/* Leader pane */}
        <div style={{
          flexBasis: isSplit ? `${paneRatio * 100}%` : '100%',
          flexGrow: 0,
          flexShrink: 0,
          minWidth: isSplit ? '30%' : undefined,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <TranscriptViewer items={store.transcript} assistantBuffer={store.assistantBuffer} thinkingBuffer={store.thinkingBuffer} sessionId={sessionId} />
          </div>
          <div style={{ flexShrink: 0 }}>
            <MessageInput
              busy={store.busy}
              commands={store.commands}
              sendRequest={sendRequest}
              wsStatus={store.wsStatus}
              placeholder={isTeamSession && store.transcript.length === 0 ? '描述你希望团队完成的任务...' : (isTeamSession ? '可向 Leader 补充说明或调整方向...' : undefined)}
            />
          </div>
        </div>

        {/* Resize divider */}
        {isSplit && (
          <div
            onMouseDown={startResize}
            style={{
              width: '5px',
              flexShrink: 0,
              cursor: 'col-resize',
              backgroundColor: '#313244',
              transition: 'background-color 100ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#45475a')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#313244')}
          />
        )}

        {/* Member pane — render ALL members but show only the selected one.
            Using display:none instead of conditional rendering preserves SSE
            connections and accumulated items when switching between members. */}
        {isSplit && Object.keys(members).length > 0 && (
          <div style={{
            flexBasis: `${(1 - paneRatio) * 100}%`,
            flexGrow: 0,
            flexShrink: 0,
            minWidth: '30%',
            overflow: 'hidden',
            borderLeft: '1px solid #313244',
            display: selectedMemberId ? 'block' : 'none',
          }}>
            {Object.values(members).map((m) => (
              <div
                key={m.agent_id}
                style={{ height: '100%', display: m.agent_id === selectedMemberId ? 'block' : 'none' }}
              >
                <SwarmMemberPane
                  member={m}
                  runId={currentRunSlug ? `${fetchTeamName}/${currentRunSlug}` : undefined}
                />
              </div>
            ))}
          </div>
        )}
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
  models: ModelsPage,
  rag: RagPage,
}

const VALID_VIEWS: AppView[] = ['chat', 'memory', 'skills', 'experts', 'cron', 'swarm', 'autopilot', 'permissions', 'models', 'rag']

export default function AppLayout() {
  const ui = useUiStore()
  const navigate = useNavigate()
  const params = useParams<{ sessionId?: string }>()
  const [searchParams] = useSearchParams()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const activeSessionId = ui.activeChatSessionId
  const { sendRequest: _rawSendRequest } = useWebSocket(activeSessionId)
  const viewParam = searchParams.get('view') as AppView | null

  // Wrap sendRequest: set busy=true for any request that triggers Agent to continue
  const sendRequest: typeof _rawSendRequest = (req) => {
    if (req.type !== 'interrupt' && req.type !== 'list_sessions') {
      useSessionStore.getState().setBusy(true)
    }
    _rawSendRequest(req)
  }

  // Sync route → uiStore on direct URL access (/chat/:id or /?view=xxx)
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
    ui.incrementSidebarRefreshKey()
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
