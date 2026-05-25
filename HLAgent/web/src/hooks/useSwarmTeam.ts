import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Member, TeamDisplayState } from '../types/swarm'
import { useSwarmStore } from '../stores/swarmStore'

export interface UseSwarmTeamResult {
  members: Record<string, Member>
  teamState: TeamDisplayState
  isLoading: boolean
  error: string | null
  lastRefresh: Date | null
  refresh: () => Promise<void>
}

function deriveTeamState(teamName: string | null, members: Record<string, Member>): TeamDisplayState {
  if (!teamName) return 'empty'
  const vals = Object.values(members)
  if (vals.length === 0) return 'configured'
  if (vals.some((m) => m.session_id && m.status === 'active')) return 'running'
  if (vals.every((m) => m.session_id && (m.status === 'idle' || m.status === 'stopped'))) return 'idle'
  return 'configured'
}

export function useSwarmTeam(teamName: string | null): UseSwarmTeamResult {
  const [members, setMembers] = useState<Record<string, Member>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const swarmTeammates = useSwarmStore((s) => s.teammates)

  const teamState = useMemo(() => deriveTeamState(teamName, members), [teamName, members])

  const refresh = useCallback(async () => {
    if (!teamName) return
    setIsLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/swarm/teams/${encodeURIComponent(teamName)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setMembers(data.members || {})
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team')
    } finally {
      setIsLoading(false)
    }
  }, [teamName])

  // Fetch on team selection
  useEffect(() => {
    if (!teamName) {
      setMembers({})
      setLastRefresh(null)
      setError(null)
      return
    }
    refresh()
  }, [teamName, refresh])

  // Merge session_id / status updates from WebSocket swarm_status events
  useEffect(() => {
    if (!teamName || swarmTeammates.length === 0) return
    setMembers((prev) => {
      const updated = { ...prev }
      let changed = false
      for (const t of swarmTeammates) {
        const key = Object.keys(updated).find((k) => updated[k].name === t.name)
        if (key && t.session_id && (updated[key].session_id !== t.session_id || updated[key].status !== t.status)) {
          updated[key] = {
            ...updated[key],
            session_id: t.session_id,
            status: (t.status as Member['status']) ?? updated[key].status,
          }
          changed = true
        }
      }
      return changed ? updated : prev
    })
  }, [swarmTeammates, teamName])

  return { members, teamState, isLoading, error, lastRefresh, refresh }
}
