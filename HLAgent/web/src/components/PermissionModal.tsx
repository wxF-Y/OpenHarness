import { useEffect } from 'react'
import type { FrontendRequest } from '../types/protocol'
import { useUiStore } from '../stores/uiStore'

interface Props {
  toolName?: string
  reason?: string
  toolInput?: Record<string, unknown>
  requestId: string
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

function formatToolInput(toolName: string | undefined, input: Record<string, unknown>): string {
  if (!toolName) return JSON.stringify(input, null, 2)

  if (toolName === 'bash' && typeof input.command === 'string') return input.command

  const path = input.file_path ?? input.path ?? input.notebook_path
  if (typeof path === 'string') {
    if (toolName === 'write_file' && typeof input.content === 'string') {
      const lines = input.content.split('\n').slice(0, 6).join('\n')
      const more = input.content.split('\n').length > 6 ? '\n…' : ''
      return `${path}\n\n${lines}${more}`
    }
    if (toolName === 'edit_file') {
      const old = typeof input.old_string === 'string' ? input.old_string.slice(0, 80) : ''
      const nw = typeof input.new_string === 'string' ? input.new_string.slice(0, 80) : ''
      return `${path}\n\n- ${old}\n+ ${nw}`
    }
    return path
  }

  if (toolName === 'todo_write' && Array.isArray(input.todos)) {
    return (input.todos as Array<{ content?: string; status?: string }>)
      .slice(0, 8)
      .map(t => `[${t.status ?? '?'}] ${t.content ?? ''}`)
      .join('\n')
  }

  if (typeof input.pattern === 'string') return input.pattern
  if (typeof input.query === 'string') return input.query
  if (typeof input.url === 'string') return input.url

  const entries = Object.entries(input)
  if (entries.length === 1) return String(entries[0][1]).slice(0, 300)
  return JSON.stringify(input, null, 2).slice(0, 400)
}

export default function PermissionModal({ toolName, reason, toolInput, requestId, sendRequest, onClose }: Props) {
  const { addErrorToast } = useUiStore()

  const isSensitive = reason?.includes('sensitive credential') || reason?.includes('credential path')
  const isPackageInstall = reason?.includes('Package installation') || reason?.includes('package management')
  const inputSummary = toolInput ? formatToolInput(toolName, toolInput) : null

  function allowOnce() {
    sendRequest({ type: 'permission_response', request_id: requestId, allowed: true })
    onClose()
  }

  function deny() {
    sendRequest({ type: 'permission_response', request_id: requestId, allowed: false })
    onClose()
  }

  function allowAll() {
    sendRequest({ type: 'permission_response', request_id: requestId, allowed: true })
    sendRequest({ type: 'submit_line', line: '/permissions full_auto' })
    onClose()
    addErrorToast('已切换到全自动模式。所有工具将自动放行，重启 Gateway 后仍生效。', 'warning')
  }

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'y') { allowOnce() }
      else if (e.key.toLowerCase() === 'n' || e.key === 'Escape') { deny() }
      else if (e.key === 'Enter') { allowOnce() }
      else if ((e.key === 'a' || e.key === 'A') && !isSensitive) { allowAll() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, isSensitive])

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '1.5rem', maxWidth: '520px', width: '92%' }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: '#f9e2af', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          ⚠️ 权限请求
        </div>

        {isSensitive && (
          <div style={{ backgroundColor: 'rgba(243,139,168,0.1)', border: '1px solid #f38ba8', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#f38ba8' }}>
            🔴 敏感文件访问警告：AI 正尝试访问凭据文件，建议拒绝。
          </div>
        )}

        {isPackageInstall && (
          <div style={{ backgroundColor: 'rgba(249,226,175,0.1)', border: '1px solid #f9e2af', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#f9e2af' }}>
            📦 包管理命令会修改工作区，默认模式不会自动执行。
          </div>
        )}

        <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
          <span style={{ color: '#6c7086' }}>工具: </span>
          <span style={{ color: '#cba6f7', fontWeight: 600 }}>{toolName || 'tool'}</span>
        </div>

        {inputSummary && (
          <div style={{ marginBottom: '0.75rem' }}>
            <pre style={{
              backgroundColor: '#11111b',
              color: '#cdd6f4',
              fontSize: '0.8rem',
              padding: '0.6rem 0.75rem',
              borderRadius: '6px',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: '180px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              lineHeight: 1.5,
            }}>
              {inputSummary}
            </pre>
          </div>
        )}

        {reason && (
          <div style={{ fontSize: '0.75rem', color: '#585b70', marginBottom: '1.25rem' }}>
            {reason.split('.')[0]}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={deny} style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            N 拒绝
          </button>
          <button onClick={allowOnce} style={{ backgroundColor: isSensitive ? '#f38ba8' : '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
            Y 允许
          </button>
          {!isSensitive && (
            <button onClick={allowAll} title="切换到全自动模式，后续工具将自动放行（写入全局配置）" style={{ backgroundColor: '#313244', color: '#f9e2af', border: '1px solid #f9e2af44', borderRadius: '6px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem' }}>
              ⚡ 本次全部允许
            </button>
          )}
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', color: '#45475a', marginTop: '0.75rem' }}>
          Y/Enter 允许 · N/Esc 拒绝{!isSensitive ? ' · A 本次全部允许' : ''}
        </div>
      </div>
    </div>
  )
}
