import { useEffect, useRef, useState } from 'react'
import type { TranscriptItem } from '../types/protocol'
import MDRenderer from './MDRenderer'
import ToolCallCard from './ToolCallCard'

interface Props {
  items: TranscriptItem[]
  assistantBuffer: string
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

function MessageRow({ item }: { item: TranscriptItem }) {
  if (item.role === 'tool' || item.role === 'tool_result') return null

  return (
    <div style={{ padding: '0.5rem 0', borderBottom: '1px solid #1e1e2e' }}>
      <div style={{ marginBottom: '0.25rem' }}>
        <RoleLabel role={item.role} />
      </div>
      <div style={{ paddingLeft: '0.5rem' }}>
        {item.role === 'assistant' ? (
          <MDRenderer content={item.text} />
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: item.role === 'system' || item.role === 'log' ? '#a6adc8' : '#cdd6f4' }}>
            {item.text}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TranscriptViewer({ items, assistantBuffer }: Props) {
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
    const behavior: ScrollBehavior = delta > 1 || (delta === 0 && assistantBuffer) ? 'instant' : 'smooth'
    bottomRef.current?.scrollIntoView({ behavior })
  }, [items.length, assistantBuffer, autoScroll])

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  if (items.length === 0 && !assistantBuffer) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7086', fontSize: '0.875rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💬</div>
          <div>发送消息开始对话</div>
        </div>
      </div>
    )
  }

  const grouped = groupToolPairs(items)

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}
      >
        {grouped.map((group, idx) => {
          if (Array.isArray(group)) {
            const [toolItem, resultItem] = group as ToolPair
            return <ToolCallCard key={idx} item={toolItem} resultItem={resultItem} />
          }
          const item = group as TranscriptItem
          if (item.role === 'tool') {
            return <ToolCallCard key={idx} item={item} />
          }
          return <MessageRow key={idx} item={item} />
        })}

        {assistantBuffer && (
          <div style={{ padding: '0.5rem 0' }}>
            <div style={{ marginBottom: '0.25rem' }}>
              <RoleLabel role="assistant" />
            </div>
            <div style={{ paddingLeft: '0.5rem' }}>
              <MDRenderer content={assistantBuffer} />
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
