import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RoleLibraryPanel from './RoleLibraryPanel'
import type { RoleAgent, SelectedRole } from '../types/swarm'
import { MEMBER_COLOR_PALETTE } from '../types/swarm'
import { fetchRoleContent } from '../utils/swarmApi'

interface Props {
  onClose: () => void
  onCreated: (teamName: string) => void
}

type WizardStep = 'name' | 'roles' | 'creating'
type SubStepStatus = 'pending' | 'running' | 'done' | 'error'

interface SubStep {
  label: string
  status: SubStepStatus
  error?: string
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function TeamCreationWizard({ onClose, onCreated }: Props) {
  const navigate = useNavigate()
  const [step, setStep] = useState<WizardStep>('name')
  const [teamNameRaw, setTeamNameRaw] = useState('')
  const [teamDesc, setTeamDesc] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<SelectedRole[]>([])
  const [subSteps, setSubSteps] = useState<SubStep[]>([])
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const [createdTeamName, setCreatedTeamName] = useState<string | null>(null)
  const [succeededRoles, setSucceededRoles] = useState<SelectedRole[]>([])
  const [failedRoles, setFailedRoles] = useState<SelectedRole[]>([])
  const [confirmCancel, setConfirmCancel] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const slug = slugify(teamNameRaw)

  function updateSubStep(index: number, update: Partial<SubStep>) {
    setSubSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)))
  }

  function handleToggle(role: RoleAgent, dept: string) {
    setSelectedRoles((prev) => {
      const exists = prev.some((s) => s.role.path === role.path)
      return exists ? prev.filter((s) => s.role.path !== role.path) : [...prev, { role, dept }]
    })
  }

  function handleCancel() {
    if (step === 'creating') return
    if (teamNameRaw || selectedRoles.length > 0) {
      setConfirmCancel(true)
    } else {
      onClose()
    }
  }

  // Esc key handler
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, teamNameRaw, selectedRoles.length])

  async function startCreating(rolesToCreate: SelectedRole[]) {
    const team = slug || teamNameRaw
    const steps: SubStep[] = [
      { label: `创建团队 ${team}`, status: 'pending' },
      ...rolesToCreate.map((r) => ({ label: `添加成员 ${r.role.name}`, status: 'pending' as SubStepStatus })),
      { label: '完成', status: 'pending' },
    ]
    setSubSteps(steps)
    setStep('creating')
    startTimeRef.current = Date.now()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000)), 500)

    const succeeded: SelectedRole[] = [...succeededRoles]
    const failed: SelectedRole[] = []
    let actualTeamName = createdTeamName ?? team

    // Step 0: create team (skip if already created)
    if (!createdTeamName) {
      updateSubStep(0, { status: 'running' })
      try {
        const r = await fetch('/api/swarm/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: team, description: teamDesc }),
        })
        if (!r.ok && r.status !== 409) throw new Error(`HTTP ${r.status}`)
        actualTeamName = team
        setCreatedTeamName(team)
        updateSubStep(0, { status: 'done' })
      } catch (e) {
        updateSubStep(0, { status: 'error', error: String(e) })
        if (timerRef.current) clearInterval(timerRef.current)
        setFailedRoles(rolesToCreate)
        return
      }
    } else {
      updateSubStep(0, { status: 'done' })
    }

    // Steps 1..N: add members
    for (let i = 0; i < rolesToCreate.length; i++) {
      const sr = rolesToCreate[i]
      const stepIdx = i + 1
      updateSubStep(stepIdx, { status: 'running' })
      try {
        const markdown = await fetchRoleContent(sr.role.path)
        const r = await fetch(`/api/swarm/teams/${encodeURIComponent(actualTeamName)}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sr.role.name,
            prompt: markdown,
            color: MEMBER_COLOR_PALETTE[i % MEMBER_COLOR_PALETTE.length],
          }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        succeeded.push(sr)
        setSucceededRoles([...succeeded])
        updateSubStep(stepIdx, { status: 'done' })
      } catch (e) {
        failed.push(sr)
        setFailedRoles([...failed])
        updateSubStep(stepIdx, { status: 'error', error: String(e) })
      }
    }

    if (timerRef.current) clearInterval(timerRef.current)
    updateSubStep(steps.length - 1, { status: failed.length === 0 ? 'done' : 'error' })

    if (failed.length === 0) {
      onCreated(actualTeamName)
    }
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const STEP_ICON: Record<SubStepStatus, string> = { pending: '○', running: '⟳', done: '✓', error: '✗' }
  const STEP_COLOR: Record<SubStepStatus, string> = { pending: '#6c7086', running: '#89b4fa', done: '#a6e3a1', error: '#f38ba8' }

  const doneCount = subSteps.filter((s) => s.status === 'done').length
  const progress = subSteps.length > 0 ? Math.round((doneCount / subSteps.length) * 100) : 0

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      {confirmCancel && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 51 }}>
          <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '12px', padding: '1.5rem', width: '320px' }}>
            <div style={{ marginBottom: '1rem', fontSize: '0.9375rem', color: '#cdd6f4' }}>确定取消？已选角色将清空</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setConfirmCancel(false)} style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: 'pointer' }}>继续编辑</button>
              <button onClick={onClose} style={{ flex: 1, backgroundColor: '#f38ba8', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>确定取消</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ backgroundColor: '#1e1e2e', border: '1px solid #313244', borderRadius: '12px', width: step === 'roles' ? '900px' : '480px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <div style={{ flex: 1, display: 'flex', gap: '1rem', fontSize: '0.8125rem' }}>
            {(['name', 'roles', 'creating'] as WizardStep[]).map((s, i) => (
              <span key={s} style={{ color: step === s ? '#89b4fa' : i < ['name', 'roles', 'creating'].indexOf(step) ? '#a6e3a1' : '#6c7086', fontWeight: step === s ? 700 : 400 }}>
                {i + 1}. {s === 'name' ? '命名' : s === 'roles' ? '选专家' : '创建中'}
              </span>
            ))}
          </div>
          {step !== 'creating' && (
            <button onClick={handleCancel} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1, padding: '0 0.25rem' }}>×</button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Step 1: Name */}
          {step === 'name' && (
            <div style={{ padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.35rem' }}>团队名称 *</label>
                <input
                  autoFocus
                  value={teamNameRaw}
                  onChange={(e) => setTeamNameRaw(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && slug && setStep('roles')}
                  placeholder="例：dev-team"
                  style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.9375rem' }}
                />
                {slug && <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#6c7086' }}>团队ID：<span style={{ color: '#89b4fa' }}>{slug}</span></div>}
                <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#45475a' }}>仅支持小写字母、数字和连字符，如 dev-team</div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.35rem' }}>描述（可选）</label>
                <input
                  value={teamDesc}
                  onChange={(e) => setTeamDesc(e.target.value)}
                  placeholder="团队用途说明"
                  style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setStep('roles')} disabled={!slug}
                  style={{ backgroundColor: slug ? '#89b4fa' : '#313244', color: slug ? '#1e1e2e' : '#6c7086', border: 'none', borderRadius: '6px', padding: '0.5rem 1.25rem', cursor: slug ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                  下一步 →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Roles */}
          {step === 'roles' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '0.5rem 1.25rem', borderBottom: '1px solid #313244', fontSize: '0.8125rem', color: '#6c7086', flexShrink: 0 }}>
                选择专家 → 点击预览 → 勾选加入 &nbsp;·&nbsp;
                <span style={{ color: '#89b4fa' }}>已选 {selectedRoles.length} 个（建议 2-5 个）</span>
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <RoleLibraryPanel
                  mode="wizard"
                  selectedRoles={selectedRoles}
                  onToggle={handleToggle}
                  onClose={() => setConfirmCancel(true)}
                />
              </div>
              <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #313244', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                <button onClick={() => setStep('name')} style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.8125rem' }}>← 返回</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => startCreating([])} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem' }}>跳过</button>
                <button onClick={() => startCreating(selectedRoles)}
                  style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.8125rem' }}>
                  {selectedRoles.length > 0 ? `添加 ${selectedRoles.length} 个专家 →` : '创建空团队 →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Creating */}
          {step === 'creating' && (
            <div style={{ padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
              <div style={{ fontSize: '0.9375rem', color: '#cdd6f4', fontWeight: 600 }}>正在创建团队...</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {subSteps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8125rem' }}>
                    <span style={{ color: STEP_COLOR[s.status], fontFamily: 'monospace' }}>{STEP_ICON[s.status]}</span>
                    <span style={{ color: s.status === 'error' ? '#f38ba8' : '#cdd6f4' }}>{s.label}</span>
                    {s.error && <span style={{ color: '#f38ba8', fontSize: '0.7rem' }}>— {s.error}</span>}
                  </div>
                ))}
              </div>
              <div style={{ backgroundColor: '#181825', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', backgroundColor: '#89b4fa', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>已用时 {elapsedSecs}s</div>

              {failedRoles.length > 0 && subSteps[subSteps.length - 1]?.status !== 'pending' && (
                <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ color: '#f9e2af', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                    {createdTeamName} 已创建，但 {failedRoles.length} 个成员添加失败
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => { onCreated(createdTeamName!); navigate(`/swarm`) }}
                      style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem', cursor: 'pointer', fontSize: '0.75rem' }}>
                      手动添加
                    </button>
                    <button onClick={() => { setSubSteps([]); setElapsedSecs(0); setSucceededRoles(succeededRoles); startCreating(failedRoles) }}
                      style={{ flex: 1, backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>
                      重试失败项
                    </button>
                    <button onClick={() => onCreated(createdTeamName!)}
                      style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem', cursor: 'pointer', fontSize: '0.75rem' }}>
                      完成（跳过失败）
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
