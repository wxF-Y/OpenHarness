import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrontendRequest } from '../types/protocol'
import AttachmentStrip from './AttachmentStrip'
import { useAttachments } from '../hooks/useAttachments'
import { useToast } from './Toast'

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
  placeholder?: string
}

export default function MessageInput({ busy, commands, sendRequest, wsStatus, initialValue, placeholder }: Props) {
  const [input, setInput] = useState(initialValue ?? '')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [pickerIdx, setPickerIdx] = useState(0)
  const [sending, setSending] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dialogLoading, setDialogLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)  // images only (base64 needed)
  const toast = useToast()
  const { attachments, addFiles, addFromDialog, removeFile, clearAll, toPayloads } = useAttachments()

  const pasteCountRef = useRef<Record<string, number>>({})

  /** Open the OS native file dialog via the Gateway, get the real full path. */
  async function openNativeDialog() {
    if (dialogLoading) return
    setDialogLoading(true)
    try {
      const res = await fetch('/api/fs/open-dialog')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.cancelled) {
        addFromDialog(data)
      }
    } catch (err) {
      toast.show(`打开文件对话框失败：${err}`, 'error', 4000)
    } finally {
      setDialogLoading(false)
    }
  }

  /** Images selected via browser picker → base64 inline for vision models. */
  async function handleImagePickerChange(files: File[]) {
    const { errors } = await addFiles(files)
    for (const err of errors) toast.show(err, 'error', 4000)
  }

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
    const hasAttachments = attachments.length > 0
    if ((!trimmed && !hasAttachments) || busy || wsStatus !== 'ready') return

    if (trimmed && !hasAttachments && handleCommand(trimmed)) {
      setHistory((h) => [...h, trimmed])
      setHistoryIdx(-1)
      setInput('')
      return
    }

    setSending(true)
    const payloads = toPayloads()
    const req: FrontendRequest = { type: 'submit_line', line: trimmed || '' }
    if (payloads.length > 0) req.attachments = payloads
    sendRequest(req)
    setHistory((h) => trimmed ? [...h, trimmed] : h)
    setHistoryIdx(-1)
    setInput('')
    clearAll()
    setSending(false)
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
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !disabled && !busy && !sending

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`
    const key = hhmm
    pasteCountRef.current[key] = (pasteCountRef.current[key] ?? 0) + 1
    const count = pasteCountRef.current[key]
    const name = count > 1 ? `截图_${hhmm}_${count}.png` : `截图_${hhmm}.png`
    const renamedFile = new File([file], name, { type: file.type })
    handleImagePickerChange([renamedFile]).then(() => toast.show('已从剪贴板添加图片', 'success', 1500))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      handleImagePickerChange(files).catch(() => {})
    }
  }

  return (
    <div
      style={{ position: 'relative', borderTop: '1px solid #313244', backgroundColor: '#181825' }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(30,30,46,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: dragOver ? 'all' : 'none',
        opacity: dragOver ? 1 : 0,
        transition: 'opacity 120ms ease',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', border: '3px dashed #89b4fa', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '2.5rem' }}>📎</div>
          <div style={{ fontSize: '1rem', color: '#89b4fa', fontWeight: 600, marginBottom: 8 }}>释放以添加附件</div>
          <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>图片 · PDF · Word · Excel · CSV · JSON</div>
        </div>
      </div>

      {showPicker && (
        <CommandPicker
          hints={commandHints}
          selected={pickerIdx}
          onSelect={(cmd) => { setInput(''); if (!handleCommand(cmd)) submit(cmd) }}
        />
      )}

      {/* Attachment strip */}
      <AttachmentStrip attachments={attachments} onRemove={removeFile} disabled={busy} />

      {/* Hidden image-only picker (for clipboard paste & drag-drop of images) */}
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) handleImagePickerChange(Array.from(e.target.files))
          e.target.value = ''
        }}
      />

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', padding: '0.5rem 0.75rem' }}>
        {/* Single 📎 button: calls OS native file dialog via Gateway */}
        <div style={{ position: 'relative', paddingBottom: '0.4rem' }}>
          <button
            onClick={() => !busy && !dialogLoading && openNativeDialog()}
            title={busy ? 'AI 响应完成后再添加' : dialogLoading ? '正在打开文件对话框…' : '选择文件（系统原生对话框）'}
            style={{ background: 'none', border: 'none', cursor: (busy || dialogLoading) ? 'not-allowed' : 'pointer', padding: 0, fontSize: '1.1rem', opacity: (busy || dialogLoading) ? 0.4 : 0.7, lineHeight: 1 }}
          >{dialogLoading ? '⏳' : '📎'}</button>
          {attachments.length > 0 && (
            <div style={{ position: 'absolute', top: -2, right: -4, background: '#89b4fa', color: '#1e1e2e', borderRadius: '50%', width: 14, height: 14, fontSize: '0.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {attachments.length}
            </div>
          )}
        </div>

        <span style={{ color: '#89b4fa', paddingBottom: '0.4rem', fontSize: '0.875rem' }}>✦</span>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled || busy}
          placeholder={disabled ? '会话未连接' : busy ? '运行中…' : (placeholder ?? '输入消息，Enter 发送，/ 命令，↑↓ 历史')}
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
            disabled={!canSend}
            style={{ backgroundColor: canSend ? '#89b4fa' : '#313244', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: canSend ? 'pointer' : 'not-allowed', fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap', opacity: canSend ? 1 : 0.5 }}
          >
            {sending ? '处理中…' : '发送'}
          </button>
        )}
      </div>

      <div style={{ padding: '0 0.75rem 0.4rem', fontSize: '0.7rem', color: '#45475a', display: 'flex', gap: '1rem' }}>
        <span><span style={{ color: '#585b70' }}>Enter</span> 发送</span>
        <span><span style={{ color: '#585b70' }}>Shift+Enter</span> 换行</span>
        <span><span style={{ color: '#585b70' }}>/</span> 命令</span>
        <span><span style={{ color: '#585b70' }}>↑↓</span> 历史</span>
        {busy && <span><span style={{ color: '#585b70' }}>Esc</span> 停止</span>}
        {attachments.length > 0 && <span style={{ color: '#89b4fa' }}>📎 {attachments.length}个附件</span>}
      </div>
    </div>
  )
}
