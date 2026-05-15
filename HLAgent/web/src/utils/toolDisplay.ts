/**
 * Tool display configuration matching all 44 OpenHarness tools.
 * Mirrors TUI summarizeInput() logic and extends it for Web display.
 */

export interface ToolDisplayConfig {
  icon: string
  color: string
  readOnly: boolean
}

const TOOL_MAP: Record<string, ToolDisplayConfig> = {
  bash: { icon: '🖥️', color: '#fab387', readOnly: false },
  write_file: { icon: '✏️', color: '#89b4fa', readOnly: false },
  edit_file: { icon: '✏️', color: '#89b4fa', readOnly: false },
  notebook_edit: { icon: '📓', color: '#89b4fa', readOnly: false },
  read_file: { icon: '📄', color: '#6c7086', readOnly: true },
  glob: { icon: '🔍', color: '#6c7086', readOnly: true },
  grep: { icon: '🔍', color: '#6c7086', readOnly: true },
  web_fetch: { icon: '🌐', color: '#a6e3a1', readOnly: true },
  web_search: { icon: '🔍', color: '#a6e3a1', readOnly: true },
  image_generation: { icon: '🎨', color: '#f5c2e7', readOnly: false },
  image_to_text: { icon: '🖼️', color: '#f5c2e7', readOnly: true },
  agent: { icon: '🤖', color: '#cba6f7', readOnly: false },
  task_create: { icon: '📋', color: '#6c7086', readOnly: false },
  task_get: { icon: '📋', color: '#6c7086', readOnly: true },
  task_output: { icon: '📋', color: '#6c7086', readOnly: true },
  task_list: { icon: '📋', color: '#6c7086', readOnly: true },
  task_stop: { icon: '📋', color: '#6c7086', readOnly: false },
  task_update: { icon: '📋', color: '#6c7086', readOnly: false },
  cron_create: { icon: '⏰', color: '#f9e2af', readOnly: false },
  cron_delete: { icon: '⏰', color: '#f9e2af', readOnly: false },
  cron_list: { icon: '⏰', color: '#f9e2af', readOnly: true },
  cron_toggle: { icon: '⏰', color: '#f9e2af', readOnly: false },
  team_create: { icon: '🤝', color: '#94e2d5', readOnly: false },
  team_delete: { icon: '🤝', color: '#94e2d5', readOnly: false },
  send_message: { icon: '💬', color: '#94e2d5', readOnly: false },
  todo_write: { icon: '✅', color: '#94e2d5', readOnly: false },
  enter_plan_mode: { icon: '📋', color: '#f9e2af', readOnly: false },
  exit_plan_mode: { icon: '📋', color: '#f9e2af', readOnly: false },
  enter_worktree: { icon: '🌿', color: '#a6e3a1', readOnly: false },
  exit_worktree: { icon: '🌿', color: '#a6e3a1', readOnly: false },
  config: { icon: '⚙️', color: '#6c7086', readOnly: false },
  skill: { icon: '⚡', color: '#89b4fa', readOnly: false },
  list_mcp_resources: { icon: '⚙️', color: '#74c7ec', readOnly: true },
  read_mcp_resource: { icon: '⚙️', color: '#74c7ec', readOnly: true },
  mcp_auth: { icon: '🔑', color: '#74c7ec', readOnly: false },
  tool_search: { icon: '🔍', color: '#6c7086', readOnly: true },
  lsp: { icon: '🔧', color: '#6c7086', readOnly: true },
  remote_trigger: { icon: '🔗', color: '#89b4fa', readOnly: false },
  ask_user_question: { icon: '❓', color: '#f9e2af', readOnly: true },
  brief: { icon: '📝', color: '#6c7086', readOnly: true },
  sleep: { icon: '💤', color: '#6c7086', readOnly: true },
}

const WRITE_TOOLS = new Set([
  'bash', 'write_file', 'edit_file', 'notebook_edit', 'computer',
])

const SENSITIVE_PATH_PATTERNS = [
  '/.ssh/', '/.aws/credentials', '/.aws/config', '/.config/gcloud/',
  '/.azure/', '/.gnupg/', '/.docker/config.json', '/.kube/config',
  '/.openharness/credentials.json', '/.openharness/copilot_auth.json',
]

export function getToolConfig(name: string): ToolDisplayConfig {
  if (!name) return { icon: '⚙️', color: '#6c7086', readOnly: false }
  if (name.startsWith('mcp__')) return { icon: '⚙️', color: '#74c7ec', readOnly: false }
  return TOOL_MAP[name] ?? { icon: '⚙️', color: '#6c7086', readOnly: false }
}

export function getToolIcon(name: string): string {
  return getToolConfig(name).icon
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name)
}

export function isReadOnly(name: string): boolean {
  return getToolConfig(name).readOnly
}

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((p) => path.includes(p))
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  if (!input) return ''

  if (name === 'bash' && input.command) {
    return String(input.command).slice(0, 120)
  }
  if ((name === 'read_file' || name === 'write_file' || name === 'edit_file') && input.file_path) {
    return String(input.file_path)
  }
  if (name === 'notebook_edit' && input.notebook_path) {
    return `${input.notebook_path}:${input.cell_number ?? '?'}`
  }
  if (name === 'grep' && input.pattern) {
    return `/${input.pattern}/${input.glob ? ` in ${input.glob}` : ''}`
  }
  if (name === 'glob' && input.pattern) {
    return String(input.pattern)
  }
  if (name === 'web_fetch' && input.url) {
    return String(input.url).slice(0, 80)
  }
  if (name === 'web_search' && input.query) {
    return String(input.query)
  }
  if (name === 'image_generation' && input.prompt) {
    return String(input.prompt).slice(0, 80)
  }
  if (name === 'image_to_text' && input.source) {
    return String(input.source).slice(0, 60)
  }
  if (name === 'agent') {
    if (input.subagent_type) return String(input.subagent_type)
    if (input.description) return String(input.description).slice(0, 80)
  }
  if (name.startsWith('cron_') && input.name) {
    return name === 'cron_create' && input.schedule
      ? `${input.name} [${input.schedule}]`
      : String(input.name)
  }
  if (name === 'send_message' && input.to) {
    const text = input.text ? ` "${String(input.text).slice(0, 40)}"` : ''
    return `→ ${input.to}${text}`
  }
  if (name === 'todo_write' && Array.isArray(input.todos)) {
    const done = (input.todos as Array<{ status?: string }>).filter((t) => t.status === 'completed').length
    return `${input.todos.length} tasks (${done} done)`
  }
  if ((name === 'team_create' || name === 'team_delete') && input.name) {
    return String(input.name)
  }
  if ((name === 'enter_worktree' || name === 'exit_worktree') && (input.name || input.path)) {
    return String(input.name ?? input.path)
  }
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    const server = parts[1] ?? ''
    const tool = parts[2] ?? ''
    const firstArg = Object.values(input)[0]
    return `${server}::${tool}${firstArg ? ` ${String(firstArg).slice(0, 40)}` : ''}`
  }

  // Generic: first key=value
  const entries = Object.entries(input)
  if (entries.length) {
    const [key, val] = entries[0]
    return `${key}=${String(val).slice(0, 60)}`
  }
  return ''
}
