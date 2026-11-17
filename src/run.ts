import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Stealth mode: `npx pinwright` runs the project's own dev command, reads the URL it prints, and pinwright
 * proxies it. Nothing is installed in the project and no file of its changes (state lives in `.pinwright/`,
 * which ignores itself).
 */

const SCRIPTS = ['dev', 'start', 'serve']

/** The project's dev command: `<package manager> run dev` (or start, serve). */
export function devCommand(root: string): string[] {
  const pkgFile = join(root, 'package.json')
  if (!existsSync(pkgFile)) throw new Error(`no package.json in ${root}. Pass the dev command after --, e.g. \`npx pinwright -- bin/rails server\`, or a running site with --target.`)
  const scripts = (JSON.parse(readFileSync(pkgFile, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
  const script = SCRIPTS.find((s) => scripts[s])
  if (!script) throw new Error(`package.json has no ${SCRIPTS.join('/')} script. Pass the dev command after --, e.g. \`npx pinwright -- vite\`.`)
  return [packageManager(root), 'run', script]
}

function packageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+/

export interface DevServer {
  child: ChildProcess
  /** The first local URL the command prints. */
  url: Promise<string>
  stop(): void
}

/** Starts the dev command with its output passed through, and watches the output for the site's URL. */
export function startDevServer(cmd: string[], root: string, timeoutMs = 180_000): DevServer {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
    // The site is reviewed through pinwright's port: the dev server must not open its own tab.
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  })
  const url = new Promise<string>((ok, fail) => {
    let seen = ''
    let found = false
    const timer = setTimeout(() => fail(new Error(`\`${cmd.join(' ')}\` printed no local URL in ${timeoutMs / 1000}s. Pass the site with --target.`)), timeoutMs)
    const watch = (out: NodeJS.WriteStream) => (chunk: Buffer) => {
      out.write(chunk)
      if (found) return
      seen = (seen + chunk.toString('utf8')).slice(-4000)
      const m = seen.replace(ANSI, '').match(LOCAL_URL)
      if (m) {
        found = true
        clearTimeout(timer)
        ok(m[0].replace('0.0.0.0', 'localhost'))
      }
    }
    child.stdout!.on('data', watch(process.stdout))
    child.stderr!.on('data', watch(process.stderr))
    child.on('error', (e) => fail(new Error(`could not run \`${cmd.join(' ')}\`: ${e.message}`)))
    child.on('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`\`${cmd.join(' ')}\` exited (code ${code}) before printing its URL.`))
    })
  })
  url.catch(() => {})
  return {
    child,
    url,
    stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      try {
        // The whole group: package managers start the real server as a grandchild.
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGINT')
        else child.kill('SIGINT')
      } catch {}
    },
  }
}

/** Opens a URL in the default browser. */
export function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {}
}

/** Waits until the site answers with something other than "starting up" (Nuxt answers 503 while it warms up). */
export async function waitReady(url: string, timeoutMs = 90_000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      await r.body?.cancel()
      if (r.status !== 503) return
    } catch {}
    await new Promise((ok) => setTimeout(ok, 500))
  }
}
