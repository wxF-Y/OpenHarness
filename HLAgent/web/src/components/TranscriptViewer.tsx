import { useEffect, useRef, useState } from 'react'
import type { MediaItem, TranscriptItem } from '../types/protocol'
import MDRenderer from './MDRenderer'
import ToolCallCard from './ToolCallCard'
import ImageLightbox from './ImageLightbox'
import ThinkingBlock from './ThinkingBlock'

interface Props {
  items: TranscriptItem[]
  assistantBuffer: string
  thinkingBuffer: string
  sessionId?: string
}

type ToolPair = readonly [TranscriptItem, TranscriptItem]
type GroupedItem = TranscriptItem | ToolPair

function groupToolPairs(items: TranscriptItem[]): GroupedItem[] {
  const result: GroupedItem[] = []
  let i = 0
  while (i < items.length) {
    const cur = items[i]
    const next = items[i + 1]
    if (cur.role === 'tool' && next?.role === 'tool_result') {
      result.push([cur, next] as const)
      i += 2
    } else {
      result.push(cur)
      i++
    }
  }
  return result
}

function RoleLabel({ role }: { role: string }) {
  const styles: Record<string, string> = {
    user: '#89b4fa',
    assistant: '#a6e3a1',
    system: '#f9e2af',
    log: '#6c7086',
  }
  const labels: Record<string, string> = { user: '你', assistant: 'Agent', system: 'System', log: 'Log' }
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: styles[role] || '#6c7086', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {labels[role] || role}
    </span>
  )
}

function UserAttachments({ media, sessionId }: { media: MediaItem[]; sessionId?: string }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const images = media.filter(m => m.type === 'image')
  const docs = media.filter(m => m.type === 'document')
  const visibleImages = images.slice(0, 4)
  const overflow = images.length - 4

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {visibleImages.map((item, i) => (
        <button key={item.source_path || item.data?.slice(0, 16) || i} onClick={() => setLightboxIdx(i)} title={item.filename || ''} style={{ width: 56, height: 56, borderRadius: 4, overflow: 'hidden', cursor: 'pointer', flexShrink: 0, padding: 0, border: 'none', background: 'none' }}>
          {item.data ? (
            <img src={`data:${item.media_type};base64,${item.data}`} alt={item.filename || ''} style={{ width: 56, height: 56, objectFit: 'cover' }} />
          ) : item.source_path && sessionId ? (
            <img src={`/api/sessions/${sessionId}/files?path=${encodeURIComponent(item.source_path)}`} alt={item.filename || ''} style={{ width: 56, height: 56, objectFit: 'cover' }} />
          ) : null}
        </button>
      ))}
      {overflow > 0 && <div style={{ width: 56, height: 56, borderRadius: 4, background: '#313244', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cdd6f4', fontSize: '0.8rem', fontWeight: 700 }}>+{overflow}</div>}
      {docs.map((d, i) => (
        <div key={`doc_${i}`} style={{ borderRadius: 12, border: '1px solid #313244', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: '0.65rem', color: '#6c7086' }}>📄</span>
          <span style={{ fontSize: '0.75rem', color: '#a6adc8' }}>{d.filename}</span>
        </div>
      ))}
      {lightboxIdx !== null && (
        <ImageLightbox images={images} initialIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} sessionId={sessionId} />
      )}
    </div>
  )
}

function MessageRow({ item, sessionId }: { item: TranscriptItem; sessionId?: string }) {
  if (item.role === 'tool' || item.role === 'tool_result') return null

  // System extraction confirmation/warning messages (📄 or ⚠️ prefix)
  if (item.role === 'system' && (item.text.startsWith('📄') || item.text.startsWith('⚠️'))) {
    const icon = item.text.startsWith('⚠️') ? '⚠️' : '📄'
    return (
      <div style={{ padding: '0.25rem 0 0.25rem 0.5rem', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: '0.75rem' }}>{icon}</span>
        <div style={{ fontSize: '0.75rem', color: item.text.startsWith('⚠️') ? '#f9e2af' : '#6c7086', whiteSpace: 'pre-wrap' }}>
          {item.text.slice(icon.length + 1)}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.5rem 0', borderBottom: '1px solid #1e1e2e' }}>
      <div style={{ marginBottom: '0.25rem' }}>
        <RoleLabel role={item.role} />
      </div>
      <div style={{ paddingLeft: '0.5rem' }}>
        {item.role === 'assistant' && item.thinking && (
          <ThinkingBlock thinking={item.thinking} />
        )}
        {item.role === 'assistant' ? (
          <MDRenderer content={item.text} />
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: item.role === 'system' || item.role === 'log' ? '#a6adc8' : '#cdd6f4' }}>
            {item.text}
          </div>
        )}
        {item.role === 'user' && item.media && item.media.length > 0 && (
          <UserAttachments media={item.media} sessionId={sessionId} />
        )}
      </div>
    </div>
  )
}

export default function TranscriptViewer({ items, assistantBuffer, thinkingBuffer, sessionId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const prevLenRef = useRef(0)

  useEffect(() => {
    if (!autoScroll) return
    const delta = items.length - prevLenRef.current
    prevLenRef.current = items.length

    // Bulk replay (multiple items added at once) → instant jump, no animation stack
    // Single item (real-time chat) → smooth animation
    const behavior: ScrollBehavior = delta > 1 || (delta === 0 && (assistantBuffer || thinkingBuffer)) ? 'instant' : 'smooth'
    // Use direct scroll on containerRef instead of scrollIntoView to avoid
    // Chromium scrolling overflow:hidden ancestor containers (known browser quirk
    // that causes the header bar to be pushed off-screen).
    const el = containerRef.current
    if (el) {
      if (behavior === 'instant') {
        el.scrollTop = el.scrollHeight
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    }
  }, [items.length, assistantBuffer, thinkingBuffer, autoScroll])

  // When transcript is cleared (clear_transcript event), reset counter
  useEffect(() => {
    if (items.length === 0) {
      prevLenRef.current = 0
    }
  }, [items.length])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAutoScroll(atBottom)
    setShowScrollBtn(!atBottom)
  }

  function scrollToBottom() {
    setAutoScroll(true)
    const el = containerRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }

  if (items.length === 0 && !assistantBuffer && !thinkingBuffer) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7086', fontSize: '0.875rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💬</div>
          <div>发送消息开始对话</div>
        </div>
      </div>
    )
  }

  const grouped = groupToolPairs(items)

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}
      >
        {grouped.map((group, idx) => {
          if (Array.isArray(group)) {
            const [toolItem, resultItem] = group as ToolPair
            const key = `pair_${idx}_${toolItem.tool_name || 'tool'}`
            return <ToolCallCard key={key} item={toolItem} resultItem={resultItem} sessionId={sessionId} />

          }
          const item = group as TranscriptItem
          if (item.role === 'tool') {
            const key = `tool_${idx}_${item.tool_name || 'call'}`
            return <ToolCallCard key={key} item={item} sessionId={sessionId} />
          }
          const key = `${item.role}_${idx}`
          return <MessageRow key={key} item={item} sessionId={sessionId} />
        })}

        {(thinkingBuffer || assistantBuffer) && (
          <div style={{ padding: '0.5rem 0' }}>
            <div style={{ marginBottom: '0.25rem' }}>
              <RoleLabel role="assistant" />
            </div>
            <div style={{ paddingLeft: '0.5rem' }}>
              {thinkingBuffer && (
                <ThinkingBlock thinking={thinkingBuffer} streaming />
              )}
              {assistantBuffer && (
                <MDRenderer content={assistantBuffer} />
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute', bottom: '1rem', right: '1rem',
            backgroundColor: '#313244', border: 'none', borderRadius: '20px',
            color: '#cdd6f4', padding: '0.4rem 0.75rem', cursor: 'pointer',
            fontSize: '0.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          ↓ 回到底部
        </button>
      )}
    </div>
  )
}
