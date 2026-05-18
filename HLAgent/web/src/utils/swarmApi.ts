import type { NavigateFunction } from 'react-router-dom'
import type { RoleCatalog } from '../types/swarm'

export async function fetchCatalog(): Promise<RoleCatalog> {
  const r = await fetch('/api/swarm/role-library/catalog')
  if (!r.ok) throw new Error(`Failed to fetch catalog: ${r.status}`)
  return r.json()
}

export async function fetchRoleContent(path: string): Promise<string> {
  const r = await fetch(`/api/swarm/role-library/content?path=${encodeURIComponent(path)}`)
  if (!r.ok) throw new Error(`Failed to fetch role content: ${r.status}`)
  return r.text()
}

export async function launchTeam(
  teamName: string,
  taskDesc: string,
  navigate: NavigateFunction,
): Promise<void> {
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!r.ok) throw new Error(`Failed to create session: ${r.status}`)
  const { session_id } = await r.json()
  // Sanitize: team name must be slug-safe; strip newlines from task description
  const safeTeam = teamName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '')
  const safeTask = taskDesc.trim().replace(/[\r\n]+/g, ' ')
  const cmd = safeTask ? `/swarm start ${safeTeam} ${safeTask}` : `/swarm start ${safeTeam}`
  navigate(`/chat/${session_id}?prefill=${encodeURIComponent(cmd)}&autosubmit=1`)
}
