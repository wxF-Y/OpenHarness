import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface Props {
  children: ReactNode
}

export default function OnboardingGuard({ children }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null)
  const checkedRef = useRef(false)

  useEffect(() => {
    // Skip check on /onboarding itself
    if (location.pathname === '/onboarding') {
      setAuthConfigured(true)
      return
    }
    if (checkedRef.current) return
    checkedRef.current = true

    fetch('/api/onboarding/status')
      .then((r) => r.json())
      .then((data) => {
        const configured = Boolean(data?.auth_configured)
        setAuthConfigured(configured)
        // Only hard-redirect on /chat routes
        if (!configured && location.pathname.startsWith('/chat')) {
          navigate('/onboarding', { replace: true })
        }
      })
      .catch(() => setAuthConfigured(true)) // On error, allow through
  }, [location.pathname, navigate])

  if (authConfigured === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6c7086', fontSize: '0.875rem', backgroundColor: '#1e1e2e' }}>
        <div>检查配置中…</div>
      </div>
    )
  }

  return <>{children}</>
}
