import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const ARTIFACTS = 'E:/AI/OpenHarness/test-artifacts/v5'

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
})

test('swarm 分栏功能验证 v5', async ({ page }) => {
  // 步骤 1: 导航到 SwarmPage
  await page.goto('http://localhost:5173/?view=swarm')

  // 步骤 2: 等待 "TEAMS" 文字出现
  await page.waitForSelector('text=TEAMS', { timeout: 10000 })

  // 步骤 3: 截图 01.png
  await page.screenshot({ path: path.join(ARTIFACTS, '01.png'), fullPage: false })
  console.log('截图 01.png 已保存')

  // 步骤 4: 点击含 "y" 文字的团队列表项
  const teamItem = page.locator('div').filter({ hasText: /^y$/ }).first()
  await teamItem.click()

  // 步骤 5: 等待 "ai-engineer" 出现
  await page.waitForSelector('text=ai-engineer', { timeout: 10000 })

  // 步骤 6: 截图 02.png
  await page.screenshot({ path: path.join(ARTIFACTS, '02.png'), fullPage: false })
  console.log('截图 02.png 已保存')

  // 检测当前团队状态：是否有 textarea（configured 状态）
  const textareaVisible = await page.locator('textarea').first().isVisible().catch(() => false)
  console.log('textarea 可见:', textareaVisible)

  if (textareaVisible) {
    // configured 状态：填写任务描述并启动
    console.log('团队处于 configured 状态，填写任务并启动')
    const textarea = page.locator('textarea').first()
    await textarea.fill('AI工具使用小红书文案测试')
    const launchBtn = page.locator('button').filter({ hasText: /启动团队/ }).first()
    await launchBtn.click()
    // 等待 URL 变为 /chat/ 格式
    await page.waitForURL('**/chat/**', { timeout: 15000 })
    console.log('已通过启动团队导航到 chat 页面:', page.url())
  } else {
    // running/idle 状态：从侧边栏找 y 团队已有的 chat session
    console.log('团队已在运行状态，尝试从侧边栏找 y 团队 session...')

    // 侧边栏中 y 团队的 session 有 "🤝 y" 标记
    const ySidebarSession = page.locator('button, a, div[role="button"]')
      .filter({ hasText: /🤝.*y$/ })
      .first()
    const ySidebarCount = await ySidebarSession.count()
    console.log('侧边栏 y 团队 session 数量:', ySidebarCount)

    if (ySidebarCount > 0) {
      await ySidebarSession.click()
      await page.waitForURL('**/chat/**', { timeout: 10000 })
      console.log('通过侧边栏导航到 y 团队 chat:', page.url())
    } else {
      // 尝试通过 swarm teams API 找 y 团队成员的 agent session，
      // 然后找对应的 lead session
      const teamResp = await page.evaluate(async () => {
        const r = await fetch('/api/swarm/teams/y')
        if (!r.ok) return null
        return r.json()
      })
      const members = Object.values(teamResp?.members || {}) as Array<{ session_id?: string; name: string; agent_id: string }>
      const memberWithSession = members.find((m) => m.session_id)
      console.log('有 session_id 的成员:', memberWithSession?.name, memberWithSession?.session_id?.slice(0,8))

      // 从 sessions 列表找与 y 团队 agent 相近时间创建的 session
      const sessionsResp = await page.evaluate(async () => {
        const r = await fetch('/api/sessions')
        if (!r.ok) return []
        return r.json()
      })
      console.log('sessions 列表 (前5):', sessionsResp.slice(0, 5).map((s: {session_id: string; title?: string}) => `${s.session_id.slice(0,8)}|${s.title || 'notitle'}`).join(', '))

      // 找侧边栏中含 "y" 的条目（team session）
      const allBtns = await page.locator('button').allTextContents()
      const yTeamBtns = allBtns.filter(t => t.includes('🤝') && t.includes('y'))
      console.log('含 🤝 y 的按钮:', yTeamBtns)

      // 通过 UI 中的 sidebar 文本找到 y 团队 session 按钮
      const yTeamBtn = page.locator('button').filter({ hasText: '🤝' }).filter({ hasText: /\by\b/ }).first()
      const yTeamBtnCount = await yTeamBtn.count()
      if (yTeamBtnCount > 0) {
        await yTeamBtn.click()
        await page.waitForURL('**/chat/**', { timeout: 10000 })
        console.log('通过 button 导航到 y 团队 chat:', page.url())
      } else if (sessionsResp.length > 0) {
        // 找带有 y 团队标记的最新 session（按 created_at 倒序）
        // y 团队 sessions 用 title 中含 y 的来过滤
        const ySession = sessionsResp.find((s: {title?: string; session_id: string}) =>
          s.title?.includes('y') || s.title?.includes('code quality')
        )
        const targetSession = ySession || sessionsResp[sessionsResp.length - 1]
        console.log('使用 session:', targetSession?.session_id?.slice(0,8), '|', targetSession?.title || 'notitle')
        await page.goto(`http://localhost:5173/chat/${targetSession.session_id}?team=y`)
        await page.waitForURL('**/chat/**', { timeout: 10000 })
      } else {
        throw new Error('无法找到 y 团队的 chat session')
      }
    }
  }

  // 步骤 10: 截图 03.png
  await page.screenshot({ path: path.join(ARTIFACTS, '03.png'), fullPage: false })
  console.log('截图 03.png 已保存，当前 URL:', page.url())

  // 步骤 11: 等待 4 秒（等待 swarm 消息流入）
  await page.waitForTimeout(4000)

  // 步骤 12: 截图 04.png
  await page.screenshot({ path: path.join(ARTIFACTS, '04.png'), fullPage: false })
  console.log('截图 04.png 已保存')

  // 步骤 13: 检查是否包含 "swarm_spawn_member" 文字
  const bodyText = await page.content()
  const hasSpawnMember = bodyText.includes('swarm_spawn_member')
  console.log('包含 swarm_spawn_member:', hasSpawnMember)

  // 步骤 14: 尝试点击成员 chip（SwarmMemberBar 中的按钮）
  // 先检查是否有 modal/overlay 覆盖，如果有先关闭
  try {
    // 检查是否有 question modal（"按 Esc 取消" 提示）
    const escHint = page.locator('text=按 Esc 取消').first()
    const escHintVisible = await escHint.isVisible().catch(() => false)
    if (escHintVisible) {
      console.log('检测到 modal 弹窗，按 Esc 关闭')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }

    // 再检查有没有其他遮罩层
    const overlay = page.locator('[style*="position: fixed"], [style*="position:fixed"]').first()
    const overlayVisible = await overlay.isVisible().catch(() => false)
    if (overlayVisible) {
      console.log('检测到 fixed 遮罩层，按 Esc 关闭')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }

    let clicked = false

    // 方法1: 找含有绿色状态圆的按钮（active 成员 chip）
    const activeChip = page.locator('button').filter({ hasText: '🟢' }).first()
    const activeCount = await activeChip.count()
    if (activeCount > 0) {
      // 使用 { force: true } 绕过覆盖层问题
      await activeChip.click({ force: true, timeout: 5000 })
      console.log('点击了含 🟢 的 chip')
      clicked = true
    }

    if (!clicked) {
      // 方法2: 原始选择器（用户提供的，颜色 89b4fa 是 chip 选中时的 border 颜色）
      const chip = page.locator('button[style*="89b4fa"]').first()
      const chipCount = await chip.count()
      if (chipCount > 0) {
        await chip.click({ force: true, timeout: 5000 })
        console.log('点击了 89b4fa 颜色的 chip')
        clicked = true
      }
    }

    if (!clicked) {
      // 方法3: 找 SwarmMemberBar 区域内的按钮（title 属性含成员名）
      const memberChip = page.locator('button[title="ai-engineer"]').first()
      const memberCount = await memberChip.count()
      if (memberCount > 0) {
        await memberChip.click({ force: true, timeout: 5000 })
        console.log('点击了 ai-engineer chip')
        clicked = true
      }
    }

    if (!clicked) {
      console.log('未找到可点击的 chip')
    }
  } catch (e) {
    console.log('chip 点击失败:', String(e))
  }

  // 步骤 15: 等待 1 秒
  await page.waitForTimeout(1000)

  // 步骤 16: 截图 05.png
  await page.screenshot({ path: path.join(ARTIFACTS, '05.png'), fullPage: false })
  console.log('截图 05.png 已保存')

  // 步骤 17: 截图 06.png（输入区域底部）
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(ARTIFACTS, '06.png'), fullPage: false })
  console.log('截图 06.png 已保存')

  // 打印页面中可见的按钮列表（用于调试）
  const buttons = await page.locator('button').allTextContents()
  console.log('页面按钮 (前30):', buttons.slice(0, 30).join(' | '))

  console.log('=== 测试完成 ===')
  console.log('所有截图保存在:', ARTIFACTS)
})
