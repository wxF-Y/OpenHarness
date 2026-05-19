import { useEffect, useState } from 'react'
import MDRenderer from '../components/MDRenderer'

interface MemFile {
  filename: string
  path: string
  size: number
  modified: number
}

export default function MemoryPage() {
  const [files, setFiles] = useState<MemFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [dreaming, setDreaming] = useState(false)
  const [dreamDone, setDreamDone] = useState(false)

  function loadFiles() {
    fetch('/api/memory/files').then((r) => r.json()).then(setFiles).catch(() => {})
  }

  useEffect(() => { loadFiles() }, [])

  async function selectFile(filename: string) {
    setSelected(filename)
    setLoading(true)
    const r = await fetch(`/api/memory/${encodeURIComponent(filename)}`)
    const data = await r.json()
    setContent(data.content || '')
    setLoading(false)
  }

  async function deleteFile(filename: string) {
    if (!confirm(`删除 ${filename}？`)) return
    await fetch(`/api/memory/${encodeURIComponent(filename)}`, { method: 'DELETE' })
    if (selected === filename) { setSelected(null); setContent('') }
    loadFiles()
  }

  async function dream() {
    setDreaming(true)
    await fetch('/api/memory/dream', { method: 'POST' })
    setDreaming(false)
    setDreamDone(true)
    setTimeout(() => setDreamDone(false), 3000)
    loadFiles()
  }

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#89b4fa', fontWeight: 700 }}>🧠 Memory</span>
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
            <div style={{ padding: '1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>无 memory 文件</div>
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

