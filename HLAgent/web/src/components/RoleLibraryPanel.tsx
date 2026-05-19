import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MDRenderer from './MDRenderer'
import type { RoleCatalog, RoleDepartment, RoleAgent, SelectedRole } from '../types/swarm'
import { fetchCatalog, fetchRoleContent, startExpertChat } from '../utils/swarmApi'

interface Props {
  mode: 'wizard' | 'picker'
  selectedRoles: SelectedRole[]
  onToggle: (role: RoleAgent, dept: string) => void
  onConfirm?: (roles: SelectedRole[]) => Promise<void>
  onClose?: () => void
}

const S = {
  root: { display: 'flex', height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', overflow: 'hidden' } as const,
  left: { width: '220px', borderRight: '1px solid #313244', display: 'flex', flexDirection: 'column' as const, flexShrink: 0 },
  middle: { width: '280px', borderRight: '1px solid #313244', overflowY: 'auto' as const, flexShrink: 0 },
  right: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  sectionLabel: { padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#6c7086', fontWeight: 700, textTransform: 'uppercase' as const },
}

function Skeleton() {
  return (
    <div style={{ padding: '0.5rem 0.75rem' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: '32px', backgroundColor: '#313244', borderRadius: '4px', marginBottom: '0.5rem', opacity: 0.5 }} />
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

export default function RoleLibraryPanel({ mode, selectedRoles, onToggle, onConfirm, onClose }: Props) {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<RoleCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeDept, setActiveDept] = useState<string | null>(null)
  const [previewRole, setPreviewRole] = useState<{ role: RoleAgent; dept: string } | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [expertChatBusy, setExpertChatBusy] = useState(false)

  useEffect(() => {
    fetchCatalog()
      .then((c) => { setCatalog(c); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  async function loadPreview(role: RoleAgent, dept: string) {
    setPreviewRole({ role, dept })
    setPreviewContent(null)
    setPreviewLoading(true)
    try {
      const content = await fetchRoleContent(role.path)
      setPreviewContent(content)
    } catch {
      setPreviewContent(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleExpertChat() {
    if (!previewRole || !previewContent) return
    setExpertChatBusy(true)
    try {
      await startExpertChat(previewContent, navigate, '/swarm')
    } catch {
      setExpertChatBusy(false)
    }
  }

  async function handleConfirm() {
    if (!onConfirm || selectedRoles.length === 0) return
    setConfirmBusy(true)
    try {
      await onConfirm(selectedRoles)
    } finally {
      setConfirmBusy(false)
    }
  }

  // Compute filtered roles
  const trimmedSearch = searchTerm.trim().toLowerCase()
  const filteredDepts: Array<{ dept: RoleDepartment; matchCount: number; roles: RoleAgent[] }> = (catalog?.departments ?? []).map((dept) => {
    const roles = trimmedSearch
      ? dept.agents.filter((a) => a.name.includes(trimmedSearch) || a.description.includes(trimmedSearch))
      : activeDept === dept.id ? dept.agents : []
    return { dept, matchCount: trimmedSearch ? roles.length : dept.agents.length, roles }
  })
  const totalMatches = trimmedSearch ? filteredDepts.reduce((s, d) => s + d.matchCount, 0) : null
  const visibleRoles = trimmedSearch
    ? filteredDepts.flatMap((d) => d.roles.map((r) => ({ role: r, dept: d.dept.id })))
    : filteredDepts.find((d) => d.dept.id === activeDept)?.roles.map((r) => ({ role: r, dept: activeDept! })) ?? []

  const isSelected = (role: RoleAgent) => selectedRoles.some((s) => s.role.path === role.path)

  if (loading) {
    return (
      <div style={S.root}>
        <div style={S.left}><Skeleton /></div>
        <div style={S.middle}><Skeleton /></div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...S.root, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <div style={{ color: '#f9e2af', fontSize: '1rem' }}>⚠️ 角色库暂时无法加载</div>
        <div style={{ color: '#6c7086', fontSize: '0.8125rem' }}>{error}</div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={() => { setError(null); setLoading(true); fetchCatalog().then((c) => { setCatalog(c); setLoading(false) }).catch((e) => { setError(String(e)); setLoading(false) }) }}
            style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem' }}>
            重试
          </button>
          {onClose && (
            <button onClick={onClose} style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem' }}>
              跳过
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: dept list + search */}
        <div style={S.left}>
          <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #313244', position: 'relative' }}>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索所有部门角色..."
              style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#cdd6f4', fontSize: '0.8125rem', boxSizing: 'border-box', paddingRight: searchTerm ? '1.5rem' : '0.6rem' }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>×</button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(catalog?.departments ?? []).map((dept) => {
              const matchCount = trimmedSearch
                ? dept.agents.filter((a) => a.name.includes(trimmedSearch) || a.description.includes(trimmedSearch)).length
                : null
              const isActive = activeDept === dept.id
              const isDimmed = trimmedSearch !== '' && matchCount === 0
              return (
                <div
                  key={dept.id}
                  onClick={() => { if (!isDimmed) { setActiveDept(dept.id); setSearchTerm('') } }}
                  style={{ padding: '0.5rem 0.75rem', cursor: isDimmed ? 'default' : 'pointer', backgroundColor: isActive ? '#313244' : 'transparent', opacity: isDimmed ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span style={{ fontSize: '0.8125rem', color: isActive ? '#89b4fa' : '#cdd6f4' }}>{dept.label}</span>
                  {matchCount !== null && matchCount > 0 && (
                    <span style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', borderRadius: '10px', padding: '0 0.35rem', fontSize: '0.65rem', fontWeight: 700 }}>{matchCount}</span>
                  )}
                  {matchCount === null && (
                    <span style={{ fontSize: '0.7rem', color: '#6c7086' }}>{dept.agents.length}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Middle: role list */}
        <div style={S.middle}>
          {trimmedSearch && (
            <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#6c7086', borderBottom: '1px solid #313244' }}>
              共找到 {totalMatches} 个角色
            </div>
          )}
          {!trimmedSearch && !activeDept && (
            <div style={{ padding: '2rem 1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>
              点击左侧部门浏览角色
            </div>
          )}
          {visibleRoles.length === 0 && trimmedSearch && (
            <div style={{ padding: '2rem 1rem', color: '#6c7086', fontSize: '0.8125rem', textAlign: 'center' }}>
              未找到匹配角色 🔍
            </div>
          )}
          {visibleRoles.map(({ role, dept }) => {
            const checked = isSelected(role)
            const isPreview = previewRole?.role.path === role.path
            return (
              <div key={role.path} style={{ display: 'flex', alignItems: 'center', padding: '0.4rem 0.5rem', borderBottom: '1px solid #1e1e2e', backgroundColor: checked ? 'rgba(137,180,250,0.08)' : isPreview ? '#181825' : 'transparent' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(role, dept)}
                  style={{ marginRight: '0.5rem', cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8125rem', color: '#cdd6f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <HighlightText text={role.name} query={trimmedSearch} />
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#6c7086', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <HighlightText text={role.description} query={trimmedSearch} />
                  </div>
                </div>
                <button
                  onClick={() => loadPreview(role, dept)}
                  style={{ marginLeft: '0.25rem', background: 'none', border: 'none', color: isPreview ? '#89b4fa' : '#585b70', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0, padding: '0.15rem 0.3rem' }}
                >
                  预览 →
                </button>
              </div>
            )
          })}
        </div>

        {/* Right: Markdown preview */}
        <div style={S.right}>
          {!previewRole && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6c7086', fontSize: '0.875rem', gap: '0.5rem' }}>
              <div>点击左侧部门浏览角色</div>
              <div style={{ fontSize: '0.75rem' }}>点击"预览 →"查看详细介绍</div>
            </div>
          )}
          {previewRole && (
            <>
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #313244', fontSize: '0.8125rem', color: '#89b4fa', fontWeight: 600, flexShrink: 0 }}>
                {previewRole.role.description}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
                {previewLoading && <Skeleton />}
                {!previewLoading && previewContent && <MDRenderer content={previewContent} compact />}
                {!previewLoading && !previewContent && (
                  <div style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>加载失败，请检查网络连接</div>
                )}
              </div>
              {previewContent && (
                <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #313244', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexShrink: 0 }}>
                  <button
                    onClick={() => onToggle(previewRole.role, previewRole.dept)}
                    style={{ backgroundColor: isSelected(previewRole.role) ? '#313244' : '#a6e3a1', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.8125rem' }}
                  >
                    {isSelected(previewRole.role) ? '✓ 已选' : '☐ 加入团队'}
                  </button>
                  <button
                    onClick={handleExpertChat}
                    disabled={expertChatBusy}
                    style={{ backgroundColor: '#cba6f7', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: expertChatBusy ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', opacity: expertChatBusy ? 0.7 : 1 }}
                  >
                    {expertChatBusy ? '⟳ 准备中...' : '与此专家对话 →'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom: selected tags + confirm (picker mode) or selected count (wizard mode) */}
      {(selectedRoles.length > 0 || mode === 'picker') && (
        <div style={{ borderTop: '1px solid #313244', padding: '0.5rem 0.75rem', backgroundColor: '#181825', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: '#6c7086', flexShrink: 0 }}>
              已选 {selectedRoles.length} 个{mode === 'wizard' ? '（建议 2-5 个）' : ''}
            </span>
            {selectedRoles.map((s) => (
              <span key={s.role.path} style={{ backgroundColor: '#313244', color: '#89b4fa', borderRadius: '12px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {s.role.name}
                <button onClick={() => onToggle(s.role, s.dept)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', padding: 0, fontSize: '0.75rem' }}>×</button>
              </span>
            ))}
            {mode === 'picker' && (
              <button
                onClick={handleConfirm}
                disabled={confirmBusy || selectedRoles.length === 0}
                style={{ marginLeft: 'auto', backgroundColor: selectedRoles.length > 0 && !confirmBusy ? '#89b4fa' : '#313244', color: selectedRoles.length > 0 && !confirmBusy ? '#1e1e2e' : '#6c7086', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: selectedRoles.length > 0 && !confirmBusy ? 'pointer' : 'not-allowed', fontSize: '0.8125rem', fontWeight: 600, flexShrink: 0 }}
              >
                {confirmBusy ? '⟳ 添加中...' : `添加 ${selectedRoles.length} 个成员`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
