import { useEffect, useRef, useState } from 'react'
import MDRenderer from '../components/MDRenderer'
import { useSessionStore } from '../stores/sessionStore'
import type { SessionSummary } from '../types/api'

interface MemFile {
  filename: string
  path: string
  size: number
  modified: number
}

interface Project {
  label: string
  dir_name: string
  memory_dir: string
  source_cwd: string | null
  is_active: boolean
  session: SessionSummary | null
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function projectTitle(p: Project): string {
  if (p.session?.title?.trim()) return p.session.title.trim()
  if (p.session?.created_at) return relativeTime(p.session.created_at)
  return p.label
}

export default function MemoryPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [files, setFiles] = useState<MemFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [dreaming, setDreaming] = useState(false)
  const [dreamDone, setDreamDone] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const appState = useSessionStore((s) => s.appState)
  const activeCwd = appState?.cwd

  // Close picker on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Load projects + sessions together; re-fetch when active cwd changes
  useEffect(() => {
    const projectsUrl = activeCwd
      ? `/api/memory/projects?active_cwd=${encodeURIComponent(activeCwd)}`
      : '/api/memory/projects'

    Promise.all([
      fetch(projectsUrl).then((r) => r.json() as Promise<Omit<Project, 'session'>[]>),
      fetch('/api/sessions').then((r) => (r.ok ? r.json() as Promise<SessionSummary[]> : [])),
    ])
      .then(([projectList, sessionList]) => {
        const sessionByCwd = new Map<string, SessionSummary>()
        for (const s of sessionList) {
          if (s.cwd) sessionByCwd.set(s.cwd, s)
        }

        const enriched: Project[] = projectList.map((p) => ({
          ...p,
          session: p.source_cwd ? (sessionByCwd.get(p.source_cwd) ?? null) : null,
        }))

        setProjects(enriched)
        setSelectedProject((prev) => {
          if (prev && enriched.some((p) => p.memory_dir === prev.memory_dir)) return prev
          return enriched.find((p) => p.is_active) ?? enriched[0] ?? null
        })
      })
      .catch(() => {})
  }, [activeCwd])

  function memDirParam() {
    return selectedProject ? `?memory_dir=${encodeURIComponent(selectedProject.memory_dir)}` : ''
  }

  function loadFiles() {
    if (!selectedProject) return
    fetch(`/api/memory/files${memDirParam()}`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => {})
  }

  useEffect(() => {
    setSelected(null)
    setContent('')
    if (!selectedProject) return
    fetch(`/api/memory/files?memory_dir=${encodeURIComponent(selectedProject.memory_dir)}`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => {})
  }, [selectedProject])

  async function selectFile(filename: string) {
    setSelected(filename)
    setLoading(true)
    const r = await fetch(`/api/memory/${encodeURIComponent(filename)}${memDirParam()}`)
    const data = await r.json()
    setContent(data.content || '')
    setLoading(false)
  }

  async function deleteFile(filename: string) {
    if (!confirm(`删除 ${filename}？`)) return
    await fetch(`/api/memory/${encodeURIComponent(filename)}${memDirParam()}`, { method: 'DELETE' })
    if (selected === filename) { setSelected(null); setContent('') }
    loadFiles()
  }

  async function dream() {
    setDreaming(true)
    await fetch(`/api/memory/dream${memDirParam()}`, { method: 'POST' })
    setDreaming(false)
    setDreamDone(true)
    setTimeout(() => setDreamDone(false), 3000)
    loadFiles()
  }

  function pickProject(p: Project) {
    setSelectedProject(p)
    setPickerOpen(false)
  }

  const pickerLabel = selectedProject
    ? `${projectTitle(selectedProject)}${selectedProject.is_active ? ' (当前)' : ''}`
    : '选择项目…'

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#89b4fa', fontWeight: 700 }}>🧠 Memory</span>

        {/* Project picker */}
        <div ref={pickerRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            style={{
              backgroundColor: '#313244',
              color: '#cdd6f4',
              border: '1px solid #45475a',
              borderRadius: '6px',
              padding: '0.25rem 0.6rem',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              maxWidth: '220px',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickerLabel}</span>
            <span style={{ fontSize: '0.65rem', flexShrink: 0 }}>▾</span>
          </button>

          {pickerOpen && (
            <div style={{
              position: 'absolute',
              top: '110%',
              left: 0,
              minWidth: '300px',
              maxWidth: '480px',
              maxHeight: '360px',
              overflowY: 'auto',
              backgroundColor: '#1e1e2e',
              border: '1px solid #45475a',
              borderRadius: '6px',
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {projects.length === 0 && (
                <div style={{ padding: '0.5rem 0.75rem', color: '#6c7086', fontSize: '0.8125rem' }}>无项目</div>
              )}
              {projects.map((p) => (
                <div
                  key={p.memory_dir}
                  onClick={() => pickProject(p)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    cursor: 'pointer',
                    backgroundColor: selectedProject?.memory_dir === p.memory_dir ? '#313244' : 'transparent',
                    borderBottom: '1px solid #313244',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '0.55rem', marginTop: '0.3rem', flexShrink: 0, color: p.is_active ? '#a6e3a1' : 'transparent' }}>●</span>
                  <div style={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
                    {/* Primary: session title (matches sidebar display) */}
                    <div style={{ fontSize: '0.8125rem', color: p.is_active ? '#a6e3a1' : '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {projectTitle(p)}
                    </div>
                    {/* Secondary: cwd path */}
                    {p.source_cwd && (
                      <div style={{ fontSize: '0.68rem', color: '#6c7086', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
                        {p.source_cwd}
                      </div>
                    )}
                  </div>
                  {/* Time badge for sessions */}
                  {p.session?.created_at && (
                    <span style={{ fontSize: '0.65rem', color: '#6c7086', flexShrink: 0, marginTop: '0.15rem' }}>
                      {relativeTime(p.session.created_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={dream}
          disabled={dreaming}
          style={{ marginLeft: 'auto', backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.3rem 0.75rem', cursor: dreaming ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', opacity: dreaming ? 0.6 : 1 }}
        >
          {dreaming ? '整合中…' : dreamDone ? '✓ 完成' : '🔮 Dream 整合'}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* File list */}
        <div style={{ width: '220px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0 }}>
          {files.length === 0 && (
            <div style={{ padding: '1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>
              {selectedProject ? '无 memory 文件' : '请先选择项目'}
            </div>
          )}
          {files.map((f) => (
            <div
              key={f.filename}
              style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #1e1e2e', backgroundColor: selected === f.filename ? '#313244' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => selectFile(f.filename)}
            >
              <div>
                <div style={{ fontSize: '0.8125rem', color: selected === f.filename ? '#89b4fa' : '#cdd6f4' }}>{f.filename}</div>
                <div style={{ fontSize: '0.7rem', color: '#6c7086' }}>{(f.size / 1024).toFixed(1)}KB</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteFile(f.filename) }}
                style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Content viewer */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
          {!selected && (
            <div style={{ color: '#6c7086', fontSize: '0.875rem', textAlign: 'center', marginTop: '3rem' }}>
              选择文件查看内容
            </div>
          )}
          {selected && loading && <div style={{ color: '#6c7086', fontSize: '0.875rem' }}>加载中…</div>}
          {selected && !loading && content && <MDRenderer content={content} />}
        </div>
      </div>
    </div>
  )
}
