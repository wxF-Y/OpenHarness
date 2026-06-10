import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import OnboardingGuard from './components/OnboardingGuard'
import AppLayout from './components/AppLayout'
import { ToastContainer } from './components/Toast'

const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))

function LoadingFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#89b4fa', fontSize: '0.875rem', backgroundColor: '#1e1e2e' }}>
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <ToastContainer>
      <BrowserRouter>
        <Suspense fallback={<LoadingFallback />}>
          <OnboardingGuard>
            <Routes>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/" element={<AppLayout />} />
              <Route path="/chat/:sessionId" element={<AppLayout />} />
              {/* Legacy routes — redirect into AppLayout with view param */}
              <Route path="/memory" element={<Navigate to="/?view=memory" replace />} />
              <Route path="/skills" element={<Navigate to="/?view=skills" replace />} />
              <Route path="/cron" element={<Navigate to="/?view=cron" replace />} />
              <Route path="/swarm" element={<Navigate to="/?view=swarm" replace />} />
              <Route path="/experts" element={<Navigate to="/?view=experts" replace />} />
              <Route path="/autopilot" element={<Navigate to="/?view=autopilot" replace />} />
              <Route path="/rag" element={<Navigate to="/?view=rag" replace />} />
              <Route path="/permissions-settings" element={<Navigate to="/?view=permissions" replace />} />
            </Routes>
          </OnboardingGuard>
        </Suspense>
      </BrowserRouter>
    </ToastContainer>
  )
}
