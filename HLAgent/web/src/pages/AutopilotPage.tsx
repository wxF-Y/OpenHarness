import { useEffect, useState } from 'react'

interface AutopilotTask {
  title: string
  status: string
  source: string
  created_at: string
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#f9e2af',
  running: '#89b4fa',
  completed: '#a6e3a1',
  failed: '#f38ba8',
}

export default function AutopilotPage() {
  const [tasks, setTasks] = useState<AutopilotTask[]>([])
  const [taskText, setTaskText] = useState('')
  const [shipping, setShipping] = useState(false)

  function load() {
    fetch('/api/autopilot/tasks').then((r) => r.json()).then(setTasks).catch(() => setTasks([]))
  }
  useEffect(() => { load() }, [])

  async function ship() {
    if (!taskText.trim()) return
    setShipping(true)
    await fetch('/api/autopilot/ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: taskText }),
    })
    setShipping(false)
    setTaskText('')
    setTimeout(load, 500)
  }

  return (
    <div style={{ height: '100vh', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#89b4fa', fontWeight: 700 }}>🚀 Autopilot</span>
      </div>

      {/* Submit form */}
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #313244', display: 'flex', gap: '0.75rem' }}>
        <input
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ship()}
          placeholder="描述任务，例如：修复登录页面的 bug…"
          style={{ flex: 1, backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', fontSize: '0.875rem' }}
        />
        <button onClick={ship} disabled={shipping || !taskText.trim()} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: shipping || !taskText.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: shipping || !taskText.trim() ? 0.6 : 1 }}>
          {shipping ? '提交中…' : '🚀 提交任务'}
        </button>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
        {tasks.length === 0 && <div style={{ textAlign: 'center', color: '#6c7086', marginTop: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🚀</div>
          <div>暂无任务</div>
        </div>}
        {tasks.map((t, i) => (
          <div key={i} style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: STATUS_COLOR[t.status] || '#6c7086', display: 'inline-block' }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{t.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: STATUS_COLOR[t.status] || '#6c7086' }}>{t.status}</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>
              {t.source && <span>{t.source} · </span>}
              {t.created_at}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

