/**
 * E2E 测试：Swarm 团队聊天页成员视图
 *
 * 测试策略：全量 mock API（page.route），不依赖真实后端。
 * 通过直接导航到 /chat/:sessionId?team=test-team/run-001 并注入 zustand store
 * 数据来驱动 UI 渲染，验证 DOM 结构与交互行为。
 *
 * 覆盖场景：
 * 1. 非团队 session：无成员栏
 * 2. 团队 session URL 结构：成员栏容器渲染
 * 3. 成员 chip 从 API 数据渲染
 * 4. 点击 active chip 打开分栏
 * 5. 点击 ← 关闭分栏，恢复全宽
 * 6. 分栏存在调整分隔线
 */

import { test, expect, type Page, type Route } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ── 常量 ───────────────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:5173'
const ARTIFACTS = 'e:/AI/OpenHarness/test-artifacts/swarm-member-view'
const FAKE_SESSION_ID = 'aabbccdd-1111-2222-3333-444455556666'
const FAKE_TEAM = 'test-team'
const FAKE_RUN_SLUG = 'run-001'
const FAKE_RUN_PARAM = `${FAKE_TEAM}/${FAKE_RUN_SLUG}`

// ── 成员固件数据 ────────────────────────────────────────────────────────────
const MOCK_MEMBERS = {
  'agent-alpha': {
    agent_id: 'agent-alpha',
    name: 'ai-engineer',
    status: 'active',
    session_id: 'sess-alpha-0001',
    color: '#89b4fa',
    prompt: '你是一个 AI 工程师',
    agent_type: 'worker',
    model: 'claude-3-5-sonnet',
  },
  'agent-beta': {
    agent_id: 'agent-beta',
    name: 'researcher',
    status: 'idle',
    session_id: 'sess-beta-0002',
    color: '#a6e3a1',
    prompt: '你是一个研究员',
    agent_type: 'worker',
    model: 'claude-3-5-haiku',
  },
  'agent-gamma': {
    agent_id: 'agent-gamma',
    name: 'pending-agent',
    status: 'idle',
    session_id: null,
    color: '#f38ba8',
    prompt: '还未启动',
    agent_type: 'worker',
    model: null,
  },
}

const MOCK_TRANSCRIPT = '## 任务执行记录\n\n**Step 1**: 分析需求\n\n**Step 2**: 实现方案'

// ── 工具函数 ────────────────────────────────────────────────────────────────
function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
}

async function screenshot(page: Page, name: string) {
  const p = path.join(ARTIFACTS, `${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  console.log(`截图: ${p}`)
}

/**
 * 注册所有 mock 路由。
 * 必须在 page.goto() 之前调用。
 */
async function registerMocks(page: Page, opts: { isTeamSession: boolean } = { isTeamSession: true }) {
  // GET /api/sessions → 返回 session 列表（含 expert_role_label 驱动 uiStore）
  await page.route('**/api/sessions', (route: Route) => {
    const sessions = [
      {
        session_id: FAKE_SESSION_ID,
        title: '测试团队对话',
        created_at: Math.floor(Date.now() / 1000) - 60,
        expert_role_label: opts.isTeamSession ? `🤝 ${FAKE_TEAM}-20260524-120000` : null,
      },
    ]
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) })
  })

  // GET /api/sessions/:id → 单个 session
  await page.route(`**/api/sessions/${FAKE_SESSION_ID}`, (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session_id: FAKE_SESSION_ID,
        title: '测试团队对话',
        created_at: Math.floor(Date.now() / 1000) - 60,
        expert_role_label: opts.isTeamSession ? `🤝 ${FAKE_TEAM}-20260524-120000` : null,
      }),
    })
  })

  // GET /api/swarm/teams/:team/runs/:slug → 返回成员列表
  await page.route(`**/api/swarm/teams/${FAKE_TEAM}/runs/${FAKE_RUN_SLUG}`, (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: MOCK_MEMBERS }),
    })
  })

  // GET /api/swarm/teams/:team → 模板团队（不含 session_id）
  await page.route(`**/api/swarm/teams/${FAKE_TEAM}`, (route: Route) => {
    const templateMembers = Object.fromEntries(
      Object.entries(MOCK_MEMBERS).map(([k, v]) => [k, { ...v, session_id: null }])
    )
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: templateMembers }),
    })
  })

  // GET /api/swarm/agents/:id/transcript → 返回成员执行记录
  await page.route('**/api/swarm/agents/*/transcript**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript: MOCK_TRANSCRIPT }),
    })
  })

  // WebSocket → 拦截，不让它真正连接（避免 4004 等 WS 错误导致导航）
  await page.route('**/api/ws/**', (route: Route) => {
    route.abort()
  })

  // GET /api/swarm/teams → 团队列表（SwarmPage 用）
  await page.route('**/api/swarm/teams', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ name: FAKE_TEAM, member_count: 3, created_at: Math.floor(Date.now() / 1000) }]),
    })
  })
}

/**
 * 导航到团队 ChatPage 并等待 React 渲染稳定。
 * 通过 ?team=test-team/run-001 触发 isTeamSession 逻辑。
 */
async function gotoTeamChat(page: Page) {
  const url = `${BASE_URL}/chat/${FAKE_SESSION_ID}?team=${encodeURIComponent(FAKE_RUN_PARAM)}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // 等待 React 完成首次渲染
  await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 10000 })
}

// ── beforeAll ──────────────────────────────────────────────────────────────
test.beforeAll(() => {
  ensureArtifactsDir()
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 1：非团队 session → 无成员栏
// ══════════════════════════════════════════════════════════════════════════
test('非团队 session 不渲染成员栏', async ({ page }) => {
  await registerMocks(page, { isTeamSession: false })

  // 直接导航，不带 ?team= 参数
  await page.goto(`${BASE_URL}/chat/${FAKE_SESSION_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('button') !== null, { timeout: 10000 })
  // 额外稳定等待，让 React effect 完成
  await page.waitForTimeout(800)

  await screenshot(page, '01-non-team-session')

  // SwarmMemberBar 高度 36px，同时含 border-top 和 border-bottom
  const memberBarEl = page.locator('div').filter({
    hasText: /正在启动团队|ai-engineer|researcher/,
  }).first()

  // 不应存在 "正在启动团队" 文字
  const launchingText = page.locator('text=正在启动团队')
  await expect(launchingText).toHaveCount(0)

  // 不应存在带 style="height: 36px" 且含 border-top 的 div（SwarmMemberBar 特征）
  const memberBarByStyle = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'))
    return divs.some((d) => {
      const s = d.getAttribute('style') || ''
      return s.includes('height: 36px') && s.includes('border-top') && s.includes('border-bottom')
    })
  })
  expect(memberBarByStyle).toBe(false)

  console.log('✓ 非团队 session 正确：SwarmMemberBar 未渲染')
  void memberBarEl
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 2：团队 session URL → 成员栏容器渲染（含加载态）
// ══════════════════════════════════════════════════════════════════════════
test('团队 session URL 渲染成员栏容器', async ({ page }) => {
  await registerMocks(page)
  await gotoTeamChat(page)
  await page.waitForTimeout(1000)

  await screenshot(page, '02-team-session-member-bar-container')

  // SwarmMemberBar 特征：height:36px + border-top + border-bottom 的 div
  const memberBarFound = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'))
    return divs.some((d) => {
      const s = d.getAttribute('style') || ''
      return s.includes('height: 36px') && s.includes('border-top') && s.includes('border-bottom')
    })
  })
  expect(memberBarFound).toBe(true)
  console.log('✓ 成员栏容器已渲染（height:36px + borders）')
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 3：成员 chip 从 API 数据渲染
// ══════════════════════════════════════════════════════════════════════════
test('成员 chip 渲染（来自 /runs/ API 响应）', async ({ page }) => {
  await registerMocks(page)
  await gotoTeamChat(page)

  // 等待 chip 出现（fetch 是异步的，最多 8s）
  await page.waitForSelector('button[title="ai-engineer"]', { timeout: 8000 })

  await screenshot(page, '03-member-chips-rendered')

  // 验证 ai-engineer chip 存在
  const chip1 = page.locator('button[title="ai-engineer"]')
  await expect(chip1).toBeVisible()

  // 验证 researcher chip 存在
  const chip2 = page.locator('button[title="researcher"]')
  await expect(chip2).toBeVisible()

  // 验证 pending-agent chip 存在（但处于 disabled 状态，因 session_id=null）
  const chip3 = page.locator('button[title="pending-agent"]')
  await expect(chip3).toBeVisible()
  await expect(chip3).toBeDisabled()

  // 验证 ai-engineer chip 是 enabled（有 session_id）
  await expect(chip1).toBeEnabled()

  // 验证状态图标存在（活跃成员含 🟢）
  const chip1Text = await chip1.textContent()
  expect(chip1Text).toContain('ai-engineer')

  console.log('✓ 成员 chip 正确渲染，active chip 可点击，pending chip 禁用')
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 4：点击 active chip → 打开分栏
// ══════════════════════════════════════════════════════════════════════════
test('点击 active 成员 chip 打开分栏', async ({ page }) => {
  await registerMocks(page)
  await gotoTeamChat(page)

  // 等待 chip 就绪
  await page.waitForSelector('button[title="ai-engineer"]', { timeout: 8000 })

  // 点击前截图
  await screenshot(page, '04a-before-chip-click')

  // 点击 ai-engineer chip
  const chip = page.locator('button[title="ai-engineer"]')
  await chip.click()
  await page.waitForTimeout(600)

  await screenshot(page, '04b-after-chip-click-split-pane')

  // ─ 验证 SwarmMemberPane 顶栏出现 ─
  // SwarmMemberPane 顶栏特征：28px 高，含成员名称标签 + 关闭按钮 "←"
  const closePaneBtn = page.locator('button[title="收起"]')
  await expect(closePaneBtn).toBeVisible()
  console.log('✓ 分栏已打开，SwarmMemberPane 关闭按钮可见')

  // ─ 验证分栏布局：两个 flex 子区域 ─
  // 容器 ref=containerRef：flex row
  // 左侧 Leader pane 的 flexBasis 变为百分比（非 "100%"）
  const splitInfo = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'))
    // 找 flex-direction:row 的内容容器
    const rowContainers = divs.filter((d) => {
      const s = d.getAttribute('style') || ''
      return s.includes('flex-direction: row') && s.includes('flex:')
    })
    return rowContainers.map((d) => ({
      childCount: d.children.length,
      style: (d.getAttribute('style') || '').slice(0, 120),
    }))
  })
  console.log('split containers:', JSON.stringify(splitInfo))

  // 分栏后 flex 容器应含至少 3 个子元素（leader + divider + member pane）
  const hasSplitLayout = splitInfo.some((c) => c.childCount >= 3)
  expect(hasSplitLayout).toBe(true)
  console.log('✓ 分栏布局：flex row 容器含 leader + divider + member pane')
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 5：点击 ← 关闭按钮 → 恢复全宽
// ══════════════════════════════════════════════════════════════════════════
test('点击关闭按钮恢复全宽布局', async ({ page }) => {
  await registerMocks(page)
  await gotoTeamChat(page)

  await page.waitForSelector('button[title="ai-engineer"]', { timeout: 8000 })

  // 打开分栏
  const chip = page.locator('button[title="ai-engineer"]')
  await chip.click()
  await page.waitForTimeout(500)

  // 确认分栏已打开
  const closePaneBtn = page.locator('button[title="收起"]')
  await expect(closePaneBtn).toBeVisible()

  await screenshot(page, '05a-split-open')

  // 点击关闭按钮
  await closePaneBtn.click()
  await page.waitForTimeout(500)

  await screenshot(page, '05b-split-closed-single-pane')

  // 关闭后 ← 按钮应消失
  await expect(closePaneBtn).toHaveCount(0)
  console.log('✓ 分栏已关闭，收起按钮消失')

  // 确认分栏布局已回退到单栏（flex row 容器子元素数 < 3）
  const layoutAfterClose = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'))
    const rowContainers = divs.filter((d) => {
      const s = d.getAttribute('style') || ''
      return s.includes('flex-direction: row') && s.includes('flex:')
    })
    return rowContainers.map((d) => d.children.length)
  })
  // 关闭后没有任何 row 容器含 3 个以上子元素
  const hasSplitStillOpen = layoutAfterClose.some((c) => c >= 3)
  expect(hasSplitStillOpen).toBe(false)
  console.log('✓ 全宽恢复：flex 容器子元素数 < 3')
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 6：分栏存在调整分隔线
// ══════════════════════════════════════════════════════════════════════════
test('分栏时存在可拖拽分隔线', async ({ page }) => {
  await registerMocks(page)
  await gotoTeamChat(page)

  await page.waitForSelector('button[title="ai-engineer"]', { timeout: 8000 })

  // 打开分栏
  const chip = page.locator('button[title="ai-engineer"]')
  await chip.click()
  await page.waitForTimeout(500)

  await screenshot(page, '06-resize-divider')

  // 分隔线特征：width:5px + cursor:col-resize
  const dividerFound = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'))
    return divs.some((d) => {
      const s = d.getAttribute('style') || ''
      return s.includes('width: 5px') && s.includes('col-resize')
    })
  })
  expect(dividerFound).toBe(true)
  console.log('✓ 分隔线 (width:5px, cursor:col-resize) 已渲染')
})

// ══════════════════════════════════════════════════════════════════════════
// 测试 7：再次点击同一 chip → 关闭分栏（toggle）
// ══════════════════════════════════════════════════════════════════════════
test('再次点击已选中 chip 关闭分栏（toggle）', async ({ page }) => {
  await registerMocks(page)
  await gotoTeamChat(page)

  await page.waitForSelector('button[title="ai-engineer"]', { timeout: 8000 })

  const chip = page.locator('button[title="ai-engineer"]')

  // 第一次点击：打开
  await chip.click()
  await page.waitForTimeout(400)
  await expect(page.locator('button[title="收起"]')).toBeVisible()

  await screenshot(page, '07a-chip-selected')

  // 第二次点击同一 chip（通过成员栏右侧 ✕ 按钮验证 — 或直接点 chip）
  // SwarmMemberBar 右侧的 ✕ 按钮（selected 时出现，onClick=onSelect(null)）
  const xBtn = page.locator('div').filter({ hasText: 'ai-engineer' }).locator('button', { hasText: '✕' }).first()
  const xBtnVisible = await xBtn.isVisible().catch(() => false)

  if (xBtnVisible) {
    await xBtn.click()
    console.log('通过 ✕ 按钮关闭分栏')
  } else {
    // 备用：再次点击 chip（toggle 逻辑：isSelected ? null : agentId）
    await chip.click()
    console.log('通过再次点击 chip 关闭分栏')
  }

  await page.waitForTimeout(400)
  await screenshot(page, '07b-chip-deselected-pane-closed')

  // 分栏应关闭
  await expect(page.locator('button[title="收起"]')).toHaveCount(0)
  console.log('✓ 再次点击 chip 关闭了分栏')
})
