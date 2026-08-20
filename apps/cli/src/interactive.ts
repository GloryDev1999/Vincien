/**
 * Interactive REPL for Vincien CLI.
 *
 * Provides a rich terminal chat interface with Bear branding, interactive
 * API key setup wizard for plugging in any LLM API, real-time tool execution
 * display, and multi-turn conversation.
 *
 * @module @deepseek-ai/dsh/interactive
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { runProfile } from './profile-boot.ts'

export interface InteractiveOptions {
  environment: LaunchEnvironmentSnapshot
  patchFiles: readonly string[]
  args: readonly string[]
}

const BEAR_BANNER = `
\x1b[36m
  __      ___            _
  \\ \\    / (_)          (_)
   \\ \\  / / _ _ __   ___ _  ___ _ __
    \\ \\/ / | | '_ \\ / __| |/ _ \\ '_ \\
     \\  /  | | | | | (__| |  __/ | | |
      \\/   |_|_| |_|\\___|_|\\___|_| |_|
\x1b[0m\x1b[1m            [ 🐻 Bear AI Assistant ]\x1b[0m
`

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

  console.log('\x1b[33m\n[Vincien Setup] Cấu hình API Model.\x1b[0m')
  console.log('Vui lòng chọn nhà cung cấp AI để cắm (plug-in) vào Vincien:\n')
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

  // Save to .env
  try {
    const envPath = resolve(process.cwd(), '.env')
    const envLines = [
      '# Vincien API Configuration',
      `${keyEnvName}=${apiKey || 'dummy-key'}`,
      `LLM_PROVIDER=${provider}`,
      `LLM_MODEL=${model}`,
      baseUrl ? `CUSTOM_BASE_URL=${baseUrl}` : '',
    ].filter(Boolean).join('\n') + '\n'

    writeFileSync(envPath, envLines)
    console.log(`\x1b[32m✔ Đã lưu cấu hình API mới vào ${envPath}\x1b[0m\n`)
  } catch {
    console.log('\x1b[33m✔ Đã thiết lập cấu hình trong phiên làm việc hiện tại.\x1b[0m\n')
  }

  return { provider, model }
}

/**
 * Dynamic bouncing loading bar animation for terminal while waiting for LLM or tool results.
 */
class LoadingAnimation {
  private timer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private direction = 1
  private text: string
  private active = false
  private readonly barWidth = 14
  private readonly blockWidth = 4

  constructor(text = 'Vincien đang suy nghĩ...') {
    this.text = text
  }

  start(text?: string): void {
    if (text) this.text = text
    if (this.active) return
    this.active = true
    this.frameIndex = 0
    this.direction = 1

    const maxPos = this.barWidth - this.blockWidth

    this.timer = setInterval(() => {
      if (!this.active) return

      let bar = ''
      for (let i = 0; i < this.barWidth; i++) {
        if (i >= this.frameIndex && i < this.frameIndex + this.blockWidth) {
          bar += '━'
        } else {
          bar += '╌'
        }
      }

      process.stdout.write(`\r\x1b[K\x1b[36m[${bar}]\x1b[0m \x1b[33m🐾 ${this.text}\x1b[0m`)

      this.frameIndex += this.direction
      if (this.frameIndex >= maxPos) {
        this.direction = -1
        this.frameIndex = maxPos
      } else if (this.frameIndex <= 0) {
        this.direction = 1
        this.frameIndex = 0
      }
    }, 60)
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    process.stdout.write('\r\x1b[K')
  }
}

function printHeaderBox(provider: string, model: string): void {
  console.log(BEAR_BANNER)
  const title = `🐾 Vincien AI Assistant  •  Model: ${model} (${provider})`
  const shortcuts = 'Phím tắt: /help  •  /config (đổi API)  •  /model  •  /clear  •  /exit'
  const width = Math.max(title.length, shortcuts.length) + 6
  const top = '╭' + '─'.repeat(width) + '╮'
  const bot = '╰' + '─'.repeat(width) + '╯'

  console.log(`\x1b[36m${top}\x1b[0m`)
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[37m${title.padEnd(width - 2)}\x1b[0m\x1b[36m│\x1b[0m`)
  console.log(`\x1b[36m│\x1b[0m  \x1b[90m${shortcuts.padEnd(width - 2)}\x1b[0m\x1b[36m│\x1b[0m`)
  console.log(`\x1b[36m${bot}\x1b[0m\n`)
}

/**
 * Launch the interactive Vincien REPL.
 */
export async function runInteractive(options: InteractiveOptions): Promise<void> {
  const rl = createInterface({ input, output })

  let currentConfig: { provider: string; model: string }
  try {
    currentConfig = await ensureApiConfig(rl)
  } catch (error) {
    rl.close()
    console.error(`\x1b[31mVincien setup error: ${String(error)}\x1b[0m`)
    process.exit(1)
  }

  printHeaderBox(currentConfig.provider, currentConfig.model)

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
    console.error('\x1b[31mVincien: Failed to initialize agents and sessions.\x1b[0m')
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

  const loading = new LoadingAnimation()
  let hasPrintedAssistantPrefix = false
  let isReasoning = false

  // Subscribe to session events for real-time streaming tool & response reporting
  ctx.on('session/event', (_session, event: SessionEvent) => {
    if (event.type === 'turn/start') {
      hasPrintedAssistantPrefix = false
      isReasoning = false
      loading.start('Vincien đang suy nghĩ...')
    } else if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'reasoning-delta') {
        loading.stop()
        if (!isReasoning) {
          isReasoning = true
          process.stdout.write('\x1b[90m')
        }
        process.stdout.write(chunk.text)
      } else if (chunk.type === 'text-delta') {
        loading.stop()
        if (isReasoning) {
          isReasoning = false
          process.stdout.write('\x1b[0m\n')
        }
        if (!hasPrintedAssistantPrefix) {
          hasPrintedAssistantPrefix = true
          process.stdout.write('\n\x1b[36m╭─── [ 🐾 Vincien ] ────────────────────────────────────────────────────────\x1b[0m\n')
        }
        process.stdout.write(chunk.text)
      }
    } else if (event.type === 'tool/call') {
      loading.stop()
      if (isReasoning) {
        isReasoning = false
        process.stdout.write('\x1b[0m\n')
      }
      const argsStr = event.data.arguments
      const preview = argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr
      process.stdout.write(`\n\x1b[33m⚙ [Tool: ${event.data.name}]\x1b[0m \x1b[90m${preview}\x1b[0m\n`)
      loading.start(`Đang thực thi: ${event.data.name}...`)
    } else if (event.type === 'tool/result') {
      loading.stop()
      const innerBlocks = event.data.message.content.flatMap(tr => tr.content)
      const textBlocks = innerBlocks
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('')
      const preview = textBlocks.length > 150 ? textBlocks.slice(0, 150) + '...' : textBlocks
      process.stdout.write(`\x1b[32m✔ [Result]\x1b[0m \x1b[90m${preview.trim()}\x1b[0m\n`)
      loading.start('Vincien đang xử lý kết quả...')
    } else if (event.type === 'turn/end') {
      loading.stop()
      if (isReasoning) {
        isReasoning = false
        process.stdout.write('\x1b[0m\n')
      }
      if (hasPrintedAssistantPrefix) {
        process.stdout.write('\n\x1b[36m╰───────────────────────────────────────────────────────────────────────────\x1b[0m\n')
      }
      if (event.data.reason?.kind === 'error') {
        process.stdout.write(`\n\x1b[31m[Lỗi: ${event.data.reason.error.code}] ${event.data.reason.error.message}\x1b[0m\n`)
      }
    }
  })

  const promptLoop = async (): Promise<void> => {
    while (true) {
      try {
        console.log('\n\x1b[90m╭─── [ 👤 Bạn ] ───────────────────────────────────────────────────────────\x1b[0m')
        const userInput = await rl.question('\x1b[90m│ > \x1b[0m\x1b[1m\x1b[37m')
        process.stdout.write('\x1b[0m\x1b[90m╰───────────────────────────────────────────────────────────────────────────\x1b[0m\n')
        const trimmed = userInput.trim()

        if (!trimmed) continue

        if (trimmed === '/exit' || trimmed === '/quit' || trimmed === 'exit' || trimmed === 'quit') {
          console.log('\x1b[36m🐾 Tạm biệt! Hẹn gặp lại.\x1b[0m')
          break
        }

        if (trimmed === '/clear') {
          console.clear()
          printHeaderBox(selection.provider, selection.model)
          continue
        }

        if (trimmed === '/help') {
          console.log('\n\x1b[1mDanh sách lệnh Vincien CLI:\x1b[0m')
          console.log('  /help    - Hiển thị trợ giúp')
          console.log('  /model   - Xem thông tin model đang dùng')
          console.log('  /config  - Thay đổi API Key, Model, hoặc Nhà cung cấp AI')
          console.log('  /clear   - Xoá màn hình terminal')
          console.log('  /exit    - Thoát phiên làm việc\n')
          continue
        }

        if (trimmed === '/config' || trimmed === '/api' || trimmed === '/setup') {
          const updated = await ensureApiConfig(rl, true)
          selection.provider = updated.provider
          selection.model = updated.model
          console.log(`\x1b[32m✔ Đã chuyển sang model: ${updated.model} (${updated.provider})\x1b[0m\n`)
          continue
        }

        if (trimmed === '/model') {
          console.log(`\nModel hiện tại: \x1b[1m${selection.model}\x1b[0m (Nhà cung cấp: \x1b[33m${selection.provider}\x1b[0m)\n`)
          continue
        }

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
