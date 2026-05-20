import { Fragment, useEffect, useState } from 'react'
import CronSchedulePicker from '../components/CronSchedulePicker'
import { cronToHumanReadable } from '../utils/cronUtils'

interface CronJob {
  name: string
  schedule: string
  timezone?: string
  command?: string
  enabled: boolean
  last_run?: string
  next_run?: string
  last_status?: string
  payload?: Record<string, unknown>
  created_by?: string
  running?: boolean
}

interface HistoryEntry {
  name: string
  started_at: string
  status: string
  stdout?: string
  stderr?: string
  cron_side_effects?: { action: 'created' | 'deleted'; job: string }[]
}

function toLocalTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'success' ? '#a6e3a1' :
    status === 'error' || status === 'failed' ? '#f38ba8' :
    status === 'timeout' ? '#f9e2af' :
    '#6c7086'
  return <span style={{ color, fontSize: '0.75rem' }}>{status || 'n/a'}</span>
}

function HistoryOutputBlock({ stdout, stderr }: { stdout?: string; stderr?: string }) {
  const [expanded, setExpanded] = useState(false)
  const FOLD_LIMIT = 200

  if (!stdout && !stderr) {
    return <span style={{ color: '#6c7086', fontStyle: 'italic' }}>（无输出）</span>
  }

  const stdoutTrunc = !expanded && stdout && stdout.length > FOLD_LIMIT
  const stderrTrunc = !expanded && stderr && stderr.length > FOLD_LIMIT
  const needsFold = (stdout?.length ?? 0) + (stderr?.length ?? 0) > FOLD_LIMIT

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.1rem', maxWidth: '500px' }}>
      {stdout && (
        <span style={{ color: '#a6adc8', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {stdoutTrunc ? stdout.slice(0, FOLD_LIMIT) + '…' : stdout}
        </span>
      )}
      {stderr && (
        <span style={{ color: '#f38ba8', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {stderrTrunc ? stderr.slice(0, FOLD_LIMIT) + '…' : stderr}
        </span>
      )}
      {needsFold && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '0.7rem', padding: 0, textAlign: 'left' }}
        >
          {expanded ? '收起 ▴' : '展开 ▾'}
        </button>
      )}
    </span>
  )
}

function defaultSchedule(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 1)
  return `${d.getMinutes()} ${d.getHours()} * * 1-5`
}

export default function CronPage() {
  useEffect(() => {
    if (!document.getElementById('cron-pulse-style')) {
      const s = document.createElement('style')
      s.id = 'cron-pulse-style'
      s.textContent = '@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }'
      document.head.appendChild(s)
    }
  }, [])
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [schedulerRunning, setSchedulerRunning] = useState<boolean | null>(null)
  const [historyJob, setHistoryJob] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [newName, setNewName] = useState('')
  const [newSchedule, setNewSchedule] = useState(() => defaultSchedule())
  const [scheduleValid, setScheduleValid] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)  // null = create mode

  function load() {
    fetch('/api/cron/jobs').then((r) => r.json()).then(setJobs).catch(() => {})
    fetch('/api/cron/scheduler/status').then((r) => r.json()).then((d) => setSchedulerRunning(d.running)).catch(() => {})
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)   // poll every 5s to reflect running state
    return () => clearInterval(timer)
  }, [])

  function openCreateForm() {
    setEditingJob(null)
    setNewName('')
    setNewSchedule(defaultSchedule())
    setNewMessage('')
    setScheduleValid(true)
    setShowForm(true)
  }

  function openEditForm(job: CronJob) {
    setEditingJob(job)
    setNewName(job.name)
    setNewSchedule(job.schedule)
    setNewMessage((job.payload as { message?: string } | undefined)?.message || job.command || '')
    setScheduleValid(true)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingJob(null)
    setSaveError(null)
    setNewName(''); setNewSchedule(defaultSchedule()); setNewMessage(''); setScheduleValid(true)
  }

  async function toggle(job: CronJob) {
    await fetch(`/api/cron/jobs/${encodeURIComponent(job.name)}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !job.enabled }),
    })
    load()
  }

  async function deleteJob(name: string) {
    if (!confirm(`删除 ${name}？`)) return
    await fetch(`/api/cron/jobs/${encodeURIComponent(name)}`, { method: 'DELETE' })
    load()
  }

  async function loadHistory(name: string) {
    setHistoryJob(name)
    try {
      const r = await fetch(`/api/cron/jobs/${encodeURIComponent(name)}/history`)
      if (!r.ok) { setHistory([]); return }
      const data = await r.json()
      setHistory(Array.isArray(data) ? data : [])
    } catch {
      setHistory([])
    }
  }

  const [saveError, setSaveError] = useState<string | null>(null)

  async function saveJob() {
    const nameDuplicate = !editingJob && jobs.some(j => j.name === newName.trim())
    if (!newName.trim() || !newSchedule.trim() || !scheduleValid || nameDuplicate) return
    setCreating(true)
    setSaveError(null)
    try {
      const r = await fetch('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          schedule: newSchedule,
          message: newMessage || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          enabled: editingJob ? editingJob.enabled : true,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({ detail: r.statusText }))
        setSaveError(String(body?.detail || r.statusText))
        return
      }
      closeForm()
      load()
    } finally {
      setCreating(false)
    }
  }

  const inputStyle = {
    backgroundColor: '#11111b',
    border: '1px solid #313244',
    borderRadius: '6px',
    padding: '0.4rem 0.6rem',
    color: '#cdd6f4',
    width: '100%',
    boxSizing: 'border-box' as const,
    fontSize: '0.8125rem',
  }

  const labelStyle = { fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.25rem' }

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#f9e2af', fontWeight: 700 }}>⏰ Cron Jobs</span>
        <span style={{ fontSize: '0.75rem', color: schedulerRunning ? '#a6e3a1' : '#f38ba8' }}>
          {schedulerRunning === null ? '' : schedulerRunning ? '● 调度器运行中' : '● 调度器未运行'}
        </span>
        <button onClick={openCreateForm} style={{ marginLeft: 'auto', backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}>
          + 新建
        </button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div style={{ backgroundColor: '#181825', borderBottom: '1px solid #313244', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.8125rem', color: '#f9e2af', fontWeight: 600, marginBottom: '0.25rem' }}>
            {editingJob ? `编辑任务：${editingJob.name}` : '新建任务'}
          </div>
          <div>
            <div style={labelStyle}>任务名称 *</div>
            {(() => {
              const nameDuplicate = !editingJob && !!newName.trim() && jobs.some(j => j.name === newName.trim())
              return (
                <>
                  <input
                    value={newName}
                    onChange={(e) => !editingJob && setNewName(e.target.value)}
                    placeholder="如：检查PR、发日报"
                    disabled={!!editingJob}
                    style={{
                      ...inputStyle,
                      opacity: editingJob ? 0.5 : 1,
                      cursor: editingJob ? 'not-allowed' : 'text',
                      borderColor: nameDuplicate ? '#f38ba8' : '#313244',
                    }}
                  />
                  {nameDuplicate && (
                    <div style={{ color: '#f38ba8', fontSize: '0.7rem', marginTop: '0.2rem' }}>
                      名称「{newName.trim()}」已存在，请使用其他名称或点击编辑修改现有任务
                    </div>
                  )}
                </>
              )
            })()}
          </div>
          <div>
            <div style={labelStyle}>执行时间 *</div>
            <CronSchedulePicker value={newSchedule} onChange={setNewSchedule} onValidChange={setScheduleValid} />
          </div>
          <div>
            <div style={labelStyle}>Agent 消息</div>
            <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="每天早上检查 PR..." style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={saveJob}
              disabled={creating || !newName.trim() || !scheduleValid || (!editingJob && jobs.some(j => j.name === newName.trim()))}
              style={{ backgroundColor: '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: creating || !newName.trim() || !scheduleValid || (!editingJob && jobs.some(j => j.name === newName.trim())) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: creating || !newName.trim() || !scheduleValid || (!editingJob && jobs.some(j => j.name === newName.trim())) ? 0.5 : 1 }}
            >
              {creating ? (editingJob ? '保存中…' : '创建中…') : (editingJob ? '保存' : '创建')}
            </button>
            <button onClick={closeForm} style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer' }}>
              取消
            </button>
          </div>
          {saveError && (
            <div style={{ color: '#f38ba8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              保存失败：{saveError}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#11111b', borderBottom: '1px solid #313244' }}>
              {['启用状态', '名称', 'Agent 消息', '执行时间', '上次状态', '上次运行', '下次运行', '操作'].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#6c7086', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <Fragment key={job.name}>
                <tr style={{ borderBottom: '1px solid #1e1e2e' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <button
                      onClick={() => toggle(job)}
                      title={job.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                      style={{ width: '36px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer', backgroundColor: job.enabled ? '#a6e3a1' : '#313244', transition: 'background-color 0.2s', position: 'relative' }}
                    >
                      <span style={{
                        position: 'absolute', top: '3px',
                        left: job.enabled ? '18px' : '3px',
                        width: '14px', height: '14px',
                        borderRadius: '50%',
                        backgroundColor: '#1e1e2e',
                        transition: 'left 0.2s',
                      }} />
                    </button>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: job.enabled ? '#cdd6f4' : '#6c7086' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      {job.name}
                      {job.running && (
                        <span style={{ fontSize: '0.65rem', backgroundColor: '#1e3a5f', color: '#89b4fa', border: '1px solid #89b4fa', borderRadius: '3px', padding: '0.05rem 0.35rem', animation: 'pulse 1.5s infinite' }}>
                          运行中…
                        </span>
                      )}
                      {job.created_by && !job.running && (
                        <span
                          title={`由 ${job.created_by.replace('cron:', '')} 执行时自动创建`}
                          style={{ fontSize: '0.65rem', backgroundColor: '#45475a', color: '#f9e2af', borderRadius: '3px', padding: '0.05rem 0.35rem', cursor: 'default' }}
                        >
                          Agent 创建
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#a6adc8', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={(job.payload as { message?: string } | undefined)?.message || (job.command ?? '')}>
                    {(job.payload as { message?: string } | undefined)?.message || job.command || <span style={{ color: '#45475a' }}>—</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#89b4fa' }} title={job.schedule}>
                    {cronToHumanReadable(job.schedule, false)}
                    {!(job.timezone) && (
                      <span title="此任务未设置时区，执行时间以 UTC 解释（非本地时间）"
                            style={{ marginLeft: '0.3rem', fontSize: '0.6rem', color: '#6c7086', verticalAlign: 'middle' }}>UTC</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}><StatusBadge status={job.last_status || ''} /></td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#6c7086' }}>{toLocalTime(job.last_run)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#6c7086' }}>{toLocalTime(job.next_run)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => openEditForm(job)} style={{ background: 'none', border: '1px solid #89b4fa', color: '#89b4fa', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>编辑</button>
                    <button onClick={() => historyJob === job.name ? setHistoryJob(null) : loadHistory(job.name)} style={{ background: 'none', border: '1px solid #313244', color: '#a6adc8', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>历史</button>
                    <button onClick={() => deleteJob(job.name)} style={{ background: 'none', border: '1px solid #f38ba8', color: '#f38ba8', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>删除</button>
                  </td>
                </tr>
                {historyJob === job.name && (
                  <tr>
                    <td colSpan={8} style={{ padding: '0.5rem 1rem', backgroundColor: '#11111b' }}>
                      {history.length === 0 && <div style={{ color: '#6c7086', fontSize: '0.75rem' }}>暂无执行历史</div>}
                      {history.slice(0, 10).map((h) => (
                        <div key={h.started_at} style={{ fontSize: '0.75rem', padding: '0.4rem 0', display: 'flex', flexDirection: 'column', gap: '0.25rem', borderBottom: '1px solid #1e1e2e' }}>
                          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                            <span style={{ color: '#6c7086', flexShrink: 0 }}>{toLocalTime(h.started_at)}</span>
                            <StatusBadge status={h.status} />
                            <HistoryOutputBlock stdout={h.stdout} stderr={h.stderr} />
                          </div>
                          {h.cron_side_effects && h.cron_side_effects.length > 0 && (
                            <div style={{ marginLeft: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                              {h.cron_side_effects.map((e, i) => (
                                <span key={i} style={{
                                  fontSize: '0.68rem',
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '3px',
                                  backgroundColor: e.action === 'created' ? '#1e3a20' : '#3a1e1e',
                                  color: e.action === 'created' ? '#a6e3a1' : '#f38ba8',
                                  border: `1px solid ${e.action === 'created' ? '#a6e3a1' : '#f38ba8'}`,
                                }}>
                                  {e.action === 'created' ? '⊕ 创建了任务' : '⊖ 删除了任务'} <strong>{e.job}</strong>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {jobs.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6c7086' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏰</div>
            <div>暂无定时任务，点击"+ 新建"创建</div>
          </div>
        )}
      </div>
    </div>
  )
}
