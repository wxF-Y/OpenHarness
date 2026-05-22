/**
 * REST API response types — mirrors HLAgent Gateway Pydantic models.
 * (WebSocket types are in protocol.ts)
 */

export interface SessionSummary {
  session_id: string
  model: string
  cwd: string
  is_managed: boolean
  ready: boolean
  created_at: number
  title?: string
  expert_role?: string | null
  expert_role_label?: string | null
}
