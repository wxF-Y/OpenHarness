interface Props {
  phase: string | null
  attempt?: number
}

export default function CompactProgressBar({ phase, attempt }: Props) {
  if (!phase || phase === 'done') return null

  return (
    <div style={{
      backgroundColor: 'rgba(137,180,250,0.08)', borderBottom: '1px solid #313244',
      padding: '0.35rem 1rem', fontSize: '0.75rem', color: '#89b4fa',
      display: 'flex', alignItems: 'center', gap: '0.5rem',
    }}>
      <span style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>⟳</span>
      <span>
        正在压缩上下文
        {attempt !== undefined && attempt > 1 && ` (第 ${attempt} 次)`}
        …
      </span>
    </div>
  )
}
