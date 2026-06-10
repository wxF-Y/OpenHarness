const base = (typeof window !== 'undefined' && (window as { GATEWAY_URL?: string }).GATEWAY_URL)
  ?? 'http://127.0.0.1:8000'

export interface RagStats {
  files: number
  chunks: number
  dimensions: number
  last_indexed: number | null
  db_path: string
}

export interface RagStatus {
  stats: RagStats
  active_profile: { id: string; model: string; dimensions: number } | null
  today_cost_usd: number
  budget_usd: number
}

export interface SearchHit {
  file: string
  lang: string
  kind: string
  symbol: string | null
  start_line: number
  end_line: number
  content: string
  score: number
}

export async function getStatus(cwd: string): Promise<RagStatus> {
  const r = await fetch(`${base}/api/rag/status?cwd=${encodeURIComponent(cwd)}`)
  if (!r.ok) throw new Error(`status ${r.status}`)
  return r.json() as Promise<RagStatus>
}

export async function rebuild(cwd: string): Promise<void> {
  const r = await fetch(
    `${base}/api/rag/rebuild?cwd=${encodeURIComponent(cwd)}`,
    { method: 'POST' },
  )
  if (!r.ok) throw new Error(`rebuild ${r.status}`)
}

export async function update(cwd: string): Promise<void> {
  const r = await fetch(
    `${base}/api/rag/update?cwd=${encodeURIComponent(cwd)}`,
    { method: 'POST' },
  )
  if (!r.ok) throw new Error(`update ${r.status}`)
}

export async function search(cwd: string, query: string, topK = 8): Promise<SearchHit[]> {
  const r = await fetch(`${base}/api/rag/search?cwd=${encodeURIComponent(cwd)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK }),
  })
  if (!r.ok) throw new Error(`search ${r.status}: ${await r.text()}`)
  return r.json() as Promise<SearchHit[]>
}

export function streamUrl(cwd: string): string {
  return `${base}/api/rag/stream?cwd=${encodeURIComponent(cwd)}`
}

export async function getIgnore(cwd: string): Promise<{ content: string; exists: boolean }> {
  const r = await fetch(`${base}/api/rag/ignore?cwd=${encodeURIComponent(cwd)}`)
  if (!r.ok) throw new Error(`get ignore ${r.status}`)
  return r.json() as Promise<{ content: string; exists: boolean }>
}

export async function putIgnore(cwd: string, content: string): Promise<void> {
  const r = await fetch(`${base}/api/rag/ignore?cwd=${encodeURIComponent(cwd)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!r.ok) throw new Error(`put ignore ${r.status}`)
}

export async function purge(cwd: string): Promise<void> {
  const r = await fetch(`${base}/api/rag/purge?cwd=${encodeURIComponent(cwd)}`, {
    method: 'POST',
  })
  if (!r.ok) throw new Error(`purge ${r.status}`)
}

export async function toggleWatcher(cwd: string, enabled: boolean): Promise<{ state: string }> {
  const r = await fetch(`${base}/api/rag/watcher/toggle?cwd=${encodeURIComponent(cwd)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!r.ok) throw new Error(`watcher toggle ${r.status}`)
  return r.json() as Promise<{ state: string }>
}

export async function cancel(cwd: string): Promise<void> {
  const r = await fetch(`${base}/api/rag/cancel?cwd=${encodeURIComponent(cwd)}`, {
    method: 'POST',
  })
  if (!r.ok) throw new Error(`cancel ${r.status}`)
}
