import { execFile } from 'node:child_process'
import { accessSync, chmodSync, constants, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download'
/** Cloudflare's Apple developer team: macOS builds must be signed by it. */
const CLOUDFLARE_TEAM = '68WVV388M8'

/** The release asset for this machine, and whether it comes as a .tgz (macOS) or as the bare binary. */
function asset(): { name: string; tgz: boolean } {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null
  if (!arch) throw new Error(`no cloudflared build for ${process.arch}: install it yourself`)
  if (process.platform === 'darwin') return { name: `cloudflared-darwin-${arch}.tgz`, tgz: true }
  if (process.platform === 'linux') return { name: `cloudflared-linux-${arch}`, tgz: false }
  if (process.platform === 'win32' && arch === 'amd64') return { name: 'cloudflared-windows-amd64.exe', tgz: false }
  throw new Error(`no cloudflared build for ${process.platform}-${process.arch}: install it yourself`)
}

const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'

function onPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, exe)
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {}
  }
  return null
}

export const defaultCacheDir = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'pinwright')

let pending: Promise<string> | null = null

/**
 * Finds cloudflared: the configured path, then the PATH, then our cache. If none, downloads the official
 * build from Cloudflare's GitHub releases into the cache, once per machine.
 */
export function resolveCloudflared(opts: { configured?: string; cacheDir?: string; log: (m: string) => void }): Promise<string> {
  if (opts.configured) return Promise.resolve(opts.configured)
  const found = onPath()
  if (found) return Promise.resolve(found)
  const dir = opts.cacheDir ?? defaultCacheDir()
  const bin = join(dir, exe)
  if (existsSync(bin)) return Promise.resolve(bin)
  pending ??= download(dir, bin, opts.log).finally(() => (pending = null))
  return pending
}

async function download(dir: string, bin: string, log: (m: string) => void): Promise<string> {
  const { name, tgz } = asset()
  log(`cloudflared not found: downloading ${name} from Cloudflare's GitHub releases (first share only)…`)
  mkdirSync(dir, { recursive: true })
  const r = await fetch(`${RELEASES}/${name}`, { redirect: 'follow' })
  if (!r.ok) throw new Error(`cloudflared download failed: HTTP ${r.status}`)
  const data = Buffer.from(await r.arrayBuffer())
  const tmp = join(dir, `.${name}.${process.pid}`)
  writeFileSync(tmp, data)
  try {
    if (tgz) {
      const out = join(dir, `.extract.${process.pid}`)
      mkdirSync(out, { recursive: true })
      await run('tar', ['-xzf', tmp, '-C', out])
      renameSync(join(out, exe), bin)
      rmSync(out, { recursive: true, force: true })
    } else {
      renameSync(tmp, bin)
    }
  } finally {
    rmSync(tmp, { force: true })
  }
  chmodSync(bin, 0o755)
  // A broken or foreign download must not stay in the cache.
  try {
    if (process.platform === 'darwin') {
      await run('codesign', ['--verify', bin])
      const { stderr } = await run('codesign', ['-dv', bin])
      if (!stderr.includes(`TeamIdentifier=${CLOUDFLARE_TEAM}`)) throw new Error('not signed by Cloudflare')
    }
    const { stdout } = await run(bin, ['--version'])
    log(`cloudflared ready: ${stdout.trim().split('\n')[0]} (${bin})`)
  } catch (e) {
    rmSync(bin, { force: true })
    throw new Error(`downloaded cloudflared rejected: ${(e as Error).message}`)
  }
  return bin
}
