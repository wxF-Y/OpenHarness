import { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
  duration: number
}

interface ToastCtx {
  show: (message: string, variant?: ToastVariant, duration?: number) => void
}

const ToastContext = createContext<ToastCtx>({ show: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, item.duration)
    return () => clearTimeout(t)
  }, [item.duration, onClose])

  const bg = item.variant === 'success' ? '#a6e3a1' : item.variant === 'error' ? '#f38ba8' : '#89b4fa'
  const lines = item.message.split('\n')

  return (
    <div
      onClick={onClose}
      style={{
        minWidth: 240, maxWidth: 360, padding: '10px 14px', borderRadius: 8,
        background: bg, color: '#1e1e2e', fontSize: '0.8125rem', fontWeight: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)', cursor: 'pointer',
        animation: 'slideInRight 200ms ease',
      }}
    >
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const show = useCallback((message: string, variant: ToastVariant = 'info', duration = 3000) => {
    counterRef.current += 1
    const id = `toast_${Date.now()}_${counterRef.current}`
    setToasts(prev => [...prev.slice(-2), { id, message, variant, duration }])
  }, [])

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 200,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <Toast item={t} onClose={() => remove(t.id)} />
          </div>
        ))}
      </div>
      <style>{`@keyframes slideInRight { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </ToastContext.Provider>
  )
}
