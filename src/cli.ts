#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { startPinwright } from './index.js'
import type { Note } from './store.js'

const HELP = `pinwright: give Claude feedback right on your dev site; agents fix the code.

Usage:
  pinwright [start] --target http://localhost:4330   proxy the site and run the daemon
  pinwright list [--all]                             notes in the running daemon
  pinwright take <id>                                take a note into this session (prints a prompt)
  pinwright done <id> [summary]                      close a note you handled by hand
  pinwright reply <id> <text>                        answer a question / follow up on a note

Options:
  --target <url>     site to proxy (proxy mode)
  --port <n>         daemon port (default 4340)
  --root <dir>       project root (default: cwd)
  --rebuild <cmd>    command to run after edits (proxy mode, no HMR)
  --agents <n>       max parallel agents (default 3)
  --model <name>     worker model (default sonnet)
  --config <file>    config file (default pinwright.config.{mjs,js,json})
  --api-key          let ANTHROPIC_API_KEY through (default: use \`claude login\`)
`

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
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
  const pw = await startPinwright({
    mode: 'cli',
    root: v.root,
    target: v.target,
    port: num(v.port),
    rebuild: v.rebuild,
    maxAgents: num(v.agents),
    models: v.model ? { worker: v.model } : undefined,
    config: v.config,
    useApiKey: v['api-key'] || undefined,
  })
  if (pw.config.target) console.log(`[pinwright] open ${pw.url}/ to review`)
  else console.log(`[pinwright] no target: add <script src="${pw.scriptUrl}" defer></script> to your pages, or use pinwright/vite or pinwright/astro`)
  let quitting = false
  const quit = () => {
    if (quitting) process.exit(1)
    quitting = true
    console.log('\n[pinwright] stopping…')
    pw.stop().finally(() => process.exit(0))
  }
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
}

main().catch((e: Error) => {
  console.error(`pinwright: ${e.message}`)
  process.exit(1)
})
