import { createReadStream, existsSync, readFileSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import net from 'node:net'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Ctx } from './context.js'
import { OpError, type Ops } from './ops.js'
import type { Scheduler } from './scheduler.js'
import type { Note } from './store.js'

const OVERLAY = join(dirname(fileURLToPath(import.meta.url)), '..', 'overlay', 'overlay.js')
export const SCRIPT_PATH = '/__pw/overlay.js'

const isLocal = (origin: string | undefined) => {
  if (!origin) return true
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** The list view: no html, styles or diff, which only the panel needs. */
const light = (n: Note) => ({ ...n, html: undefined, styles: undefined, diff: undefined, hasDiff: Boolean(n.diff) })

function readBody(req: IncomingMessage, limit = 256_000): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    let s = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      s += c
      if (s.length > limit) {
        fail(new OpError('body too large', 413))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        ok(s ? JSON.parse(s) : {})
      } catch {
        fail(new OpError('bad json'))
      }
    })
    req.on('error', fail)
  })
}

export function createServer(ctx: Ctx, ops: Ops, scheduler: Scheduler): http.Server {
  const { cfg, store, bus } = ctx
  const clients = new Set<ServerResponse>()
  const send = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(msg)
  }
  bus.on('note', (n) => send('note', light(n)))
  bus.on('activity', (a) => send('activity', a))
  bus.on('reload', () => send('reload', {}))
  const ping = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n')
  }, 25_000)

  const json = (res: ServerResponse, data: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname.slice('/__pw'.length)
    const m = req.method ?? 'GET'

    if (path === '/overlay.js') {
      const cfgJs = `window.__pinwright=${JSON.stringify({ lang: cfg.lang })};\n`
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end(cfgJs + readFileSync(OVERLAY, 'utf8'))
    }
    if (path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(`event: hello\ndata: ${JSON.stringify({ activity: Object.fromEntries(bus.activity) })}\n\n`)
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (path.startsWith('/shots/')) {
      const file = join(ctx.shooter.dir, basename(path))
      if (!existsSync(file)) return json(res, { error: 'not found' }, 404)
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' })
      return void createReadStream(file).pipe(res)
    }
    if (path === '/status') {
      return json(res, { busy: scheduler.busy, locks: ctx.locks.snapshot(), activity: Object.fromEntries(bus.activity), root: cfg.root })
    }
    if (path === '/notes' && m === 'GET') {
      const all = url.searchParams.get('all')
      return json(res, (all ? store.list(['queued', 'planning', 'working', 'done', 'asking', 'handoff', 'failed', 'archived', 'undone', 'taken']) : store.list()).map(light))
    }
    if (path === '/notes' && m === 'POST') {
      const b = await readBody(req)
      if (typeof b.text !== 'string' || !b.text.trim() || typeof b.page !== 'string') throw new OpError('text and page are required')
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      const str = (v: unknown) => (typeof v === 'string' ? v : null)
      const styles = b.styles && typeof b.styles === 'object' ? (b.styles as Record<string, string>) : null
      const note = store.create({
        page: b.page,
        text: b.text.trim(),
        url: str(b.url),
        selector: str(b.selector),
        element: str(b.element),
        html: str(b.html),
        styles,
        fx: num(b.fx),
        fy: num(b.fy),
        pageX: num(b.pageX),
        pageY: num(b.pageY),
        viewport: str(b.viewport),
        author: str(b.author),
      })
      cfg.log(`${note.id}: new note on ${note.page}: “${note.text.split('\n')[0].slice(0, 70)}”`)
      return json(res, light(note), 201)
    }
    const nm = path.match(/^\/notes\/([\w-]+)(?:\/(\w+))?$/)
    if (nm) {
      const [, id, action] = nm
      if (!action && m === 'GET') {
        const note = store.get(id)
        if (!note || note.status === 'deleted') throw new OpError('note not found', 404)
        return json(res, { ...note, messages: store.messages(id), files: store.changes(id).map((c) => c.file), activity: bus.activity.get(id) ?? null })
      }
      if (!action && m === 'DELETE') {
        ops.delete(id)
        return json(res, { ok: true })
      }
      if (m === 'POST') {
        const b = await readBody(req)
        switch (action) {
          case 'reply':
            return json(res, light(ops.reply(id, String(b.text ?? ''))))
          case 'archive':
            return json(res, light(ops.archive(id)))
          case 'retry':
            return json(res, light(ops.retry(id)))
          case 'handoff':
            return json(res, light(ops.handoff(id)))
          case 'undo':
            return json(res, light(await ops.undo(id)))
          case 'take':
            return json(res, ops.take(id))
          case 'done':
            return json(res, light(ops.markDone(id, typeof b.summary === 'string' ? b.summary : undefined)))
        }
      }
    }
    json(res, { error: 'not found' }, 404)
  }

  function proxy(req: IncomingMessage, res: ServerResponse): void {
    if (!cfg.target) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      return void res.end(`pinwright is running on ${cfg.root}.\nNo --target: the overlay is served at ${SCRIPT_PATH}.\n`)
    }
    const t = new URL(cfg.target)
    const headers = { ...req.headers, host: t.host, 'accept-encoding': 'identity' }
    delete headers['if-none-match']
    delete headers['if-modified-since']
    const up = http.request({ host: t.hostname, port: t.port || 80, path: req.url, method: req.method, headers }, (r) => {
      const h = { ...r.headers }
      if (typeof h.location === 'string' && h.location.startsWith(t.origin)) h.location = h.location.slice(t.origin.length) || '/'
      const html = (r.headers['content-type'] ?? '').includes('text/html')
      if (!html || req.method === 'HEAD') {
        res.writeHead(r.statusCode ?? 502, h)
        return void r.pipe(res)
      }
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => {
        let s = Buffer.concat(chunks).toString('utf8')
        const tag = `<script src="${SCRIPT_PATH}" defer></script>`
        const i = s.lastIndexOf('</body>')
        s = i >= 0 ? s.slice(0, i) + tag + s.slice(i) : s + tag
        // The overlay changes without the page changing: never let the browser reuse an old copy.
        h['cache-control'] = 'no-store'
        delete h['content-length']
        delete h.etag
        delete h['last-modified']
        res.writeHead(r.statusCode ?? 200, h)
        res.end(s)
      })
      r.on('error', () => res.destroy())
    })
    up.on('error', () => {
      if (res.headersSent) return void res.destroy()
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`pinwright: ${cfg.target} is not reachable. Start the site there, then reload.`)
    })
    req.pipe(up)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (!url.pathname.startsWith('/__pw/')) return proxy(req, res)
    const origin = req.headers.origin
    if (!isLocal(origin)) return json(res, { error: 'forbidden origin' }, 403)
    if (origin) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('vary', 'origin')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' })
      return void res.end()
    }
    api(req, res, url).catch((e: unknown) => {
      const err = e instanceof OpError ? e : new OpError((e as Error)?.message ?? String(e), 500)
      if (err.code >= 500) cfg.log(`api ${req.method} ${url.pathname}: ${(e as Error)?.stack ?? e}`)
      if (!res.headersSent) json(res, { error: err.message, ...(err.data ? { data: err.data } : {}) }, err.code)
      else res.destroy()
    })
  })

  // HMR and other websockets go straight through to the target.
  server.on('upgrade', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    if (!cfg.target) return void socket.destroy()
    const t = new URL(cfg.target)
    const up = net.connect(Number(t.port || 80), t.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]
        lines.push(`${k}: ${k.toLowerCase() === 'host' ? t.host : req.rawHeaders[i + 1]}`)
      }
      up.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })

  server.on('close', () => {
    clearInterval(ping)
    for (const c of clients) c.end()
  })
  return server
}
