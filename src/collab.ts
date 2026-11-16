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

/** Whether a request reached the daemon from outside this machine (through the tunnel, or another host). */
export function isRemote(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? ''
  const loopback = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
  // cloudflared connects from localhost but marks the real client.
  return !loopback || Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'])
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
    const https = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip'])
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

  /** Opens the tunnel (once) and returns the public base URL; the caller adds the page and a token. */
  async share(): Promise<{ url: string; tokens: Record<'auto' | 'review', string> }> {
    const tok = () => randomBytes(18).toString('base64url')
    this.tokens ??= { auto: tok(), review: tok() }
    const tokens = this.tokens
    if (this.url && this.tunnel && this.tunnel.exitCode === null) return { url: this.url, tokens }
    const bin = await resolveCloudflared({ configured: this.cfg.cloudflared, log: this.cfg.log })
    this.url = await new Promise<string>((ok, fail) => {
      let out = ''
      let p: ChildProcess
      try {
        p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.cfg.port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        return fail(e)
      }
      this.tunnel = p
      const timer = setTimeout(() => fail(new Error('cloudflared did not give a URL within 30 s')), 30_000)
      const read = (b: Buffer) => {
        out = (out + b.toString()).slice(-4000)
        const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
        if (m) {
          clearTimeout(timer)
          ok(m[0])
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
    return { url: this.url, tokens }
  }

  /** Closes the tunnel and voids both links: the next share gets new tokens. */
  unshare(): void {
    if (!this.tokens && !this.tunnel) return
    this.tunnel?.kill('SIGTERM')
    this.tunnel = null
    this.url = null
    this.tokens = null
    this.cfg.log('sharing stopped')
  }
}
