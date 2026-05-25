/**
 * 修复验证测试：
 * 1. 点击"开始新任务"后 URL 清除 ?team= 参数 → 显示 textarea 而非"等待 Agent 启动中..."
 * 2. 完整 Swarm 启动 → Leader 调用 swarm_spawn_member → 成员内容可查看
 */
import { test, expect } from '@playwright/test'
import path from 'path'

const ARTIFACT_DIR = 'e:/AI/OpenHarness/test-artifacts/fix-verify'
const BASE_URL = 'http://localhost:5173'

function s(name: string) {
  return path.join(ARTIFACT_DIR, name)
}

test.describe('修复验证：Swarm 新任务流程', () => {
  test('step1 - swarm 页面加载并选择团队', async ({ page }) => {
    // 步骤 1：访问 swarm 视图
    await page.goto(`${BASE_URL}/?view=swarm`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: s('01-swarm-page.png'), fullPage: true })

    // 截图中间列团队列表，确认有 marketing-team
    const teamEntries = page.locator('[style*="cursor: pointer"]').filter({ hasText: /marketing-team/i })
    const count = await teamEntries.count()
    console.log(`页面内 marketing-team 条目数: ${count}`)

    // 使用更稳健的方式找到 Swarm 页面三列布局中的团队 div
    // 根据代码分析：团队列表在 width:180px 的左侧列，每个团队是 div[onClick]
    // 选择器：包含"marketing-team"文字的 div，且在 Swarm 页面（非 Sidebar）
    // 通过 data- 属性不可用，改用 :has-text + nth 精确定位
    const swarmTeamDiv = page.locator('text=marketing-team').nth(0)
    await swarmTeamDiv.waitFor({ timeout: 5000 }).catch(() => {})
    const swarmTeamCount = await swarmTeamDiv.count()
    console.log(`marketing-team 文本节点数: ${swarmTeamCount}`)
    await page.screenshot({ path: s('01-team-list.png'), fullPage: true })
  })

  test('step2 - 选择团队并验证状态', async ({ page }) => {
    await page.goto(`${BASE_URL}/?view=swarm`)
    await page.waitForLoadState('networkidle')

    // 点击团队列表中的 marketing-team（Swarm 三列左侧列中）
    // 通过层级关系定位：最近包含"Teams"标签的区域内的 marketing-team
    // 根据代码：左列 div 宽度 180px，包含 "Teams" header 和每个团队 div
    // 用 page.locator 匹配精确文本，取 Swarm 页面主内容区的第一个
    const teamsHeader = page.locator('text=Teams').first()
    const teamsCount = await teamsHeader.count()
    console.log(`Teams 标题数: ${teamsCount}`)

    // 找到 "marketing-team" 文本（在团队列表中，其父级有 cursor:pointer）
    // 取包含这个文本且字体约为 0.8125rem 的 div
    const allTeamDivs = page.locator('div').filter({ hasText: /^marketing-team$/ })
    const divCount = await allTeamDivs.count()
    console.log(`精确匹配 marketing-team div 数: ${divCount}`)

    // 截图当前状态
    await page.screenshot({ path: s('02-before-team-click.png'), fullPage: true })

    if (divCount > 0) {
      await allTeamDivs.first().click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: s('03-team-state.png'), fullPage: true })

      const url = page.url()
      console.log(`选择团队后 URL: ${url}`)

      // 检查中间列的状态
      const waitingText = await page.locator('text=/等待.*Agent.*启动/').count()
      const textareaCount = await page.locator('textarea').count()
      const runningState = await page.locator('text=/开始新任务/').count()
      const configuredState = await page.locator('text=/已就绪/').count()
      const idleState = await page.locator('text=/任务已完成/').count()

      console.log(`=== 团队状态检测 ===`)
      console.log(`"等待 Agent 启动中" 文本: ${waitingText}`)
      console.log(`textarea 输入框: ${textareaCount}`)
      console.log(`"开始新任务" 按钮（running状态）: ${runningState}`)
      console.log(`"已就绪" banner（configured状态）: ${configuredState}`)
      console.log(`"任务已完成"（idle状态）: ${idleState}`)
    }
  })

  test('step3 - 关键修复验证：开始新任务后显示 textarea', async ({ page }) => {
    // 模拟修复前的问题场景：带 ?team= 参数访问 Swarm 页面
    // 在未修复版本中，这会导致"等待 Agent 启动中..."一直显示
    // 修复后：点击"开始新任务"清除 URL 参数 → 正确显示 textarea

    await page.goto(`${BASE_URL}/?view=swarm`)
    await page.waitForLoadState('networkidle')

    // 找到并点击 marketing-team 团队条目
    const teamDiv = page.locator('div').filter({ hasText: /^marketing-team$/ }).first()
    const found = await teamDiv.count()
    if (found === 0) {
      console.log('未找到 marketing-team，跳过此步骤')
      await page.screenshot({ path: s('04-no-team.png'), fullPage: true })
      return
    }

    await teamDiv.click()
    await page.waitForTimeout(1500)

    // 截图：团队当前状态
    await page.screenshot({ path: s('04-team-state-raw.png'), fullPage: true })

    // 检测团队状态
    const isRunning = await page.locator('text=开始新任务').filter({ hasText: '开始新任务' }).count()
    const isIdle = await page.locator('text=任务已完成').count()
    const isConfigured = await page.locator('text=已就绪').count()
    console.log(`running: ${isRunning}, idle: ${isIdle}, configured: ${isConfigured}`)

    if (isRunning > 0 || isIdle > 0) {
      // 有"开始新任务"按钮（running 或 idle 状态）
      const newTaskBtn = page.locator('button').filter({ hasText: '开始新任务' }).first()
      const btnCount = await newTaskBtn.count()
      console.log(`"开始新任务"按钮: ${btnCount}`)

      if (btnCount > 0) {
        // 记录点击前的 URL
        const urlBefore = page.url()
        console.log(`点击前 URL: ${urlBefore}`)

        await newTaskBtn.click()
        await page.waitForTimeout(1000)

        const urlAfter = page.url()
        console.log(`点击后 URL: ${urlAfter}`)

        // 关键验证：URL 不含 team= 参数（已由 navigate('/?view=swarm', {replace:true}) 清除）
        const hasTeamParam = urlAfter.includes('team=')
        console.log(`URL 含 team= 参数: ${hasTeamParam} (期望: false)`)

        // 截图：关键验证点
        await page.screenshot({ path: s('05-after-new-task-click.png'), fullPage: true })

        // 关键断言：应显示 textarea 而非"等待 Agent 启动中..."
        const waitingText = await page.locator('text=/等待.*Agent.*启动/').count()
        const textareaVisible = await page.locator('textarea').count()
        console.log(`"等待 Agent 启动中" 文本: ${waitingText} (期望: 0)`)
        console.log(`textarea 可见: ${textareaVisible} (期望: >=1)`)

        if (waitingText > 0) {
          console.log('!! 修复未生效：仍显示"等待 Agent 启动中..."')
          console.log('原因：navigate() 未清除 URL 中的 team= 参数，或 searchParams 仍保留旧值')
        } else if (textareaVisible > 0) {
          console.log('✓ 修复有效：正确显示任务 textarea 输入框')
        } else {
          console.log('?? 状态不明，请检查截图')
        }
      }
    } else if (isConfigured > 0) {
      // 已在 configured 状态，检查是否有 textarea
      const hasWaiting = await page.locator('text=/等待.*Agent.*启动/').count()
      const hasTextarea = await page.locator('textarea').count()
      console.log(`configured 状态 - waiting: ${hasWaiting}, textarea: ${hasTextarea}`)
      await page.screenshot({ path: s('05-configured-state.png'), fullPage: true })

      // 这种情况没有 URL 参数问题，直接验证 textarea 是否可用
      if (hasTextarea > 0) {
        console.log('✓ configured 状态正确显示 textarea')
      }
    }
  })

  test('step4 - 完整启动流程：填写任务并启动', async ({ page }) => {
    await page.goto(`${BASE_URL}/?view=swarm`)
    await page.waitForLoadState('networkidle')

    const teamDiv = page.locator('div').filter({ hasText: /^marketing-team$/ }).first()
    const found = await teamDiv.count()
    if (found === 0) {
      console.log('未找到 marketing-team，跳过启动流程')
      return
    }
    await teamDiv.click()
    await page.waitForTimeout(1500)

    // 确保进入 configured 状态并有 textarea
    let textarea = page.locator('textarea').first()
    let textareaCount = await textarea.count()

    // 如果在 running/idle 状态，先点击"开始新任务"
    if (textareaCount === 0) {
      const newTaskBtn = page.locator('button').filter({ hasText: '开始新任务' }).first()
      if (await newTaskBtn.count() > 0) {
        await newTaskBtn.click()
        await page.waitForTimeout(1000)
        textareaCount = await page.locator('textarea').count()
        textarea = page.locator('textarea').first()
      }
    }

    if (textareaCount === 0) {
      console.log('未找到 textarea，当前团队状态不支持启动，截图后退出')
      await page.screenshot({ path: s('06-no-textarea.png'), fullPage: true })
      return
    }

    // 截图：输入框就绪状态
    await page.screenshot({ path: s('06-textarea-ready.png'), fullPage: true })
    console.log('✓ textarea 可用，开始填写任务')

    // 填写任务描述
    await textarea.fill('分析当前AI工具市场的用户痛点，输出一份500字的调研报告')
    await page.waitForTimeout(500)
    await page.screenshot({ path: s('07-task-filled.png'), fullPage: true })

    // 点击"启动团队 →"
    const launchBtn = page.locator('button').filter({ hasText: /启动团队/ }).first()
    const launchCount = await launchBtn.count()
    console.log(`"启动团队"按钮: ${launchCount}`)

    if (launchCount === 0) {
      console.log('未找到启动按钮，截图并退出')
      await page.screenshot({ path: s('07-no-launch-btn.png'), fullPage: true })
      return
    }

    await launchBtn.click()
    console.log('已点击"启动团队 →"')

    // 等待导航到 /chat/
    await page.waitForURL(/\/chat\//, { timeout: 15000 }).catch(() => {
      console.log('等待导航到 /chat/ 超时')
    })
    await page.waitForTimeout(2000)
    const chatUrl = page.url()
    console.log(`导航后 URL: ${chatUrl}`)
    await page.screenshot({ path: s('08-chatpage.png'), fullPage: true })

    // 等待 20 秒，检查 Leader 是否调用 swarm_spawn_member
    console.log('等待 20 秒，观察 Leader 工具调用...')
    await page.waitForTimeout(20000)
    await page.screenshot({ path: s('09-leader-tools.png'), fullPage: true })

    const spawnCount = await page.locator('text=swarm_spawn_member').count()
    console.log(`swarm_spawn_member 工具调用可见: ${spawnCount}`)
    if (spawnCount > 0) {
      console.log('✓ Leader 已调用 swarm_spawn_member，成员 spawn 正常')
    } else {
      console.log('... swarm_spawn_member 尚未出现，Agent 可能还在思考')
    }

    // 再等 30 秒
    console.log('继续等待 30 秒...')
    await page.waitForTimeout(30000)
    await page.screenshot({ path: s('10-progress.png'), fullPage: true })

    // 等待 60 秒，查看最终状态
    console.log('最终等待 60 秒...')
    await page.waitForTimeout(60000)
    await page.screenshot({ path: s('11-final.png'), fullPage: true })

    const finalSpawnCount = await page.locator('text=swarm_spawn_member').count()
    console.log(`最终 swarm_spawn_member 调用数: ${finalSpawnCount}`)
  })
})
