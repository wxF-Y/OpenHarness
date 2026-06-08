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

export interface ProfileSummary {
  name: string
  label: string
  provider: string
  model: string
  api_format: string
  base_url: string
  auth_source: string
  is_builtin: boolean
  allowed_models: string[]
  context_window_tokens: number | null
  auto_compact_threshold_tokens: number | null
  credential_slot: string | null
}
