import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../types/api'

interface ExpertRole {
  name: string
  description: string
  dept: string
  rolePrefix: string
}

interface Props {
  onCreated: (sessionId: string) => void
  onClose: () => void
  expertRole?: ExpertRole
}

export default function CreateSessionModal({ onCreated, onClose, expertRole }: Props) {
  const [cwdInput, setCwdInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCreate = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      if (cwdInput.trim()) body.cwd = cwdInput.trim()
      if (expertRole) {
        body.role_prefix = expertRole.rolePrefix
        body.expert_role = expertRole.name
        body.expert_role_label = expertRole.description
      }
      const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.status === 422) {
        const data = await r.json().catch(() => ({}))
        setError(data.detail || '路径无效')
        return
      }
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setError(data.detail || '创建失败，请重试')
        return
      }
      const data: SessionSummary = await r.json()
      onCreated(data.session_id)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setCreating(false)
    }
  }, [cwdInput, expertRole, onCreated])

  async function handleBrowse() {
    setBrowsing(true)
    try {
      const r = await fetch('/api/fs/open-directory-dialog')
      if (!r.ok) { setError('无法打开目录选择窗口'); return }
      const data = await r.json()
      if (!data.cancelled && data.path) {
        setCwdInput(data.path)
        setError(null)
      }
    } catch {
      setError('无法打开目录选择窗口')
    } finally {
      setBrowsing(false)
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Enter' && !creating && !browsing) { void handleCreate() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [creating, browsing, handleCreate, onClose])

  const cwdLabel = expertRole ? '代码目录（如需处理文件，可选）' : '工作目录（可选）'
  const cwdHelp = expertRole
    ? '留空时将自动创建工作区，删除会话时一并清理'
    : '留空将自动创建临时工作目录'
  const confirmLabel = expertRole ? '开始对话 →' : '创建对话 →'
  const title = expertRole ? `与 ${expertRole.description} 开始对话` : '新建对话'

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,17,27,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#181825', border: '1px solid #313244', borderRadius: 10, padding: '1.5rem', maxWidth: 520, width: '92%', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ marginBottom: expertRole ? '0' : '1.25rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#cdd6f4', marginBottom: '0.3rem' }}>{title}</div>
          {!expertRole && (
            <div style={{ fontSize: '0.8125rem', color: '#6c7086' }}>选择 Agent 的工作目录，Agent 将在此目录读写文件和执行代码</div>
          )}
        </div>

        {/* Expert info section */}
        {expertRole && (
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ padding: '0.6rem 0', borderBottom: '1px solid #313244', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.875rem', color: '#cba6f7', fontWeight: 600 }}>🎭 {expertRole.description}</div>
              <div style={{ fontSize: '0.75rem', color: '#6c7086', marginTop: '0.15rem' }}>{expertRole.dept}</div>
            </div>
          </div>
        )}

        {/* Path input row */}
        <div style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.8125rem', color: '#a6adc8', display: 'block', marginBottom: '0.4rem' }}>{cwdLabel}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={inputRef}
              value={cwdInput}
              onChange={(e) => { setCwdInput(e.target.value); setError(null) }}
              placeholder="留空自动分配"
              style={{
                flex: 1, background: '#11111b', border: '1px solid #313244', borderRadius: 6,
                color: '#cdd6f4', padding: '0.45rem 0.6rem', fontSize: '0.8125rem', fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={handleBrowse}
              disabled={browsing}
              style={{
                background: 'none', border: '1px solid #313244', borderRadius: 6,
                color: browsing ? '#6c7086' : '#a6adc8',
                cursor: browsing ? 'not-allowed' : 'pointer',
                padding: '0.45rem 0.7rem', fontSize: '0.8125rem', flexShrink: 0,
              }}
            >
              {browsing ? '⟳' : '📁'} 浏览
            </button>
          </div>
        </div>

        {/* Help / error text */}
        <div style={{ fontSize: '0.72rem', marginBottom: '1.25rem', minHeight: '1.1rem' }}>
          {error ? (
            <span style={{ color: '#f38ba8' }}>❌ {error}</span>
          ) : (
            <span style={{ color: '#6c7086' }}>
              {expertRole ? cwdHelp : (
                <>留空将自动创建临时工作目录（<span style={{ color: '#f9e2af' }}>⚠ 删除会话时目录内容将被永久清除</span>）</>
              )}
            </span>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ background: '#313244', border: 'none', borderRadius: 6, color: '#cdd6f4', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              background: creating ? '#6c7086' : '#89b4fa', border: 'none', borderRadius: 6,
              color: '#1e1e2e', padding: '0.5rem 1.2rem', cursor: creating ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: 600,
            }}
          >
            {creating ? '⟳ 创建中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
