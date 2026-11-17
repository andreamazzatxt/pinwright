import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Options, Pinwright } from './index.js'
import { injectIntoHtml } from './inject.js'
import { releaseDaemon, scriptTag, tryDaemon } from './plugin.js'

export { currentDaemon, ensureDaemon, releaseDaemon } from './plugin.js'

/* Structural types: no dependency on vite itself. */
type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void
interface DevServer {
  httpServer: { once(e: 'listening', f: () => void): void; on(e: 'close', f: () => void): void } | null
  resolvedUrls?: { local: string[] } | null
  middlewares?: { use(fn: Middleware): void }
  config: { server: { port?: number; https?: unknown } }
}

/** Points screenshots at the dev server once it listens. */
export function trackSiteUrl(server: DevServer, pw: Pinwright, explicit?: string): void {
  if (explicit) return
  server.httpServer?.once('listening', () => {
    const u = server.resolvedUrls?.local[0]
    if (u) pw.setSiteUrl(u)
  })
}

/**
 * Vite plugin: starts pinwright with `vite dev` and puts the overlay in every HTML page the dev server sends:
 * plain index.html apps and the SSR frameworks built on Vite (SvelteKit, React Router, SolidStart, Qwik…).
 */
export default function pinwright(opts: Options = {}) {
  let pw: Pinwright | null = null
  return {
    name: 'pinwright',
    apply: 'serve' as const,
    async configureServer(server: DevServer) {
      pw = await tryDaemon(opts)
      if (!pw) return
      trackSiteUrl(server, pw, opts.siteUrl)
      server.httpServer?.on('close', releaseDaemon)
      // Registered now, so it runs before the framework's own SSR handler and wraps its response.
      const tag = scriptTag(pw.scriptUrl)
      server.middlewares?.use((req, res, next) => {
        injectIntoHtml(req, res, tag)
        next()
      })
    },
  }
}
