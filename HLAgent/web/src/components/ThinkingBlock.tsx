import { useEffect, useId, useState } from 'react'

interface Props {
  thinking: string
  streaming?: boolean
}

const THINKING_KEYFRAMES = `
@keyframes thinkingPulse {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
`

let styleInjected = false
function ensureStyles() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = THINKING_KEYFRAMES
  document.head.appendChild(style)
}

export default function ThinkingBlock({ thinking, streaming = false }: Props) {
  const [expanded, setExpanded] = useState(true)
  const uid = useId()
  const contentId = `thinking-content-${uid}`

  useEffect(() => {
    ensureStyles()
  }, [])

  if (!thinking && !streaming) return null

  const charCount = thinking.length
  const lines = thinking.split('\n')
  const previewText = lines.slice(0, 2).join(' ').slice(0, 100)
  const hasMore = charCount > 100 || lines.length > 2

  return (
    <div
      style={{
        borderLeft: '3px solid #89dceb',
        backgroundColor: 'rgba(137,220,235,0.05)',
        borderRadius: '0 6px 6px 0',
        margin: '4px 0 8px 0',
        fontSize: '0.8rem',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.35rem 0.75rem',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          color: '#89dceb',
          font: 'inherit',
          fontSize: '0.78rem',
          fontWeight: 600,
        }}
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <span>🧠</span>
        <span>思考过程</span>
        {streaming && (
          <span style={{ color: '#6c7086', fontWeight: 400, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <PulsingDots />
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: '#6c7086', fontSize: '0.7rem' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div id={contentId} style={{ padding: '0 0.75rem 0.5rem' }}>
          <div
            style={{
              backgroundColor: '#11111b',
              borderRadius: '4px',
              padding: '0.5rem 0.7rem',
              fontSize: '0.8rem',
              margin: 0,
              overflowY: 'auto',
              maxHeight: '400px',
              color: '#a6adc8',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
          >
            {thinking || '（思考中...）'}
          </div>
        </div>
      )}
    </div>
  )
}

function PulsingDots() {
  return (
    <span style={{ display: 'inline-block', animation: 'thinkingPulse 1.4s infinite' }}>
      •••
    </span>
  )
}
