import { useEffect, useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import {
  getStatus, rebuild, update, search, streamUrl,
  getIgnore, putIgnore, purge, toggleWatcher, cancel,
} from '../utils/ragApi'
import type { RagStatus, SearchHit } from '../utils/ragApi'

const styles = {
  container: { padding: '1.5rem', color: '#cdd6f4' as const, overflow: 'auto' as const, flex: 1 },
  card: {
    background: '#1e1e2e',
    border: '1px solid #313244',
    borderRadius: 8,
    padding: '1rem',
    marginBottom: '1rem',
  },
  button: {
    background: '#89b4fa',
    color: '#1e1e2e',
    border: 'none',
    padding: '0.5rem 1rem',
    borderRadius: 4,
    cursor: 'pointer',
    marginRight: 8,
  },
  destructive: {
    background: '#f38ba8',
    color: '#1e1e2e',
    border: 'none',
    padding: '0.5rem 1rem',
    borderRadius: 4,
    cursor: 'pointer',
  },
  hit: {
    background: '#181825',
    padding: '0.75rem',
    marginBottom: 8,
    borderRadius: 6,
    fontFamily: 'monospace',
    fontSize: 12,
    whiteSpace: 'pre-wrap' as const,
  },
  textarea: {
    width: '100%',
    minHeight: 120,
    padding: '0.5rem',
    background: '#181825',
    color: '#cdd6f4',
    border: '1px solid #313244',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 12,
    boxSizing: 'border-box' as const,
  },
  logEntry: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#a6adc8',
    padding: '2px 0',
  },
}

interface ActivityEntry {
  ts: number
  stage?: string
  file?: string
  done?: number
  total?: number
  error?: string
}

export default function RagPage() {
  const appState = useSessionStore((s) => s.appState)
  const cwd = appState?.cwd ?? 'e:/AI/OpenHarness'

  const [status, setStatus] = useState<RagStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [ignoreText, setIgnoreText] = useState('')
  const [ignoreSaving, setIgnoreSaving] = useState(false)
  const [watcherOn, setWatcherOn] = useState(false)
  const [activity, setActivity] = useState<ActivityEntry[]>([])

  const refreshStatus = async () => {
    try {
      setStatus(await getStatus(cwd))
      setErr(null)
    } catch (e) {
      setErr(String(e))
    }
  }

  useEffect(() => {
    void refreshStatus()
    void getIgnore(cwd)
      .then((r) => setIgnoreText(r.content))
      .catch((e) => setErr(String(e)))

    const es = new EventSource(streamUrl(cwd))
    es.onmessage = (ev: MessageEvent) => {
      try {
        const e = JSON.parse(ev.data) as ActivityEntry
        e.ts = Date.now() / 1000
        setActivity((prev) => [e, ...prev].slice(0, 50))
        setProgress(
          `${e.stage ?? ''}${e.file ? ' ' + e.file : ''}${
            e.done != null && e.total != null ? ` (${e.done}/${e.total})` : ''
          }`,
        )
        if (e.stage === 'complete' || e.stage === 'cancelled' || e.stage === 'purged') {
          void refreshStatus()
        }
      } catch {
        // heartbeat
      }
    }
    es.onerror = () => setProgress('(SSE disconnected)')
    return () => es.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const onRebuild = async () => {
    try { await rebuild(cwd) } catch (e) { setErr(String(e)) }
  }
  const onUpdate = async () => {
    try { await update(cwd) } catch (e) { setErr(String(e)) }
  }
  const onCancel = async () => {
    try { await cancel(cwd) } catch (e) { setErr(String(e)) }
  }
  const onSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      setHits(await search(cwd, query))
      setErr(null)
    } catch (e) {
      setErr(String(e))
      setHits([])
    } finally {
      setSearching(false)
    }
  }

  const onToggleWatcher = async () => {
    try {
      const r = await toggleWatcher(cwd, !watcherOn)
      setWatcherOn(r.state === 'running')
    } catch (e) {
      setErr(String(e))
    }
  }

  const onSaveIgnore = async () => {
    setIgnoreSaving(true)
    try {
      await putIgnore(cwd, ignoreText)
      setErr(null)
    } catch (e) {
      setErr(String(e))
    } finally {
      setIgnoreSaving(false)
    }
  }

  const onPurge = async () => {
    if (!window.confirm('删除全部索引并清空 DB 文件？此操作不可恢复。')) return
    try {
      await purge(cwd)
      void refreshStatus()
    } catch (e) {
      setErr(String(e))
    }
  }

  return (
    <div style={styles.container}>
      <h2>RAG · 索引与检索</h2>
      <p style={{ color: '#6c7086', fontSize: 12, marginTop: -8 }}>cwd: {cwd}</p>

      <div style={styles.card}>
        <h3>状态</h3>
        {err && <p style={{ color: '#f38ba8' }}>{err}</p>}
        {status ? (
          <pre style={{ margin: 0 }}>{JSON.stringify(status, null, 2)}</pre>
        ) : (
          <p>加载中…</p>
        )}
      </div>

      <div style={styles.card}>
        <h3>操作</h3>
        <button style={styles.button} onClick={() => void onRebuild()}>重建全部</button>
        <button style={styles.button} onClick={() => void onUpdate()}>增量更新</button>
        <button style={styles.button} onClick={() => void onCancel()}>取消</button>
        <button style={styles.button} onClick={() => void onToggleWatcher()}>
          {watcherOn ? '关闭监听' : '启用监听'}
        </button>
        <button style={styles.destructive} onClick={() => void onPurge()}>清空索引</button>
        <p style={{ marginTop: 12, color: '#a6adc8' }}>
          {progress || '等待事件…'}
        </p>
      </div>

      <div style={styles.card}>
        <h3>最近活动</h3>
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {activity.length === 0 && <p style={{ color: '#6c7086' }}>暂无活动</p>}
          {activity.map((e, i) => (
            <div key={i} style={styles.logEntry}>
              {new Date(e.ts * 1000).toLocaleTimeString()} · {e.stage}
              {e.file ? ` · ${e.file}` : ''}
              {e.done != null && e.total != null ? ` (${e.done}/${e.total})` : ''}
              {e.error ? ` · err=${e.error}` : ''}
            </div>
          ))}
        </div>
      </div>

      <div style={styles.card}>
        <h3>.ragignore</h3>
        <p style={{ color: '#6c7086', fontSize: 12, marginTop: 0 }}>
          每行一条 gitignore 风格规则；保存后下次索引立即生效。
        </p>
        <textarea
          style={styles.textarea}
          value={ignoreText}
          onChange={(e) => setIgnoreText(e.target.value)}
          placeholder="# 例如：&#10;node_modules&#10;dist/&#10;*.log"
        />
        <button
          style={{ ...styles.button, marginTop: 8 }}
          onClick={() => void onSaveIgnore()}
          disabled={ignoreSaving}
        >
          {ignoreSaving ? '保存中…' : '保存 .ragignore'}
        </button>
      </div>

      <div style={styles.card}>
        <h3>检索 Playground</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入 query"
            style={{
              flex: 1, padding: '0.5rem',
              background: '#181825', color: '#cdd6f4',
              border: '1px solid #313244', borderRadius: 4,
            }}
            onKeyDown={(e) => e.key === 'Enter' && void onSearch()}
          />
          <button style={styles.button} onClick={() => void onSearch()} disabled={searching}>
            {searching ? '检索中…' : '搜索'}
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {hits.map((h, i) => (
            <div key={i} style={styles.hit}>
              <div style={{ color: '#89b4fa' }}>
                {h.file}:{h.start_line}-{h.end_line} · {h.symbol || h.kind} · score {h.score}
              </div>
              <div>{h.content.substring(0, 500)}{h.content.length > 500 ? '…' : ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
