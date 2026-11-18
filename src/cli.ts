#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { startPinwright, type Pinwright } from './index.js'
import { detectProject, hasClaude } from './detect.js'
import { ask, bold, dim, green, interactive, pink, red, select } from './prompt.js'
import { devCommand, openBrowser, startDevServer, waitReady, type DevServer } from './run.js'
import type { Note } from './store.js'

const HELP = `pinwright: give Claude feedback right on your dev site; agents fix the code.

Usage:
  pinwright                                          run the project's dev script and review it through pinwright
  pinwright -- <dev command>                         same, with your own command (e.g. -- bin/rails server)
  pinwright --target http://localhost:3000           review a site that is already running
  pinwright list [--all]                             notes in the running daemon
  pinwright take <id>                                take a note into this session (prints a prompt)
  pinwright done <id> [summary]                      close a note you handled by hand
  pinwright reply <id> <text>                        answer a question / follow up on a note

Options:
  --target <url>     site to proxy, instead of starting the dev script
  --port <n>         daemon port (default 4340, or the next free one)
  --no-open          don't open the browser
  -y, --yes          no questions: run the dev script straight away
  --mfe              microfrontend: the overlay rides in this remote's JavaScript, inside your shell
  --scope <css>      notes only inside matching elements, e.g. '[data-mfe="checkout"]'
  --shell <url>      with --mfe: the shell page to open, and the one Go live shares
  --public-url <url> Go live on a fixed tunnel you run to this port: none is opened
  --tunnel <name>    Go live through your named Cloudflare tunnel instead of a quick one
  --hostname <host>  with --tunnel: the hostname routed to it, e.g. review.example.com
  --root <dir>       project root (default: cwd)
  --rebuild <cmd>    command to run after edits (sites without HMR)
  --agents <n>       max parallel agents (default 3)
  --model <name>     worker model (default sonnet)
  --config <file>    config file (default pinwright.config.{mjs,js,json})
  --api-key          let ANTHROPIC_API_KEY through (default: use \`claude login\`)
`

// Everything after -- is the dev command to run.
const argv = process.argv.slice(2)
const dash = argv.indexOf('--')
const devArgs = dash >= 0 ? argv.slice(dash + 1) : []
const { values: v, positionals } = parseArgs({
  args: dash >= 0 ? argv.slice(0, dash) : argv,
  allowPositionals: true,
  allowNegative: true,
  options: {
    open: { type: 'boolean', default: true },
    yes: { type: 'boolean', short: 'y' },
    mfe: { type: 'boolean' },
    scope: { type: 'string' },
    shell: { type: 'string' },
    'public-url': { type: 'string' },
    tunnel: { type: 'string' },
    hostname: { type: 'string' },
    target: { type: 'string' },
    port: { type: 'string' },
    root: { type: 'string' },
    rebuild: { type: 'string' },
    agents: { type: 'string' },
    model: { type: 'string' },
    config: { type: 'string' },
    'api-key': { type: 'boolean' },
    all: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [cmd = 'start', ...rest] = positionals
const num = (s?: string) => (s === undefined ? undefined : Number(s))

async function main(): Promise<void> {
  if (v.help || cmd === 'help') return void process.stdout.write(HELP)
  if (cmd === 'start') return start()
  const cfg = await loadConfig({ root: v.root, port: num(v.port), config: v.config, log: () => {} })
  const base = `http://127.0.0.1:${cfg.port}/__pw`
  const call = async (path: string, init?: RequestInit) => {
    let r: Response
    try {
      r = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } })
    } catch {
      throw new Error(`pinwright is not running on port ${cfg.port}. Start it with \`pinwright --target …\` or your dev server.`)
    }
    const body = await r.json()
    if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText)
    return body
  }
  const post = (path: string, body: object = {}) => call(path, { method: 'POST', body: JSON.stringify(body) })
  const need = (what: string) => {
    if (!rest[0]) throw new Error(`usage: pinwright ${cmd} <id>${what}`)
    return rest[0]
  }

  switch (cmd) {
    case 'list': {
      const notes = (await call(`/notes${v.all ? '?all=1' : ''}`)) as Note[]
      if (!notes.length) return console.log('No notes.')
      for (const n of notes) console.log(`${n.id}  ${n.status.padEnd(8)}  ${n.page}  ${n.text.split('\n')[0].slice(0, 70)}`)
      return
    }
    case 'take': {
      const { prompt } = (await post(`/notes/${need('')}/take`)) as { prompt: string }
      return void process.stdout.write(`${prompt}\n`)
    }
    case 'done':
      await post(`/notes/${need(' [summary]')}/done`, { summary: rest.slice(1).join(' ') })
      return console.log('Done.')
    case 'reply':
      if (!rest[1]) throw new Error('usage: pinwright reply <id> <text>')
      await post(`/notes/${rest[0]}/reply`, { text: rest.slice(1).join(' ') })
      return console.log('Sent: the note is back in the queue.')
    default:
      throw new Error(`unknown command ${cmd}\n\n${HELP}`)
  }
}

async function start(): Promise<void> {
  // Standalone: the daemon owns the process, so nothing may take it down.
  process.on('uncaughtException', (e) => console.error('[pinwright] uncaught:', e))
  process.on('unhandledRejection', (e) => console.error('[pinwright] unhandled rejection:', e))
  const root = v.root ?? process.cwd()
  const fileCfg = await loadConfig({ root, config: v.config, log: () => {} })
  let devCmd: string[] | null = devArgs.length ? devArgs : null
  let siteArg = v.target
  let asked = false
  let mfe = v.mfe ?? fileCfg.mfe
  let scope = v.scope ?? fileCfg.scope
  let shell = v.shell
  // Bare `pinwright` in a terminal: ask what to do instead of guessing.
  if (!devCmd && !siteArg && !fileCfg.target && !v.yes && positionals.length === 0 && interactive()) {
    const plan = await wizard(root)
    asked = true
    if (plan.kind === 'done') return
    if (plan.kind === 'plain') return runPlain(plan.cmd, root)
    if (plan.kind === 'site') siteArg = plan.url
    else {
      devCmd = plan.cmd
      if (plan.mfe) {
        mfe = true
        scope = plan.mfe.scope || undefined
        shell = plan.mfe.shell
      }
    }
  }
  // No site given anywhere: run the project's own dev command and proxy whatever URL it prints.
  const run = !siteArg && !fileCfg.target
  const dev: DevServer | null = run ? startDevServer(devCmd ?? devCommand(root), root) : null

  let pw: Pinwright | null = null
  let quitting = false
  const quit = (code = 0) => {
    if (quitting) process.exit(1)
    quitting = true
    console.log('\n[pinwright] stopping…')
    dev?.stop()
    void (pw?.stop() ?? Promise.resolve()).finally(() => process.exit(code))
  }
  process.on('SIGINT', () => quit())
  process.on('SIGTERM', () => quit())
  dev?.child.on('exit', () => quit())

  const opts = {
    mode: 'cli' as const,
    root,
    target: siteArg,
    mfe,
    scope,
    shell: shell || undefined,
    publicUrl: v['public-url'],
    tunnel: v.tunnel,
    hostname: v.hostname,
    rebuild: v.rebuild,
    maxAgents: num(v.agents),
    models: v.model ? { worker: v.model } : undefined,
    config: v.config,
    useApiKey: v['api-key'] || undefined,
  }
  pw = await startOnFreePort(opts, num(v.port) ?? fileCfg.port, v.port !== undefined)

  let target = pw.config.target
  if (dev) {
    try {
      target = await dev.url
    } catch (e) {
      console.error(`pinwright: ${(e as Error).message}`)
      return quit(1)
    }
    pw.config.target = target
    pw.setSiteUrl(target)
    await waitReady(target)
  }
  const local = pw.url.replace('127.0.0.1', 'localhost')
  if (mfe) {
    console.log(`\n[pinwright] microfrontend ${target} → load it from ${local} in your shell (instead of ${target})`)
    console.log(`[pinwright] then open the shell${shell ? ` (${shell})` : ''}: the overlay comes with this remote${scope ? `, notes only inside ${scope}` : ''}\n`)
    if (shell && v.open) openBrowser(shell)
    return
  }
  console.log(`\n[pinwright] reviewing ${target} → open ${local}/  (⌥ + click to leave a note)\n`)
  if ((dev || asked) && v.open) openBrowser(`${local}/`)
}

type Plan = { kind: 'run'; cmd: string[]; mfe?: { scope: string; shell: string } } | { kind: 'site'; url: string } | { kind: 'plain'; cmd: string[] } | { kind: 'done' }

const SETUP_URL = 'https://raw.githubusercontent.com/andreamazzatxt/pinwright/main/SETUP.md'

/** The interactive start: what kind of project this is, and how the user wants pinwright in it. */
async function wizard(root: string): Promise<Plan> {
  const project = detectProject(root)
  const claude = hasClaude()
  const dev = project.dev?.join(' ')
  const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  console.log(`\n  ${pink(bold('pinwright'))} ${dim(version + ' · give Claude feedback right on your dev site')}\n`)
  console.log(`  ${dim('Project')}  ${bold(project.name)}${project.mfe ? dim(' · Module Federation') : ''}${dev ? dim(' · ' + dev) : ''}${project.installed ? green('  · pinwright already set up') : ''}`)
  console.log(`  ${dim('Claude ')}  ${claude ? green('✓ Claude Code found') : red('✗ Claude Code not found') + dim(': install it and run `claude login`, the agents need it')}\n`)

  type Pick = 'plain' | 'run' | 'install' | 'site' | 'mfe'
  const choices: { label: string; hint?: string; value: Pick }[] = []
  if (project.installed && project.dev) choices.push({ label: 'Start the dev server', hint: `pinwright is in the project already (${dev})`, value: 'plain' })
  if (project.mfe) choices.push({ label: 'Review it inside its shell', hint: 'the overlay rides in this microfrontend, nothing installed', value: 'mfe' })
  choices.push({ label: 'Run it now', hint: project.mfe ? 'on its own dev server, nothing installed' : 'nothing is installed in the project', value: 'run' })
  if (project.js && !project.installed && claude)
    choices.push({ label: 'Add it to the project', hint: project.pluggable ? `Claude Code installs and wires the ${project.name} plugin` : 'Claude Code makes your dev script start through pinwright', value: 'install' })
  choices.push({ label: 'Review a site that is already running', hint: 'you give its URL', value: 'site' })
  const pick = await select('How do you want to start?', choices)

  if (pick === 'plain') return { kind: 'plain', cmd: project.dev! }
  if (pick === 'site') return { kind: 'site', url: await ask('Site URL', 'http://localhost:3000') }
  if (pick === 'mfe') {
    let cmd = ''
    while (!cmd) cmd = await ask('Dev command of this microfrontend', dev ?? '')
    const scope = await ask('Notes only inside (CSS selector of its mount point, empty for the whole page)', '')
    const shell = await ask('Shell URL', 'http://localhost:3000')
    return { kind: 'run', cmd: cmd.split(/\s+/), mfe: { scope, shell } }
  }
  if (pick === 'run') {
    let cmd = ''
    while (!cmd) cmd = await ask('Dev command', dev ?? '')
    return { kind: 'run', cmd: cmd.split(/\s+/) }
  }
  console.log(dim(`\n  Starting Claude Code. It follows ${SETUP_URL}\n`))
  await new Promise<void>((ok) => {
    const c = spawn('claude', [`Set up pinwright in this project: follow ${SETUP_URL}. I already chose "Add it to the project" (section 4c), don't ask again.`], { cwd: root, stdio: 'inherit' })
    c.on('exit', () => ok())
    c.on('error', (e) => {
      console.error(red(`could not start claude: ${e.message}`))
      ok()
    })
  })
  console.log(`\n  ${pink('pinwright')} ${dim('From now on just start your dev server' + (dev ? `: ${dev}` : '') + '.')}\n`)
  return { kind: 'done' }
}

/** pinwright is already in the project: its plugin starts with the dev server, so just run that. */
function runPlain(cmd: string[], root: string): void {
  const c = spawn(cmd[0], cmd.slice(1), { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  c.on('exit', (code) => process.exit(code ?? 0))
  process.on('SIGINT', () => {})
}

/** Starts the daemon, moving to the next ports when the default one is taken (an explicit --port is kept). */
async function startOnFreePort(opts: Parameters<typeof startPinwright>[0], port: number, fixed: boolean): Promise<Pinwright> {
  for (let i = 0; ; i++) {
    try {
      return await startPinwright({ ...opts, port: port + i })
    } catch (e) {
      if (fixed || i >= 20 || !/is busy/.test((e as Error).message)) throw e
    }
  }
}

main().catch((e: Error) => {
  console.error(`pinwright: ${e.message}`)
  process.exit(1)
})
