/**
 * Interactive REPL for Ghostic CLI.
 *
 * Provides a rich terminal chat interface with Ghostty-inspired animation,
 * interactive API key setup wizard, streaming spinner animations, and multi-turn
 * conversation.
 *
 * @module @deepseek-ai/dsh/interactive
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { runProfile } from './profile-boot.ts'
import {
  getTerminalWidth,
  playGhostIntroAnimation,
  printGhosticHeader,
  StreamAnimationEngine,
} from './animations.ts'

export interface InteractiveOptions {
  environment: LaunchEnvironmentSnapshot
  patchFiles: readonly string[]
  args: readonly string[]
}

/** Read package version from manifest. */
function getPackageVersion(): string {
  try {
    const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string }
    return manifest.version || '0.1.0-rc.8'
  } catch {
    return '0.1.0-rc.8'
  }
}

/**
 * Safely update .env file without wiping existing environment variables.
 */
function updateEnvFile(updates: Record<string, string>): void {
  try {
    const envPath = resolve(process.cwd(), '.env')
    let existingContent = ''
    if (existsSync(envPath)) {
      existingContent = readFileSync(envPath, 'utf8')
    }

    const lines = existingContent ? existingContent.split(/\r?\n/) : []
    const updatedKeys = new Set<string>()

    const newLines = lines.map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (match) {
        const key = match[1]
        if (key && key in updates) {
          updatedKeys.add(key)
          return `${key}=${updates[key]}`
        }
      }
      return line
    })

    for (const [key, value] of Object.entries(updates)) {
      if (!updatedKeys.has(key) && value) {
        newLines.push(`${key}=${value}`)
      }
    }

    while (newLines.length > 0 && newLines[newLines.length - 1] === '') {
      newLines.pop()
    }

    writeFileSync(envPath, newLines.join('\n') + '\n')
    console.log(`\x1b[32m✔ Đã cập nhật cấu hình API vào ${envPath}\x1b[0m\n`)
  } catch {
    console.log('\x1b[33m✔ Đã thiết lập cấu hình trong phiên làm việc hiện tại.\x1b[0m\n')
  }
}

/**
 * Check if any LLM API key / configuration exists in environment or .env.
 */
function getActiveConfig(): { provider: string; model: string; hasKey: boolean } {
  const provider = process.env.LLM_PROVIDER
  const model = process.env.LLM_MODEL

  if (process.env.OPENAI_API_KEY) {
    return { provider: provider || 'openai', model: model || 'gpt-4o', hasKey: true }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: provider || 'anthropic', model: model || 'claude-3-7-sonnet', hasKey: true }
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { provider: provider || 'deepseek', model: model || 'deepseek-chat', hasKey: true }
  }
  if (process.env.CUSTOM_API_KEY || process.env.CUSTOM_BASE_URL || process.env.OPENAI_BASE_URL) {
    return { provider: provider || 'custom', model: model || 'default', hasKey: true }
  }
  if (provider && model) {
    return { provider, model, hasKey: true }
  }
  return { provider: '', model: '', hasKey: false }
}

/**
 * Run interactive API setup wizard if no API is plugged in (or when forced via /config).
 */
async function ensureApiConfig(rl: ReturnType<typeof createInterface>, force = false): Promise<{ provider: string; model: string }> {
  if (!force) {
    const active = getActiveConfig()
    if (active.hasKey && active.provider && active.model) {
      return { provider: active.provider, model: active.model }
    }
  }

  console.log('\x1b[35m\n[Ghostic Setup] Cấu hình API Model.\x1b[0m')
  console.log('Vui lòng chọn nhà cung cấp AI để cắm (plug-in) vào Ghostic:\n')
  console.log('  1) \x1b[1mOpenAI\x1b[0m (GPT-4o, o3-mini, GPT-4.5)')
  console.log('  2) \x1b[1mAnthropic Claude\x1b[0m (Claude 3.7 Sonnet, Claude 3.5 Sonnet)')
  console.log('  3) \x1b[1mDeepSeek\x1b[0m (DeepSeek-V3, DeepSeek-R1)')
  console.log('  4) \x1b[1mCustom / OpenAI-Compatible\x1b[0m (Ollama, Groq, OpenRouter, vLLM)\n')

  const choice = (await rl.question('\x1b[32mChọn nhà cung cấp [1-4] (mặc định 1): \x1b[0m')).trim() || '1'
  let provider = 'openai'
  let defaultModel = 'gpt-4o'
  let keyEnvName = 'OPENAI_API_KEY'
  let baseUrl = ''

  if (choice === '2') {
    provider = 'anthropic'
    defaultModel = 'claude-3-7-sonnet'
    keyEnvName = 'ANTHROPIC_API_KEY'
  } else if (choice === '3') {
    provider = 'deepseek'
    defaultModel = 'deepseek-chat'
    keyEnvName = 'DEEPSEEK_API_KEY'
  } else if (choice === '4') {
    provider = 'custom'
    defaultModel = 'default'
    keyEnvName = 'CUSTOM_API_KEY'
    baseUrl = (await rl.question('\x1b[32mNhập Base URL (vd: http://localhost:11434/v1): \x1b[0m')).trim()
  }

  const apiKey = (await rl.question(`\x1b[32mNhập API Key cho ${provider}: \x1b[0m`)).trim()
  const modelPrompt = await rl.question(`\x1b[32mNhập Model [mặc định: ${defaultModel}]: \x1b[0m`)
  const model = modelPrompt.trim() || defaultModel

  // Save to environment
  process.env[keyEnvName] = apiKey || 'dummy-key'
  process.env.LLM_PROVIDER = provider
  process.env.LLM_MODEL = model
  if (baseUrl) {
    process.env.CUSTOM_BASE_URL = baseUrl
  }

  // Safe update to .env
  const updates: Record<string, string> = {
    [keyEnvName]: apiKey || 'dummy-key',
    LLM_PROVIDER: provider,
    LLM_MODEL: model,
  }
  if (baseUrl) updates.CUSTOM_BASE_URL = baseUrl

  updateEnvFile(updates)

  return { provider, model }
}

/**
 * Prompt user for workspace access permission authorization.
 */
async function ensureWorkspacePermission(rl: ReturnType<typeof createInterface>): Promise<string> {
  const cwd = process.cwd()
  console.log(`\x1b[33m? Yêu cầu cấp quyền Workspace [${cwd}]\x1b[0m`)
  const answer = (await rl.question('\x1b[32m  Cấp quyền truy cập Đọc & Ghi (workspace-write)? [Y/n]: \x1b[0m')).trim().toLowerCase()

  if (answer === 'n' || answer === 'no') {
    process.env.DSH_PERMISSION_MODE = 'read-only'
    console.log('\x1b[33m✔ Đã cấp quyền: Read-Only (Chỉ đọc)\x1b[0m\n')
    return 'read-only'
  } else {
    process.env.DSH_PERMISSION_MODE = 'workspace-write'
    console.log('\x1b[32m✔ Đã cấp quyền: Workspace-Write (Toàn quyền đọc & ghi workspace)\x1b[0m\n')
    return 'workspace-write'
  }
}

/**
 * Render complete interactive CLI command reference table.
 */
function printHelpTable(): void {
  console.log('\n\x1b[1m\x1b[35m=== BẢNG LỆNH & CHẾ ĐỘ HOẠT ĐỘNG GHOSTIC CLI ===\x1b[0m\n')
  console.log('  \x1b[36mChế độ hoạt động (Modes):\x1b[0m')
  console.log('    \x1b[1m/plan [nhiệm_vụ]\x1b[0m   - Bật chế độ Lập kế hoạch (Plan Mode: khám phá & thiết kế, không sửa code)')
  console.log('    \x1b[1m/plan off\x1b[0m          - Thoát khỏi chế độ Plan Mode để quay về chế độ thực thi bình thường')
  console.log('    \x1b[1m/goal <nhiệm_vụ>\x1b[0m   - Kích hoạt Goal Driver tự hành đa vòng (Multi-round Autonomous Goal)')
  console.log('    \x1b[1m/mode [tên_mode]\x1b[0m   - Chuyển quyền Sandbox (read-only | workspace-write | danger-full-access)')
  console.log('')
  console.log('  \x1b[36mNgữ cảnh & Thống kê (Context & Metrics):\x1b[0m')
  console.log('    \x1b[1m/compact\x1b[0m           - Nén ngữ cảnh hội thoại thủ công, tóm tắt lịch sử để giải phóng token')
  console.log('    \x1b[1m/stats\x1b[0m             - Xem thống kê token sử dụng (Prompt, Completion, KV-Cache) & số bước')
  console.log('    \x1b[1m/tools\x1b[0m             - Liệt kê toàn bộ công cụ (Tools) đang sẵn sàng (FS, Web, Subagent, ...)')
  console.log('    \x1b[1m/skills\x1b[0m            - Liệt kê toàn bộ kỹ năng (Skills) đang nạp trong hệ thống')
  console.log('')
  console.log('  \x1b[36mCấu hình & Hệ thống (Config & System):\x1b[0m')
  console.log('    \x1b[1m/model [tên_model]\x1b[0m - Xem thông tin model hiện tại hoặc đổi sang model khác tức thì')
  console.log('    \x1b[1m/config\x1b[0m            - Trình hướng dẫn thiết lập API Key, Base URL, Nhà cung cấp AI')
  console.log('    \x1b[1m/feedback <nội_dung>\x1b[0m - Gửi phản hồi / ghi chú vào session log')
  console.log('    \x1b[1m/clear\x1b[0m             - Xoá màn hình terminal và vẽ lại Header')
  console.log('    \x1b[1m/exit\x1b[0m              - Thoát khỏi phiên làm việc\n')
}

/**
 * Print real-time session statistics (tokens, turns, tools, cache).
 */
function printSessionStats(agent: unknown, selection: { provider: string; model: string }): void {
  const session = (agent as { session?: { events?: readonly SessionEvent[] } })?.session
  const events = session?.events || []
  let promptTokens = 0
  let completionTokens = 0
  let cachedTokens = 0
  let toolCalls = 0
  let userTurns = 0

  for (const ev of events) {
    if (ev.type === 'user/message') userTurns++
    if (ev.type === 'tool/call') toolCalls++
    if (ev.type === 'assistant/message' && (ev as { data?: { usage?: { promptTokens?: number; completionTokens?: number; cacheReadTokens?: number } } }).data?.usage) {
      const usage = (ev as { data: { usage: { promptTokens?: number; completionTokens?: number; cacheReadTokens?: number } } }).data.usage
      promptTokens += usage.promptTokens || 0
      completionTokens += usage.completionTokens || 0
      cachedTokens += usage.cacheReadTokens || 0
    }
  }

  const width = getTerminalWidth()
  console.log(`\n\x1b[35m─── [ 📊 Thống Kê Phiên Làm Việc ] ${'─'.repeat(Math.max(4, width - 36))}\x1b[0m`)
  console.log(`  \x1b[1mModel đang dùng:\x1b[0m      \x1b[36m${selection.model}\x1b[0m (\x1b[33m${selection.provider}\x1b[0m)`)
  console.log(`  \x1b[1mChế độ Sandbox:\x1b[0m       \x1b[32m${process.env.DSH_PERMISSION_MODE || 'workspace-write'}\x1b[0m`)
  console.log(`  \x1b[1mSố lượt tương tác:\x1b[0m    \x1b[37m${userTurns} lượt hỏi, ${toolCalls} lượt gọi tool\x1b[0m`)
  console.log(`  \x1b[1mPrompt Tokens:\x1b[0m        \x1b[37m${promptTokens.toLocaleString()} tokens\x1b[0m`)
  console.log(`  \x1b[1mCompletion Tokens:\x1b[0m    \x1b[37m${completionTokens.toLocaleString()} tokens\x1b[0m`)
  console.log(`  \x1b[1mKV-Cache Read Tokens:\x1b[0m \x1b[32m${cachedTokens.toLocaleString()} tokens (đã tối ưu)\x1b[0m`)
  console.log(`  \x1b[1mTổng Tokens tiêu thụ:\x1b[0m \x1b[1m\x1b[33m${(promptTokens + completionTokens).toLocaleString()} tokens\x1b[0m`)
  console.log(`\x1b[35m${'─'.repeat(width)}\x1b[0m\n`)
}

/**
 * Print active tools catalog.
 */
function printToolsCatalog(ctx: { get?: (name: string) => unknown }, agent: unknown): void {
  const toolsService = ctx.get?.('tools') as { schemas?: (agent: unknown) => Array<{ name: string; description?: string }> } | undefined
  const tools = toolsService?.schemas ? toolsService.schemas(agent) : []
  const width = getTerminalWidth()

  console.log(`\n\x1b[35m─── [ ⚙ Danh Sách Công Cụ (Tools) ] ${'─'.repeat(Math.max(4, width - 38))}\x1b[0m`)
  if (tools.length === 0) {
    console.log('  (Đang sử dụng các công cụ mặc định: bash, fs, web, subagent, todo, ralph)')
  } else {
    for (const tool of tools) {
      const desc = (tool.description || '').split('\n')[0] || ''
      console.log(`  \x1b[1m\x1b[36m${tool.name.padEnd(26)}\x1b[0m \x1b[90m${desc.slice(0, Math.max(10, width - 32))}\x1b[0m`)
    }
  }
  console.log(`\x1b[35m${'─'.repeat(width)}\x1b[0m\n`)
}

/**
 * Print registered skills catalog.
 */
function printSkillsCatalog(ctx: { get?: (name: string) => unknown }, agent: unknown): void {
  const skillService = (ctx.get?.('skill') || ctx.get?.('skills')) as { list?: (agent: unknown) => Array<{ name: string; description?: string }> } | undefined
  const skills = skillService?.list ? skillService.list(agent) : []
  const width = getTerminalWidth()

  console.log(`\n\x1b[35m─── [ 💡 Danh Sách Kỹ Năng (Skills) ] ${'─'.repeat(Math.max(4, width - 40))}\x1b[0m`)
  if (skills.length === 0) {
    console.log('  (Đang nạp: smart-token-caching, dsh-pre-push-checks, dsh-code-review, agy-customizations)')
  } else {
    for (const s of skills) {
      const desc = (s.description || '').split('\n')[0] || ''
      console.log(`  \x1b[1m\x1b[33m${s.name.padEnd(26)}\x1b[0m \x1b[90m${desc.slice(0, Math.max(10, width - 32))}\x1b[0m`)
    }
  }
  console.log(`\x1b[35m${'─'.repeat(width)}\x1b[0m\n`)
}

/**
 * Handle interactive or direct permission mode switching.
 */
async function handlePermissionChange(rl: ReturnType<typeof createInterface>, arg?: string): Promise<void> {
  let targetMode = (arg || '').toLowerCase().trim()
  if (targetMode === '1') targetMode = 'read-only'
  else if (targetMode === '2') targetMode = 'workspace-write'
  else if (targetMode === '3' || targetMode === 'danger') targetMode = 'danger-full-access'

  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(targetMode)) {
    console.log(`\nChế độ Sandbox hiện tại: \x1b[1m\x1b[33m${process.env.DSH_PERMISSION_MODE || 'workspace-write'}\x1b[0m`)
    console.log('Chọn chế độ Sandbox mới:')
    console.log('  1) \x1b[1mread-only\x1b[0m (Chỉ đọc, hỏi quyền khi sửa file hoặc chạy lệnh)')
    console.log('  2) \x1b[1mworkspace-write\x1b[0m (Cho phép đọc & ghi trong workspace, hỏi khi chạy lệnh nhạy cảm)')
    console.log('  3) \x1b[1mdanger-full-access\x1b[0m (Toàn quyền hệ thống, không hỏi xác nhận)\n')
    const choice = (await rl.question('\x1b[32mChọn chế độ [1-3]: \x1b[0m')).trim()
    if (choice === '1') targetMode = 'read-only'
    else if (choice === '2') targetMode = 'workspace-write'
    else if (choice === '3') targetMode = 'danger-full-access'
    else {
      console.log('\x1b[33mHủy thay đổi chế độ.\x1b[0m\n')
      return
    }
  }

  process.env.DSH_PERMISSION_MODE = targetMode
  console.log(`\x1b[32m✔ Đã chuyển chế độ Sandbox sang: ${targetMode}\x1b[0m\n`)
}

/**
 * Check whether plan mode is active in the session event log.
 */
function isPlanModeActive(events: readonly SessionEvent[] = []): boolean {
  let active = false
  for (const event of events) {
    if ((event.type as string) === 'plan/mode') {
      active = Boolean((event as { data?: { active?: boolean } }).data?.active)
    }
  }
  return active
}

/**
 * Launch the interactive Ghostic REPL.
 */
export async function runInteractive(options: InteractiveOptions): Promise<void> {
  const rl = createInterface({ input, output })

  let currentConfig: { provider: string; model: string }
  try {
    currentConfig = await ensureApiConfig(rl)
  } catch (error) {
    rl.close()
    console.error(`\x1b[31mGhostic setup error: ${String(error)}\x1b[0m`)
    process.exit(1)
  }

  // Play animated intro with Ghostty-inspired logo
  await playGhostIntroAnimation()

  // Display rich header
  printGhosticHeader(currentConfig.provider, currentConfig.model, getPackageVersion(), process.cwd())

  // Authorize workspace permission
  await ensureWorkspacePermission(rl)

  // Boot profile with interactive overlay (disabling one-shot runner to keep context active)
  const interactivePatchPath = fileURLToPath(new URL('../config/interactive.patch.yml', import.meta.url))
  const { ctx, shutdown } = await runProfile({
    environment: options.environment,
    profile: 'headless',
    patchFiles: [interactivePatchPath, ...options.patchFiles],
    args: [],
  })

  // Settlement await
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')

  if (!agents || !sessions) {
    console.error('\x1b[31mGhostic: Failed to initialize agents and sessions.\x1b[0m')
    rl.close()
    process.exit(1)
  }

  const selection = {
    provider: currentConfig.provider,
    model: currentConfig.model,
  }

  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: selection,
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })

  const loading = new StreamAnimationEngine()
  let hasPrintedAssistantPrefix = false
  let isReasoning = false
  let reasoningClosed = false
  let thinkingStartTime = 0

  const closeReasoningBlock = (): void => {
    if (isReasoning && !reasoningClosed) {
      isReasoning = false
      reasoningClosed = true
      const durationSec = Math.max(0.1, (Date.now() - thinkingStartTime) / 1000).toFixed(1)
      process.stdout.write(`\r\x1b[K\x1b[90m🧠 [Đã suy luận xong trong ${durationSec}s]\x1b[0m\n\n`)
    }
  }

  // Subscribe to session events for real-time streaming tool & response reporting
  ctx.on('session/event', (_session, event: SessionEvent) => {
    const width = getTerminalWidth()

    if (event.type === 'turn/start') {
      hasPrintedAssistantPrefix = false
      isReasoning = false
      reasoningClosed = false
      thinkingStartTime = Date.now()
      loading.start('Ghostic đang suy nghĩ...', 'dots')
    } else if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'reasoning-delta') {
        if (!isReasoning) {
          isReasoning = true
          reasoningClosed = false
        }
        loading.start('Ghostic đang suy luận...', 'wave')
      } else if (chunk.type === 'text-delta') {
        loading.stop()
        closeReasoningBlock()

        if (!hasPrintedAssistantPrefix) {
          hasPrintedAssistantPrefix = true
          const planSuffix = isPlanModeActive(agent.session.events) ? ' (Plan Mode)' : ''
          const aTop = `\n\x1b[35m─── [ 👻 Ghostic${planSuffix} ] ${'─'.repeat(Math.max(4, width - (planSuffix ? 31 : 19)))}\x1b[0m\n`
          process.stdout.write(aTop)
        }
        process.stdout.write(`\x1b[0m\x1b[37m${chunk.text}`)
      }
    } else if (event.type === 'tool/call') {
      loading.stop()
      closeReasoningBlock()

      const argsStr = event.data.arguments
      const preview = argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr
      process.stdout.write(`\n\x1b[33m⚙ [Tool: ${event.data.name}]\x1b[0m \x1b[90m${preview}\x1b[0m\n`)
      loading.start(`Đang thực thi: ${event.data.name}...`, 'pulse')
    } else if (event.type === 'tool/result') {
      loading.stop()
      const innerBlocks = event.data.message.content.flatMap(tr => tr.content)
      const textBlocks = innerBlocks
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('')
      const preview = textBlocks.length > 150 ? textBlocks.slice(0, 150) + '...' : textBlocks
      process.stdout.write(`\x1b[32m✔ [Result]\x1b[0m \x1b[90m${preview.trim()}\x1b[0m\n`)
      loading.start('Ghostic đang xử lý kết quả...', 'modern')
    } else if (event.type === 'turn/end') {
      loading.stop()
      closeReasoningBlock()

      if (hasPrintedAssistantPrefix) {
        hasPrintedAssistantPrefix = false
        process.stdout.write(`\n\x1b[90m${'─'.repeat(width)}\x1b[0m\n`)
      }

      if (event.data.reason?.kind === 'error') {
        process.stdout.write(`\n\x1b[31m[Lỗi: ${event.data.reason.error.code}] ${event.data.reason.error.message}\x1b[0m\n`)
      }
    } else if ((event.type as string) === 'compaction/summary') {
      const lineLen = Math.floor((width - 32) / 2)
      process.stdout.write(`\n\x1b[90m${'─'.repeat(lineLen)} [ 📦 Conversation Compacted ] ${'─'.repeat(width - lineLen - 32)}\x1b[0m\n\n`)
    }
  })

  const promptLoop = async (): Promise<void> => {
    while (true) {
      try {
        const width = getTerminalWidth()
        const isPlanMode = isPlanModeActive(agent.session.events)
        const planBadge = isPlanMode ? '\x1b[35m[ 📋 PLAN MODE ] \x1b[0m' : ''
        const userTop = `\n\x1b[90m─── [ 👤 Bạn ] ${planBadge}${'─'.repeat(Math.max(4, width - (isPlanMode ? 31 : 15)))}\x1b[0m`

        console.log(userTop)
        const userInput = await rl.question('\x1b[90m│ > \x1b[0m\x1b[1m\x1b[37m')
        process.stdout.write('\x1b[0m')
        const trimmed = userInput.trim()

        if (!trimmed) continue

        // Slash command processing
        if (trimmed.startsWith('/')) {
          const parts = trimmed.slice(1).split(/\s+/)
          const cmd = parts[0]?.toLowerCase() || ''
          const arg = trimmed.slice(cmd.length + 1).trim()

          if (cmd === 'exit' || cmd === 'quit') {
            console.log('\x1b[35m👻 Tạm biệt! Hẹn gặp lại.\x1b[0m')
            break
          }

          if (cmd === 'clear') {
            console.clear()
            printGhosticHeader(selection.provider, selection.model, getPackageVersion(), process.cwd())
            continue
          }

          if (cmd === 'help') {
            printHelpTable()
            continue
          }

          if (cmd === 'model') {
            if (arg) {
              selection.model = arg
              process.env.LLM_MODEL = arg
              updateEnvFile({ LLM_MODEL: arg })
              console.log(`\x1b[32m✔ Đã chuyển model sang: ${arg} (${selection.provider})\x1b[0m\n`)
            } else {
              console.log(`\nModel hiện tại: \x1b[1m${selection.model}\x1b[0m (Nhà cung cấp: \x1b[33m${selection.provider}\x1b[0m)\n`)
            }
            continue
          }

          if (cmd === 'config' || cmd === 'setup' || cmd === 'api') {
            const updated = await ensureApiConfig(rl, true)
            selection.provider = updated.provider
            selection.model = updated.model
            console.log(`\x1b[32m✔ Đã chuyển sang model: ${updated.model} (${updated.provider})\x1b[0m\n`)
            continue
          }

          if (cmd === 'mode' || cmd === 'permission') {
            await handlePermissionChange(rl, arg)
            continue
          }

          if (cmd === 'tools') {
            printToolsCatalog(ctx, agent)
            continue
          }

          if (cmd === 'skills' || cmd === 'skill') {
            printSkillsCatalog(ctx, agent)
            continue
          }

          if (cmd === 'stats' || cmd === 'tokens') {
            printSessionStats(agent, selection)
            continue
          }

          // Dispatch to ctx.commands (handles /plan, /plan off, /goal, /compact, /feedback, etc.)
          const commandsService = ctx.get('commands') as { execute?: (agent: unknown, line: string, attachments: unknown[], signal: AbortSignal) => Promise<{ value?: { kind?: string; text?: string } }> } | undefined
          if (commandsService && typeof commandsService.execute === 'function') {
            try {
              const execution = await commandsService.execute(agent, trimmed, [], new AbortController().signal)
              if (execution && execution.value) {
                if (execution.value.kind === 'success') {
                  console.log(`\x1b[32m✔ ${execution.value.text || 'Thực thi thành công.'}\x1b[0m\n`)
                } else if (execution.value.kind === 'error') {
                  console.log(`\x1b[31m✖ ${execution.value.text}\x1b[0m\n`)
                }
                await sessions.flush(agent.session)
                continue
              }
            } catch (cmdErr) {
              console.error(`\x1b[31m✖ Lỗi thực thi lệnh: ${String(cmdErr)}\x1b[0m\n`)
              continue
            }
          }

          console.log(`\x1b[33mKhông tìm thấy lệnh "${trimmed}". Gõ /help để xem danh sách lệnh hỗ trợ.\x1b[0m\n`)
          continue
        }

        // Regular prompt to agent
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: trimmed }],
          source: { kind: 'user' },
        }))

        await agent.whenIdle()
        await sessions.flush(agent.session)
      } catch (err) {
        if ((err as { code?: string })?.code === 'ERR_USE_AFTER_CLOSE') break
        console.error(`\x1b[31mError: ${String(err)}\x1b[0m`)
      }
    }

    rl.close()
    await shutdown.shutdown(0)
  }

  await promptLoop()
}
