import { startPinwright, type Options, type Pinwright } from './index.js'

/* Structural types: no dependency on vite itself. */
interface DevServer {
  httpServer: { once(e: 'listening', f: () => void): void; on(e: 'close', f: () => void): void } | null
  resolvedUrls?: { local: string[] } | null
  config: { server: { port?: number; https?: unknown } }
}

/**
 * Shared by the Vite plugin and the Astro integration: one daemon per process. Dev servers restart
 * by opening the new server before closing the old one, so the daemon stops only when the last user
 * has let it go for a moment.
 */
let current: Promise<Pinwright> | null = null
let users = 0
let stopTimer: NodeJS.Timeout | null = null
export function ensureDaemon(opts: Options): Promise<Pinwright> {
  users++
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
  current ??= startPinwright({ ...opts, mode: 'plugin' }).catch((e) => {
    current = null
    throw e
  })
  return current
}
export function currentDaemon(): Promise<Pinwright | null> {
  return current?.catch(() => null) ?? Promise.resolve(null)
}
export function releaseDaemon(): void {
  users = Math.max(0, users - 1)
  if (users || stopTimer) return
  stopTimer = setTimeout(() => {
    stopTimer = null
    if (users) return
    const c = current
    current = null
    void c?.then((pw) => pw.stop()).catch(() => {})
  }, 1500)
  stopTimer.unref()
}

/** Points screenshots at the dev server once it listens. */
export function trackSiteUrl(server: DevServer, pw: Pinwright, explicit?: string): void {
  if (explicit) return
  server.httpServer?.once('listening', () => {
    const u = server.resolvedUrls?.local[0]
    if (u) pw.setSiteUrl(u)
  })
}

/** Vite plugin: starts pinwright with `vite dev` and injects the overlay into index.html. */
export default function pinwright(opts: Options = {}) {
  let pw: Pinwright | null = null
  return {
    name: 'pinwright',
    apply: 'serve' as const,
    async configureServer(server: DevServer) {
      try {
        pw = await ensureDaemon(opts)
      } catch (e) {
        releaseDaemon()
        console.error(`[pinwright] not started: ${(e as Error).message}`)
        return
      }
      trackSiteUrl(server, pw, opts.siteUrl)
      server.httpServer?.on('close', releaseDaemon)
    },
    transformIndexHtml() {
      if (!pw) return []
      return [{ tag: 'script', attrs: { src: pw.scriptUrl, defer: true }, injectTo: 'body' as const }]
    },
  }
}
