import type { NavigateFunction } from 'react-router-dom'
import type { RoleCatalog } from '../types/swarm'
import { useUiStore } from '../stores/uiStore'

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

/** Max characters from role Markdown to inject as system_prompt prefix. */
const ROLE_PREFIX_MAX_CHARS = 3000
/** Gateway hard limit for role_prefix field. */
const ROLE_PREFIX_SERVER_LIMIT = 5000

/**
 * Create a session with the expert role definition as system_prompt prefix,
 * then navigate to the chat page. The role is injected server-side so it
 * persists across the whole conversation rather than appearing as the first
 * user message.
 */
export async function startExpertChat(
  roleContent: string,
  navigate: NavigateFunction,
  fromPath: string = '/experts',
): Promise<void> {
  if (roleContent.length > ROLE_PREFIX_SERVER_LIMIT) {
    useUiStore.getState().addErrorToast(
      `角色定义超过 ${ROLE_PREFIX_SERVER_LIMIT} 字限制（当前 ${roleContent.length} 字），请精简后重试`,
      'warning',
    )
    return
  }
  const rolePrefix = roleContent.slice(0, ROLE_PREFIX_MAX_CHARS)
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_prefix: rolePrefix }),
  })
  if (!r.ok) throw new Error(`创建 session 失败: ${r.status}`)
  const body = await r.json()
  if (!body?.session_id) throw new Error('服务器返回了无效的 session')
  navigate(`/chat/${body.session_id}?from=${encodeURIComponent(fromPath)}`)
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
  const safeTeam = teamName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '')
  const safeTask = taskDesc.trim().replace(/[\r\n]+/g, ' ')
  const cmd = safeTask ? `/swarm start ${safeTeam} ${safeTask}` : `/swarm start ${safeTeam}`
  navigate(`/chat/${session_id}?prefill=${encodeURIComponent(cmd)}&autosubmit=1&from=${encodeURIComponent('/swarm')}`)
}
