import { useState } from 'react'
import type { TranscriptItem } from '../types/protocol'
import ImageGrid from './ImageGrid'

interface Props {
  item: TranscriptItem
  resultItem?: TranscriptItem
  sessionId?: string
}

const TOOL_CONFIG: Record<string, { icon: string; color: string }> = {
  bash: { icon: '🖥️', color: '#fab387' },
  write_file: { icon: '✏️', color: '#89b4fa' },
  edit_file: { icon: '✏️', color: '#89b4fa' },
  notebook_edit: { icon: '📓', color: '#89b4fa' },
  read_file: { icon: '📄', color: '#6c7086' },
  glob: { icon: '🔍', color: '#6c7086' },
  grep: { icon: '🔍', color: '#6c7086' },
  web_fetch: { icon: '🌐', color: '#a6e3a1' },
  web_search: { icon: '🔍', color: '#a6e3a1' },
  image_generation: { icon: '🎨', color: '#f5c2e7' },
  image_to_text: { icon: '🖼️', color: '#f5c2e7' },
  agent: { icon: '🤖', color: '#cba6f7' },
  task_create: { icon: '📋', color: '#6c7086' },
  task_stop: { icon: '📋', color: '#6c7086' },
  todo_write: { icon: '✅', color: '#94e2d5' },
  send_message: { icon: '💬', color: '#94e2d5' },
  team_create: { icon: '🤝', color: '#94e2d5' },
  team_delete: { icon: '🤝', color: '#94e2d5' },
  cron_create: { icon: '⏰', color: '#f9e2af' },
  cron_delete: { icon: '⏰', color: '#f9e2af' },
  cron_list: { icon: '⏰', color: '#f9e2af' },
  cron_toggle: { icon: '⏰', color: '#f9e2af' },
  enter_plan_mode: { icon: '📋', color: '#f9e2af' },
  exit_plan_mode: { icon: '📋', color: '#f9e2af' },
  enter_worktree: { icon: '🌿', color: '#a6e3a1' },
  exit_worktree: { icon: '🌿', color: '#a6e3a1' },
  skill: { icon: '⚡', color: '#89b4fa' },
  sleep: { icon: '💤', color: '#6c7086' },
  brief: { icon: '📝', color: '#6c7086' },
  tool_search: { icon: '🔍', color: '#6c7086' },
}

function getToolConfig(name: string) {
  if (!name) return { icon: '⚙️', color: '#6c7086' }
  if (name.startsWith('mcp__')) return { icon: '⚙️', color: '#74c7ec' }
  return TOOL_CONFIG[name] || { icon: '⚙️', color: '#6c7086' }
}

function summarize(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return ''
  if (toolName === 'bash' && input.command) return String(input.command).slice(0, 120)
  if ((toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') && input.file_path)
    return String(input.file_path)
  if (toolName === 'grep' && input.pattern) return `/${input.pattern}/`
  if (toolName === 'glob' && input.pattern) return String(input.pattern)
  if (toolName === 'web_fetch' && input.url) return String(input.url).slice(0, 80)
  if (toolName === 'web_search' && input.query) return String(input.query)
  if (toolName === 'agent' && input.subagent_type) return String(input.subagent_type)
  if (toolName.startsWith('cron_') && input.name) return String(input.name)
  const entries = Object.entries(input)
  if (entries.length) return `${entries[0][0]}=${String(entries[0][1]).slice(0, 60)}`
  return ''
}

export default function ToolCallCard({ item, resultItem, sessionId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const toolName = item.tool_name || 'tool'
  const { icon, color } = getToolConfig(toolName)
  const summary = summarize(toolName, item.tool_input)

  const isError = resultItem?.is_error
  const isPlanBlocked = resultItem?.is_error && resultItem.text?.includes('Plan mode blocks')
  const pending = !resultItem
  const hasMedia = (resultItem?.media?.length ?? 0) > 0
  const imageMedia = resultItem?.media?.filter(m => m.type === 'image') ?? []
  const outputLines = resultItem && !hasMedia ? resultItem.text.split('\n').filter((l) => l.trim()) : []
  const truncated = outputLines.length > 0 && !expanded
  const displayLines = truncated ? outputLines.slice(0, 5) : outputLines

  // Get directory path from first media item's source_path
  const dirPath = imageMedia[0]?.source_path
    ? imageMedia[0].source_path.split('/').slice(0, -1).join('/')
    : ''

  return (
    <div
      style={{
        borderLeft: `3px solid ${isPlanBlocked ? '#fab387' : isError ? '#f38ba8' : pending ? color : '#a6e3a1'}`,
        backgroundColor: '#181825',
        borderRadius: '0 6px 6px 0',
        margin: '4px 0',
        fontSize: '0.8125rem',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <button
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', cursor: item.tool_input ? 'pointer' : 'default', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', font: 'inherit' }}
        onClick={() => item.tool_input && setExpanded(!expanded)}
        aria-expanded={item.tool_input ? expanded : undefined}
      >
        <span>{icon}</span>
        <span style={{ color, fontWeight: 600 }}>{toolName}</span>
        {summary && <span style={{ color: '#6c7086' }}>{summary}</span>}
        <span style={{ marginLeft: 'auto', color: '#6c7086' }}>
          {pending && <span style={{ display: 'inline-block' }}>...</span>}
          {!pending && !isError && hasMedia && <span style={{ color: '#a6e3a1' }}>ok {imageMedia.length}张图片</span>}
          {!pending && !isError && !hasMedia && <span style={{ color: '#a6e3a1' }}>ok {outputLines.length > 0 ? `${outputLines.length}L` : ''}</span>}
          {isPlanBlocked && <span style={{ color: '#fab387' }}>blocked</span>}
          {isError && !isPlanBlocked && <span style={{ color: '#f38ba8' }}>error</span>}
        </span>
      </button>

      {/* PLAN MODE banner */}
      {isPlanBlocked && (
        <div style={{ padding: '0.25rem 0.75rem', backgroundColor: 'rgba(250,179,135,0.1)', color: '#fab387', fontSize: '0.75rem' }}>
          Plan Mode 已阻断此写操作。退出 Plan Mode 后重试。
        </div>
      )}

      {/* Bash command block */}
      {toolName === 'bash' && item.tool_input?.command !== undefined && (
        <div style={{ padding: '0.25rem 0.75rem 0.25rem 0.75rem' }}>
          <pre style={{ backgroundColor: '#313244', borderRadius: '4px', padding: '0.4rem 0.6rem', fontSize: '0.75rem', margin: 0, overflowX: 'auto', color: '#cdd6f4', fontFamily: 'monospace' }}>
            {String(item.tool_input.command)}
          </pre>
        </div>
      )}

      {/* Expanded input JSON */}
      {expanded && item.tool_input && toolName !== 'bash' && (
        <div style={{ padding: '0.25rem 0.75rem' }}>
          <pre style={{ backgroundColor: '#313244', borderRadius: '4px', padding: '0.4rem 0.6rem', fontSize: '0.7rem', margin: 0, overflowX: 'auto', color: '#a6adc8', fontFamily: 'monospace' }}>
            {JSON.stringify(item.tool_input, null, 2).slice(0, 800)}
          </pre>
        </div>
      )}

      {/* Media output (images from tool results) */}
      {hasMedia && !isError && (
        <>
          <ImageGrid media={imageMedia} sessionId={sessionId} />
          {dirPath && (
            <div style={{ padding: '0 12px 6px', fontSize: '0.7rem', color: '#6c7086', fontFamily: 'monospace' }}>
              📁 已保存至 {dirPath.length > 50 ? '…' + dirPath.slice(-50) : dirPath}
            </div>
          )}
          <div style={{ padding: '0 12px 8px', fontSize: '0.7rem', color: '#585b70' }}>
            💬 可继续描述修改意见，AI 将重新生成
          </div>
        </>
      )}

      {/* Text Output */}
      {resultItem && !isError && !hasMedia && outputLines.length > 0 && (
        <div style={{ padding: '0.25rem 0.75rem 0.4rem' }}>
          <pre style={{ backgroundColor: '#11111b', borderRadius: '4px', padding: '0.4rem 0.6rem', fontSize: '0.75rem', margin: 0, overflowX: 'auto', color: '#a6adc8', fontFamily: 'monospace', maxHeight: expanded ? 'none' : '120px', overflow: expanded ? 'auto' : 'hidden' }}>
            {displayLines.join('\n')}
            {truncated && outputLines.length > 5 && `\n… (+${outputLines.length - 5} 行)`}
          </pre>
          {outputLines.length > 5 && (
            <button onClick={() => setExpanded(!expanded)} style={{ marginTop: '0.25rem', background: 'none', border: 'none', color: '#89b4fa', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>
              {expanded ? '▲ 收起' : `▼ 展开完整输出（${outputLines.length} 行）`}
            </button>
          )}
        </div>
      )}

      {/* Error output */}
      {isError && !isPlanBlocked && outputLines.length > 0 && (
        <div style={{ padding: '0.25rem 0.75rem 0.4rem' }}>
          {outputLines.slice(0, 5).map((l, i) => (
            <div key={i} style={{ fontSize: '0.75rem', color: '#f38ba8', fontFamily: 'monospace' }}>{l}</div>
          ))}
          {outputLines.length > 5 && <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>… (+{outputLines.length - 5} 行)</div>}
        </div>
      )}
    </div>
  )
}
