// Feedback pins on the local site: a proxy in front of `astro preview` that injects an
// overlay into every page. Notes land in .previews/notes/notes.json (git-ignored).
//   node .previews/notes/server.mjs [port=4340] [target=http://127.0.0.1:4330]
import { readFileSync, writeFileSync, existsSync, watchFile } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.argv[2] ?? 4340)
const TARGET = new URL(process.argv[3] ?? 'http://127.0.0.1:4330')
const FILE = join(here, 'notes.json')
const overlay = () => readFileSync(join(here, 'overlay.js'), 'utf8')
// Live reload: rebuild.sh touches .stamp once the new dist is in place; every open page hears it.
const STAMP = join(here, '.stamp')
if (!existsSync(STAMP)) writeFileSync(STAMP, '')
const clients = new Set()
watchFile(STAMP, { interval: 300 }, () => {
  for (const c of clients) c.write('data: reload\n\n')
})

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [])
const save = (notes) => writeFileSync(FILE, `${JSON.stringify(notes, null, 2)}\n`)
const body = (req) =>
  new Promise((ok) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => ok(s ? JSON.parse(s) : {}))
  })
const json = (res, data, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/__reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(': hi\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname === '/__notes') {
      if (req.method === 'GET') return json(res, load())
      if (req.method === 'POST') {
        const n = await body(req)
        const notes = load()
        const note = { id: Date.now().toString(36), at: new Date().toISOString(), done: false, ...n }
        notes.push(note)
        save(notes)
        return json(res, note, 201)
      }
      if (req.method === 'PATCH') {
        // The person answers a question Claude left on a note.
        const { answer } = await body(req)
        const notes = load()
        const note = notes.find((n) => n.id === url.searchParams.get('id'))
        if (!note) return json(res, { error: 'not found' }, 404)
        note.answer = answer
        note.answeredAt = new Date().toISOString()
        save(notes)
        return json(res, note)
      }
      if (req.method === 'DELETE') {
        save(load().filter((n) => n.id !== url.searchParams.get('id')))
        return json(res, { ok: true })
      }
    }
    const up = http.request(
      { host: TARGET.hostname, port: TARGET.port, path: req.url, method: req.method, headers: { ...req.headers, host: TARGET.host, 'accept-encoding': 'identity', 'if-none-match': '', 'if-modified-since': '' } },
      (r) => {
        const html = (r.headers['content-type'] ?? '').includes('text/html')
        if (!html) {
          res.writeHead(r.statusCode, r.headers)
          return r.pipe(res)
        }
        let s = ''
        r.setEncoding('utf8')
        r.on('data', (c) => (s += c))
        r.on('end', () => {
          s = s.replace('</body>', `<script>${overlay()}</script></body>`)
          // The overlay changes without the page changing: never let the browser reuse an old copy.
          const h = { ...r.headers, 'cache-control': 'no-store' }
          delete h['content-length']
          delete h.etag
          delete h['last-modified']
          res.writeHead(r.statusCode, h)
          res.end(s)
        })
      },
    )
    up.on('error', () => {
      res.writeHead(502)
      res.end('Anteprima non raggiungibile: avvia astro preview sulla porta ' + TARGET.port)
    })
    req.pipe(up)
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Note su http://localhost:${PORT}/it/`))
