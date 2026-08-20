/**
 * Commander adapter for the `vincien` command line.
 *
 * @module @deepseek-ai/dsh/args
 */

import { Command, CommanderError } from 'commander'

/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/** Boot interactive REPL mode. */
interface InteractiveInvocation {
  mode: 'interactive'
  patches: string[]
  args: string[]
}

/** The resolved `vincien` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation | InteractiveInvocation

/** Launcher flags shared by the default command and the `web` alias. */
interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
  apiKey?: string
  model?: string
  provider?: string
  baseUrl?: string
  interactive?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The launcher's own help text; each app prints its own. */
const HELP_EXAMPLES = `
Examples:
  vincien "run the tests and explain failures"    answer one task, print the result, and exit
  vincien                                         start interactive terminal REPL chat
  vincien -i                                      start interactive terminal REPL chat
  vincien --model gpt-4o "refactor this function" run task with specified model
  vincien web                                     boot web UI (alias of --profile web)
  vincien plugin --profile standard add <pkg>     install a plugin
`

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  const program: Command = new Command()
  program
    .name('vincien')
    .version(version, '-V, --version', 'output the version number')
    .description('vincien: AI agent harness — multi-provider, tool-capable agent CLI.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. `vincien -h` with no profile still prints this help, below.
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'task text or arguments for the agent')
    .option('-i, --interactive', 'start interactive terminal REPL chat session')
    .option('--api-key <key>', 'LLM API key (or set in .env / env vars)')
    .option('--model <model>', 'model name (e.g. gpt-4o, claude-3-7-sonnet, deepseek-chat)')
    .option('--provider <provider>', 'provider name (openai, anthropic, deepseek, custom)')
    .option('--base-url <url>', 'custom API base URL')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      if (options.apiKey) {
        if (options.provider === 'anthropic') process.env.ANTHROPIC_API_KEY = options.apiKey
        else if (options.provider === 'deepseek') process.env.DEEPSEEK_API_KEY = options.apiKey
        else if (options.provider === 'custom') process.env.CUSTOM_API_KEY = options.apiKey
        else process.env.OPENAI_API_KEY = options.apiKey
        process.env.LLM_API_KEY = options.apiKey
      }
      if (options.model) process.env.LLM_MODEL = options.model
      if (options.provider) process.env.LLM_PROVIDER = options.provider
      if (options.baseUrl) process.env.CUSTOM_BASE_URL = options.baseUrl

      if (args.some(argument => argument === '-h' || argument === '--help')) {
        program.help()
      }

      if (options.profile !== undefined) {
        const profile = options.profile
        if (profile === '') program.error('error: --profile needs a name')
        resolved = resolveBoot(program, profile, options, args)
        return
      }

      if (options.interactive || args.length === 0) {
        resolved = { mode: 'interactive', patches: options.patch ?? [], args }
        return
      }

      resolved = resolveBoot(program, 'headless', options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: vincien web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('vincien: no invocation resolved')
  return resolved
}
