import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface OnboardingStatus {
  auth_configured: boolean
  auth_status: string
  active_profile: string
  cwd: string
  project_initialized: boolean
  version: string
}

type Provider = 'anthropic' | 'openai' | 'claude_subscription' | 'copilot' | 'custom'

const PROVIDERS: { id: Provider; label: string; desc: string; recommended?: boolean; needsCli?: boolean }[] = [
  { id: 'anthropic', label: 'Anthropic API Key', desc: 'Claude API 密钥（推荐）', recommended: true },
  { id: 'openai', label: 'OpenAI Compatible', desc: 'OpenAI / 小米 Mimo / DeepSeek 等兼容接口' },
  { id: 'claude_subscription', label: 'Claude Subscription', desc: 'claude.ai 订阅用户（需 CLI）', needsCli: true },
  { id: 'copilot', label: 'GitHub Copilot', desc: 'GitHub Copilot 订阅（需 CLI）', needsCli: true },
  { id: 'custom', label: '自定义', desc: '手动指定 base_url / API Key / 模型名 / API 格式' },
]

const FEATURES = [
  { icon: '💬', title: 'AI 对话', desc: '与 Agent 自然对话，执行编码任务' },
  { icon: '🧠', title: '持久记忆', desc: '跨会话保留项目知识' },
  { icon: '⏰', title: '定时任务', desc: 'Cron 任务自动执行' },
  { icon: '🤝', title: 'Swarm', desc: '多 Agent 协作' },
  { icon: '✅', title: '任务追踪', desc: '后台任务实时状态' },
  { icon: '⚡', title: '技能库', desc: '可复用 Agent 技能' },
]

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [provider, setProvider] = useState<Provider>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('')
  const [apiFormat, setApiFormat] = useState<'anthropic' | 'openai_compat' | 'openai'>('openai_compat')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk, setSaveOk] = useState(false)
  const [initOk, setInitOk] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const apiKeyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/onboarding/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  // Already configured → show completion page
  if (status?.auth_configured) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#1e1e2e', color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ textAlign: 'center', maxWidth: '420px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h1 style={{ color: '#a6e3a1', fontSize: '1.5rem', margin: '0 0 0.5rem' }}>已完成初始化</h1>
          <p style={{ color: '#a6adc8', margin: '0 0 1.5rem' }}>
            Provider: {status.active_profile} · 状态: {status.auth_status}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button onClick={() => navigate('/')} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.6rem 1.25rem', cursor: 'pointer', fontWeight: 600 }}>进入应用</button>
            <button onClick={() => setStatus({ ...status, auth_configured: false })} style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '8px', padding: '0.6rem 1.25rem', cursor: 'pointer' }}>重新配置</button>
          </div>
        </div>
      </div>
    )
  }

  const sel = PROVIDERS.find((p) => p.id === provider)!
  const totalSteps = 5

  function StepDots() {
    return (
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', marginBottom: '2rem' }}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: i + 1 === step ? '#89b4fa' : i + 1 < step ? '#a6e3a1' : '#313244' }} />
        ))}
      </div>
    )
  }

  function Card({ children }: { children: React.ReactNode }) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '12px', padding: '2rem', maxWidth: '520px', width: '100%', color: '#cdd6f4' }}>
          {children}
        </div>
      </div>
    )
  }

  // Step 1: Welcome + Diagnostics
  if (step === 1) return (
    <Card>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚡</div>
        <h1 style={{ color: '#89b4fa', fontSize: '1.75rem', margin: '0 0 0.5rem' }}>HLAgent</h1>
        <p style={{ color: '#a6adc8', margin: 0 }}>欢迎！让我们完成初始化配置。</p>
      </div>
      <StepDots />
      {status && (
        <div style={{ backgroundColor: '#11111b', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <div><span style={{ color: '#6c7086' }}>版本: </span>{status.version || '0.1.0'}</div>
          <div><span style={{ color: '#6c7086' }}>工作目录: </span><span style={{ color: '#a6adc8' }}>{status.cwd}</span></div>
          <div><span style={{ color: '#6c7086' }}>Auth 状态: </span><span style={{ color: '#f38ba8' }}>未配置</span></div>
          {status.project_initialized && <div style={{ color: '#a6e3a1' }}>✓ 项目已初始化</div>}
        </div>
      )}
      <button onClick={() => setStep(2)} style={{ width: '100%', backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.75rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}>
        开始配置 →
      </button>
    </Card>
  )

  // Step 2: Provider selection
  if (step === 2) return (
    <Card>
      <h2 style={{ color: '#cdd6f4', margin: '0 0 0.5rem' }}>选择 AI Provider</h2>
      <p style={{ color: '#6c7086', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>Step 2 / {totalSteps}</p>
      <StepDots />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            onClick={() => setProvider(p.id)}
            style={{ padding: '0.75rem 1rem', borderRadius: '8px', border: `2px solid ${provider === p.id ? '#89b4fa' : '#313244'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: provider === p.id ? 'rgba(137,180,250,0.05)' : 'transparent' }}
          >
            <div>
              <div style={{ fontSize: '0.9rem', color: provider === p.id ? '#89b4fa' : '#cdd6f4', fontWeight: provider === p.id ? 600 : 400 }}>
                {p.label}
                {p.recommended && <span style={{ marginLeft: '0.5rem', backgroundColor: '#a6e3a1', color: '#1e1e2e', fontSize: '0.65rem', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>推荐</span>}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6c7086' }}>{p.desc}</div>
            </div>
            <span style={{ color: provider === p.id ? '#89b4fa' : '#45475a' }}>{provider === p.id ? '●' : '○'}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={() => setStep(1)} style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '8px', padding: '0.6rem', cursor: 'pointer' }}>← 返回</button>
        <button onClick={() => { setSaveOk(false); setSaveError(''); setStep(3) }} style={{ flex: 2, backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.6rem', fontWeight: 600, cursor: 'pointer' }}>下一步 →</button>
      </div>
    </Card>
  )

  // Step 3: Credentials
  if (step === 3) return (
    <Card>
      <h2 style={{ color: '#cdd6f4', margin: '0 0 0.5rem' }}>配置凭据</h2>
      <p style={{ color: '#6c7086', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>Step 3 / {totalSteps} · {sel.label}</p>
      <StepDots />

      {sel.needsCli ? (
        <div>
          <div style={{ backgroundColor: '#11111b', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#a6adc8' }}>
            <p style={{ margin: '0 0 0.75rem' }}>此 Provider 需通过 CLI 完成 OAuth 绑定，请在终端运行：</p>
            <code style={{ backgroundColor: '#313244', padding: '0.4rem 0.6rem', borderRadius: '6px', display: 'block', color: '#89b4fa', fontFamily: 'monospace', marginBottom: '0.75rem' }}>
              {provider === 'claude_subscription' ? 'oh auth claude-login' : 'oh auth copilot-login'}
            </code>
            <p style={{ margin: 0, color: '#6c7086', fontSize: '0.8125rem' }}>完成后点击下方按钮刷新检查。</p>
          </div>
          <button
            onClick={async () => {
              setRefreshing(true)
              const r = await fetch('/api/onboarding/status').then((x) => x.json()).catch(() => null)
              setRefreshing(false)
              if (r?.auth_configured) { setStatus(r); setStep(4) }
              else setSaveError('未检测到认证，请先完成 CLI 绑定')
            }}
            disabled={refreshing}
            style={{ width: '100%', backgroundColor: '#313244', color: '#cdd6f4', border: '1px solid #45475a', borderRadius: '8px', padding: '0.6rem', cursor: refreshing ? 'not-allowed' : 'pointer', marginBottom: '0.5rem', opacity: refreshing ? 0.6 : 1 }}
          >
            {refreshing ? '检查中…' : '已完成 CLI 绑定，刷新检查'}
          </button>
          {saveError && <div style={{ color: '#f38ba8', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>{saveError}</div>}
          <button onClick={() => { setSaveError(''); setStep(4) }} style={{ width: '100%', background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem', marginTop: '0.25rem' }}>跳过，稍后配置</button>
        </div>
      ) : (
        <div>
          {(provider === 'openai' || provider === 'custom') && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.25rem' }}>Base URL *</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', outline: 'none', boxSizing: 'border-box' }}
                placeholder="https://api.openai.com/v1"
              />
              <div style={{ fontSize: '0.7rem', color: '#6c7086', marginTop: '0.2rem' }}>
                示例：https://token-plan-cn.xiaomimimo.com/v1（小米 Mimo）
              </div>
            </div>
          )}

          {(provider === 'openai' || provider === 'custom') && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.25rem' }}>
                Model（模型名称）
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', outline: 'none', boxSizing: 'border-box' }}
                placeholder="gpt-4o / mimo-v2.5-pro / deepseek-chat …"
              />
              <div style={{ fontSize: '0.7rem', color: '#6c7086', marginTop: '0.2rem' }}>
                填写 API 文档中的模型 ID，如 mimo-v2.5-pro
              </div>
            </div>
          )}

          {provider === 'custom' && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.25rem' }}>
                API 格式
              </label>
              <select
                value={apiFormat}
                onChange={(e) => setApiFormat(e.target.value as typeof apiFormat)}
                style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', outline: 'none', boxSizing: 'border-box' }}
              >
                <option value="openai_compat">OpenAI Compatible（OpenAI 兼容，适用大多数第三方 API）</option>
                <option value="openai">OpenAI（标准 OpenAI 接口）</option>
                <option value="anthropic">Anthropic（Claude 官方格式）</option>
              </select>
              <div style={{ fontSize: '0.7rem', color: '#f9e2af', marginTop: '0.2rem' }}>
                ⚠️ 小米 Mimo / DeepSeek / 阿里云 等第三方 API 请选 OpenAI Compatible
              </div>
            </div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', color: '#6c7086', marginBottom: '0.25rem' }}>
              API Key *
            </label>
            <input
              ref={apiKeyRef}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoFocus
              style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', outline: 'none', boxSizing: 'border-box' }}
              placeholder={provider === 'anthropic' ? 'sk-ant-api03-…' : 'sk-…'}
            />
            <div style={{ fontSize: '0.75rem', color: '#6c7086', marginTop: '0.25rem' }}>
              {provider === 'anthropic' && '从 console.anthropic.com 获取'}
              {provider === 'openai' && '从 API 服务商控制台获取'}
              {provider === 'custom' && 'API Key / Token（如无可填任意值）'}
            </div>
          </div>

          {saveError && <div style={{ color: '#f38ba8', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>{saveError}</div>}
          {saveOk && <div style={{ color: '#a6e3a1', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>✓ 已保存（将在首次对话时验证有效性）</div>}

          <button
            onClick={async () => {
              if (!apiKey.trim()) { setSaveError('请输入 API Key'); return }
              setSaving(true); setSaveError('')
              const body: Record<string, string> = { provider, api_key: apiKey }
              if (provider !== 'anthropic') {
                body.base_url = baseUrl
                if (model.trim()) body.model = model.trim()
                body.api_format = provider === 'custom' ? apiFormat : 'openai_compat'
              }
              const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
              setSaving(false)
              if (r.ok) { setSaveOk(true); setTimeout(() => setStep(4), 800) }
              else setSaveError('保存失败，请重试')
            }}
            disabled={saving || !apiKey.trim()}
            style={{ width: '100%', backgroundColor: saveOk ? '#a6e3a1' : '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.6rem', fontWeight: 600, cursor: saving || !apiKey.trim() ? 'not-allowed' : 'pointer', opacity: saving || !apiKey.trim() ? 0.7 : 1 }}
          >
            {saving ? '保存中…' : saveOk ? '✓ 已保存' : '保存 →'}
          </button>
          <button onClick={() => { setSaveError(''); setStep(4) }} style={{ width: '100%', background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: '0.8125rem', marginTop: '0.5rem' }}>跳过，稍后配置</button>
        </div>
      )}

      <button onClick={() => setStep(2)} style={{ width: '100%', background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '0.8125rem', marginTop: '0.75rem' }}>← 返回</button>
    </Card>
  )

  // Step 4: Project init
  if (step === 4) return (
    <Card>
      <h2 style={{ color: '#cdd6f4', margin: '0 0 0.5rem' }}>初始化项目（可选）</h2>
      <p style={{ color: '#6c7086', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>Step 4 / {totalSteps}</p>
      <StepDots />

      {status?.project_initialized || initOk ? (
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ color: '#a6e3a1', fontSize: '1.5rem', marginBottom: '0.5rem' }}>✓</div>
          <div style={{ color: '#a6e3a1', fontSize: '0.9rem' }}>项目已初始化</div>
          <div style={{ color: '#6c7086', fontSize: '0.75rem', marginTop: '0.25rem' }}>{status?.cwd}</div>
        </div>
      ) : (
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: '#a6adc8', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
            在当前目录 <code style={{ backgroundColor: '#313244', padding: '0.1em 0.3em', borderRadius: '3px', fontSize: '0.85em', color: '#89b4fa' }}>{status?.cwd}</code> 创建 <code style={{ backgroundColor: '#313244', padding: '0.1em 0.3em', borderRadius: '3px', fontSize: '0.85em', color: '#89b4fa' }}>CLAUDE.md</code> 和 <code style={{ backgroundColor: '#313244', padding: '0.1em 0.3em', borderRadius: '3px', fontSize: '0.85em', color: '#89b4fa' }}>.openharness/</code> 目录，帮助 AI 更好地理解你的项目。
          </p>
          <button
            onClick={async () => {
              setSaving(true)
              await fetch('/api/onboarding/init-project', { method: 'POST' })
              setSaving(false)
              setInitOk(true)
            }}
            disabled={saving}
            style={{ width: '100%', backgroundColor: '#313244', color: '#cdd6f4', border: '1px solid #45475a', borderRadius: '8px', padding: '0.6rem', cursor: saving ? 'not-allowed' : 'pointer', marginBottom: '0.5rem', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? '初始化中…' : '初始化项目'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={() => setStep(3)} style={{ flex: 1, backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '8px', padding: '0.6rem', cursor: 'pointer' }}>← 返回</button>
        <button onClick={() => setStep(5)} style={{ flex: 2, backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.6rem', fontWeight: 600, cursor: 'pointer' }}>
          {initOk || status?.project_initialized ? '下一步 →' : '跳过 →'}
        </button>
      </div>
    </Card>
  )

  // Step 5: Feature tour
  return (
    <Card>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎉</div>
        <h2 style={{ color: '#cdd6f4', margin: '0 0 0.25rem' }}>准备就绪！</h2>
        <p style={{ color: '#6c7086', fontSize: '0.875rem', margin: 0 }}>Step 5 / {totalSteps} · 功能概览</p>
      </div>
      <StepDots />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ backgroundColor: '#11111b', borderRadius: '8px', padding: '0.6rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{f.icon}</div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.15rem' }}>{f.title}</div>
            <div style={{ fontSize: '0.65rem', color: '#6c7086' }}>{f.desc}</div>
          </div>
        ))}
      </div>
      <button
        onClick={async () => {
          localStorage.setItem('hlagent_tour_seen', 'true')
          const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
          const { session_id } = await r.json()
          navigate(`/chat/${session_id}`)
        }}
        style={{ width: '100%', backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '8px', padding: '0.75rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}
      >
        开始使用 HLAgent →
      </button>
    </Card>
  )
}

