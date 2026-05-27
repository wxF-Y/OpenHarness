import { useEffect, useState } from 'react'
import MDRenderer from '../components/MDRenderer'

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  return content.slice(end + 4).trimStart()
}

interface Skill {
  name: string
  description: string
  tags: string[]
  user_invocable: boolean
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/skills').then((r) => r.json()).then(setSkills).catch(() => {})
  }, [])

  async function openSkill(name: string) {
    setSelected(name)
    setLoading(true)
    const r = await fetch(`/api/skills/${encodeURIComponent(name)}`)
    const d = await r.json()
    setContent(d.content || '')
    setLoading(false)
  }

  const filtered = skills.filter((s) => s.name.includes(filter) || s.description.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#89b4fa', fontWeight: 700 }}>⚡ Skills</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="过滤…" style={{ backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.3rem 0.6rem', color: '#cdd6f4', fontSize: '0.8125rem', width: '180px' }} />
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: '260px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0 }}>
          {filtered.map((s) => (
            <div key={s.name} onClick={() => openSkill(s.name)} style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #1e1e2e', backgroundColor: selected === s.name ? '#313244' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem' }}>
                <span style={{ fontSize: '0.8125rem', color: selected === s.name ? '#89b4fa' : '#cdd6f4', fontWeight: 600 }}>{s.name}</span>
                {s.user_invocable && <span style={{ fontSize: '0.65rem', backgroundColor: '#313244', color: '#89b4fa', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>/{s.name}</span>}
              </div>
              {s.description && <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>{s.description.slice(0, 80)}</div>}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>无匹配 Skill</div>}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
          {!selected && <div style={{ color: '#6c7086', fontSize: '0.875rem', textAlign: 'center', marginTop: '3rem' }}>选择 Skill 查看内容</div>}
          {loading && <div style={{ color: '#6c7086' }}>加载中…</div>}
          {!loading && content && <MDRenderer content={stripFrontmatter(content)} />}
        </div>
      </div>
    </div>
  )
}

