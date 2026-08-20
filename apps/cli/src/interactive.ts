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
import { appendFileSync } from 'node:fs'
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
 * Run interactive API setup wizard if no API is plugged in.
 */
async function ensureApiConfig(rl: ReturnType<typeof createInterface>): Promise<{ provider: string; model: string }> {
  const active = getActiveConfig()
  if (active.hasKey && active.provider && active.model) {
    return { provider: active.provider, model: active.model }
  }

  console.log('\x1b[33m\n[Vincien Setup] Chưa phát hiện cấu hình API Model.\x1b[0m')
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
      '\n# Vincien API Configuration',
      `${keyEnvName}=${apiKey || 'dummy-key'}`,
      `LLM_PROVIDER=${provider}`,
      `LLM_MODEL=${model}`,
      baseUrl ? `CUSTOM_BASE_URL=${baseUrl}` : '',
    ].filter(Boolean).join('\n') + '\n'

    appendFileSync(envPath, envLines)
    console.log(`\x1b[32m✔ Đã lưu cấu hình API vào ${envPath}\x1b[0m\n`)
  } catch {
    console.log('\x1b[33m✔ Đã thiết lập cấu hình trong phiên làm việc hiện tại.\x1b[0m\n')
  }

  return { provider, model }
}

/**
 * Launch the interactive Vincien REPL.
 */
export async function runInteractive(options: InteractiveOptions): Promise<void> {
  console.log(BEAR_BANNER)
  const rl = createInterface({ input, output })

  let currentConfig: { provider: string; model: string }
  try {
    currentConfig = await ensureApiConfig(rl)
  } catch (error) {
    rl.close()
    console.error(`\x1b[31mVincien setup error: ${String(error)}\x1b[0m`)
    process.exit(1)
  }

  console.log(`\x1b[36mModel đang hoạt động:\x1b[0m \x1b[1m${currentConfig.model}\x1b[0m (\x1b[33m${currentConfig.provider}\x1b[0m)`)
  console.log('\x1b[90mGõ câu hỏi / yêu cầu để bắt đầu. Gõ /help để xem trợ giúp, /exit để thoát.\x1b[0m\n')

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

  let hasPrintedAssistantPrefix = false
  let isReasoning = false

  // Subscribe to session events for real-time streaming tool & response reporting
  ctx.on('session/event', (_session, event: SessionEvent) => {
    if (event.type === 'turn/start') {
      hasPrintedAssistantPrefix = false
      isReasoning = false
      process.stdout.write('\x1b[36m[Vincien suy nghĩ...]\x1b[0m\n')
    } else if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'reasoning-delta') {
        if (!isReasoning) {
          isReasoning = true
          process.stdout.write('\x1b[90m')
        }
        process.stdout.write(chunk.text)
      } else if (chunk.type === 'text-delta') {
        if (isReasoning) {
          isReasoning = false
          process.stdout.write('\x1b[0m\n')
        }
        if (!hasPrintedAssistantPrefix) {
          hasPrintedAssistantPrefix = true
          process.stdout.write('\n\x1b[1m\x1b[36mVincien:\x1b[0m\n')
        }
        process.stdout.write(chunk.text)
      }
    } else if (event.type === 'tool/call') {
      if (isReasoning) {
        isReasoning = false
        process.stdout.write('\x1b[0m\n')
      }
      const argsStr = event.data.arguments
      const preview = argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr
      process.stdout.write(`\n\x1b[33m⚙ [Tool: ${event.data.name}]\x1b[0m ${preview}\n`)
    } else if (event.type === 'tool/result') {
      const innerBlocks = event.data.message.content.flatMap(tr => tr.content)
      const textBlocks = innerBlocks
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('')
      const preview = textBlocks.length > 150 ? textBlocks.slice(0, 150) + '...' : textBlocks
      process.stdout.write(`\x1b[32m✔ [Result]\x1b[0m ${preview.trim()}\n`)
    } else if (event.type === 'turn/end') {
      if (isReasoning) {
        isReasoning = false
        process.stdout.write('\x1b[0m\n')
      }
      process.stdout.write('\n\n')
      if (event.data.reason?.kind === 'error') {
        process.stdout.write(`\x1b[31m[Lỗi: ${event.data.reason.error.code}] ${event.data.reason.error.message}\x1b[0m\n\n`)
      }
    }
  })

  const promptLoop = async (): Promise<void> => {
    while (true) {
      try {
        const userInput = await rl.question('\x1b[1m\x1b[35mvincien>\x1b[0m ')
        const trimmed = userInput.trim()

        if (!trimmed) continue

        if (trimmed === '/exit' || trimmed === '/quit' || trimmed === 'exit' || trimmed === 'quit') {
          console.log('\x1b[36m🐾 Tạm biệt! Hẹn gặp lại.\x1b[0m')
          break
        }

        if (trimmed === '/clear') {
          console.clear()
          console.log(BEAR_BANNER)
          continue
        }

        if (trimmed === '/help') {
          console.log('\n\x1b[1mDanh sách lệnh Vincien CLI:\x1b[0m')
          console.log('  /help    - Hiển thị trợ giúp')
          console.log('  /model   - Xem thông tin model đang dùng')
          console.log('  /clear   - Xoá màn hình terminal')
          console.log('  /exit    - Thoát phiên làm việc\n')
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
