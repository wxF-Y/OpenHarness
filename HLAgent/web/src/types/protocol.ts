/**
 * Protocol types mirroring openharness/ui/protocol.py exactly.
 */

export type FrontendRequestType =
  | 'submit_line'
  | 'permission_response'
  | 'question_response'
  | 'list_sessions'
  | 'select_command'
  | 'apply_select_command'
  | 'interrupt'
  | 'shutdown'

export interface FrontendRequest {
  type: FrontendRequestType
  line?: string
  command?: string
  value?: string
  request_id?: string
  allowed?: boolean
  answer?: string
}

export type BackendEventType =
  | 'ready'
  | 'state_snapshot'
  | 'tasks_snapshot'
  | 'transcript_item'
  | 'compact_progress'
  | 'assistant_delta'
  | 'assistant_complete'
  | 'line_complete'
  | 'tool_started'
  | 'tool_completed'
  | 'clear_transcript'
  | 'modal_request'
  | 'select_request'
  | 'todo_update'
  | 'plan_mode_change'
  | 'swarm_status'
  | 'error'
  | 'shutdown'

/** Mirrors openharness/state/app_state.py AppState dataclass exactly. */
export interface AppState {
  model: string
  permission_mode: string
  theme: string
  cwd: string
  provider: string
  auth_status: string
  base_url: string
  vim_enabled: boolean
  voice_enabled: boolean
  voice_available: boolean
  voice_reason: string
  fast_mode: boolean
  effort: string
  passes: number
  mcp_connected: number
  mcp_failed: number
  bridge_sessions: number
  output_style: string
  keybindings: Record<string, string>
}

export type TranscriptRole = 'system' | 'user' | 'assistant' | 'tool' | 'tool_result' | 'log'

export interface TranscriptItem {
  role: TranscriptRole
  text: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  is_error?: boolean
}

export interface TaskSnapshot {
  id: string
  type: string
  status: string
  description: string
  metadata: Record<string, string>
}

export interface McpServerSnapshot {
  name: string
  state: string
  transport?: string
  auth_configured: boolean
  tool_count: number
  resource_count: number
  detail?: string
}

export interface BridgeSessionSnapshot {
  session_id: string
  command: string
  cwd: string
  pid: number
  status: string
  started_at: string
  output_path?: string
}

export type SwarmStatus = 'running' | 'idle' | 'done' | 'error'

export interface SwarmTeammate {
  name: string
  status: SwarmStatus
  duration?: number
  task?: string
}

export interface SwarmNotification {
  from: string
  message: string
  timestamp: number
}

export interface ModalData {
  kind: 'permission' | 'question'
  request_id: string
  tool_name?: string
  reason?: string
  question?: string
}

export interface SelectOption {
  value: string
  label: string
  description?: string
  active?: boolean
}

export interface BackendEvent {
  type: BackendEventType
  // Common optional fields from protocol.py BackendEvent
  select_options?: SelectOption[]
  message?: string
  item?: TranscriptItem
  state?: Partial<AppState>
  tasks?: TaskSnapshot[]
  mcp_servers?: McpServerSnapshot[]
  bridge_sessions?: BridgeSessionSnapshot[]
  commands?: string[]
  modal?: Record<string, unknown>
  tool_name?: string
  tool_input?: Record<string, unknown>
  output?: string
  is_error?: boolean
  compact_phase?: string
  compact_trigger?: string
  attempt?: number
  compact_checkpoint?: string
  compact_metadata?: Record<string, unknown>
  todo_markdown?: string
  plan_mode?: string
  swarm_teammates?: SwarmTeammate[]
  swarm_notifications?: SwarmNotification[]
}
