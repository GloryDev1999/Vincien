/**
 * Terminal Animation Engine for Ghostic CLI.
 *
 * Provides Ghostty logo animation, rich streaming spinners sourced from
 * terminal-animations-2.0.2, and clean full-width header rendering.
 *
 * @module @deepseek-ai/dsh/animations
 */

import { basename } from 'node:path'
import { GHOST_FRAMES } from './ghost-frames.ts'

/** Sleep helper for animation pacing. */
export const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms))

/** Adaptive terminal width bounded between 40 and 200 cols. */
export function getTerminalWidth(): number {
  return Math.max(40, (process.stdout.columns || 80) - 2)
}

/** Rich animation spinners sourced from terminal-animations-2.0.2. */
export const SPINNERS = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  braille: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  wave: ['𓃉𓃉𓃉', '𓃉𓃉∘', '𓃉∘°', '∘°∘', '°∘𓃉', '∘𓃉𓃉'],
  modern: ['●    ', ' ●   ', '  ●  ', '   ● ', '    ●', '   ● ', '  ●  ', ' ●   '],
  pulse: ['🔹', '🔷', '🔵', '🔵', '🔷'],
  bar: ['[━╌╌╌]', '[╌━╌╌]', '[╌╌━╌]', '[╌╌╌━]', '[╌╌━╌]', '[╌━╌╌]'],
} as const

export type SpinnerStyle = keyof typeof SPINNERS

/**
 * Dynamic streaming & loading animation engine.
 */
export class StreamAnimationEngine {
  private timer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private text: string
  private active = false
  private style: SpinnerStyle = 'dots'

  constructor(text = 'Ghostic đang suy nghĩ...', style: SpinnerStyle = 'dots') {
    this.text = text
    this.style = style
  }

  start(text?: string, style?: SpinnerStyle): void {
    if (text) this.text = text
    if (style) this.style = style
    if (this.active) return
    this.active = true
    this.frameIndex = 0

    const frames = SPINNERS[this.style] || SPINNERS.dots

    this.timer = setInterval(() => {
      if (!this.active) return
      const frame = frames[this.frameIndex % frames.length] || '⠋'
      process.stdout.write(`\r\x1b[K\x1b[35m${frame}\x1b[0m \x1b[36m👻 ${this.text}\x1b[0m`)
      this.frameIndex++
    }, 70)
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

/** Ghostic compact ASCII art logo. */
export const GHOSTIC_LOGO = [
  '     .---.      ',
  '    /     \\     ',
  '   | () () |    ',
  '    \\  -  /     ',
  '     |||||      ',
]

/**
 * Play startup Ghostty logo intro animation.
 */
export async function playGhostIntroAnimation(): Promise<void> {
  const rows = process.stdout.rows || 24
  const cols = process.stdout.columns || 80

  // If terminal has enough room, play full Ghostty frames
  if (rows >= 28 && cols >= 72 && GHOST_FRAMES.length > 0) {
    process.stdout.write('\x1b[?25l') // hide cursor
    console.clear()
    for (let i = 0; i < GHOST_FRAMES.length; i++) {
      const frame = GHOST_FRAMES[i]
      if (frame) {
        process.stdout.write('\x1b[H') // home
        process.stdout.write(frame)
        await sleep(55)
      }
    }
    process.stdout.write('\x1b[?25h') // show cursor
    process.stdout.write('\n')
  } else {
    // Compact ghost wobble animation for standard/smaller terminals
    console.clear()
    const ghostWobbles = [
      ["   .-''''-.   ", '  /  () () \\  ', ' |    __    | ', "  \\  '--'  /  ", "   '--||--'   "],
      ["   .-''''-.   ", '  /  (^)(^) \\ ', ' |    --    | ', "  \\  '--'  /  ", "   '--||--'   "],
      ["   .-''''-.   ", '  /  (•)(•) \\ ', ' |    __    | ', "  \\  '--'  /  ", "   '--||--'   "],
      ["   .-''''-.   ", '  /  () () \\  ', ' |    --    | ', "  \\  '--'  /  ", "   '--||--'   "],
    ]

    for (let cycle = 0; cycle < 3; cycle++) {
      for (const ghost of ghostWobbles) {
        process.stdout.write('\x1b[H')
        for (const line of ghost) {
          process.stdout.write(`\x1b[35m${line}\x1b[0m\n`)
        }
        await sleep(80)
      }
    }
    process.stdout.write('\n')
  }
}

/**
 * Print rich full-width Ghostic header box with Model, Version, and Workspace info.
 */
export function printGhosticHeader(provider: string, model: string, version: string, cwd: string): void {
  const width = getTerminalWidth()
  const dirName = basename(cwd) || cwd

  const line1 = `👻 G H O S T I C   A I  •  v${version}`
  const line2 = `Model:     ${model} (${provider})`
  const line3 = `Workspace: ${cwd} (${dirName})`
  const line4 = 'Phím tắt:  /help  •  /config  •  /model  •  /clear  •  /exit'

  const divider = '─'.repeat(width)

  console.log(`\x1b[35m${divider}\x1b[0m`)
  console.log(`\x1b[1m\x1b[37m${line1}\x1b[0m`)
  console.log(`\x1b[90m${divider}\x1b[0m`)
  console.log(`\x1b[36m${line2}\x1b[0m`)
  console.log(`\x1b[33m${line3}\x1b[0m`)
  console.log(`\x1b[90m${line4}\x1b[0m`)
  console.log(`\x1b[35m${divider}\x1b[0m\n`)
}
