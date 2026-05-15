import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import OnboardingGuard from './components/OnboardingGuard'

const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const CronPage = lazy(() => import('./pages/CronPage'))
const SwarmPage = lazy(() => import('./pages/SwarmPage'))
const MemoryPage = lazy(() => import('./pages/MemoryPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const AutopilotPage = lazy(() => import('./pages/AutopilotPage'))

function LoadingFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#89b4fa', fontSize: '0.875rem', backgroundColor: '#1e1e2e' }}>
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <OnboardingGuard>
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/chat/:sessionId" element={<ChatPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/swarm" element={<SwarmPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/autopilot" element={<AutopilotPage />} />
          </Routes>
        </OnboardingGuard>
      </Suspense>
    </BrowserRouter>
  )
}

