export interface RoleAgent {
  name: string
  path: string
  description: string
}

export interface RoleDepartment {
  id: string
  label: string
  agents: RoleAgent[]
}

export interface RoleCatalog {
  departments: RoleDepartment[]
}

export interface SelectedRole {
  role: RoleAgent
  dept: string
}

export type TeamDisplayState = 'empty' | 'configured' | 'running' | 'idle'

export interface TeamSummary {
  name: string
  description: string
  member_count: number
  lead_agent_id?: string
  created_at: number
}

export interface Member {
  agent_id: string
  name: string
  status?: string
  agent_type?: string
  model?: string
  color?: string
  session_id?: string
  worktree_path?: string
  plan_mode_required?: boolean
  prompt?: string
}

export interface MailboxMsg {
  id: string
  type: string
  sender: string
  payload: Record<string, unknown>
  timestamp: number
  read: boolean
}

export const MEMBER_COLOR_PALETTE = ['blue', 'green', 'yellow', 'red', 'purple', 'cyan'] as const
