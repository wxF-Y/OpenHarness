import { useEffect, useRef, useState } from 'react'
import type { FrontendRequest } from '../types/protocol'

const SELECTABLE_COMMANDS = new Set([
  '/provider', '/model', '/theme', '/output-style', '/permissions',
  '/resume', '/effort', '/passes', '/turns', '/fast', '/vim', '/voice',
])

interface Props {
  commands: string[]
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

export default function CommandPalette({ commands, sendRequest, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = commands.filter((c) =>
    c.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 20)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSelected(0) }, [query])

  function execute(cmd: string) {
    if (SELECTABLE_COMMANDS.has(cmd)) {
      sendRequest({ type: 'select_command', command: cmd.slice(1) })
    } else if (cmd === '/plan') {
      sendRequest({ type: 'submit_line', line: '/plan' })
    } else {
      sendRequest({ type: 'submit_line', line: cmd })
    }
    onClose()
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(filtered.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(0, i - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); if (filtered[selected]) execute(filtered[selected]) }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '20vh', zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '10px', width: '480px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <div style={{ padding: '0.75rem', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#6c7086', fontSize: '0.875rem' }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="搜索命令…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#cdd6f4', fontSize: '0.9rem' }}
          />
        </div>
        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '0.75rem 1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>无匹配命令</div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd}
              onClick={() => execute(cmd)}
              style={{
                padding: '0.45rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: i === selected ? '#313244' : 'transparent',
              }}
            >
              <span style={{ fontSize: '0.8125rem', color: i === selected ? '#cdd6f4' : '#a6adc8', fontFamily: 'monospace' }}>{cmd}</span>
              {SELECTABLE_COMMANDS.has(cmd) && (
                <span style={{ fontSize: '0.65rem', color: '#6c7086', backgroundColor: '#313244', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>select</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '0.35rem 1rem', borderTop: '1px solid #313244', fontSize: '0.65rem', color: '#45475a', display: 'flex', gap: '1rem' }}>
          <span>↑↓ 导航</span><span>Enter 执行</span><span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
