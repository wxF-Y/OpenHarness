import { useSwarmStore } from '../stores/swarmStore'
import type { TeamMember } from '../stores/swarmStore'

interface Props {
  members: Record<string, TeamMember>
  selectedMemberId: string | null
  onSelect: (agentId: string | null) => void
  allDone: boolean
}

const STATUS_ICON: Record<string, string> = {
  active: '🟢', idle: '🟡', stopped: '⬛',
}

export default function SwarmMemberBar({ members, selectedMemberId, onSelect, allDone }: Props) {
  const teammates = useSwarmStore((s) => s.teammates)

  // Merge WS last_message/status into display, matched by name
  const merged = Object.values(members).map((m) => {
    const t = teammates.find((x) => x.name === m.name)
    return {
      ...m,
      status: t?.status ?? m.status,
      last_message: t?.last_message,
      session_id: t?.session_id ?? m.session_id,
    }
  })

  const anyActive = merged.some((m) => m.session_id)
  const selected = merged.find((m) => m.agent_id === selectedMemberId)

  return (
    <div style={{
      height: '36px',
      flexShrink: 0,
      backgroundColor: '#1e1e2e',
      borderBottom: '1px solid #313244',
      borderTop: '1px solid #313244',
      display: 'flex',
      alignItems: 'center',
      padding: '0 0.75rem',
      gap: '0.5rem',
      overflow: 'hidden',
    }}>
      {/* "启动中" hint before any member is active */}
      {!anyActive && (
        <span style={{ fontSize: '0.7rem', color: '#6c7086', flexShrink: 0 }}>正在启动团队...</span>
      )}

      {/* Member chips - always clickable so user can open pane while member starts */}
      <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
        {merged.map((m) => {
          const active = m.session_id !== null && m.session_id !== undefined
          const isSelected = m.agent_id === selectedMemberId
          return (
            <button
              key={m.agent_id}
              onClick={() => onSelect(isSelected ? null : m.agent_id)}
              title={active ? m.name : `${m.name}（等待启动...）`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.15rem 0.5rem',
                borderRadius: '4px',
                border: `1px solid ${isSelected ? '#89b4fa' : active ? '#313244' : '#45475a'}`,
                backgroundColor: isSelected ? '#2a2a4a' : '#181825',
                color: active ? '#cdd6f4' : '#585b70',
                cursor: 'pointer',
                opacity: active ? 1 : 0.65,
                fontSize: '0.72rem',
                flexShrink: 0,
                maxWidth: '120px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span style={{ flexShrink: 0 }}>
                {active
                  ? (m.status === 'active' && !m.last_message
                      ? '🟡'
                      : (STATUS_ICON[m.status ?? ''] ?? '⬛'))
                  : '⏳'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
            </button>
          )
        })}
      </div>

      {/* Selected member info (right-aligned) */}
      {selected && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          flexShrink: 0,
          borderLeft: '1px solid #313244',
          paddingLeft: '0.5rem',
          fontSize: '0.7rem',
          color: '#89b4fa',
        }}>
          <span>{selected.name}</span>
          <button
            onClick={() => onSelect(null)}
            style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8rem', padding: 0, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Task complete marker */}
      {allDone && (
        <span style={{ fontSize: '0.7rem', color: '#a6e3a1', flexShrink: 0 }}>✅ 全部完成</span>
      )}
    </div>
  )
}
