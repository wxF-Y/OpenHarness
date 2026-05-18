import { useEffect } from 'react'
import type { FrontendRequest } from '../types/protocol'
import { useUiStore } from '../stores/uiStore'

interface Props {
  toolName?: string
  reason?: string
  requestId: string
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

export default function PermissionModal({ toolName, reason, requestId, sendRequest, onClose }: Props) {
  const { addErrorToast } = useUiStore()

  const isSensitive = reason?.includes('sensitive credential') || reason?.includes('credential path')
  const isPackageInstall = reason?.includes('Package installation') || reason?.includes('package management')

  function allowOnce() {
    sendRequest({ type: 'permission_response', request_id: requestId, allowed: true })
    onClose()
  }

  function deny() {
    sendRequest({ type: 'permission_response', request_id: requestId, allowed: false })
    onClose()
  }

  function allowAll() {
    // 1. Allow the current request
    sendRequest({ type: 'permission_response', request_id: requestId, allowed: true })
    // 2. Switch to full_auto mode (writes to global settings)
    sendRequest({ type: 'submit_line', line: '/permissions full_auto' })
    onClose()
    // 3. Warn user with a warning-style toast
    addErrorToast(
      '已切换到全自动模式。所有工具将自动放行，重启 Gateway 后仍生效。',
      'warning'
    )
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

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            onClick={deny}
            style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            N 拒绝
          </button>
          <button
            onClick={allowOnce}
            style={{ backgroundColor: isSensitive ? '#f38ba8' : '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
          >
            Y 允许
          </button>
          {!isSensitive && (
            <button
              onClick={allowAll}
              title="切换到全自动模式，后续工具将自动放行（写入全局配置）"
              style={{ backgroundColor: '#313244', color: '#f9e2af', border: '1px solid #f9e2af44', borderRadius: '6px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem' }}
            >
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

