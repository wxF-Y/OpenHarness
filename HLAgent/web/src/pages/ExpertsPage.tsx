import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MDRenderer from '../components/MDRenderer'
import type { RoleCatalog, RoleDepartment, RoleAgent } from '../types/swarm'
import { fetchCatalog, fetchRoleContent, startExpertChat } from '../utils/swarmApi'

function Skeleton() {
  return (
    <div style={{ padding: '0.5rem 0.75rem' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: '48px', backgroundColor: '#313244', borderRadius: '4px', marginBottom: '0.5rem', opacity: 0.5 }} />
      ))}
    </div>
  )
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ backgroundColor: '#f9e2af', color: '#1e1e2e', borderRadius: '2px' }}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function ExpertsPage() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<RoleCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeDept, setActiveDept] = useState<string | null>(null)
  const [previewRole, setPreviewRole] = useState<{ role: RoleAgent; dept: string } | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const previewGenRef = useRef(0)

  useEffect(() => {
    fetchCatalog()
      .then((c) => {
        setCatalog(c)
        setLoading(false)
        if (c.departments.length > 0) setActiveDept(c.departments[0].id)
      })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  async function loadPreview(role: RoleAgent, dept: string) {
    const gen = ++previewGenRef.current
    setPreviewRole({ role, dept })
    setPreviewContent(null)
    setPreviewLoading(true)
    try {
      const content = await fetchRoleContent(role.path)
      if (gen !== previewGenRef.current) return
      setPreviewContent(content)
    } catch {
      if (gen !== previewGenRef.current) return
      setPreviewContent(null)
    } finally {
      if (gen === previewGenRef.current) setPreviewLoading(false)
    }
  }

  async function startChat(role: RoleAgent, content?: string | null) {
    setChatError(null)
    setBusyPath(role.path)
    try {
      const roleContent = content ?? await fetchRoleContent(role.path)
      await startExpertChat(roleContent, navigate)
    } catch (e) {
      setBusyPath(null)
      setChatError(e instanceof Error ? e.message : '启动对话失败，请重试')
    }
  }

  function retry() {
    setError(null)
    setLoading(true)
    fetchCatalog()
      .then((c) => { setCatalog(c); setLoading(false); if (c.departments.length > 0) setActiveDept(c.departments[0].id) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }

  const trimmedSearch = searchTerm.trim().toLowerCase()

  const filteredDepts = useMemo<Array<{ dept: RoleDepartment; roles: RoleAgent[]; matchCount: number }>>(
    () => (catalog?.departments ?? []).map((dept) => {
      const roles = trimmedSearch
        ? dept.agents.filter((a) => a.name.toLowerCase().includes(trimmedSearch) || a.description.toLowerCase().includes(trimmedSearch))
        : dept.agents
      return { dept, roles, matchCount: roles.length }
    }),
    [catalog, trimmedSearch],
  )

  const visibleRoles = useMemo(
    () => trimmedSearch
      ? filteredDepts.flatMap((d) => d.roles.map((r) => ({ role: r, dept: d.dept.id })))
      : filteredDepts.find((d) => d.dept.id === activeDept)?.roles.map((r) => ({ role: r, dept: activeDept! })) ?? [],
    [filteredDepts, trimmedSearch, activeDept],
  )

  const totalMatches = trimmedSearch ? filteredDepts.reduce((s, d) => s + d.matchCount, 0) : null

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <span style={{ color: '#cba6f7', fontWeight: 700, fontSize: '0.9375rem' }}>🎭 专家库</span>
        <span style={{ color: '#6c7086', fontSize: '0.8125rem' }}>选择专家直接开始对话</span>
      </div>

      {/* Error toast */}
      {chatError && (
        <div style={{ backgroundColor: '#45192c', borderBottom: '1px solid #f38ba8', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>⚠️ {chatError}</span>
          <button onClick={() => setChatError(null)} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}>×</button>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {loading && (
          <div style={{ flex: 1, display: 'flex' }}>
            <div style={{ width: '200px', borderRight: '1px solid #313244' }}><Skeleton /></div>
            <div style={{ flex: 1 }}><Skeleton /></div>
          </div>
        )}

        {error && !loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
            <div style={{ color: '#f9e2af', fontSize: '1rem' }}>⚠️ 角色库暂时无法加载</div>
            <div style={{ color: '#6c7086', fontSize: '0.8125rem' }}>{error}</div>
            <button onClick={retry} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem' }}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && catalog && (
          <>
            {/* Left: dept list + search */}
            <div style={{ width: '200px', borderRight: '1px solid #313244', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #313244', position: 'relative' }}>
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索专家..."
                  style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', fontSize: '0.8125rem', boxSizing: 'border-box', paddingRight: searchTerm ? '1.5rem' : '0.6rem' }}
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>×</button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {filteredDepts.map(({ dept, matchCount }) => {
                  const isActive = activeDept === dept.id && !trimmedSearch
                  const isDimmed = trimmedSearch !== '' && matchCount === 0
                  return (
                    <div
                      key={dept.id}
                      onClick={() => { if (!isDimmed) { setActiveDept(dept.id); setSearchTerm('') } }}
                      style={{ padding: '0.55rem 0.75rem', cursor: isDimmed ? 'default' : 'pointer', backgroundColor: isActive ? '#313244' : 'transparent', opacity: isDimmed ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e1e2e' }}
                    >
                      <span style={{ fontSize: '0.8125rem', color: isActive ? '#89b4fa' : '#cdd6f4' }}>{dept.label}</span>
                      {trimmedSearch && matchCount > 0 && (
                        <span style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', borderRadius: '10px', padding: '0 0.35rem', fontSize: '0.65rem', fontWeight: 700 }}>{matchCount}</span>
                      )}
                      {!trimmedSearch && (
                        <span style={{ fontSize: '0.7rem', color: '#6c7086' }}>{dept.agents.length}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Middle: role list */}
            <div style={{ width: '300px', borderRight: '1px solid #313244', overflowY: 'auto', flexShrink: 0 }}>
              {trimmedSearch && (
                <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#6c7086', borderBottom: '1px solid #313244' }}>
                  共找到 {totalMatches} 个专家
                </div>
              )}
              {!trimmedSearch && !activeDept && (
                <div style={{ padding: '2rem 1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>
                  点击左侧部门浏览专家
                </div>
              )}
              {visibleRoles.length === 0 && trimmedSearch && (
                <div style={{ padding: '2rem 1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>
                  未找到匹配专家 🔍
                </div>
              )}
              {visibleRoles.map(({ role, dept }) => {
                const isPreview = previewRole?.role.path === role.path
                const isBusy = busyPath === role.path
                return (
                  <div
                    key={role.path}
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1e1e2e', backgroundColor: isPreview ? '#181825' : 'transparent', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => loadPreview(role, dept)}>
                      <div style={{ fontSize: '0.8125rem', color: isPreview ? '#cba6f7' : '#cdd6f4', fontWeight: isPreview ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <HighlightText text={role.description || role.name} query={trimmedSearch} />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#6c7086', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.1rem' }}>
                        <HighlightText text={role.name} query={trimmedSearch} />
                      </div>
                    </div>
                    <button
                      onClick={() => startChat(role, isPreview ? previewContent : null)}
                      disabled={isBusy}
                      style={{ flexShrink: 0, backgroundColor: isBusy ? '#313244' : '#cba6f7', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.3rem 0.6rem', cursor: isBusy ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: isBusy ? 0.7 : 1, whiteSpace: 'nowrap' }}
                    >
                      {isBusy ? '⟳ 准备中' : '对话 →'}
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Right: Markdown preview */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {!previewRole && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6c7086', fontSize: '0.875rem', gap: '0.75rem' }}>
                  <div style={{ fontSize: '2rem' }}>🎭</div>
                  <div>点击专家名称预览详情</div>
                  <div style={{ fontSize: '0.75rem' }}>或直接点击"对话 →"立即开始</div>
                </div>
              )}
              {previewRole && (
                <>
                  <div style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.875rem', color: '#cba6f7', fontWeight: 600 }}>{previewRole.role.description}</span>
                    <span style={{ fontSize: '0.75rem', color: '#6c7086' }}>{previewRole.role.name}</span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
                    {previewLoading && <Skeleton />}
                    {!previewLoading && previewContent && <MDRenderer content={previewContent} compact />}
                    {!previewLoading && !previewContent && (
                      <div style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>加载失败，请检查网络连接</div>
                    )}
                  </div>
                  <div style={{ padding: '0.6rem 0.75rem', borderTop: '1px solid #313244', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                    <button
                      onClick={() => startChat(previewRole.role, previewContent)}
                      disabled={busyPath === previewRole.role.path}
                      style={{ backgroundColor: busyPath === previewRole.role.path ? '#313244' : '#cba6f7', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 1rem', cursor: busyPath === previewRole.role.path ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: busyPath === previewRole.role.path ? 0.7 : 1 }}
                    >
                      {busyPath === previewRole.role.path ? '⟳ 准备中...' : '与此专家对话 →'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
