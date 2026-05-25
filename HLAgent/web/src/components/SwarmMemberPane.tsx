import { useEffect, useRef, useState } from 'react'
import MDRenderer from './MDRenderer'
import TranscriptViewer from './TranscriptViewer'
import type { TranscriptItem } from '../types/protocol'
import type { TeamMember } from '../stores/swarmStore'
import { useSwarmStore } from '../stores/swarmStore'

interface Props {
  member: TeamMember
  onClose: () => void
  runId?: string
}

/** Parse session snapshot messages into TranscriptItems for TranscriptViewer */
function parseSessionToItems(snapshot: { messages?: Record<string, unknown>[] }): TranscriptItem[] {
  const msgs = snapshot?.messages ?? []
  const items: TranscriptItem[] = []
  for (const msg of msgs) {
    const role = msg.role as string
    const content = msg.content
    if (role === 'user' || role === 'assistant') {
      let text = ''
      let thinking = ''
      if (typeof content === 'string') {
        text = content
      } else if (Array.isArray(content)) {
        for (const b of content as Record<string, unknown>[]) {
          if (b.type === 'text') text += (b.text as string) ?? ''
          if (b.type === 'thinking') thinking += (b.thinking as string) ?? ''
          if (b.type === 'tool_use') {
            items.push({
              role: 'tool',
              text: '',
              tool_name: b.name as string,
              tool_input: b.input as Record<string, unknown>,
            })
          }
        }
      }
      if (text.trim() || thinking.trim()) {
        items.push({
          role: role as TranscriptItem['role'],
          text,
          ...(thinking ? { thinking } : {}),
        })
      }
    } else if (role === 'tool') {
      // Tool result messages (role=tool in OpenAI format)
      const toolContent = typeof content === 'string' ? content
        : Array.isArray(content) ? (content as Record<string, unknown>[]).map(b => (b.text as string) ?? '').join('') : ''
      items.push({ role: 'tool_result', text: toolContent })
    }
  }
  return items
}

export default function SwarmMemberPane({ member, onClose, runId }: Props) {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [assistantBuffer, setAssistantBuffer] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamDone, setStreamDone] = useState(false)
  const [hasNew, setHasNew] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const esRef = useRef<EventSource | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const teammates = useSwarmStore((s) => s.teammates)
  const t = teammates.find((x) => x.name === member.name)
  const sessionId = t?.session_id ?? member.session_id
  const memberStatus = t?.status ?? member.status

  // Load full transcript from session JSON
  const loadFullTranscript = async (sid: string) => {
    if (!runId) return
    try {
      const qs = `?run_id=${encodeURIComponent(runId)}`
      const r = await fetch(`/api/swarm/agents/${encodeURIComponent(member.agent_id)}/transcript${qs}`)
      if (!r.ok) return
      // Try structured session data
      const data = await r.json()
      if (data.messages) {
        setItems(parseSessionToItems(data))
      } else if (data.transcript) {
        // Fall back: show markdown as a single assistant item
        setItems([{ role: 'assistant', text: data.transcript }])
      }
    } catch { /* ignore */ }
  }

  // Open SSE stream when member has a sessionId (not gated on memberStatus=active)
  // because swarm_status events may not be emitted from tool-path spawned members
  useEffect(() => {
    if (!sessionId || !runId) {
      // No session or run — load static transcript if done
      if (sessionId && memberStatus !== 'active') {
        loadFullTranscript(sessionId)
      }
      return
    }

    // Always pre-load transcript immediately (covers page refresh after agent finished)
    loadFullTranscript(sessionId)

    const qs = `?run_id=${encodeURIComponent(runId)}`
    const url = `/api/swarm/agents/${encodeURIComponent(member.agent_id)}/stream${qs}`
    const es = new EventSource(url)
    esRef.current = es
    setIsStreaming(true)
    setAssistantBuffer('')
    setStreamDone(false)

    es.onmessage = (e) => {
      try {
        const data: { type: string; text?: string; name?: string; output?: string; input?: Record<string, unknown> } = JSON.parse(e.data)
        if (data.type === 'delta' && data.text) {
          setAssistantBuffer((prev) => prev + data.text)
        } else if (data.type === 'tool_start') {
          // Flush current buffer as assistant message, then add tool item
          setAssistantBuffer((prev) => {
            if (prev) {
              setItems((it) => [...it, { role: 'assistant', text: prev }])
            }
            return ''
          })
          setItems((it) => [...it, { role: 'tool', text: '', tool_name: data.name ?? 'tool', tool_input: data.input ?? {} }])
        } else if (data.type === 'tool_end') {
          setItems((it) => [...it, { role: 'tool_result', text: (data.output ?? '').slice(0, 500) }])
        } else if (data.type === 'done') {
          setIsStreaming(false)
          setStreamDone(true)
          es.close()
          // Flush remaining buffer
          setAssistantBuffer((prev) => {
            if (prev) setItems((it) => [...it, { role: 'assistant', text: prev }])
            return ''
          })
          // Load authoritative session transcript
          loadFullTranscript(sessionId)
        } else if (data.type === 'error') {
          setIsStreaming(false)
          es.close()
        }
      } catch { /* ignore parse errors */ }
    }

    es.onerror = () => {
      setIsStreaming(false)
      es.close()
      // Fall back to transcript if SSE fails
      loadFullTranscript(sessionId)
    }

    return () => {
      es.close()
      esRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, runId, memberStatus])

  // Auto-scroll
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (autoScroll) {
      el.scrollTop = el.scrollHeight
      setHasNew(false)
    } else {
      setHasNew(true)
    }
  }, [items, assistantBuffer, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom) { setAutoScroll(true); setHasNew(false) }
    else setAutoScroll(false)
  }

  const isEmpty = items.length === 0 && !assistantBuffer

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative', backgroundColor: '#1e1e2e' }}>
      {/* Header */}
      <div style={{
        height: '28px', flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 0.5rem', backgroundColor: '#181825', borderBottom: '1px solid #313244',
      }}>
        <span style={{ fontSize: '0.72rem', color: '#89b4fa', background: '#313244', borderRadius: '3px', padding: '0.1rem 0.4rem', flex: 1 }}>
          {memberStatus === 'active' ? '🟢' : '🟡'} {member.name}
          {isStreaming && <span style={{ color: '#f9e2af', marginLeft: '0.4rem', fontSize: '0.65rem' }}>• 流式输出中</span>}
        </span>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0.2rem', lineHeight: 1 }}
          title="收起">←</button>
      </div>

      {/* Content — TranscriptViewer style */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {!sessionId && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6c7086', fontSize: '0.8125rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
              <div>等待 Agent 启动...</div>
            </div>
          </div>
        )}
        {sessionId && isEmpty && !isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6c7086', fontSize: '0.8125rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💬</div>
              <div>暂无执行记录</div>
            </div>
          </div>
        )}
        {(items.length > 0 || assistantBuffer) && (
          <TranscriptViewer
            items={items}
            assistantBuffer={assistantBuffer}
            thinkingBuffer=""
          />
        )}
      </div>

      {/* Scroll-to-bottom button */}
      {hasNew && (
        <button
          onClick={() => { setAutoScroll(true); if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight }}
          style={{
            position: 'absolute', bottom: '0.75rem', right: '0.75rem',
            backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none',
            borderRadius: '4px', padding: '0.25rem 0.5rem',
            fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600,
          }}
        >
          ↓ 新内容
        </button>
      )}
    </div>
  )
}
