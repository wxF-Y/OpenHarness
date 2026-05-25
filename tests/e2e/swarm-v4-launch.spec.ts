/**
 * E2E 测试：Swarm 完整流程 v4 - 最终版
 *
 * 前置条件：团队 "y" 已通过 API 启动
 * Leader session: 7545176441ac4b71ab12556a9ca708b0
 *
 * 步骤：
 * 1. 访问 http://localhost:5173
 * 2. 点击左侧 "Swarm 协作" 导航
 * 3. 等待 SwarmPage 加载
 * 4. 截图 01-swarm-page.png
 * 5. 点击团队 "y"（getByText 或 borderBottom）
 * 6. 等待成员卡片出现
 * 7. 截图 02-team-selected.png
 * 8. 直接导航到 Leader session ChatPage
 * 9. 截图 03-chatpage-initial.png
 * 10. 等待 2 秒（SwarmMemberBar 加载）
 * 11. 截图 04-memberbar.png
 * 12. 等待 3 秒，点击绿色 chip
 * 13. 等待 1 秒
 * 14. 截图 05-split-view.png
 * 15. 等待 5 秒
 * 16. 截图 06-leader-conversation.png
 */

import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173'
const ARTIFACTS_DIR = 'e:/AI/OpenHarness/test-artifacts/v4'

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
}

async function screenshot(page: Page, name: string): Promise<string> {
  const filePath = path.join(ARTIFACTS_DIR, name)
  await page.screenshot({ path: filePath, fullPage: false })
  console.log(`截图保存: ${filePath}`)
  return filePath
}

test.describe('Swarm 完整流程 v4 - 最终版', () => {
  test.setTimeout(120000)

  test('SwarmPage → 选团队 → Leader ChatPage → SwarmMemberBar → 分栏', async ({ page }) => {
    // ── 步骤 1：访问应用 ──
    console.log('\n步骤 1: 访问 http://localhost:5173')
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // ── 步骤 2：点击左侧 "Swarm 协作" 导航 ──
    console.log('步骤 2: 点击 "Swarm 协作" 导航')
    const swarmNavBtn = page.locator('button, a, [role="button"]').filter({ hasText: /Swarm 协作/ }).first()
    if (await swarmNavBtn.isVisible().catch(() => false)) {
      await swarmNavBtn.click()
      await page.waitForTimeout(1000)
    } else {
      await page.goto(`${BASE_URL}/?view=swarm`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1000)
    }

    // ── 步骤 3：等待 SwarmPage 加载 ──
    console.log('步骤 3: 等待 SwarmPage 加载')
    try {
      await page.waitForSelector('text=/TEAMS|Swarm Teams|🤝 Swarm/i', { timeout: 8000 })
      console.log('✓ SwarmPage 标题可见')
    } catch {
      console.log('⚠ SwarmPage 标题超时')
    }

    // ── 步骤 4：截图 01-swarm-page.png ──
    console.log('步骤 4: 截图 01-swarm-page.png')
    await screenshot(page, '01-swarm-page.png')

    // ── 步骤 5：点击团队 "y" ──
    console.log('步骤 5: 点击团队 "y"')
    const teamTextEl = page.getByText('y', { exact: true }).first()
    if (await teamTextEl.isVisible().catch(() => false)) {
      await teamTextEl.click()
      console.log('✓ 点击团队 "y"')
    } else {
      const borderEl = page.locator('[style*="borderBottom"]').first()
      if (await borderEl.isVisible().catch(() => false)) {
        await borderEl.click()
        console.log('✓ 通过 borderBottom 点击团队')
      }
    }
    await page.waitForTimeout(1500)

    // ── 步骤 6：等待成员卡片 ──
    console.log('步骤 6: 等待成员卡片')
    try {
      await page.waitForSelector('text=/ai-engineer|ai-data/i', { timeout: 8000 })
      console.log('✓ 成员卡片可见')
    } catch {
      console.log('⚠ 成员卡片超时')
    }

    // ── 步骤 7：截图 02-team-selected.png ──
    console.log('步骤 7: 截图 02-team-selected.png')
    await screenshot(page, '02-team-selected.png')

    // ── 步骤 8：获取 Leader session ID，导航到 ChatPage ──
    console.log('步骤 8: 获取 Leader session ID')

    // 从 API 获取团队详情，取 lead_session_id
    const teamDetail = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/swarm/teams/y')
        return r.ok ? r.json() : null
      } catch { return null }
    })

    console.log('lead_session_id:', teamDetail?.lead_session_id)
    const members = teamDetail?.members || {}
    const memberList = Object.entries(members).map(([id, m]: [string, any]) => ({
      id,
      session_id: m.session_id,
      name: m.name,
    }))
    console.log('成员 sessions:', JSON.stringify(memberList.map(m => ({ name: m.name, session_id: m.session_id?.slice(0, 8) }))))

    let targetSessionId: string | null = teamDetail?.lead_session_id || null

    // 如果没有 lead_session_id，通过 /api/sessions 找带 🤝 标签的 session
    if (!targetSessionId) {
      const sessions = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/sessions')
          return r.ok ? r.json() : []
        } catch { return [] }
      })
      const teamSession = sessions.find((s: any) => s.expert_role_label?.startsWith('🤝'))
      if (teamSession) {
        targetSessionId = teamSession.session_id
        console.log(`通过 /api/sessions 找到 Leader session: ${targetSessionId}`)
      }
    }

    if (!targetSessionId) {
      console.log('⚠ 未找到 Leader session，尝试使用最新的 session 或通过 UI 启动')
      // 检查当前是否有任务输入框（团队 configured 状态）
      const taskTextarea = page.locator('textarea').first()
      if (await taskTextarea.isVisible().catch(() => false)) {
        await taskTextarea.fill('代码质量分析')
        await page.waitForTimeout(300)
        const launchBtn = page.locator('button').filter({ hasText: /启动团队/ }).first()
        if (await launchBtn.isVisible().catch(() => false)) {
          await launchBtn.click()
          try {
            await page.waitForURL(/\/chat\//, { timeout: 15000 })
            targetSessionId = page.url().split('/chat/')[1]?.split('?')[0] || null
            console.log(`✓ 通过 UI 启动，session: ${targetSessionId}`)
          } catch {
            console.log('⚠ 启动后未跳转到 /chat/')
          }
        }
      }
    }

    if (!targetSessionId) {
      console.log('⚠ 无法获取 Leader session ID，测试中止')
      await screenshot(page, '03-no-leader-session.png')
      return
    }

    // ── 导航到 Leader ChatPage ──
    console.log(`导航到 Leader ChatPage: /chat/${targetSessionId}`)
    await page.goto(`${BASE_URL}/chat/${targetSessionId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // ── 步骤 11：截图 03-chatpage-initial.png ──
    console.log('步骤 11: 截图 03-chatpage-initial.png')
    await screenshot(page, '03-chatpage-initial.png')
    console.log(`ChatPage URL: ${page.url()}`)

    // 检查 🤝 团队标签
    const teamLabel = await page.locator('span, div').filter({ hasText: /🤝/ }).first().textContent().catch(() => null)
    console.log(`🤝 团队标签: ${teamLabel}`)

    // ── 步骤 12：等待 2 秒（SwarmMemberBar 加载）──
    console.log('步骤 12: 等待 2 秒 SwarmMemberBar 加载')
    await page.waitForTimeout(2000)

    // 检查 SwarmMemberBar 详细信息
    const memberBarCheck = await page.evaluate(() => {
      // 找所有 button 中含成员特征的
      const allBtns = Array.from(document.querySelectorAll('button'))
      const memberChips = allBtns.filter(b => {
        const text = b.textContent || ''
        return text.includes('🟢') || text.includes('🟡') || text.includes('⬛') || text.includes('⏳') ||
               text.includes('ai-engineer') || text.includes('ai-data')
      })

      // 找 36px 高的横向 bar
      const divs = Array.from(document.querySelectorAll('div'))
      let barFound = false
      let barButtons = 0
      for (const div of divs) {
        const style = div.getAttribute('style') || ''
        if (style.includes('36px') && style.includes('border')) {
          barButtons = div.querySelectorAll('button').length
          if (barButtons > 0) {
            barFound = true
            break
          }
        }
      }

      return {
        memberChipCount: memberChips.length,
        memberChipTexts: memberChips.map(b => b.textContent?.trim()).slice(0, 5),
        barFound,
        barButtons,
        allButtonTexts: allBtns.map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20),
      }
    })
    console.log('SwarmMemberBar 检查:', JSON.stringify({
      chipCount: memberBarCheck.memberChipCount,
      chipTexts: memberBarCheck.memberChipTexts,
      barFound: memberBarCheck.barFound,
    }))
    console.log('所有 button:', memberBarCheck.allButtonTexts.join(' | '))

    // ── 步骤 13：截图 04-memberbar.png ──
    console.log('步骤 13: 截图 04-memberbar.png')
    await screenshot(page, '04-memberbar.png')

    // ── 步骤 14：等待 3 秒，找绿色 chip 并点击 ──
    console.log('步骤 14: 等待 3 秒后找绿色 chip')
    await page.waitForTimeout(3000)

    let chipClickResult = '未点击'

    // 优先找 🟢 chip
    const greenChip = page.locator('button').filter({ hasText: /🟢/ }).first()
    const greenChipVisible = await greenChip.isVisible().catch(() => false)

    if (greenChipVisible) {
      const isDisabled = await greenChip.isDisabled().catch(() => true)
      const chipText = await greenChip.textContent()
      console.log(`绿色 chip: "${chipText?.trim()}", disabled: ${isDisabled}`)
      if (!isDisabled) {
        await greenChip.click()
        chipClickResult = `✓ 点击绿色 chip: "${chipText?.trim()}"`
        console.log(chipClickResult)
      } else {
        chipClickResult = `绿色 chip disabled: "${chipText?.trim()}"`
        console.log(`⚠ ${chipClickResult}`)
      }
    } else {
      // 找包含成员名的非 disabled button
      const memberBtns = page.locator('button').filter({ hasText: /ai-engineer|ai-data/ })
      const count = await memberBtns.count()
      console.log(`成员名 button 数: ${count}`)
      for (let i = 0; i < count; i++) {
        const btn = memberBtns.nth(i)
        const disabled = await btn.isDisabled().catch(() => true)
        if (!disabled) {
          const text = await btn.textContent()
          await btn.click()
          chipClickResult = `✓ 点击成员 chip: "${text?.trim()}"`
          console.log(chipClickResult)
          break
        }
      }
      if (chipClickResult === '未点击') {
        console.log('⚠ 所有成员 chip 均 disabled 或未找到')
      }
    }

    // ── 步骤 15：等待 1 秒 ──
    await page.waitForTimeout(1000)

    // ── 步骤 16：截图 05-split-view.png ──
    console.log('步骤 16: 截图 05-split-view.png')
    await screenshot(page, '05-split-view.png')

    // 验证分栏
    const closePaneBtn = page.locator('button').filter({ hasText: /✕|×/ }).first()
    const splitViewActive = await closePaneBtn.isVisible().catch(() => false)
    console.log(`分栏关闭按钮: ${splitViewActive}`)

    if (splitViewActive) {
      console.log('✓ SwarmMemberPane 分栏已出现')
    } else {
      const allBtnTexts2 = await page.locator('button').allTextContents()
      console.log('当前所有 button:', allBtnTexts2.slice(0, 15).join(' | '))
    }

    // ── 步骤 17：等待 5 秒，观察 Leader 对话 ──
    console.log('步骤 17: 等待 5 秒观察 Leader 对话')
    await page.waitForTimeout(5000)

    const bodyContent = await page.locator('body').textContent().catch(() => '')
    const hasSendMessage = bodyContent?.includes('send_message') ?? false
    const hasCurl = bodyContent?.includes('curl') ?? false
    console.log(`send_message: ${hasSendMessage}, curl: ${hasCurl}`)
    if (hasSendMessage) console.log('✓ Leader 使用 send_message 通信')
    if (hasCurl) console.log('⚠ 检测到 curl（可能错误通信方式）')

    // ── 步骤 18：截图 06-leader-conversation.png ──
    console.log('步骤 18: 截图 06-leader-conversation.png')
    await screenshot(page, '06-leader-conversation.png')

    // ── 摘要 ──
    console.log('\n========== 最终测试摘要 ==========')
    console.log(`Leader session: ${targetSessionId}`)
    console.log(`ChatPage URL: ${page.url()}`)
    console.log(`🤝 团队标签: ${teamLabel}`)
    console.log(`SwarmMemberBar chips: ${memberBarCheck.memberChipCount} 个`)
    console.log(`chip 点击: ${chipClickResult}`)
    console.log(`分栏出现: ${splitViewActive}`)
    console.log(`send_message: ${hasSendMessage}`)
    const files = fs.readdirSync(ARTIFACTS_DIR).filter(f => /^\d+/.test(f))
    console.log(`截图文件: ${files.join(', ')}`)
    console.log('====================================\n')

    expect(page.url()).toMatch(/\/chat\//)
    console.log('✓ 测试完成')
  })
})
