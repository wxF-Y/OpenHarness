import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrontendRequest } from '../types/protocol'

interface CommandPickerProps {
  hints: string[]
  selected: number
  onSelect: (cmd: string) => void
}

function CommandPicker({ hints, selected, onSelect }: CommandPickerProps) {
  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0,
      backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '6px',
      marginBottom: '4px', maxHeight: '220px', overflowY: 'auto', zIndex: 100,
    }}>
      {hints.map((h, i) => (
        <div
          key={h}
          onClick={() => onSelect(h)}
          style={{
            padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem',
            backgroundColor: i === selected ? '#313244' : 'transparent',
            color: i === selected ? '#89b4fa' : '#cdd6f4',
          }}
        >
          {h}
        </div>
      ))}
    </div>
  )
}

// Commands that trigger a SelectModal via select_command instead of submit_line
const SELECTABLE_COMMANDS = new Set([
  '/provider', '/model', '/theme', '/output-style', '/permissions',
  '/resume', '/effort', '/passes', '/turns', '/fast', '/vim', '/voice',
])

interface Props {
  busy: boolean
  commands: string[]
  sendRequest: (req: FrontendRequest) => void
  wsStatus: string
  initialValue?: string
}

export default function MessageInput({ busy, commands, sendRequest, wsStatus, initialValue }: Props) {
  const [input, setInput] = useState(initialValue ?? '')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [pickerIdx, setPickerIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const commandHints = input.startsWith('/')
    ? commands.filter((c) => c.startsWith(input)).slice(0, 10)
    : []
  const showPicker = commandHints.length > 0 && !busy

  // Reset picker when hints change
  useEffect(() => { setPickerIdx(0) }, [commandHints.length, input])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const handleCommand = useCallback((cmd: string): boolean => {
    const trimmed = cmd.trim()
    if (SELECTABLE_COMMANDS.has(trimmed)) {
      sendRequest({ type: 'select_command', command: trimmed.slice(1) })
      return true
    }
    if (trimmed === '/plan') {
      sendRequest({ type: 'submit_line', line: '/plan' })
      return true
    }
    return false
  }, [sendRequest])

  function submit(value: string) {
    const trimmed = value.trim()
    if (!trimmed || busy || wsStatus !== 'ready') return

    if (handleCommand(trimmed)) {
      setHistory((h) => [...h, trimmed])
      setHistoryIdx(-1)
      setInput('')
      return
    }

    sendRequest({ type: 'submit_line', line: trimmed })
    setHistory((h) => [...h, trimmed])
    setHistoryIdx(-1)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showPicker) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIdx((i) => Math.max(0, i - 1)) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIdx((i) => Math.min(commandHints.length - 1, i + 1)) }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const sel = commandHints[pickerIdx]
        if (sel) { setInput(''); if (!handleCommand(sel)) submit(sel) }
        return
      }
      if (e.key === 'Tab') { e.preventDefault(); setInput(commandHints[pickerIdx] || input); return }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); return }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); return }
    if (e.key === 'Escape') {
      if (busy) { sendRequest({ type: 'interrupt' }); return }
      setInput('')
      return
    }
    if (!showPicker && e.key === 'ArrowUp' && !input) {
      e.preventDefault()
      const nextIdx = Math.min(history.length - 1, historyIdx + 1)
      if (nextIdx >= 0) { setHistoryIdx(nextIdx); setInput(history[history.length - 1 - nextIdx] || '') }
    }
    if (!showPicker && e.key === 'ArrowDown' && historyIdx > -1) {
      e.preventDefault()
      const nextIdx = historyIdx - 1
      setHistoryIdx(nextIdx)
      setInput(nextIdx === -1 ? '' : (history[history.length - 1 - nextIdx] || ''))
    }
  }

  const disabled = wsStatus === 'terminated' || wsStatus === 'connecting'

  return (
    <div style={{ position: 'relative', borderTop: '1px solid #313244', backgroundColor: '#181825' }}>
      {showPicker && (
        <CommandPicker
          hints={commandHints}
          selected={pickerIdx}
          onSelect={(cmd) => { setInput(''); if (!handleCommand(cmd)) submit(cmd) }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', padding: '0.5rem 0.75rem' }}>
        <span style={{ color: '#89b4fa', paddingBottom: '0.4rem', fontSize: '0.875rem' }}>✦</span>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || busy}
          placeholder={disabled ? '会话未连接' : busy ? '运行中…' : '输入消息，Enter 发送，/ 命令，↑↓ 历史'}
          rows={1}
          style={{
            flex: 1, resize: 'none', background: 'none', border: 'none', outline: 'none',
            color: '#cdd6f4', fontSize: '0.875rem', lineHeight: 1.5, padding: '0.35rem 0',
            fontFamily: 'inherit', opacity: (disabled || busy) ? 0.5 : 1,
            minHeight: '28px', maxHeight: '200px',
          }}
        />

        {busy ? (
          <button
            onClick={() => sendRequest({ type: 'interrupt' })}
            style={{ backgroundColor: '#f38ba8', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            ■ 停止
          </button>
        ) : (
          <button
            onClick={() => submit(input)}
            disabled={!input.trim() || disabled}
            style={{ backgroundColor: input.trim() && !disabled ? '#89b4fa' : '#313244', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: input.trim() && !disabled ? 'pointer' : 'not-allowed', fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap', opacity: input.trim() && !disabled ? 1 : 0.5 }}
          >
            发送
          </button>
        )}
      </div>

      <div style={{ padding: '0 0.75rem 0.4rem', fontSize: '0.7rem', color: '#45475a', display: 'flex', gap: '1rem' }}>
        <span><span style={{ color: '#585b70' }}>Enter</span> 发送</span>
        <span><span style={{ color: '#585b70' }}>Shift+Enter</span> 换行</span>
        <span><span style={{ color: '#585b70' }}>/</span> 命令</span>
        <span><span style={{ color: '#585b70' }}>↑↓</span> 历史</span>
        {busy && <span><span style={{ color: '#585b70' }}>Esc</span> 停止</span>}
      </div>
    </div>
  )
}
