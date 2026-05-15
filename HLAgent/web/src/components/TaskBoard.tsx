import { useTaskStore } from '../stores/taskStore'
import MDRenderer from './MDRenderer'

const STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  in_progress: '🔄',
  completed: '✅',
  done: '✅',
  error: '❌',
}

export default function TaskBoard() {
  const { tasks, todoMarkdown } = useTaskStore()

  if (tasks.length === 0 && !todoMarkdown) {
    return (
      <div style={{ padding: '0.75rem 1rem', color: '#45475a', fontSize: '0.75rem', textAlign: 'center' }}>
        暂无任务
      </div>
    )
  }

  return (
    <div style={{ fontSize: '0.8125rem' }}>
      <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#6c7086', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Tasks
      </div>

      {/* Structured tasks from tasks_snapshot */}
      {tasks.length > 0 && (
        <div>
          {tasks.map((t) => (
            <div
              key={t.id}
              style={{ padding: '0.35rem 0.75rem', borderBottom: '1px solid #1e1e2e', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}
            >
              <span style={{ flexShrink: 0 }}>{STATUS_ICON[t.status] || '⏳'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.description}
                </div>
                {t.metadata?.progress && (
                  <div style={{ color: '#6c7086', fontSize: '0.7rem' }}>{t.metadata.progress}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Markdown tasks from todo_update */}
      {todoMarkdown && tasks.length === 0 && (
        <div style={{ padding: '0.4rem 0.75rem' }}>
          <MDRenderer content={todoMarkdown} compact />
        </div>
      )}
    </div>
  )
}
