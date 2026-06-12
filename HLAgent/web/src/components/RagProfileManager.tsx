import { useEffect, useState } from 'react'
import {
  listProfiles, createProfile, deleteProfile, testEmbed, listOllamaModels,
  installLocalDepsUrl,
} from '../utils/ragApi'
import type { EmbedProfile } from '../utils/ragApi'

const styles = {
  card: {
    background: '#1e1e2e', border: '1px solid #313244',
    borderRadius: 8, padding: '1rem', marginBottom: '1rem',
    color: '#cdd6f4' as const,
  },
  button: {
    background: '#89b4fa', color: '#1e1e2e', border: 'none',
    padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer',
    marginRight: 8, fontSize: 12,
  },
  destructive: {
    background: '#f38ba8', color: '#1e1e2e', border: 'none',
    padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer',
    fontSize: 12,
  },
  input: {
    padding: '0.4rem', background: '#181825', color: '#cdd6f4',
    border: '1px solid #313244', borderRadius: 4, fontSize: 12,
    width: '100%', boxSizing: 'border-box' as const,
  },
  row: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginBottom: 8 },
  profileLine: {
    background: '#181825', padding: '0.5rem',
    marginBottom: 6, borderRadius: 4, fontFamily: 'monospace', fontSize: 12,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
}

type FormState = {
  name: string
  provider: 'openai' | 'ollama' | 'openai-compatible' | 'local'
  model: string
  dimensions: number
  api_base: string
  api_key: string
}

const DEFAULT_FORM: FormState = {
  name: '', provider: 'openai', model: 'text-embedding-3-small',
  dimensions: 1536, api_base: '', api_key: '',
}

export function RagProfileManager() {
  const [profiles, setProfiles] = useState<EmbedProfile[]>([])
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [installLog, setInstallLog] = useState<string[]>([])
  const [installing, setInstalling] = useState(false)
  const [installDone, setInstallDone] = useState(false)

  const refresh = async () => {
    try { setProfiles(await listProfiles()) } catch (e) { setErr(String(e)) }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    if (form.provider === 'ollama') {
      void listOllamaModels(form.api_base || 'http://localhost:11434')
        .then((ms) => setOllamaModels(ms.map((m) => m.name)))
        .catch(() => setOllamaModels([]))
    }
  }, [form.provider, form.api_base])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testEmbed({
        provider: form.provider, model: form.model,
        dimensions: form.dimensions,
        api_base: form.api_base || null, api_key: form.api_key || null,
      })
      setTestResult(r.ok
        ? `✓ ${r.latency_ms}ms · ${r.dimensions}d`
        : `✗ ${r.error ?? 'unknown'}`)
    } catch (e) {
      setTestResult(`✗ ${String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  const handleCreate = async () => {
    try {
      await createProfile({
        name: form.name || `${form.provider} ${form.model}`,
        provider: form.provider,
        model: form.model,
        dimensions: form.dimensions,
        api_base: form.api_base || null,
        api_key: form.api_key || null,
      })
      setForm(DEFAULT_FORM)
      setTestResult(null)
      void refresh()
    } catch (e) {
      setErr(String(e))
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(`删除 profile ${id}?`)) return
    try {
      await deleteProfile(id)
      void refresh()
    } catch (e) {
      setErr(String(e))
    }
  }

  const handleInstallLocalDeps = async () => {
    if (!window.confirm(
      '将通过 pip 安装 sentence-transformers + torch (~1.5GB 下载)。\n' +
      '安装完成后需要重启 gateway 才能生效。是否继续？',
    )) return
    setInstalling(true)
    setInstallLog([])
    setInstallDone(false)
    try {
      const resp = await fetch(installLocalDepsUrl(), { method: 'POST' })
      if (!resp.ok || !resp.body) throw new Error(`install ${resp.status}`)
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const chunk of parts) {
          const line = chunk.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          try {
            const evt = JSON.parse(line.slice(5).trim()) as {
              stage: string; line?: string; message?: string; cmd?: string; rc?: number
            }
            if (evt.stage === 'log' && evt.line) {
              setInstallLog((prev) => [...prev, evt.line as string].slice(-200))
            } else if (evt.stage === 'start' && evt.cmd) {
              setInstallLog((prev) => [...prev, `$ ${evt.cmd}`])
            } else if (evt.stage === 'done') {
              setInstallLog((prev) => [...prev, '✓ ' + (evt.message ?? '完成')])
              setInstallDone(true)
            } else if (evt.stage === 'error') {
              setInstallLog((prev) => [...prev, '✗ ' + (evt.message ?? 'error')])
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (e) {
      setInstallLog((prev) => [...prev, '✗ ' + String(e)])
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div style={styles.card}>
      <h3>嵌入 Provider 配置</h3>
      {err && <p style={{ color: '#f38ba8' }}>{err}</p>}

      <h4>现有 Profiles</h4>
      {profiles.length === 0 && <p style={{ color: '#a6adc8' }}>暂无</p>}
      {profiles.map((p) => (
        <div key={p.id} style={styles.profileLine}>
          <span>
            <strong>{p.name}</strong> · {p.id} · {p.provider} · {p.model} · {p.dimensions}d
            {p.has_api_key ? ' · 🔑' : ''}
          </span>
          <button style={styles.destructive} onClick={() => void handleDelete(p.id)}>删除</button>
        </div>
      ))}

      <h4 style={{ marginTop: 16 }}>新建 Profile</h4>
      <div style={styles.row}>
        <label>类型</label>
        <select
          style={styles.input}
          value={form.provider}
          onChange={(e) => setForm({
            ...form,
            provider: e.target.value as FormState['provider'],
            model: e.target.value === 'openai' ? 'text-embedding-3-small'
              : e.target.value === 'ollama' ? 'nomic-embed-text'
              : e.target.value === 'local' ? 'BAAI/bge-small-en-v1.5'
              : 'BAAI/bge-m3',
            dimensions: e.target.value === 'openai' ? 1536
              : e.target.value === 'ollama' ? 768
              : e.target.value === 'local' ? 384
              : 1024,
            api_base: e.target.value === 'ollama' ? 'http://localhost:11434' : '',
          })}
        >
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="openai-compatible">OpenAI-Compatible</option>
          <option value="local">Local (sentence-transformers)</option>
        </select>
      </div>

      <div style={styles.row}>
        <label>显示名</label>
        <input
          style={styles.input}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="(auto)"
        />
      </div>

      <div style={styles.row}>
        <label>模型</label>
        {form.provider === 'ollama' && ollamaModels.length > 0 ? (
          <select
            style={styles.input}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          >
            {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input
            style={styles.input}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        )}
      </div>

      <div style={styles.row}>
        <label>维度</label>
        <input
          style={styles.input}
          type="number"
          value={form.dimensions}
          onChange={(e) => setForm({ ...form, dimensions: parseInt(e.target.value || '0', 10) })}
        />
      </div>

      <div style={styles.row}>
        <label>API Base</label>
        <input
          style={styles.input}
          value={form.api_base}
          onChange={(e) => setForm({ ...form, api_base: e.target.value })}
          placeholder={
            form.provider === 'openai' ? 'https://api.openai.com/v1' :
            form.provider === 'ollama' ? 'http://localhost:11434' :
            'https://api.example.com/v1'
          }
        />
      </div>

      {form.provider !== 'ollama' && form.provider !== 'local' && (
        <div style={styles.row}>
          <label>API Key</label>
          <input
            style={styles.input}
            type="password"
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
          />
        </div>
      )}

      {form.provider === 'local' && (
        <div style={{ ...styles.row, marginTop: 12, color: '#fab387' }}>
          <span style={{ gridColumn: 'span 2' }}>
            ⚠ Local provider 需要 sentence-transformers + torch (~1.5GB)。
            点下方按钮一键安装；首次使用模型时会自动从 HF 镜像下载 (~130MB-1.2GB)。
            <div style={{ marginTop: 8 }}>
              <button
                style={styles.button}
                onClick={() => void handleInstallLocalDeps()}
                disabled={installing}
              >
                {installing ? '安装中…' : installDone ? '已安装 ✓' : '一键安装 Local 依赖'}
              </button>
              {installDone && (
                <span style={{ marginLeft: 8, color: '#fab387' }}>
                  请重启 gateway: bash scripts/restart.sh all
                </span>
              )}
            </div>
            {installLog.length > 0 && (
              <pre style={{
                marginTop: 8, padding: 8, maxHeight: 240,
                overflowY: 'auto', background: '#11111b',
                color: '#cdd6f4', fontSize: 11, borderRadius: 4,
              }}>
                {installLog.join('\n')}
              </pre>
            )}
          </span>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button style={styles.button} onClick={() => void handleTest()} disabled={testing}>
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button
          style={styles.button}
          onClick={() => void handleCreate()}
          disabled={!testResult || !testResult.startsWith('✓')}
        >
          保存
        </button>
        {testResult && (
          <span style={{ marginLeft: 8, color: testResult.startsWith('✓') ? '#a6e3a1' : '#f38ba8' }}>
            {testResult}
          </span>
        )}
      </div>
    </div>
  )
}
