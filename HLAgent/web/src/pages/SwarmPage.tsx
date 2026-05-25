import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MDRenderer from '../components/MDRenderer'
import SwarmAgentPanel from '../components/SwarmAgentPanel'
import TeamCreationWizard from '../components/TeamCreationWizard'
import RoleLibraryPanel from '../components/RoleLibraryPanel'
import type { TeamSummary, Member, MailboxMsg, SelectedRole, RoleAgent } from '../types/swarm'
import { MEMBER_COLOR_PALETTE } from '../types/swarm'
import { launchTeam, fetchRoleContent } from '../utils/swarmApi'
import { useSwarmTeam } from '../hooks/useSwarmTeam'

const STATUS_ICON: Record<string, string> = {
  active: '🟢', idle: '🟡', stopped: '⬛', running: '🟢', done: '✅', error: '🔴',
}
const MSG_ICON: Record<string, string> = {
  user_message: '✉️', permission_request: '⚠️', permission_response: '✅',
  sandbox_permission_request: '🌐', shutdown: '🔴', idle_notification: '🟡',
}

export default function SwarmPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Team list
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const pendingTeamSelectRef = useRef<string | null>(null)

  // Member data via hook (replaces useState + useEffect + setInterval)
  const { members, teamState, isLoading: membersLoading, lastRefresh, refresh: refreshSelected } = useSwarmTeam(selectedTeam)

  // UI state
  const [selectedMember, setSelectedMember] = useState<string | null>(null)
  const [view, setView] = useState<'transcript' | 'mailbox' | 'role'>('transcript')
  const [transcript, setTranscript] = useState<string>('')
  const [mailbox, setMailbox] = useState<MailboxMsg[]>([])
  const [msgText, setMsgText] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerRoles, setPickerRoles] = useState<SelectedRole[]>([])
  const [launchBusy, setLaunchBusy] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [highlightTeam, setHighlightTeam] = useState<string | null>(null)
  const [singleChatBusy, setSingleChatBusy] = useState<string | null>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [transcriptCache, setTranscriptCache] = useState<Record<string, string>>({})
  const [transcriptLoading, setTranscriptLoading] = useState<Record<string, boolean>>({})
  const [transcriptErrorKind, setTranscriptErrorKind] = useState<Record<string, 'none' | 'no-session' | 'fetch-error'>>({})
  const prevMembersRef = useRef<Record<string, string | undefined>>({})
  const loadingRef = useRef<Record<string, boolean>>({})

  function refreshTeams() {
    fetch('/api/swarm/teams').then((r) => r.json()).then((data) => {
      setTeams(data)
      const pending = pendingTeamSelectRef.current
      if (pending && data.some((t: TeamSummary) => t.name === pending)) {
        selectTeam(pending)
        pendingTeamSelectRef.current = null
      }
    }).catch(() => {})
  }

  function loadTranscriptForAgent(agentId: string) {
    if (loadingRef.current[agentId]) return
    loadingRef.current[agentId] = true
    setTranscriptLoading((prev) => ({ ...prev, [agentId]: true }))
    fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/transcript`)
      .then(async (r) => {
        if (r.status === 404) {
          setTranscriptErrorKind((p) => ({ ...p, [agentId]: 'no-session' }))
        } else if (!r.ok) {
          setTranscriptErrorKind((p) => ({ ...p, [agentId]: 'fetch-error' }))
        } else {
          const d = await r.json()
          setTranscriptCache((p) => ({ ...p, [agentId]: d.transcript ?? '' }))
          setTranscriptErrorKind((p) => ({ ...p, [agentId]: 'none' }))
        }
      })
      .catch(() => setTranscriptErrorKind((p) => ({ ...p, [agentId]: 'fetch-error' })))
      .finally(() => {
        loadingRef.current[agentId] = false
        setTranscriptLoading((p) => ({ ...p, [agentId]: false }))
      })
  }

  function selectTeam(name: string) {
    setSelectedTeam(name)
    setSelectedMember(null)
    setView('transcript')
  }

  // Init: load teams, handle ?team= param
  useEffect(() => {
    refreshTeams()
    const teamParam = searchParams.get('team')
    if (teamParam) {
      const templateName = teamParam.replace(/-\d{8}-\d{6}$/, '')
      pendingTeamSelectRef.current = templateName
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load transcripts when members change status (running/idle states)
  useEffect(() => {
    if (teamState !== 'running' && teamState !== 'idle') return
    const memberList = Object.values(members)
    for (const m of memberList) {
      const prevStatus = prevMembersRef.current[m.agent_id]
      if (prevStatus !== m.status) loadTranscriptForAgent(m.agent_id)
    }
    prevMembersRef.current = Object.fromEntries(memberList.map((m) => [m.agent_id, m.status]))
  }, [members, teamState])

  // Load all transcripts on first enter to overview (running/idle, no selected member)
  useEffect(() => {
    if ((teamState === 'running' || teamState === 'idle') && !selectedMember) {
      Object.keys(members).forEach((agentId) => {
        if (!transcriptLoading[agentId] && !transcriptCache[agentId]) loadTranscriptForAgent(agentId)
      })
    }
  }, [teamState, selectedMember]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTranscript(agentId: string) {
    try {
      const r = await fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/transcript`)
      setTranscript(r.ok ? (await r.json()).transcript || '' : '')
    } catch { setTranscript('') }
  }

  async function loadMailbox(agentId: string) {
    try {
      const r = await fetch(`/api/swarm/agents/${encodeURIComponent(agentId)}/messages?unread_only=false`)
      if (r.ok) setMailbox(await r.json())
    } catch { setMailbox([]) }
  }

  async function selectMember(agentId: string) {
    setSelectedMember(agentId)
    setView('transcript')
    loadTranscript(agentId)
    loadMailbox(agentId)
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

  async function handleDeleteTeam(team: string) {
    await fetch(`/api/swarm/teams/${encodeURIComponent(team)}`, { method: 'DELETE' })
    setDeleteConfirm(null)
    if (selectedTeam === team) setSelectedTeam(null)
    refreshTeams()
  }

  async function handleRemoveMember(agentId: string) {
    if (!selectedTeam) return
    await fetch(`/api/swarm/teams/${encodeURIComponent(selectedTeam)}/members/${encodeURIComponent(agentId)}`, { method: 'DELETE' })
    refreshSelected()
  }

  async function handleLaunch() {
    if (!selectedTeam) return
    setLaunchBusy(true)
    try { await launchTeam(selectedTeam, navigate) } catch { /* fall through */ }
    setLaunchBusy(false)
  }

  async function handlePickerConfirm(roles: SelectedRole[]) {
    if (!selectedTeam) return
    const currentCount = Object.keys(members).length
    const failed: string[] = []
    for (let i = 0; i < roles.length; i++) {
      const sr = roles[i]
      try {
        const markdown = await fetchRoleContent(sr.role.path)
        const r = await fetch(`/api/swarm/teams/${encodeURIComponent(selectedTeam)}/members`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sr.role.name, prompt: markdown, color: MEMBER_COLOR_PALETTE[(currentCount + i) % MEMBER_COLOR_PALETTE.length] }),
        })
        if (!r.ok) failed.push(sr.role.name)
      } catch { failed.push(sr.role.name) }
    }
    setShowPicker(false)
    setPickerRoles([])
    if (failed.length > 0) setPickerError(`${failed.length} 个成员添加失败：${failed.join(', ')}`)
    await refreshSelected()
  }

  async function handleSingleChat(member: Member) {
    if (!member.prompt) return
    setSingleChatBusy(member.agent_id)
    try {
      const intro = `请你扮演以下专家角色，所有回复都以该角色的视角和知识体系来回答：\n\n${member.prompt.slice(0, 3000)}`
      const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const { session_id } = await r.json()
      navigate(`/chat/${session_id}?prefill=${encodeURIComponent(intro)}&autosubmit=1`)
    } catch { setSingleChatBusy(null) }
  }

  function handleWizardCreated(teamName: string) {
    setShowWizard(false)
    refreshTeams()
    selectTeam(teamName)
    setHighlightTeam(teamName)
    setTimeout(() => setHighlightTeam(null), 1500)
  }

  const memberList = Object.values(members)

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#89dceb', fontWeight: 700 }}>🤝 Swarm Teams</span>
      </div>

      {showWizard && <TeamCreationWizard onClose={() => setShowWizard(false)} onCreated={handleWizardCreated} />}

      {showPicker && selectedTeam && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: '#1e1e2e', border: '1px solid #313244', borderRadius: '12px', width: '900px', maxWidth: '95vw', height: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.9375rem', fontWeight: 600, flex: 1 }}>为 {selectedTeam} 添加成员</span>
              <button onClick={() => { setShowPicker(false); setPickerRoles([]) }} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1.25rem' }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <RoleLibraryPanel
                mode="picker" selectedRoles={pickerRoles}
                onToggle={(role: RoleAgent, dept: string) => setPickerRoles((prev) => prev.some((s) => s.role.path === role.path) ? prev.filter((s) => s.role.path !== role.path) : [...prev, { role, dept }])}
                onConfirm={handlePickerConfirm}
                onClose={() => { setShowPicker(false); setPickerRoles([]) }}
              />
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '12px', padding: '1.5rem', width: '320px' }}>
            <div style={{ marginBottom: '1rem', color: '#cdd6f4' }}>确定删除团队 <strong>{deleteConfirm}</strong>？</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: 'pointer' }}>取消</button>
              <button onClick={() => handleDeleteTeam(deleteConfirm)} style={{ flex: 1, backgroundColor: '#f38ba8', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>删除</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Team list */}
        <div style={{ width: '180px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#6c7086', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Teams</span>
            <button onClick={() => setShowWizard(true)} style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }} title="新建团队">+</button>
          </div>
          {teams.length === 0 && (
            <div style={{ padding: '1.5rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🤝</div>
              <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.75rem' }}>创建你的第一个 Swarm 团队</div>
              <button onClick={() => setShowWizard(true)} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>+ 新建</button>
            </div>
          )}
          {teams.map((t) => (
            <div key={t.name} onClick={() => selectTeam(t.name)}
              style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', backgroundColor: selectedTeam === t.name ? '#313244' : 'transparent', borderBottom: '1px solid #1e1e2e', outline: highlightTeam === t.name ? '2px solid #89b4fa' : 'none', transition: 'outline 0.15s' }}>
              <div style={{ fontSize: '0.8125rem', color: selectedTeam === t.name ? '#89b4fa' : '#cdd6f4' }}>{t.name}</div>
              <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{t.member_count} 成员 · {t.created_at ? new Date(t.created_at * 1000).toLocaleDateString() : ''}</div>
              <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(t.name) }} style={{ marginTop: '0.2rem', background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '0.65rem', padding: 0 }}>删除</button>
            </div>
          ))}
        </div>

        {/* Members column */}
        <div style={{ width: '260px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {!selectedTeam && <div style={{ padding: '1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>选择团队</div>}

          {selectedTeam && (
            <>
              {pickerError && (
                <div style={{ padding: '0.4rem 0.75rem', backgroundColor: '#f38ba820', borderBottom: '1px solid #f38ba8', fontSize: '0.75rem', color: '#f38ba8', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                  <span>{pickerError}</span>
                  <button onClick={() => setPickerError(null)} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', padding: 0 }}>×</button>
                </div>
              )}

              {/* State banner */}
              {teamState === 'running' && (
                <div style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', color: '#6c7086', flexShrink: 0 }}>
                  <button onClick={refreshSelected} style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>⟳ 刷新</button>
                  {lastRefresh && <span>上次更新 {Math.round((Date.now() - lastRefresh.getTime()) / 1000)}s 前</span>}
                </div>
              )}

              {/* IDLE banner with restart entry (7.1 + 7.2) */}
              {teamState === 'idle' && (
                <div style={{ padding: '0.5rem 0.75rem', backgroundColor: '#1e3a2e', borderBottom: '1px solid #a6e3a1', fontSize: '0.75rem', flexShrink: 0 }}>
                  <div style={{ color: '#a6e3a1', marginBottom: '0.4rem' }}>✅ 上次任务已完成</div>
                  <button onClick={handleLaunch} disabled={launchBusy}
                    style={{ width: '100%', backgroundColor: launchBusy ? '#313244' : '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem', cursor: launchBusy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>
                    {launchBusy ? '⟳ 启动中...' : '🔄 重新启动'}
                  </button>
                </div>
              )}

              {/* Configured banner */}
              {teamState === 'configured' && (
                <div style={{ backgroundColor: '#181825', borderBottom: '1px solid #313244', padding: '0.75rem', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.75rem', color: '#89b4fa', marginBottom: '0.4rem' }}>
                    🚀 {selectedTeam} 已就绪
                    {memberList.length > 0 && <span style={{ color: '#6c7086', marginLeft: '0.4rem' }}>{memberList.slice(0, 3).map((m) => m.name).join(' · ')}{memberList.length > 3 && ` +${memberList.length - 3} 个`}</span>}
                  </div>
                  {(() => {
                    const teamParam = searchParams.get('team') ?? ''
                    const isRunId = teamParam.includes('/') && teamParam.split('/')[0] === selectedTeam
                    return isRunId && !launchBusy ? (
                      <div style={{ marginTop: '0.4rem', padding: '0.4rem', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', fontSize: '0.75rem', color: '#6c7086', textAlign: 'center' }}>⟳ 等待 Agent 启动中，请稍候…</div>
                    ) : (
                      <button onClick={handleLaunch} disabled={launchBusy}
                        style={{ marginTop: '0.4rem', width: '100%', backgroundColor: launchBusy ? '#313244' : '#89b4fa', color: launchBusy ? '#6c7086' : '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem', cursor: launchBusy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.8125rem' }}>
                        {launchBusy ? '⟳ 启动中...' : '启动团队 →'}
                      </button>
                    )
                  })()}
                </div>
              )}

              <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                {memberList.map((m) => (
                  <div key={m.agent_id} onClick={() => selectMember(m.agent_id)}
                    style={{ marginBottom: '0.5rem', padding: '0.6rem', borderRadius: '8px', cursor: 'pointer', backgroundColor: selectedMember === m.agent_id ? '#313244' : '#181825', border: `2px solid ${selectedMember === m.agent_id ? '#89b4fa' : '#313244'}`, borderLeft: `4px solid ${m.color || '#45475a'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                      <span>{STATUS_ICON[m.status || 'idle'] || '⬛'}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      {m.prompt && <button onClick={(e) => { e.stopPropagation(); selectMember(m.agent_id); setView('role') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6c7086', fontSize: '0.75rem', padding: 0 }} title="查看角色定义">📄</button>}
                    </div>
                    {m.agent_type && <div style={{ fontSize: '0.7rem', color: '#89b4fa' }}>{m.agent_type}</div>}
                    {m.model && <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{m.model}</div>}
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
                      {!m.session_id && m.prompt && (
                        <button onClick={(e) => { e.stopPropagation(); handleSingleChat(m) }} disabled={singleChatBusy === m.agent_id}
                          style={{ backgroundColor: '#cba6f7', color: '#1e1e2e', border: 'none', borderRadius: '4px', padding: '0.15rem 0.4rem', cursor: singleChatBusy === m.agent_id ? 'not-allowed' : 'pointer', fontSize: '0.65rem', opacity: singleChatBusy === m.agent_id ? 0.7 : 1 }}>
                          {singleChatBusy === m.agent_id ? '⟳' : '单独对话'}
                        </button>
                      )}
                      {!m.session_id && teamState === 'configured' && (
                        <button onClick={(e) => { e.stopPropagation(); handleRemoveMember(m.agent_id) }}
                          style={{ backgroundColor: 'transparent', color: '#f38ba8', border: '1px solid #f38ba8', borderRadius: '4px', padding: '0.15rem 0.4rem', cursor: 'pointer', fontSize: '0.65rem' }}>
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {teamState === 'configured' && memberList.length > 0 && (
                  <button onClick={() => setShowPicker(true)} style={{ width: '100%', backgroundColor: '#313244', color: '#89b4fa', border: '1px dashed #45475a', borderRadius: '6px', padding: '0.4rem', cursor: 'pointer', fontSize: '0.75rem' }}>+ 添加成员</button>
                )}
                {teamState === 'configured' && memberList.length === 0 && (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#6c7086', fontSize: '0.8125rem' }}>
                    <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>👤</div>
                    <div style={{ marginBottom: '0.75rem' }}>暂无成员</div>
                    <button onClick={() => setShowPicker(true)} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>+ 从角色库添加成员</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {(teamState === 'running' || teamState === 'idle') && !selectedMember && (() => {
            const activeCount = memberList.filter((m) => m.status === 'active').length
            const doneCount = memberList.filter((m) => m.status === 'idle' || m.status === 'stopped').length
            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid #313244', fontSize: '0.75rem', color: teamState === 'idle' ? '#a6e3a1' : '#89b4fa', flexShrink: 0 }}>
                  {teamState === 'idle' ? `✅ 全部完成（共 ${memberList.length} 个 Agent）` : `${activeCount} 个 Agent 运行中 / ${doneCount} 个已完成`}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem' }}>
                  {memberList.map((m) => (
                    <SwarmAgentPanel key={m.agent_id} member={m}
                      transcript={transcriptCache[m.agent_id] ?? ''}
                      isLoading={transcriptLoading[m.agent_id] ?? false}
                      errorKind={transcriptErrorKind[m.agent_id] ?? 'none'}
                      defaultExpanded={m.status === 'active'}
                      onSelect={() => selectMember(m.agent_id)}
                      onRetry={() => { loadingRef.current[m.agent_id] = false; setTranscriptLoading((p) => ({ ...p, [m.agent_id]: false })); loadTranscriptForAgent(m.agent_id) }}
                    />
                  ))}
                  {memberList.length === 0 && <div style={{ color: '#6c7086', fontSize: '0.875rem', textAlign: 'center', marginTop: '2rem' }}>暂无成员数据</div>}
                </div>
              </div>
            )
          })()}

          {!selectedMember && teamState !== 'running' && teamState !== 'idle' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7086', fontSize: '0.875rem' }}>选择 Agent 查看详情</div>
          )}

          {selectedMember && (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid #313244', flexShrink: 0, alignItems: 'center' }}>
                {(teamState === 'running' || teamState === 'idle') && (
                  <button onClick={() => setSelectedMember(null)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem', padding: '0.3rem 0.4rem', borderRadius: '4px' }}>← 返回全览</button>
                )}
                {(['transcript', 'mailbox', 'role'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    style={{ backgroundColor: view === v ? '#313244' : 'transparent', border: 'none', color: view === v ? '#89b4fa' : '#6c7086', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}>
                    {v === 'transcript' ? '📋 Transcript' : v === 'mailbox' ? (
                      <>📬 Mailbox{mailbox.filter((m) => !m.read).length > 0 && <span style={{ backgroundColor: '#f38ba8', color: '#1e1e2e', borderRadius: '10px', padding: '0 0.3rem', marginLeft: '0.3rem', fontSize: '0.7rem' }}>{mailbox.filter((m) => !m.read).length}</span>}</>
                    ) : '📄 角色定义'}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
                {view === 'transcript' && (transcript ? <MDRenderer content={transcript} compact /> : <div style={{ color: '#6c7086', fontSize: '0.875rem' }}>暂无对话记录</div>)}
                {view === 'role' && (members[selectedMember]?.prompt ? <MDRenderer content={members[selectedMember].prompt!} compact /> : <div style={{ color: '#6c7086', fontSize: '0.875rem' }}>未配置角色定义</div>)}
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
              {view === 'mailbox' && (
                <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #313244', display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  <input value={msgText} onChange={(e) => setMsgText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage(selectedMember)}
                    placeholder="发消息给 Agent…"
                    style={{ flex: 1, backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', fontSize: '0.8125rem' }} />
                  <button onClick={() => sendMessage(selectedMember)} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}>发送</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
