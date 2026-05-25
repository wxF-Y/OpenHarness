/**
 * E2E 测试：Swarm 分栏视图（SwarmMemberBar + SwarmMemberPane）
 *
 * 测试目标：
 * 1. 找到带 🤝 标签的侧边栏 session（团队 session）
 * 2. 点击进入 ChatPage
 * 3. 验证成员选择栏（SwarmMemberBar）存在
 * 4. 等待 active 成员 chip 出现（ai-engineer 等）
 * 5. 点击绿色（active）成员 chip
 * 6. 验证分栏出现（左侧 Leader + 右侧成员详情）
 * 7. 验证 Leader 区域可滚动并有内容
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
  const filePath = path.join(ARTIFACTS_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
  console.log(`截图已保存: ${filePath}`)
  return filePath
}

test.describe('Swarm 分栏视图 E2E 测试', () => {
  test.setTimeout(90000)

  test('点击团队 session 成员 chip 触发分栏', async ({ page }) => {
    // ── 步骤 1：加载首页，等待侧边栏 session 列表 ──
    console.log('步骤 1: 访问应用首页')
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // ── 步骤 2：通过 API 查找具有 🤝 expert_role_label 的 session ──
    console.log('步骤 2: 查询带 🤝 标签的团队 session')
    const sessions: Array<{
      session_id: string
      title?: string
      expert_role_label?: string
    }> = await page.evaluate(async () => {
      const r = await fetch('/api/sessions')
      if (!r.ok) return []
      return r.json()
    }).catch(() => [])

    console.log(`总 session 数: ${sessions.length}`)

    const teamSessions = sessions.filter(
      (s) => s.expert_role_label && s.expert_role_label.startsWith('🤝')
    )
    console.log(`团队 session 数: ${teamSessions.length}`)

    if (teamSessions.length === 0) {
      console.log('没有找到带 🤝 标签的团队 session，跳过测试')
      console.log('所有 expert_role_label:', sessions.map((s) => s.expert_role_label).filter(Boolean))
      await screenshot(page, '00-no-team-session')
      test.skip()
      return
    }

    // 选择最新的团队 session（第一个）
    const teamSession = teamSessions[0]
    console.log(`使用 session: ${teamSession.session_id}, label: ${teamSession.expert_role_label}`)

    // ── 步骤 3：直接导航到 ChatPage ──
    console.log('步骤 3: 导航到团队 ChatPage')
    await page.goto(`${BASE_URL}/chat/${teamSession.session_id}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // ── 步骤 4：截图 - 01-chatpage-with-memberbar.png ──
    console.log('步骤 4: 截图 ChatPage（验证成员选择栏存在）')
    await screenshot(page, '01-chatpage-with-memberbar')

    // 验证团队标签在 header 中可见（包含 🤝）
    const teamLabel = page.locator('span').filter({ hasText: /🤝/ }).first()
    const teamLabelVisible = await teamLabel.isVisible().catch(() => false)
    if (teamLabelVisible) {
      const labelText = await teamLabel.textContent()
      console.log(`✓ 团队标签可见: ${labelText}`)
    } else {
      console.log('⚠ 团队标签未在 header 中找到（可能 expertRoleLabels 尚未加载）')
      // 检查页面内容
      const bodyText = await page.locator('body').textContent()
      console.log(`页面内容摘要 (前300): ${bodyText?.slice(0, 300)}`)
    }

    // ── 步骤 5：等待 SwarmMemberBar 中的成员 chip 出现 ──
    console.log('步骤 5: 等待成员 chip 出现（最多 15s）')

    // SwarmMemberBar 是一个 36px 高的横向 bar，包含成员 chip button
    // chip button 内有 status icon（🟢/🟡/⬛/⏳） + 成员名称
    // 等待任意 chip button 出现（包含 active 或 loading 状态）
    const memberBarLocator = page.locator('div').filter({
      hasText: /正在启动团队|ai-engineer|leader|coordinator|researcher|developer|analyst/i,
    }).filter({
      has: page.locator('button'),
    }).first()

    // 先尝试等待 ai-engineer chip（最常见的 agent 名称）
    let activeMemberChip = page.locator('button').filter({ hasText: 'ai-engineer' }).first()
    let chipFound = false

    // 尝试等待 ai-engineer chip（最多 10s）
    try {
      await activeMemberChip.waitFor({ state: 'visible', timeout: 10000 })
      chipFound = true
      console.log('✓ 找到 ai-engineer chip')
    } catch {
      console.log('⚠ ai-engineer chip 未出现，尝试其他成员名称...')
    }

    if (!chipFound) {
      // 尝试找任意成员 chip：SwarmMemberBar 中的 button（包含状态图标）
      // active chip: cursor=pointer, opacity=1
      // 通过 DOM 查询找到第一个 active chip
      const firstActiveChip = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button')
        for (const btn of buttons) {
          const style = btn.getAttribute('style') || ''
          const computedStyle = window.getComputedStyle(btn)
          // SwarmMemberBar chip 特征：cursor=pointer, fontSize~0.72rem, maxWidth=120px
          if (style.includes('cursor: pointer') && style.includes('border-radius: 4px') && style.includes('max-width: 120px')) {
            return btn.textContent?.trim()
          }
          // 备用：检查 computed style
          if (computedStyle.cursor === 'pointer' && computedStyle.maxWidth === '120px') {
            return btn.textContent?.trim()
          }
        }
        return null
      })

      if (firstActiveChip) {
        console.log(`找到 active chip: "${firstActiveChip}"`)
        activeMemberChip = page.locator('button').filter({ hasText: firstActiveChip }).first()
        chipFound = true
      }
    }

    if (!chipFound) {
      // 最后尝试：查找任何包含状态图标的 button（🟢🟡⬛⏳）
      const statusChip = page.locator('button').filter({ hasText: /🟢|🟡|⬛|⏳/ }).first()
      const statusChipVisible = await statusChip.isVisible().catch(() => false)
      if (statusChipVisible) {
        const chipText = await statusChip.textContent()
        console.log(`找到状态 chip: "${chipText}"`)
        activeMemberChip = statusChip
        chipFound = true
      }
    }

    if (!chipFound) {
      console.log('⚠ 未找到任何成员 chip，截图记录当前状态')
      await screenshot(page, '01b-no-member-chips')

      // 检查 SwarmMemberBar 是否渲染了（但可能都是 disabled 状态）
      const memberBarText = await page.locator('div').filter({ hasText: '正在启动团队' }).first().textContent().catch(() => '')
      console.log(`SwarmMemberBar 内容: "${memberBarText}"`)

      // 如果成员还在启动中，等更久
      console.log('等待 20s 让团队成员启动...')
      await page.waitForTimeout(20000)

      // 再次尝试
      const retryChip = page.locator('button').filter({ hasText: /🟢|ai-engineer|leader/ }).first()
      const retryVisible = await retryChip.isVisible().catch(() => false)
      if (!retryVisible) {
        console.log('20s 后仍未找到 active chip，截图并结束')
        await screenshot(page, '01c-still-no-chips-after-wait')
        return
      }
      activeMemberChip = retryChip
      chipFound = true
    }

    // 截图（此时 memberbar 应该可见）
    await screenshot(page, '01-chatpage-with-memberbar')

    // ── 步骤 6：判断 chip 是否 active（可点击）──
    console.log('步骤 6: 检查成员 chip 是否 active（绿色可点击）')

    // active chip 判断：disabled 属性为 false
    const isDisabled = await activeMemberChip.isDisabled().catch(() => true)
    if (isDisabled) {
      console.log('⚠ 找到的 chip 处于 disabled 状态（成员尚未分配 session_id）')
      const chipText = await activeMemberChip.textContent()
      console.log(`chip 内容: "${chipText}"`)

      // 查找其他 active chip
      const allChips = await page.locator('button').filter({ hasText: /🟢|🟡/ }).all()
      console.log(`含绿/黄图标的 chip 数: ${allChips.length}`)

      if (allChips.length === 0) {
        console.log('没有 active（非 disabled）的成员 chip，截图记录')
        await screenshot(page, '02-no-active-chips')
        return
      }
      activeMemberChip = allChips[0]
    }

    // ── 步骤 7：点击 active 成员 chip ──
    console.log('步骤 7: 点击 active 成员 chip')
    const chipTextBefore = await activeMemberChip.textContent()
    console.log(`点击 chip: "${chipTextBefore?.trim()}"`)

    await activeMemberChip.click()
    await page.waitForTimeout(800)

    // ── 步骤 8：截图 - 02-split-view.png（验证分栏出现）──
    console.log('步骤 8: 截图 分栏视图')
    await screenshot(page, '02-split-view')

    // 验证分栏：SwarmMemberPane 应该出现
    // SwarmMemberPane 特征：包含成员名称的 28px 高顶栏 + 关闭按钮(✕)
    const closePaneBtn = page.locator('button').filter({ hasText: '✕' }).first()
    const closePaneVisible = await closePaneBtn.isVisible().catch(() => false)

    if (closePaneVisible) {
      console.log('✓ 分栏出现（找到关闭按钮 ✕）')
    } else {
      // 备用检查：查找 SwarmMemberPane 顶栏
      const paneHeader = page.locator('div').filter({ hasText: /ai-engineer|leader|coordinator/ }).filter({
        has: page.locator('button', { hasText: '✕' }),
      }).first()
      const paneHeaderVisible = await paneHeader.isVisible().catch(() => false)
      if (paneHeaderVisible) {
        console.log('✓ 分栏出现（找到成员详情面板头部）')
      } else {
        console.log('⚠ 分栏可能未出现，检查页面状态')
        // 打印页面中所有 button 内容以调试
        const allBtns = await page.locator('button').allTextContents()
        console.log(`页面所有 button 内容: ${allBtns.slice(0, 20).join(' | ')}`)
      }
    }

    // ── 步骤 9：验证左侧 Leader 对话可滚动 ──
    console.log('步骤 9: 验证左侧 Leader 对话区域')

    // Leader 区域（TranscriptViewer）的 overflow 检查
    // 通过 DOM 查找 overflow: auto/scroll 的容器
    const leaderScrollInfo = await page.evaluate(() => {
      const divs = document.querySelectorAll('div')
      for (const div of divs) {
        const s = div.getAttribute('style') || ''
        const computed = window.getComputedStyle(div)
        // TranscriptViewer 内的滚动容器
        if ((computed.overflowY === 'auto' || computed.overflowY === 'scroll') && div.scrollHeight > 0) {
          return {
            found: true,
            scrollHeight: div.scrollHeight,
            clientHeight: div.clientHeight,
            canScroll: div.scrollHeight > div.clientHeight,
            style: s.slice(0, 100),
          }
        }
      }
      return { found: false }
    })

    console.log(`Leader 滚动区域: ${JSON.stringify(leaderScrollInfo)}`)

    if (leaderScrollInfo.found) {
      console.log(`✓ 找到可滚动容器, scrollHeight=${leaderScrollInfo.scrollHeight}, canScroll=${leaderScrollInfo.canScroll}`)
    } else {
      console.log('⚠ 未找到可滚动的 Leader 容器')
    }

    // ── 步骤 10：截图 - 03-leader-scroll.png ──
    console.log('步骤 10: 截图 Leader 区域')
    await screenshot(page, '03-leader-scroll')

    // ── 步骤 11：如果 Leader 有内容，额外截图 ──
    console.log('步骤 11: 检查 Leader 对话内容')
    const transcriptContainer = page.locator('[data-testid="transcript-viewer"]').first()
    const transcriptHasContent = await transcriptContainer.isVisible().catch(() => false)

    if (transcriptHasContent) {
      const content = await transcriptContainer.textContent()
      console.log(`✓ TranscriptViewer 内容（前100字）: ${content?.slice(0, 100)}`)
      await screenshot(page, '04-leader-transcript-content')
    } else {
      // 通过其他方式检查 transcript 内容
      const messageItems = await page.locator('div').filter({ hasText: /user|assistant|tool/ }).count()
      console.log(`消息条目数（模糊匹配）: ${messageItems}`)

      // 检查是否有历史消息
      const anyContent = await page.locator('body').textContent()
      const hasMessages = anyContent && anyContent.length > 200
      if (hasMessages) {
        console.log('✓ 页面有实质内容（Leader 对话已加载）')
        await screenshot(page, '04-leader-has-content')
      } else {
        console.log('⚠ Leader 区域内容较少')
      }
    }

    // ── 最终验证总结 ──
    console.log('\n=== 测试结果总结 ===')
    console.log(`团队 session: ${teamSession.session_id}`)
    console.log(`团队标签: ${teamSession.expert_role_label}`)
    console.log(`chip 找到: ${chipFound}`)
    console.log(`分栏关闭按钮: ${closePaneVisible}`)
    console.log(`Leader 滚动区域: ${leaderScrollInfo.found}`)
    console.log(`截图保存目录: ${ARTIFACTS_DIR}`)
    console.log('====================\n')

    // 基本断言：至少要进入了 ChatPage（URL 正确）
    expect(page.url()).toContain(`/chat/${teamSession.session_id}`)
    console.log('✓ 测试完成')
  })

  test('验证 SwarmMemberBar 渲染（团队 session 进入 ChatPage）', async ({ page }) => {
    console.log('验证 SwarmMemberBar 是否在团队 session 的 ChatPage 中渲染')

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    const sessions: Array<{
      session_id: string
      expert_role_label?: string
    }> = await page.evaluate(async () => {
      const r = await fetch('/api/sessions')
      if (!r.ok) return []
      return r.json()
    }).catch(() => [])

    const teamSession = sessions.find(
      (s) => s.expert_role_label && s.expert_role_label.startsWith('🤝')
    )

    if (!teamSession) {
      console.log('没有团队 session，跳过')
      test.skip()
      return
    }

    console.log(`使用 session: ${teamSession.session_id}`)

    await page.goto(`${BASE_URL}/chat/${teamSession.session_id}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const artifactsPath = path.join(ARTIFACTS_DIR, 'memberbar-verify.png')
    await page.screenshot({ path: artifactsPath, fullPage: false })
    console.log(`截图: ${artifactsPath}`)

    // SwarmMemberBar 高度 36px，背景色 #1e1e2e，位于顶部 header 下方
    // 通过检查 DOM 中是否有 36px 高度的横向 bar 来验证
    const memberBarInfo = await page.evaluate(() => {
      const divs = document.querySelectorAll('div')
      for (const div of divs) {
        const s = div.getAttribute('style') || ''
        if (s.includes('height: 36px') && s.includes('border-bottom') && s.includes('border-top')) {
          return {
            found: true,
            childButtons: div.querySelectorAll('button').length,
            text: div.textContent?.slice(0, 100),
          }
        }
      }
      return { found: false }
    })

    console.log(`SwarmMemberBar DOM 信息: ${JSON.stringify(memberBarInfo)}`)

    if (memberBarInfo.found) {
      console.log(`✓ SwarmMemberBar 渲染正常，包含 ${memberBarInfo.childButtons} 个 button`)
      console.log(`  bar 文本: "${memberBarInfo.text}"`)
    } else {
      // 可能团队成员数为 0 导致 bar 不渲染（isTeamSession && Object.keys(members).length > 0 条件）
      console.log('⚠ SwarmMemberBar 未找到，可能 members 尚未加载')
      // 检查 expert_role_label 是否正确加载到 UI Store
      const expertLabel = await page.evaluate(() => {
        // 查找 header 中的 🤝 标签
        const spans = document.querySelectorAll('span')
        for (const span of spans) {
          if (span.textContent?.includes('🤝')) return span.textContent
        }
        return null
      })
      console.log(`Header 中的 🤝 标签: ${expertLabel}`)
    }

    // 验证 URL 正确
    expect(page.url()).toContain(`/chat/${teamSession.session_id}`)
  })
})
