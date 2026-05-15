import { useEffect, useState } from 'react'
import type { FrontendRequest, SelectOption } from '../types/protocol'

interface Props {
  title: string
  command: string
  options: SelectOption[]
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

export default function SelectModal({ title, command, options, sendRequest, onClose }: Props) {
  const initialIdx = options.findIndex((o) => o.active)
  const [selected, setSelected] = useState(initialIdx >= 0 ? initialIdx : 0)

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(0, i - 1)) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(options.length - 1, i + 1)) }
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') { apply(options[selected]?.value || ''); }
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= options.length) apply(options[num - 1].value)
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [selected, options, onClose])

  function apply(value: string) {
    sendRequest({ type: 'apply_select_command', command, value })
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '1.25rem', maxWidth: '400px', width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#cdd6f4', marginBottom: '0.75rem' }}>{title}</div>
        <div style={{ border: '1px solid #313244', borderRadius: '6px', overflow: 'hidden' }}>
          {options.map((opt, i) => (
            <div
              key={opt.value}
              onClick={() => apply(opt.value)}
              onMouseEnter={() => setSelected(i)}
              style={{
                padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                backgroundColor: i === selected ? '#313244' : 'transparent',
                borderBottom: i < options.length - 1 ? '1px solid #1e1e2e' : 'none',
              }}
            >
              <span style={{ color: opt.active ? '#89b4fa' : '#45475a', flexShrink: 0 }}>{opt.active ? '●' : '○'}</span>
              <div>
                <div style={{ fontSize: '0.8125rem', color: i === selected ? '#cdd6f4' : '#a6adc8' }}>{opt.label || opt.value}</div>
                {opt.description && <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{opt.description}</div>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#45475a', textAlign: 'center' }}>
          ↑↓ 导航 · Enter 确认 · 1-9 快选 · Esc 取消
        </div>
      </div>
    </div>
  )
}
