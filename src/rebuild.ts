import { spawn } from 'node:child_process'
import type { Bus } from './bus.js'
import type { Config } from './config.js'

export interface RebuildResult {
  ok: boolean
  output: string
  skipped?: boolean
}

/** Runs a shell command in root; resolves with the exit status and the tail of its output. */
export function sh(cmd: string, cwd: string, timeoutMs = 10 * 60_000): Promise<RebuildResult> {
  return new Promise((done) => {
    const p = spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const add = (b: Buffer) => {
      out = (out + b.toString()).slice(-8000)
    }
    p.stdout.on('data', add)
    p.stderr.on('data', add)
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs)
    p.on('error', (e) => {
      clearTimeout(timer)
      done({ ok: false, output: String(e) })
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      done({ ok: code === 0, output: out.slice(-4000) })
    })
  })
}

/**
 * The configured rebuild, serialized and coalesced: while one runs, every new request
 * shares a single follow-up run, which picks up all the edits made in the meantime.
 */
export class Rebuilder {
  private running: Promise<RebuildResult> | null = null
  private next: Promise<RebuildResult> | null = null

  constructor(
    private cfg: Config,
    private bus: Bus,
  ) {}

  get enabled(): boolean {
    return Boolean(this.cfg.rebuild)
  }

  request(): Promise<RebuildResult> {
    if (!this.cfg.rebuild) return Promise.resolve({ ok: true, output: 'No rebuild configured: the dev server reloads on its own (HMR).', skipped: true })
    if (!this.running) return (this.running = this.run())
    if (!this.next) {
      this.next = this.running.then(() => {
        this.next = null
        return (this.running = this.run())
      })
    }
    return this.next
  }

  private async run(): Promise<RebuildResult> {
    const t = Date.now()
    this.cfg.log(`rebuild: ${this.cfg.rebuild}`)
    try {
      const r = await sh(this.cfg.rebuild!, this.cfg.root)
      this.cfg.log(`rebuild ${r.ok ? 'ok' : 'FAILED'} in ${((Date.now() - t) / 1000).toFixed(1)}s`)
      if (r.ok) this.bus.emit('reload')
      return r
    } finally {
      if (!this.next) this.running = null
    }
  }
}
