import type { Server } from 'node:http'
import { Bus } from './bus.js'
import { Collab } from './collab.js'
import { loadConfig, type Config, type Options } from './config.js'
import type { Ctx } from './context.js'
import { openDb } from './db.js'
import { Locks } from './locks.js'
import { Ops } from './ops.js'
import { Rebuilder } from './rebuild.js'
import { Scheduler } from './scheduler.js'
import { createServer, SCRIPT_PATH } from './server.js'
import { Shooter } from './shots.js'
import { Store } from './store.js'

export type { Config, Options } from './config.js'
export type { Note, Status } from './store.js'

export interface Pinwright {
  /** Base URL of the daemon, e.g. http://127.0.0.1:4340 */
  url: string
  /** Where the overlay script is served. */
  scriptUrl: string
  config: Config
  /** Where screenshots load the site from (plugins call it once the dev server listens). */
  setSiteUrl(url: string): void
  stop(): Promise<void>
}

/** Starts the daemon: store, scheduler, HTTP server (API, SSE, overlay, and the proxy when there is a target). */
export async function startPinwright(opts: Options = {}): Promise<Pinwright> {
  const cfg = await loadConfig(opts)
  const db = openDb(cfg.root)
  const bus = new Bus()
  bus.setMaxListeners(50)
  const store = new Store(db, bus)
  const ctx: Ctx = { cfg, store, bus, locks: new Locks(cfg.root), shooter: new Shooter(cfg), rebuilder: new Rebuilder(cfg, bus) }
  const scheduler = new Scheduler(ctx)
  const ops = new Ops(ctx, scheduler)
  const collab = new Collab(cfg)
  const server = createServer(ctx, ops, scheduler, collab)

  try {
    await listen(server, cfg.port, cfg.host)
  } catch (e) {
    db.close()
    throw e
  }
  scheduler.start()
  const url = `http://${cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host}:${cfg.port}`
  cfg.log(`listening on ${url}${cfg.target ? ` → ${cfg.target}` : ''} (root ${cfg.root}, ${cfg.maxAgents} agents, ${cfg.models.worker})`)

  let stopped: Promise<void> | null = null
  return {
    url,
    scriptUrl: url + SCRIPT_PATH,
    config: cfg,
    setSiteUrl(u: string) {
      cfg.siteUrl = u.replace(/\/$/, '')
    },
    stop() {
      stopped ??= (async () => {
        await collab.unshare()
        await scheduler.stop()
        await new Promise<void>((ok) => {
          server.close(() => ok())
          server.closeAllConnections()
        })
        await ctx.shooter.close()
        db.close()
      })()
      return stopped
    },
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((ok, fail) => {
    const onErr = (e: NodeJS.ErrnoException) => {
      fail(e.code === 'EADDRINUSE' ? new Error(`port ${port} is busy: is pinwright already running? Set another with --port or \`port\` in the config.`) : e)
    }
    server.once('error', onErr)
    server.listen(port, host, () => {
      server.off('error', onErr)
      // Once listening, a server error must never take the process down.
      server.on('error', (e) => console.error('[pinwright] server error:', e))
      ok()
    })
  })
}
