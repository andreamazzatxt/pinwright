import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface Viewport {
  name: string
  width: number
  height: number
}

export interface Config {
  /** Project root: the agents' working directory and the only place they may edit. */
  root: string
  /** Proxy mode: the site to put the overlay in front of. */
  target?: string
  /** Where the site itself is reachable, for screenshots. Defaults to `target`; plugins set it from the dev server. */
  siteUrl?: string
  port: number
  host: string
  /** Shell command run in `root` after edits, when the target has no HMR (proxy mode). */
  rebuild?: string
  /** Rebuild right after every edit, so the reviewer sees changes while the agent works. */
  rebuildOnEdit: boolean
  /** Let the agent ask the reviewer when a note is ambiguous. Off: it picks the likeliest reading and says so. */
  ask: boolean
  maxAgents: number
  models: { planner: string; worker: string }
  viewports: Viewport[]
  maxTurns: number
  timeoutMin: number
  lang: string
  /** Extra text appended to the worker's system prompt. */
  instructions: string
  /** Let ANTHROPIC_API_KEY through to the agents. Off by default: they use the `claude login` session. */
  useApiKey: boolean
  /** Before/after thumbnails in the panel (Playwright + Chrome). Off by default: the reviewer sees changes live. */
  shots: boolean
  /**
   * Notes from a shared link may only edit files under a directory with one of these names
   * (anywhere in the path: `src`, `apps/web/src`…). Config files, scripts and secrets stay off limits for every note.
   */
  guestDirs: string[]
  /** CSS selector: notes may only be placed inside matching elements (e.g. a microfrontend's mount point). */
  scope?: string
  /**
   * Microfrontend mode: the target is a Module Federation remote, loaded by a shell running elsewhere. The overlay
   * rides along in the remote's JavaScript instead of the HTML, so it shows up wherever the shell mounts it.
   */
  mfe: boolean
  /**
   * Microfrontend mode: the shell that loads the remote (e.g. http://localhost:3000). A live session shares it, with
   * the remote inside. Default: the page Go live is pressed on.
   */
  shell?: string
  /**
   * Go live on a fixed address you run yourself (a Cloudflare tunnel, or any other), pointed at
   * pinwright's port: no tunnel is opened, the links are built on it. For sites whose login only accepts known hosts.
   */
  publicUrl?: string
  /**
   * Go live through your named Cloudflare tunnel (`cloudflared tunnel create <name>`) instead of a quick tunnel,
   * on `hostname`, which you routed to it (`cloudflared tunnel route dns <name> <hostname>`): the same address
   * every time.
   */
  tunnel?: string
  hostname?: string
  /**
   * Run when a share opens, and when it closes: a shell command (the public URL in PINWRIGHT_URL) or, in a JS
   * config, a function of the URL. For setup outside pinwright, e.g. allowing the URL as a login redirect.
   */
  onShare?: string | ((url: string) => unknown)
  onUnshare?: string | ((url: string) => unknown)
  /** cloudflared binary for live-session links. Default: on PATH, else downloaded once to ~/.cache/pinwright. */
  cloudflared?: string
  /** Who launched the daemon: the CLI installs process-wide handlers, plugins must not. */
  mode: 'cli' | 'plugin'
  /** Print what happens. */
  log: (msg: string) => void
}

export type Options = Partial<Omit<Config, 'models'>> & { models?: Partial<Config['models']>; config?: string | false }

const DEFAULTS: Omit<Config, 'root' | 'log'> = {
  port: 4340,
  host: '127.0.0.1',
  maxAgents: 3,
  rebuildOnEdit: true,
  ask: false,
  models: { planner: 'haiku', worker: 'sonnet' },
  viewports: [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ],
  maxTurns: 30,
  timeoutMin: 20,
  lang: 'en',
  instructions: '',
  useApiKey: false,
  shots: false,
  mfe: false,
  guestDirs: ['src', 'public', 'app', 'pages', 'components', 'layouts', 'styles', 'css', 'assets', 'content', 'static', 'images', 'img'],
  mode: 'plugin',
}

const FILES = ['pinwright.config.mjs', 'pinwright.config.js', 'pinwright.config.json']

async function readFileConfig(root: string, explicit?: string): Promise<Options> {
  const candidates = explicit ? [resolve(root, explicit)] : FILES.map((f) => join(root, f))
  for (const file of candidates) {
    if (!existsSync(file)) continue
    if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'))
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`)
    return (mod.default ?? mod) as Options
  }
  if (explicit) throw new Error(`config not found: ${explicit}`)
  return {}
}

/** Defaults, then the config file in root, then explicit options (CLI flags, plugin options). */
export async function loadConfig(opts: Options = {}): Promise<Config> {
  const root = resolve(opts.root ?? process.cwd())
  const file = opts.config === false ? {} : await readFileConfig(root, opts.config || undefined)
  const merged = { ...DEFAULTS, ...strip(file), ...strip(opts) }
  merged.models = { ...DEFAULTS.models, ...file.models, ...opts.models }
  const cfg = { ...merged, root, log: opts.log ?? file.log ?? ((m: string) => console.log(`[pinwright] ${m}`)) } as Config
  cfg.siteUrl ??= cfg.target
  if (cfg.target) cfg.target = cfg.target.replace(/\/$/, '')
  if (cfg.siteUrl) cfg.siteUrl = cfg.siteUrl.replace(/\/$/, '')
  return cfg
}

function strip<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && k !== 'config') (out as Record<string, unknown>)[k] = v
  return out
}
