import { useEffect } from 'react'
import type { FrontendRequest } from '../types/protocol'

interface Props {
  toolName?: string
  reason?: string
  requestId: string
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

export default function PermissionModal({ toolName, reason, requestId, sendRequest, onClose }: Props) {
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'y') {
        sendRequest({ type: 'permission_response', request_id: requestId, allowed: true })
        onClose()
      } else if (e.key.toLowerCase() === 'n' || e.key === 'Escape') {
        sendRequest({ type: 'permission_response', request_id: requestId, allowed: false })
        onClose()
      } else if (e.key === 'Enter') {
        sendRequest({ type: 'permission_response', request_id: requestId, allowed: true })
        onClose()
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [requestId, sendRequest, onClose])

  const isSensitive = reason?.includes('sensitive credential') || reason?.includes('credential path')
  const isPackageInstall = reason?.includes('Package installation') || reason?.includes('package management')

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '1.5rem', maxWidth: '480px', width: '90%' }}>
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

        <div style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
          <span style={{ color: '#6c7086' }}>工具: </span>
          <span style={{ color: '#cba6f7', fontWeight: 600 }}>{toolName || 'tool'}</span>
        </div>

        {reason && (
          <div style={{ fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '1.25rem', backgroundColor: '#11111b', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
            {reason.split('.')[0]}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { sendRequest({ type: 'permission_response', request_id: requestId, allowed: false }); onClose() }}
            style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            N 拒绝
          </button>
          <button
            onClick={() => { sendRequest({ type: 'permission_response', request_id: requestId, allowed: true }); onClose() }}
            style={{ backgroundColor: isSensitive ? '#f38ba8' : '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
          >
            Y 允许
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', color: '#45475a', marginTop: '0.75rem' }}>
          键盘: Y 允许 / N 或 Esc 拒绝 / Enter 允许
        </div>
      </div>
    </div>
  )
}
