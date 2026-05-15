import { create } from 'zustand'
import type { SwarmNotification, SwarmTeammate } from '../types/protocol'

interface SwarmState {
  teammates: SwarmTeammate[]
  notifications: SwarmNotification[]
  unreadCount: number
  pendingPermissions: number
  // SwarmPage state
  teams: TeamSummary[]
  selectedTeam: string | null
  selectedMember: string | null
  memberDetails: Record<string, TeamMember>
  // Actions
  setTeammates: (teammates: SwarmTeammate[]) => void
  addNotifications: (notifications: SwarmNotification[]) => void
  setPendingPermissions: (n: number) => void
  setTeams: (teams: TeamSummary[]) => void
  selectTeam: (team: string | null) => void
  selectMember: (member: string | null) => void
  setMemberDetails: (agentId: string, details: TeamMember) => void
}

export interface TeamSummary {
  name: string
  description: string
  member_count: number
  active_count?: number
  lead_agent_id?: string
  created_at?: number
}

export interface TeamMember {
  agent_id: string
  name: string
  backend_type: string
  joined_at: number
  agent_type?: string
  model?: string
  color?: string
  plan_mode_required?: boolean
  session_id?: string
  subscriptions?: string[]
  is_active?: boolean
  mode?: string
  cwd?: string
  worktree_path?: string
  permissions?: string[]
  status?: 'active' | 'idle' | 'stopped'
}

export const useSwarmStore = create<SwarmState>((set) => ({
  teammates: [],
  notifications: [],
  unreadCount: 0,
  pendingPermissions: 0,
  teams: [],
  selectedTeam: null,
  selectedMember: null,
  memberDetails: {},

  setTeammates: (teammates) => set({ teammates }),
  addNotifications: (newNotifs) =>
    set((prev) => ({
      notifications: [...prev.notifications, ...newNotifs].slice(-50),
      unreadCount: prev.unreadCount + newNotifs.length,
    })),
  setPendingPermissions: (pendingPermissions) => set({ pendingPermissions }),
  setTeams: (teams) => set({ teams }),
  selectTeam: (selectedTeam) => set({ selectedTeam, selectedMember: null }),
  selectMember: (selectedMember) => set({ selectedMember }),
  setMemberDetails: (agentId, details) =>
    set((prev) => ({ memberDetails: { ...prev.memberDetails, [agentId]: details } })),
}))
