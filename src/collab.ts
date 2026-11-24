import type net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { resolveCloudflared } from './cloudflared.js'
import type { Config } from './config.js'

export const MAX_PEOPLE = 8
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#65a30d']
const ANIMALS = {
  it: ['Volpe', 'Gufo', 'Lontra', 'Panda', 'Koala', 'Riccio', 'Lince', 'Polpo', 'Bradipo', 'Tucano', 'Delfino', 'Fenicottero', 'Procione', 'Capibara'],
  en: ['Fox', 'Owl', 'Otter', 'Panda', 'Koala', 'Hedgehog', 'Lynx', 'Octopus', 'Sloth', 'Toucan', 'Dolphin', 'Flamingo', 'Raccoon', 'Capybara'],
}
const TRAITS = ['Ninja', 'Turbo', 'Pixel', 'Laser', 'Disco', 'Zen', 'Jazz', 'Neon', 'Cosmo', 'Razzo', 'Funky', 'Groove']
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

/**
 * Who is asking: the host (this machine), or a guest from one of the two shared links. Notes from the
 * `auto` link go straight to the agents; notes and replies from the `review` link wait for the host.
 */
export type Access = 'host' | 'auto' | 'review'
export const LINK_KINDS = ['auto', 'review'] as const

export interface Peer {
  id: string
  name: string
  color: string
  guest: boolean
  page: string | null
}

/** localhost, 127.0.0.1, [::1] or *.localhost, with or without a port. */
export function isLocalHost(host: string | undefined): boolean {
  const h = (host ?? '').replace(/:\d+$/, '').toLowerCase()
  return !h || h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]'
}

/**
 * Whether a request reached the daemon from outside this machine: another host, a tunnel that marks the real
 * client (cloudflared and most tunnels), or any request naming a host other than localhost. That last one covers a tunnel
 * that adds no header, and a site that points its own name at 127.0.0.1 (DNS rebinding): both need the token.
 */
export function isRemote(req: IncomingMessage): boolean {
  if (guestOrigin(req) !== undefined) return true
  const a = req.socket.remoteAddress ?? ''
  const loopback = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
  return !loopback || Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) || !isLocalHost(req.headers.host)
}

/**
 * Sockets accepted on the guest port carry this: a way to the share's public origin ('' while there's none), read
 * per request since a connection outlives a share. Whatever a proxy in front does to the headers, it's a guest.
 */
export const GUEST = Symbol('pinwright guest')
export type GuestSocket = net.Socket & { [GUEST]?: () => string }
export const guestOrigin = (req: IncomingMessage): string | undefined => (req.socket as GuestSocket)[GUEST]?.()

/** The origin the browser used to reach the daemon: the share's for a guest, the public URL's when it names that host, else from the headers. */
export function publicOrigin(req: IncomingMessage, cfg: Pick<Config, 'publicUrl'>): string {
  const g = guestOrigin(req)
  if (g) return g
  const host = req.headers.host ?? 'localhost'
  if (cfg.publicUrl) {
    const pub = new URL(cfg.publicUrl)
    if (pub.host === host) return pub.origin
  }
  const proto = req.headers['x-forwarded-proto']
  const https = proto ? proto === 'https' : Boolean(req.headers['cf-connecting-ip'])
  return `${https ? 'https' : 'http'}://${host}`
}

const readCookie = (req: IncomingMessage, name: string) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1]

/**
 * Live sessions: who is here (max 8, each with a made-up name and a colour), and the shared link,
 * which is a cloudflared quick tunnel to the daemon plus a secret token.
 */
export class Collab {
  peers = new Map<string, Peer>()
  /** Names stay with a browser tab for the daemon's lifetime, across reloads. */
  private known = new Map<string, { name: string; color: string }>()
  private leaving = new Map<string, NodeJS.Timeout>()
  private tokens: Record<'auto' | 'review', string> | null = null
  private tunnel: ChildProcess | null = null
  url: string | null = null
  /** Where tunnels reach the daemon (set once it listens there). */
  guestPort = 0
  /** A one-off code: a request carrying it proves the user's server reaches us. */
  probe: string | null = null

  constructor(private cfg: Config) {}

  get sharing(): boolean {
    return Boolean(this.tokens && this.url)
  }

  /** Which link a token belongs to, if any. */
  private kindOf(t: string | undefined | null): 'auto' | 'review' | null {
    if (!t || !this.tokens) return null
    const a = Buffer.from(t)
    for (const k of LINK_KINDS) {
      const b = Buffer.from(this.tokens[k])
      if (a.length === b.length && timingSafeEqual(a, b)) return k
    }
    return null
  }

  /** A remote request may pass only with a share token (from the link, then from its cookie). */
  authorized(req: IncomingMessage, query: URLSearchParams): 'ok' | 'set-cookie' | 'denied' {
    if (!isRemote(req)) return 'ok'
    if (this.kindOf(query.get('pw'))) return 'set-cookie'
    return this.kindOf(readCookie(req, 'pw_t')) ? 'ok' : 'denied'
  }

  /** What the request may do: the host, or a guest of the link its cookie came from. Null: no valid token. */
  access(req: IncomingMessage): Access | null {
    if (!isRemote(req)) return 'host'
    return this.kindOf(readCookie(req, 'pw_t'))
  }

  /** The cookie for the token in the link (the request was just `authorized` as 'set-cookie'). */
  cookie(req: IncomingMessage, token: string): string {
    const https = publicOrigin(req, this.cfg).startsWith('https:')
    return `pw_t=${token}; Path=/; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`
  }

  /** Joins (or rejoins after a reload). Null when the session is full. `name`: the one the person chose before. */
  join(id: string, guest: boolean, page: string | null, name?: string | null): Peer | null {
    const pending = this.leaving.get(id)
    if (pending) clearTimeout(pending)
    this.leaving.delete(id)
    const existing = this.peers.get(id)
    if (existing) return Object.assign(existing, { page })
    if (this.peers.size >= MAX_PEOPLE) return null
    let who = this.known.get(id)
    if (!who) {
      const taken = new Set([...this.peers.values()].map((p) => p.name))
      const used = new Set([...this.peers.values()].map((p) => p.color))
      const lang = this.cfg.lang.startsWith('it') ? 'it' : 'en'
      let name = ''
      for (let i = 0; i < 50 && (!name || taken.has(name)); i++) {
        const a = pick(ANIMALS[lang])
        const t = pick(TRAITS)
        name = lang === 'it' ? `${a} ${t}` : `${t} ${a}`
      }
      who = { name, color: COLORS.find((c) => !used.has(c)) ?? pick(COLORS) }
      this.known.set(id, who)
    }
    const peer = { id, ...who, guest, page }
    this.peers.set(id, peer)
    if (name) this.rename(id, name)
    return peer
  }

  /** Sets the name a person chose. False if it's empty or someone else here has it. */
  rename(id: string, raw: string): boolean {
    const peer = this.peers.get(id)
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, 30)
    if (!peer || !name) return false
    if ([...this.peers.values()].some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) return false
    peer.name = name
    this.known.set(id, { name, color: peer.color })
    return true
  }

  /** Leaves after a short grace, so a reload doesn't look like someone left and came back. */
  leave(id: string, onGone: () => void): void {
    this.leaving.set(
      id,
      setTimeout(() => {
        this.leaving.delete(id)
        if (this.peers.delete(id)) onGone()
      }, 4000),
    )
  }

  list(): Peer[] {
    return [...this.peers.values()]
  }

  /**
   * Opens the tunnel (once) and returns the public base URL; the caller adds the page and a token.
   * - publicUrl: nothing opens, the tunnel is the user's; only the tokens make the links.
   * - tunnel + hostname: the user's named Cloudflare tunnel, its hostname already routed to it.
   * - ssh + hostname: a reverse SSH tunnel to the user's own server, whose web server serves the hostname.
   * - otherwise a Cloudflare quick tunnel, on a new random host each time.
   */
  async share(): Promise<{ url: string; tokens: Record<'auto' | 'review', string> }> {
    const tok = () => randomBytes(18).toString('base64url')
    this.tokens ??= { auto: tok(), review: tok() }
    const tokens = this.tokens
    if (this.cfg.publicUrl) {
      this.url = new URL(this.cfg.publicUrl).origin
      if (this.announced !== this.url) this.cfg.log(`sharing at ${this.url} (your tunnel, to 127.0.0.1:${this.guestPort})`)
      await this.announce()
      return { url: this.url, tokens }
    }
    if (this.url && this.tunnel && this.tunnel.exitCode === null) return { url: this.url, tokens }
    if (this.cfg.ssh) {
      this.url = await this.openSsh()
      this.cfg.log(`sharing at ${this.url} (through ${this.cfg.ssh})`)
      await this.announce()
      return { url: this.url, tokens }
    }
    const { tunnel: named, hostname } = this.cfg
    if (named && !hostname) throw new Error('a named tunnel needs its hostname (--hostname), the one routed to it')
    const bin = await resolveCloudflared({ configured: this.cfg.cloudflared, log: this.cfg.log })
    const local = `http://127.0.0.1:${this.guestPort || this.cfg.port}`
    // A quick tunnel prints its URL; a named one says when it's connected, and its URL is the hostname.
    const [args, ready] = named
      ? [['tunnel', '--no-autoupdate', 'run', '--url', local, named], /Registered tunnel connection/]
      : [['tunnel', '--no-autoupdate', '--url', local], /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/]
    this.url = await new Promise<string>((ok, fail) => {
      let out = ''
      let p: ChildProcess
      try {
        p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        return fail(e)
      }
      this.tunnel = p
      const timer = setTimeout(() => fail(new Error(`cloudflared did not ${named ? 'connect' : 'give a URL'} within 30 s`)), 30_000)
      const read = (b: Buffer) => {
        out = (out + b.toString()).slice(-4000)
        const m = out.match(ready)
        if (m) {
          clearTimeout(timer)
          ok(named ? `https://${hostname!.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}` : m[1])
        }
      }
      p.stdout?.on('data', read)
      p.stderr?.on('data', read)
      p.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        fail(e.code === 'ENOENT' ? new Error(`cloudflared not found at ${bin}`) : e)
      })
      p.on('exit', () => {
        clearTimeout(timer)
        if (this.tunnel === p) {
          this.tunnel = null
          this.url = null
        }
        fail(new Error(`cloudflared exited: ${out.split('\n').slice(-3).join(' ')}`))
      })
    })
    this.cfg.log(`sharing at ${this.url}`)
    await this.announce()
    return { url: this.url, tokens }
  }

  /**
   * `ssh -R`: the server's sshPort (its loopback only) leads to our guest port. ssh says nothing once it's up, so it's
   * up when a request sent to the public hostname comes back to us: that also proves the server's web server.
   */
  private async openSsh(): Promise<string> {
    const { ssh, hostname } = this.cfg
    if (!hostname) throw new Error('--ssh needs --hostname: the address your server serves pinwright on')
    // https unless spelled out (a plain-http address is for trying it on a LAN, or tests).
    const url = /^https?:\/\//.test(hostname) ? new URL(hostname).origin : `https://${hostname.replace(/\/.*$/, '')}`
    const remote = this.cfg.sshPort ?? 9000
    const args = ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-R', `${this.cfg.sshBind ?? '127.0.0.1'}:${remote}:127.0.0.1:${this.guestPort}`, ssh!]
    let out = ''
    const p = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.tunnel = p
    let exited: Error | null = null
    p.stderr?.on('data', (b: Buffer) => (out = (out + b.toString()).slice(-2000)))
    p.on('error', (e: NodeJS.ErrnoException) => (exited = e.code === 'ENOENT' ? new Error('ssh not found: install OpenSSH') : e))
    p.on('exit', () => {
      exited ??= new Error(`ssh to ${ssh} closed: ${out.trim().split('\n').slice(-2).join(' ') || 'no reason given'}`)
      if (this.tunnel === p) {
        this.tunnel = null
        this.url = null
      }
    })
    this.probe = randomBytes(12).toString('base64url')
    try {
      for (const until = Date.now() + 30_000; Date.now() < until; ) {
        if (exited) throw exited
        const ok = await fetch(`${url}/__pw/probe?n=${this.probe}`, { signal: AbortSignal.timeout(3000), redirect: 'manual' })
          .then((r) => r.status === 204 && r.headers.get('x-pinwright') === 'probe')
          .catch(() => false)
        if (ok) return url
        await new Promise((r) => setTimeout(r, 700))
      }
      throw new Error(`${url} doesn't lead to pinwright: on ${ssh!.replace(/^.*@/, '')}, serve it from 127.0.0.1:${remote} (Caddy: reverse_proxy ${this.cfg.sshBind ?? '127.0.0.1'}:${remote})`)
    } catch (e) {
      p.kill('SIGTERM')
      throw exited ?? e
    } finally {
      this.probe = null
    }
  }

  /** The URL onShare was last told about: it hears about each new one once. */
  private announced: string | null = null

  private async announce(): Promise<void> {
    if (!this.url || this.announced === this.url) return
    this.announced = this.url
    await runHook(this.cfg, 'onShare', this.url)
  }

  /** Closes the tunnel and voids both links (even when the tunnel is the user's): the next share gets new tokens. */
  async unshare(): Promise<void> {
    if (!this.tokens && !this.tunnel) return
    this.tunnel?.kill('SIGTERM')
    const url = this.announced
    this.tunnel = null
    this.url = null
    this.tokens = null
    this.announced = null
    this.cfg.log('sharing stopped')
    if (url) await runHook(this.cfg, 'onUnshare', url)
  }
}

/**
 * Tells the user's own setup that a share opened or closed, e.g. to add the public URL to a login's allowed
 * redirects and take it out again. A function gets the URL; a shell command gets it as PINWRIGHT_URL. A hook that
 * fails is logged, never fatal: the share itself works without it.
 */
async function runHook(cfg: Config, name: 'onShare' | 'onUnshare', url: string): Promise<void> {
  const hook = cfg[name]
  if (!hook) return
  try {
    if (typeof hook === 'function') return void (await hook(url))
    await new Promise<void>((ok, fail) => {
      const p = spawn(hook, { shell: true, cwd: cfg.root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PINWRIGHT_URL: url, PINWRIGHT_PORT: String(cfg.port) } })
      let out = ''
      p.stdout?.on('data', (b: Buffer) => (out = (out + b).slice(-2000)))
      p.stderr?.on('data', (b: Buffer) => (out = (out + b).slice(-2000)))
      const timer = setTimeout(() => (p.kill('SIGTERM'), fail(new Error('took more than 60 s'))), 60_000)
      p.on('error', (e) => (clearTimeout(timer), fail(e)))
      p.on('exit', (code) => (clearTimeout(timer), code === 0 ? ok() : fail(new Error(`exited ${code}: ${out.trim().split('\n').slice(-2).join(' ')}`))))
    })
    cfg.log(`${name} done for ${url}`)
  } catch (e) {
    cfg.log(`${name} failed: ${(e as Error).message}`)
  }
}
