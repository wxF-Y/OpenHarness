import { useNavigate } from 'react-router-dom'

interface Props {
  show: boolean
}

export default function AuthBanner({ show }: Props) {
  const navigate = useNavigate()
  if (!show) return null

  return (
    <div style={{
      backgroundColor: 'rgba(249,226,175,0.1)', borderBottom: '1px solid #f9e2af',
      padding: '0.4rem 1rem', fontSize: '0.8125rem', color: '#f9e2af',
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0,
    }}>
      <span>⚠️</span>
      <span>未配置 AI Provider，对话功能不可用。</span>
      <button
        onClick={() => navigate('/onboarding')}
        style={{ marginLeft: 'auto', background: 'none', border: '1px solid #f9e2af', color: '#f9e2af', padding: '0.2rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
      >
        立即配置 →
      </button>
    </div>
  )
}
