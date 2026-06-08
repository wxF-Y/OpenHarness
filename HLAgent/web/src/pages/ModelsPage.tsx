import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileSummary } from '../types/api'

const API_FORMAT_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic 官方' },
  { value: 'anthropic_compat', label: 'Anthropic Compatible（第三方兼容接口）' },
  { value: 'openai_compat', label: 'OpenAI Compatible（第三方兼容接口）' },
  { value: 'openai', label: 'OpenAI 标准' },
  { value: 'copilot', label: 'GitHub Copilot' },
]

const BASE_URL_REQUIRED_FORMATS = new Set(['anthropic_compat', 'openai_compat'])
const BASE_URL_OPTIONAL_FORMATS = new Set(['openai'])

function needsBaseUrl(apiFormat: string): 'required' | 'optional' | 'none' {
  if (BASE_URL_REQUIRED_FORMATS.has(apiFormat)) return 'required'
  if (BASE_URL_OPTIONAL_FORMATS.has(apiFormat)) return 'optional'
  return 'none'
}

interface EditForm {
  profileName: string
  label: string
  api_format: string
  base_url: string
  default_model: string
  api_key: string
  context_window_tokens: string  // 输入框用 string，提交时转 number
  auto_compact_threshold_tokens: string
}

const DEFAULT_CONTEXT_WINDOW = 200000  // 与后端 DEFAULT_CONTEXT_WINDOW_TOKENS 保持一致

const EMPTY_FORM: EditForm = {
  profileName: '',
  label: '',
  api_format: 'anthropic',
  base_url: '',
  default_model: '',
  api_key: '',
  context_window_tokens: String(DEFAULT_CONTEXT_WINDOW),
  auto_compact_threshold_tokens: '',
}

function generateProfileId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `p-${hex}`
}

export default function ModelsPage() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/profiles')
      if (!res.ok) throw new Error('加载失败')
      const data: ProfileSummary[] = await res.json()
      setProfiles(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  function openEdit(profile: ProfileSummary) {
    setEditForm({
      profileName: profile.name,
      label: profile.label,
      api_format: profile.api_format,
      base_url: profile.base_url || '',
      default_model: profile.model,
      api_key: '',
      context_window_tokens: profile.context_window_tokens !== null && profile.context_window_tokens !== undefined
        ? String(profile.context_window_tokens)
        : String(DEFAULT_CONTEXT_WINDOW),
      auto_compact_threshold_tokens: profile.auto_compact_threshold_tokens !== null && profile.auto_compact_threshold_tokens !== undefined
        ? String(profile.auto_compact_threshold_tokens)
        : '',
    })
    setIsCreating(false)
    setSaveError(null)
    setSaved(false)
    setShowAdvanced(false)
  }

  function openCreate() {
    setEditForm({ ...EMPTY_FORM })
    setIsCreating(true)
    setSaveError(null)
    setSaved(false)
  }

  function closeEdit() {
    setEditForm(null)
    setIsCreating(false)
    setSaveError(null)
  }

  async function handleSave() {
    if (!editForm) return
    setSaving(true)
    setSaveError(null)
    try {
      // 解析高级字段：空字符串 → null，否则转 number
      const parseTokens = (s: string): number | null => {
        const trimmed = s.trim()
        if (!trimmed) return null
        const n = parseInt(trimmed, 10)
        return Number.isFinite(n) && n > 0 ? n : null
      }
      const ctxTokens = parseTokens(editForm.context_window_tokens)
      const compactTokens = parseTokens(editForm.auto_compact_threshold_tokens)

      if (isCreating) {
        if (!editForm.label.trim()) { setSaveError('显示名称不能为空'); setSaving(false); return }
        if (!editForm.default_model.trim()) { setSaveError('默认模型不能为空'); setSaving(false); return }
        if (!editForm.api_key.trim()) { setSaveError('API Key 不能为空'); setSaving(false); return }
        const name = generateProfileId()
        const res = await fetch('/api/settings/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            label: editForm.label,
            api_format: editForm.api_format,
            base_url: editForm.base_url || null,
            default_model: editForm.default_model,
            api_key: editForm.api_key || null,
            context_window_tokens: ctxTokens,
            auto_compact_threshold_tokens: compactTokens,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { detail?: string }).detail || `创建失败: ${res.status}`)
        }
      } else {
        // 编辑模式：label / default_model 改为空字符串视为非法（保持原值需保留原文本）
        if (!editForm.label.trim()) { setSaveError('显示名称不能为空'); setSaving(false); return }
        if (!editForm.default_model.trim()) { setSaveError('默认模型不能为空'); setSaving(false); return }
        const body: Record<string, unknown> = {
          label: editForm.label,
          api_format: editForm.api_format,
          base_url: editForm.base_url || null,
          default_model: editForm.default_model,
        }
        if (editForm.api_key) body.api_key = editForm.api_key
        if (ctxTokens !== null) body.context_window_tokens = ctxTokens
        if (compactTokens !== null) body.auto_compact_threshold_tokens = compactTokens
        const res = await fetch(`/api/settings/profiles/${editForm.profileName}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { detail?: string }).detail || `保存失败: ${res.status}`)
        }
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await loadProfiles()
      if (isCreating) closeEdit()
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(profileName: string) {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/settings/profiles/${profileName}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { detail?: string }).detail || `删除失败: ${res.status}`)
      }
      setConfirmDelete(null)
      if (editForm?.profileName === profileName) closeEdit()
      await loadProfiles()
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const baseUrlMode = editForm ? needsBaseUrl(editForm.api_format) : 'none'

  return (
    <div style={{ height: '100%', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem', borderBottom: '1px solid #313244', backgroundColor: '#181825', flexShrink: 0 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem', padding: 0 }}>
          ← 返回
        </button>
        <span style={{ color: '#cdd6f4', fontWeight: 700 }}>🧩 模型配置</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6c7086' }}>配置保存到全局 settings.json</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
        <div style={{ maxWidth: '720px', width: '100%', margin: '0 auto' }}>
          {loading && <div style={{ color: '#6c7086', textAlign: 'center', marginTop: '2rem' }}>加载中…</div>}
          {error && !loading && <div style={{ color: '#f38ba8', textAlign: 'center', marginTop: '2rem' }}>{error}</div>}

          {!loading && !error && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                {profiles.map((p) => {
                  const isActive = editForm?.profileName === p.name && !isCreating
                  return (
                    <div
                      key={p.name}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.75rem', borderRadius: '6px', marginBottom: '0.35rem',
                        background: isActive ? '#313244' : '#181825',
                        border: `1px solid ${isActive ? '#45475a' : '#313244'}`,
                        cursor: 'pointer',
                        transition: 'background 80ms, border-color 80ms',
                      }}
                      onClick={() => openEdit(p)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', color: '#cdd6f4', fontWeight: 500 }}>
                          {p.label}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#6c7086', marginTop: '2px' }}>
                          {p.model || p.api_format}
                          {p.base_url ? ` · ${p.base_url}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(p) }}
                          style={{ background: '#313244', border: 'none', borderRadius: '4px', color: '#cdd6f4', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem' }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.name) }}
                          style={{ background: 'rgba(243,139,168,0.12)', border: 'none', borderRadius: '4px', color: '#f38ba8', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem' }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={openCreate}
                style={{ background: '#313244', border: '1px dashed #45475a', borderRadius: '6px', color: '#89b4fa', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.8125rem', width: '100%', marginBottom: '1.5rem' }}
              >
                + 新增 Profile
              </button>

              {editForm && (
                <div style={{ background: '#181825', border: '1px solid #45475a', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, color: '#cdd6f4', marginBottom: '1rem', fontSize: '0.875rem' }}>
                    {isCreating ? '新增 Profile' : `编辑：${editForm.label}`}
                  </div>

                  {isCreating && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                        显示名称 <span style={{ color: '#f38ba8' }}>*必填</span>
                      </label>
                      <input
                        value={editForm.label}
                        onChange={(e) => setEditForm((f) => f ? { ...f, label: e.target.value } : f)}
                        placeholder="如：DeepSeek V4 Pro (1M)"
                        style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}

                  <>
                    {!isCreating && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                          显示名称 <span style={{ color: '#f38ba8' }}>*必填</span>
                        </label>
                        <input
                          value={editForm.label}
                          onChange={(e) => setEditForm((f) => f ? { ...f, label: e.target.value } : f)}
                          style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box' }}
                        />
                      </div>
                    )}

                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>API 格式</label>
                        <select
                          value={editForm.api_format}
                          onChange={(e) => setEditForm((f) => f ? { ...f, api_format: e.target.value } : f)}
                          style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem', fontSize: '0.8125rem' }}
                        >
                          {API_FORMAT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      {baseUrlMode !== 'none' && (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                            Base URL {baseUrlMode === 'required' ? <span style={{ color: '#f38ba8' }}>*必填</span> : '（可选）'}
                          </label>
                          <input
                            value={editForm.base_url}
                            onChange={(e) => setEditForm((f) => f ? { ...f, base_url: e.target.value } : f)}
                            placeholder="https://your-proxy.example.com/v1"
                            style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                          />
                        </div>
                      )}

                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                          默认模型 <span style={{ color: '#f38ba8' }}>*必填</span>
                        </label>
                        <input
                          value={editForm.default_model}
                          onChange={(e) => setEditForm((f) => f ? { ...f, default_model: e.target.value } : f)}
                          placeholder="claude-sonnet-4-6"
                          style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                        />
                      </div>
                    </>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8125rem', color: '#a6adc8', marginBottom: '0.3rem' }}>
                      API Key {isCreating
                        ? <span style={{ color: '#f38ba8' }}>*必填</span>
                        : <span style={{ color: '#6c7086' }}>（留空保留原 Key）</span>}
                    </label>
                    <input
                      type="password"
                      value={editForm.api_key}
                      onChange={(e) => setEditForm((f) => f ? { ...f, api_key: e.target.value } : f)}
                      placeholder={isCreating ? '输入第三方 API Key' : '留空保留原 Key，输入新 Key 则覆盖'}
                      style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                    />
                  </div>

                  {/* 高级设置（折叠） */}
                  <div style={{ marginBottom: '1rem', borderTop: '1px solid #313244', paddingTop: '0.75rem' }}>
                    <button
                      onClick={() => setShowAdvanced((v) => !v)}
                      style={{ background: 'none', border: 'none', color: '#a6adc8', cursor: 'pointer', fontSize: '0.8125rem', padding: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 100ms', display: 'inline-block' }}>▶</span>
                      高级设置
                    </button>
                    {showAdvanced && (
                      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: '#a6adc8', marginBottom: '0.25rem' }}>
                            上下文窗口（tokens） <span style={{ color: '#6c7086' }}>· 默认 {DEFAULT_CONTEXT_WINDOW.toLocaleString()}</span>
                          </label>
                          <input
                            type="number"
                            value={editForm.context_window_tokens}
                            onChange={(e) => setEditForm((f) => f ? { ...f, context_window_tokens: e.target.value } : f)}
                            placeholder="200000（Claude 标准）/ 1000000（1M 扩展窗口）"
                            style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                          />
                          <div style={{ fontSize: '0.7rem', color: '#6c7086', marginTop: '0.2rem' }}>
                            常用值：200000（GPT/Claude 标准）· 128000（GPT-4o）· 1000000（Claude 4.6 / Gemini 长上下文）
                          </div>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: '#a6adc8', marginBottom: '0.25rem' }}>
                            自动压缩阈值（tokens） <span style={{ color: '#6c7086' }}>· 留空 = 窗口 × 80% 自动计算</span>
                          </label>
                          <input
                            type="number"
                            value={editForm.auto_compact_threshold_tokens}
                            onChange={(e) => setEditForm((f) => f ? { ...f, auto_compact_threshold_tokens: e.target.value } : f)}
                            placeholder="留空使用窗口 × 80%（推荐）"
                            style={{ width: '100%', background: '#11111b', border: '1px solid #313244', borderRadius: '6px', color: '#cdd6f4', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
                          />
                          <div style={{ fontSize: '0.7rem', color: '#6c7086', marginTop: '0.2rem' }}>
                            达到此阈值时自动压缩历史对话。建议为窗口的 70-80%
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      style={{ background: saving ? '#45475a' : '#89b4fa', border: 'none', borderRadius: '4px', color: '#1e1e2e', padding: '0.5rem 1.25rem', cursor: saving ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 700 }}
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button
                      onClick={closeEdit}
                      style={{ background: '#313244', border: 'none', borderRadius: '4px', color: '#cdd6f4', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.875rem' }}
                    >
                      取消
                    </button>
                    {saved && <span style={{ color: '#a6e3a1', fontSize: '0.8125rem' }}>✓ 已保存</span>}
                    {saveError && <span style={{ color: '#f38ba8', fontSize: '0.8125rem' }}>{saveError}</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(17,17,27,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#181825', border: '1px solid rgba(243,139,168,0.5)', borderRadius: 10, padding: '1.25rem 1.5rem', width: 300 }}
          >
            <div style={{ fontWeight: 700, color: '#cdd6f4', marginBottom: '0.5rem' }}>删除 Profile</div>
            <div style={{ fontSize: '0.8125rem', color: '#f38ba8', marginBottom: '1.25rem' }}>
              确定删除 <strong>{confirmDelete}</strong>？此操作不可撤销。
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: '#313244', border: 'none', borderRadius: 6, color: '#cdd6f4', padding: '0.4rem 0.9rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ background: '#f38ba8', border: 'none', borderRadius: 6, color: '#1e1e2e', padding: '0.4rem 0.9rem', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
