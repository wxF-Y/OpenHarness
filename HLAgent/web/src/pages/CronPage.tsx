import { useEffect, useState } from 'react'

interface CronJob {
  name: string
  schedule: string
  command?: string
  enabled: boolean
  last_run?: string
  next_run?: string
  last_status?: string
  payload?: Record<string, unknown>
}

interface HistoryEntry {
  name: string
  started_at: string
  status: string
  output?: string
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'success' ? '#a6e3a1' : status === 'error' ? '#f38ba8' : '#6c7086'
  return <span style={{ color, fontSize: '0.75rem' }}>{status || 'n/a'}</span>
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [schedulerRunning, setSchedulerRunning] = useState<boolean | null>(null)
  const [historyJob, setHistoryJob] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [newName, setNewName] = useState('')
  const [newSchedule, setNewSchedule] = useState('0 9 * * 1-5')
  const [newMessage, setNewMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)

  function load() {
    fetch('/api/cron/jobs').then((r) => r.json()).then(setJobs).catch(() => {})
    fetch('/api/cron/scheduler/status').then((r) => r.json()).then((d) => setSchedulerRunning(d.running)).catch(() => {})
  }

  useEffect(() => { load() }, [])

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
    const r = await fetch(`/api/cron/jobs/${encodeURIComponent(name)}/history`)
    setHistory(await r.json())
  }

  async function createJob() {
    if (!newName.trim() || !newSchedule.trim()) return
    setCreating(true)
    await fetch('/api/cron/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, schedule: newSchedule, message: newMessage || undefined }),
    })
    setCreating(false)
    setShowForm(false)
    setNewName(''); setNewSchedule('0 9 * * 1-5'); setNewMessage('')
    load()
  }

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#f9e2af', fontWeight: 700 }}>⏰ Cron Jobs</span>
        <span style={{ fontSize: '0.75rem', color: schedulerRunning ? '#a6e3a1' : '#f38ba8' }}>
          {schedulerRunning === null ? '' : schedulerRunning ? '● 调度器运行中' : '● 调度器未运行'}
        </span>
        <button onClick={() => setShowForm(!showForm)} style={{ marginLeft: 'auto', backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}>
          + 新建
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{ backgroundColor: '#181825', borderBottom: '1px solid #313244', padding: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.25rem' }}>名称 *</div>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-job" style={{ backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', width: '140px' }} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.25rem' }}>Schedule *</div>
            <input value={newSchedule} onChange={(e) => setNewSchedule(e.target.value)} placeholder="0 9 * * 1-5" style={{ backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', width: '160px', fontFamily: 'monospace' }} />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '0.75rem', color: '#6c7086', marginBottom: '0.25rem' }}>Agent 消息</div>
            <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="每天早上检查 PR..." style={{ backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', width: '100%', boxSizing: 'border-box' }} />
          </div>
          <button onClick={createJob} disabled={creating || !newName.trim()} style={{ backgroundColor: '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, flexShrink: 0 }}>
            {creating ? '创建中…' : '创建'}
          </button>
          <button onClick={() => setShowForm(false)} style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer', flexShrink: 0 }}>取消</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Job list */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#11111b', borderBottom: '1px solid #313244' }}>
              {['', '名称', 'Schedule', '上次状态', '上次运行', '下次运行', '操作'].map((h) => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#6c7086', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <>
                <tr key={job.name} style={{ borderBottom: '1px solid #1e1e2e' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <button
                      onClick={() => toggle(job)}
                      style={{ width: '36px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer', backgroundColor: job.enabled ? '#a6e3a1' : '#313244', transition: 'background-color 0.2s' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: job.enabled ? '#cdd6f4' : '#6c7086' }}>{job.name}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', color: '#89b4fa' }}>{job.schedule}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}><StatusBadge status={job.last_status || ''} /></td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#6c7086' }}>{job.last_run ? job.last_run.slice(0, 16) : '-'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#6c7086' }}>{job.next_run ? job.next_run.slice(0, 16) : '-'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => historyJob === job.name ? setHistoryJob(null) : loadHistory(job.name)} style={{ background: 'none', border: '1px solid #313244', color: '#a6adc8', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>历史</button>
                    <button onClick={() => deleteJob(job.name)} style={{ background: 'none', border: '1px solid #f38ba8', color: '#f38ba8', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>删除</button>
                  </td>
                </tr>
                {historyJob === job.name && (
                  <tr key={job.name + '-history'}>
                    <td colSpan={7} style={{ padding: '0.5rem 1rem', backgroundColor: '#11111b' }}>
                      {history.length === 0 && <div style={{ color: '#6c7086', fontSize: '0.75rem' }}>暂无执行历史</div>}
                      {history.slice(0, 10).map((h, i) => (
                        <div key={i} style={{ fontSize: '0.75rem', padding: '0.2rem 0', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                          <span style={{ color: '#6c7086' }}>{h.started_at?.slice(0, 16) || '-'}</span>
                          <StatusBadge status={h.status} />
                          {h.output && <span style={{ color: '#a6adc8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>{h.output.slice(0, 100)}</span>}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </>
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

