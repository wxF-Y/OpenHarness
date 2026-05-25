import { useState } from 'react'
import MDRenderer from './MDRenderer'
import type { Member } from '../types/swarm'

const STATUS_ICON: Record<string, string> = {
  active: '🟢', idle: '🟡', stopped: '⬛',
}

const COLOR_MAP: Record<string, string> = {
  blue: '#89b4fa', green: '#a6e3a1', yellow: '#f9e2af',
  red: '#f38ba8', purple: '#cba6f7', cyan: '#89dceb',
}

interface Props {
  member: Member
  transcript: string
  isLoading: boolean
  errorKind: 'none' | 'no-session' | 'fetch-error'
  defaultExpanded: boolean
  onSelect: () => void
  onRetry: () => void
}

export default function SwarmAgentPanel({ member, transcript, isLoading, errorKind, defaultExpanded, onSelect, onRetry }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const borderColor = COLOR_MAP[member.color ?? ''] ?? '#45475a'

  return (
    <div style={{ marginBottom: '0.5rem', borderRadius: '8px', border: '1px solid #313244', backgroundColor: '#181825', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 0.6rem', borderLeft: `4px solid ${borderColor}`, gap: '0.4rem', cursor: 'default' }}>
        <span style={{ fontSize: '0.75rem', flexShrink: 0 }}>{STATUS_ICON[member.status ?? ''] ?? '⬛'}</span>
        {/* Name — click to navigate to single-member detail */}
        <button
          onClick={onSelect}
          title="查看详情"
          style={{ background: 'none', border: 'none', color: '#cdd6f4', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0 }}
        >
          {member.name}
        </button>
        {/* Expand/collapse — independent from onSelect */}
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.2rem', flexShrink: 0, lineHeight: 1 }}
          title={expanded ? '折叠' : '展开'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #313244', maxHeight: '400px', overflowY: 'auto' }}>
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {[80, 60, 70].map((w, i) => (
                <div key={i} style={{ height: '10px', width: `${w}%`, backgroundColor: '#313244', borderRadius: '4px', opacity: 0.6 }} />
              ))}
            </div>
          )}
          {!isLoading && errorKind === 'no-session' && (
            <div style={{ color: '#6c7086', fontSize: '0.8125rem' }}>⏳ 等待 Agent 启动…</div>
          )}
          {!isLoading && errorKind === 'fetch-error' && (
            <button
              onClick={onRetry}
              style={{ background: 'none', border: 'none', color: '#f38ba8', fontSize: '0.8125rem', cursor: 'pointer', padding: 0 }}
            >
              ⚠ 加载失败，点击重试
            </button>
          )}
          {!isLoading && errorKind === 'none' && !transcript && (
            <div style={{ color: '#6c7086', fontSize: '0.8125rem' }}>暂无执行记录</div>
          )}
          {!isLoading && errorKind === 'none' && transcript && (
            <MDRenderer content={transcript} compact />
          )}
        </div>
      )}
    </div>
  )
}
