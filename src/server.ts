import { createReadStream, existsSync, readFileSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import net from 'node:net'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRemote, LINK_KINDS, type Access, type Collab } from './collab.js'
import type { Ctx } from './context.js'
import { acceptWs, type WsConn } from './ws.js'
import { OpError, type Ops } from './ops.js'
import type { Scheduler } from './scheduler.js'
import type { Note } from './store.js'
import { loaderCode } from './inject.js'

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

export function createServer(ctx: Ctx, ops: Ops, scheduler: Scheduler, collab: Collab): http.Server {
  const { cfg, store, bus } = ctx
  /** Open live channels (WebSocket), with the person each belongs to and whether it comes from outside. */
  const clients = new Map<WsConn, { pid: string | null; guest: boolean }>()
  const send = (event: string, data: unknown, only?: (c: { pid: string | null; guest: boolean }) => boolean) => {
    const msg = JSON.stringify({ event, data })
    for (const [conn, c] of clients) if (!only || only(c)) conn.send(msg)
  }
  /** The two links, once shared: `auto` runs every note, `review` waits for the host's approval. */
  let links: Record<'auto' | 'review', string> | null = null
  const sharePayload = () => ({ links: collab.sharing ? links : null })
  bus.on('note', (n) => send('note', light(n)))
  bus.on('activity', (a) => send('activity', a))
  bus.on('reload', () => send('reload', {}))
  const ping = setInterval(() => {
    for (const c of clients.keys()) c.ping()
  }, 25_000)

  const json = (res: ServerResponse, data: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname.slice('/__pw'.length)
    const m = req.method ?? 'GET'
    const access: Access = collab.access(req) ?? 'review'
    /** What a guest of the review link writes waits for the host. */
    const approved = access !== 'review'

    if (path === '/overlay.js') {
      const cfgJs = `window.__pinwright=${JSON.stringify({ lang: cfg.lang, scope: cfg.scope })};\n`
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end(cfgJs + readFileSync(OVERLAY, 'utf8'))
    }
    if (path === '/share') {
      if (isRemote(req)) throw new OpError('only the host can share', 403)
      if (m === 'POST') {
        const b = await readBody(req)
        const { url: base, tokens } = await collab.share()
        const page = typeof b.page === 'string' && b.page.startsWith('/') ? b.page : '/'
        const link = (t: string) => `${base}${page}${page.includes('?') ? '&' : '?'}pw=${t}`
        links = Object.fromEntries(LINK_KINDS.map((k) => [k, link(tokens[k])])) as Record<'auto' | 'review', string>
        send('share', sharePayload(), (c) => !c.guest)
        return json(res, sharePayload())
      }
      if (m === 'DELETE') {
        collab.unshare()
        links = null
        send('share', sharePayload(), (c) => !c.guest)
        // Guests lose access: their streams close and the old link stops working.
        for (const [conn, c] of clients) if (c.guest) conn.close()
        return json(res, { ok: true })
      }
    }
    if (path.startsWith('/shots/')) {
      const file = join(ctx.shooter.dir, basename(path))
      if (!existsSync(file)) return json(res, { error: 'not found' }, 404)
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' })
      return void createReadStream(file).pipe(res)
    }
    if (path === '/status') {
      if (isRemote(req)) throw new OpError('forbidden', 403)
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
        approved,
        guest: access !== 'host',
      })
      cfg.log(`${note.id}: new note on ${note.page}${approved ? '' : ' (waiting for approval)'}: “${note.text.split('\n')[0].slice(0, 70)}”`)
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
            return json(res, light(ops.reply(id, String(b.text ?? ''), typeof b.author === 'string' ? b.author.slice(0, 60) : null, approved, access !== 'host')))
          case 'approve':
            if (access !== 'host') throw new OpError('only the host can approve a note', 403)
            return json(res, light(ops.approve(id)))
          case 'archive':
            return json(res, light(ops.archive(id)))
          case 'retry':
            return json(res, light(ops.retry(id, approved)))
          case 'handoff':
            return json(res, light(ops.handoff(id)))
          case 'undo':
            return json(res, light(await ops.undo(id)))
          case 'take':
            if (isRemote(req)) throw new OpError('only the host can take a note', 403)
            return json(res, ops.take(id))
          case 'done':
            return json(res, light(ops.markDone(id, typeof b.summary === 'string' ? b.summary : undefined)))
        }
      }
    }
    json(res, { error: 'not found' }, 404)
  }

  function proxy(req: IncomingMessage, res: ServerResponse): void {
    const target = cfg.target ?? cfg.siteUrl
    if (!target) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      return void res.end(`pinwright is running on ${cfg.root}.\nNo --target: the overlay is served at ${SCRIPT_PATH}.\n`)
    }
    const t = new URL(target)
    const headers = { ...req.headers, host: t.host, 'accept-encoding': 'identity' }
    // The share token is ours, not the site's.
    const site = (req.headers.cookie ?? '').split(';').filter((c) => !c.trim().startsWith('pw_t=')).join(';').trim()
    if (site) headers.cookie = site
    else delete headers.cookie
    delete headers['if-none-match']
    delete headers['if-modified-since']
    const up = http.request({ host: t.hostname, port: t.port || 80, path: req.url, method: req.method, headers }, (r) => {
      const h = { ...r.headers }
      if (typeof h.location === 'string' && h.location.startsWith(t.origin)) h.location = h.location.slice(t.origin.length) || '/'
      const type = r.headers['content-type'] ?? ''
      const html = type.includes('text/html')
      // Microfrontend: the shell loads this server's JavaScript, not its HTML, so the overlay loader goes there.
      const js = cfg.mfe && /javascript/.test(type) && !/\.hot-update\.js(\?|$)/.test(req.url ?? '') && (r.statusCode ?? 200) < 300
      if (js && req.method !== 'HEAD') {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => {
          const own = `http://${req.headers.host ?? `127.0.0.1:${cfg.port}`}${SCRIPT_PATH}`
          // Appended, so source maps keep their line numbers.
          const body = Buffer.concat([Buffer.concat(chunks), Buffer.from(`\n;${loaderCode(own)}\n`)])
          delete h['content-length']
          delete h.etag
          delete h['content-encoding']
          h['cache-control'] = 'no-store'
          res.writeHead(r.statusCode ?? 200, h)
          res.end(body)
        })
        r.on('error', () => res.destroy())
        return
      }
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
      res.end(`pinwright: ${target} is not reachable. Start the site there, then reload.`)
    })
    req.pipe(up)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    // Remote visitors (the shared link) need the token: from the link once, then from its cookie.
    const auth = collab.authorized(req, url.searchParams)
    if (auth === 'denied') {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      return void res.end('pinwright: this link is not valid anymore. Ask for a new one.')
    }
    if (auth === 'set-cookie') {
      const token = url.searchParams.get('pw')!
      url.searchParams.delete('pw')
      res.writeHead(302, { 'set-cookie': collab.cookie(req, token), location: url.pathname + url.search, 'cache-control': 'no-store' })
      return void res.end()
    }
    if (!url.pathname.startsWith('/__pw/')) return proxy(req, res)
    const origin = req.headers.origin
    // Local pages must come from localhost; remote ones already proved the token (SameSite cookie).
    if (!isRemote(req) && !isLocal(origin)) return json(res, { error: 'forbidden origin' }, 403)
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

  /** The live channel: note events out, cursors both ways, presence. One per open page. */
  function live(req: IncomingMessage, socket: net.Socket, url: URL): void {
    const guest = isRemote(req)
    if (!guest && !isLocal(req.headers.origin)) return void socket.destroy()
    const conn = acceptWs(req, socket)
    if (!conn) return void socket.destroy()
    const pid = url.searchParams.get('pid')?.slice(0, 40) || null
    const me = pid ? collab.join(pid, guest, url.searchParams.get('page'), url.searchParams.get('name')) : null
    if (pid && !me) {
      conn.send(JSON.stringify({ event: 'full', data: {} }))
      return void conn.close()
    }
    const hello = { activity: Object.fromEntries(bus.activity), me, peers: collab.list(), access: collab.access(req), share: guest ? null : sharePayload() }
    conn.send(JSON.stringify({ event: 'hello', data: hello }))
    clients.set(conn, { pid, guest })
    send('peers', collab.list())
    conn.on('message', (raw) => {
      let m: Record<string, unknown>
      try {
        m = JSON.parse(raw)
      } catch {
        return
      }
      const peer = pid ? collab.peers.get(pid) : undefined
      if (m.t === 'name' && peer && typeof m.name === 'string') {
        if (collab.rename(peer.id, m.name)) send('peers', collab.list())
        else conn.send(JSON.stringify({ event: 'peers', data: collab.list() }))
        return
      }
      if (m.t === 'cursor' && peer) {
        if (typeof m.page === 'string') peer.page = m.page
        const { t: _t, ...rest } = m
        send('cursor', { ...rest, pid, name: peer.name, color: peer.color }, (c) => c.pid !== pid)
      }
    })
    conn.on('close', () => {
      clients.delete(conn)
      // Another channel of the same tab may still be open (a reload overlaps the old one).
      if (pid && ![...clients.values()].some((c) => c.pid === pid)) collab.leave(pid, () => send('peers', collab.list()))
    })
  }

  server.on('upgrade', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (collab.authorized(req, url.searchParams) !== 'ok') return void socket.destroy()
    if (url.pathname === '/__pw/ws') return live(req, socket, url)
    // HMR and other websockets go straight through to the target.
    const target = cfg.target ?? cfg.siteUrl
    if (!target) return void socket.destroy()
    const t = new URL(target)
    const up = net.connect(Number(t.port || 80), t.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]
        const lk = k.toLowerCase()
        // Dev servers (Next.js) refuse HMR sockets from another origin: to them it must look like their own page.
        lines.push(`${k}: ${lk === 'host' ? t.host : lk === 'origin' ? t.origin : req.rawHeaders[i + 1]}`)
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
    for (const c of clients.keys()) c.close()
  })
  return server
}
