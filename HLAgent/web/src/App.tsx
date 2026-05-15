import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Suspense, lazy } from 'react'

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
    <div className="flex items-center justify-center h-screen text-[#89b4fa] text-sm">
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
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
      </Suspense>
    </BrowserRouter>
  )
}

