import { useEffect } from 'react'
import { useUiStore, type ErrorToast as ErrorToastType } from '../stores/uiStore'

function Toast({ toast, onDismiss }: { toast: ErrorToastType; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{
      backgroundColor: '#181825', border: '1px solid #f38ba8', borderRadius: '8px',
      padding: '0.6rem 0.75rem', maxWidth: '360px', display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      <span style={{ color: '#f38ba8', flexShrink: 0 }}>✗</span>
      <span style={{ fontSize: '0.8125rem', color: '#cdd6f4', flex: 1 }}>{toast.message}</span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 }}>×</button>
    </div>
  )
}

export default function ErrorToastContainer() {
  const { errorToasts, removeErrorToast } = useUiStore()

  if (errorToasts.length === 0) return null

  return (
    <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {errorToasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => removeErrorToast(t.id)} />
      ))}
    </div>
  )
}
