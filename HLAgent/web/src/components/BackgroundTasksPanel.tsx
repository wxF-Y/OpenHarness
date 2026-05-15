import { useEffect, useState } from 'react'

interface BgTask {
  id: string
  type: string
  status: string
  description: string
  metadata: Record<string, string>
  output?: string
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#f9e2af',
  running: '#89b4fa',
  in_progress: '#89b4fa',
  completed: '#a6e3a1',
  done: '#a6e3a1',
  error: '#f38ba8',
  failed: '#f38ba8',
  stopped: '#6c7086',
}

const TYPE_ICON: Record<string, string> = {
  local_agent: '🤖',
  remote_agent: '🌐',
  in_process_teammate: '⚡',
  shell: '🖥️',
  local_shell: '🖥️',
}

export default function BackgroundTasksPanel() {
  const [tasks, setTasks] = useState<BgTask[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      fetch('/api/tasks').then((r) => r.json()).then(setTasks).catch(() => {})
    }
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadOutput(id: string) {
    if (expanded === id) { setExpanded(null); return }
    const r = await fetch(`/api/tasks/${id}`)
    if (r.ok) {
      const data = await r.json()
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, output: data.output } : t))
    }
    setExpanded(id)
  }

  async function stopTask(id: string) {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: 'stopped' } : t))
  }

  if (tasks.length === 0) return (
    <div style={{ padding: '0.75rem', color: '#45475a', fontSize: '0.75rem', textAlign: 'center' }}>
      无后台任务
    </div>
  )

  return (
    <div style={{ fontSize: '0.8125rem' }}>
      <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#6c7086', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Background Tasks
      </div>
      {tasks.map((t) => (
        <div key={t.id} style={{ borderBottom: '1px solid #1e1e2e' }}>
          <div style={{ padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ flexShrink: 0 }}>{TYPE_ICON[t.type] || '📋'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cdd6f4' }}>
                {t.description}
              </div>
              <div style={{ fontSize: '0.7rem' }}>
                <span style={{ color: STATUS_COLOR[t.status] || '#6c7086' }}>{t.status}</span>
                {t.metadata?.progress && <span style={{ color: '#6c7086', marginLeft: '0.4rem' }}>{t.metadata.progress}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
              <button onClick={() => loadOutput(t.id)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}>
                {expanded === t.id ? '▲' : '▼'}
              </button>
              {(t.status === 'running' || t.status === 'in_progress') && (
                <button onClick={() => stopTask(t.id)} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: '0.7rem', padding: '0.1rem 0.3rem' }}>
                  ■
                </button>
              )}
            </div>
          </div>
          {expanded === t.id && t.output && (
            <div style={{ padding: '0.25rem 0.75rem 0.4rem 2.25rem' }}>
              <pre style={{ backgroundColor: '#11111b', borderRadius: '4px', padding: '0.35rem 0.5rem', fontSize: '0.7rem', margin: 0, overflowX: 'auto', color: '#a6adc8', fontFamily: 'monospace', maxHeight: '120px', overflow: 'auto' }}>
                {t.output.slice(-1000)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
