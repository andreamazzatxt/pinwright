// The proxy without a browser: the localhost guards, and a microfrontend live session seen by a guest.
// Fake dev servers stand in for the shell and the remote; a fake cloudflared hands out the tunnel URL.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startPinwright } from '../../dist/index.js'

const FAKE_CLOUDFLARED = fileURLToPath(new URL('../helpers/fake-cloudflared.mjs', import.meta.url))
const TUNNEL = 'test-tunnel.trycloudflare.com'
const skip = process.platform === 'win32' && 'the fake cloudflared is a shebang script'

/** A dev server: path → [content-type, body]; anything else 404. Upgrades are accepted and their headers kept. */
function devServer(routes) {
  const upgrades = []
  const srv = http.createServer((req, res) => {
    const r = routes()[req.url]
    if (!r) return void res.writeHead(404).end('not here')
    res.writeHead(200, { 'content-type': r[0] }).end(r[1])
  })
  srv.on('upgrade', (req, socket) => {
    upgrades.push(req.headers)
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, upgrades })))
}

const freePort = () =>
  new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let s = ''
      res.on('data', (c) => (s += c))
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: s }))
    })
    req.on('error', fail)
    req.end(body)
  })
}

/** Opens a websocket handshake; resolves with the status line, or null when the socket is closed without one. */
function upgrade(port, path, origin) {
  return new Promise((ok) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: ${origin}\r\n\r\n`)
    })
    let got = ''
    s.on('data', (d) => {
      got += d
      if (got.includes('\r\n')) {
        ok(got.split('\r\n')[0])
        s.destroy()
      }
    })
    s.on('close', () => ok(got ? got.split('\r\n')[0] : null))
    s.on('error', () => ok(null))
  })
}

let remote, shell, pw, D
const guest = (token, extra = {}) => ({ host: TUNNEL, 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https', cookie: `pw_t=${token}`, ...extra })
let tokens

before(async () => {
  if (skip) return
  D = await freePort()
  remote = await devServer(() => ({
    '/': ['text/html', `<html><head><title>Remote</title></head><body><script src="http://localhost:${remote.port}/static/js/index.js"></script></body></html>`],
    '/remoteEntry.js': ['application/javascript', `var chunk = "http://localhost:${remote.port}/static/js/chunk.js"; var esc = "http:\\/\\/127.0.0.1:${remote.port}\\/x";`],
    '/static/js/index.js': ['application/javascript', 'console.log("remote")'],
    '/only-remote.js': ['application/javascript', 'window.onlyRemote = 1'],
  }))
  shell = await devServer(() => ({
    '/': ['text/html', `<html><head><title>Shell</title></head><body><a href="http://localhost:${shell.port}/about">about</a><script src="/main.js"></script></body></html>`],
    '/config.json': ['application/json', JSON.stringify({ remote: `http://localhost:${D}/remoteEntry.js` })],
  }))
  pw = await startPinwright({
    root: mkdtempSync(join(tmpdir(), 'pinwright-proxy-')),
    config: false,
    port: D,
    target: `http://localhost:${remote.port}`,
    mfe: true,
    maxAgents: 0,
    cloudflared: FAKE_CLOUDFLARED,
    log: () => {},
  })
})

after(async () => {
  await pw?.stop()
  remote?.srv.close()
  shell?.srv.close()
})

test('refuses a page that reaches localhost under another name (DNS rebinding)', { skip }, async () => {
  assert.equal((await request(D, '/', { headers: { host: `evil.example:${D}` } })).status, 421)
  assert.equal((await request(D, '/')).status, 200)
})

test('dev-server websockets pass for local pages only, looking like the dev server\'s own', { skip }, async () => {
  assert.equal(await upgrade(D, '/hmr', 'https://evil.example'), null)
  const before = remote.upgrades.length
  assert.match(await upgrade(D, '/hmr', `http://localhost:${shell.port}`), / 101 /)
  assert.equal(remote.upgrades.length, before + 1)
  assert.equal(remote.upgrades.at(-1).origin, `http://localhost:${remote.port}`)
})

test('microfrontend: the remote\'s scripts carry the overlay loader', { skip }, async () => {
  const r = await request(D, '/remoteEntry.js')
  assert.match(r.body, /var chunk/)
  assert.ok(r.body.trimEnd().endsWith('}'), 'loader appended')
  assert.ok(r.body.includes(`http://localhost:${D}/__pw/overlay.js`))
})

test('Go live in microfrontend mode needs the shell page', { skip }, async () => {
  const r = await request(D, '/__pw/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(r.status, 400)
  assert.match(r.body, /shell/)
})

test('Go live from the shell page gives two links on the tunnel', { skip }, async () => {
  const r = await request(D, '/__pw/share', { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://localhost:${shell.port}` }, body: JSON.stringify({ page: '/' }) })
  assert.equal(r.status, 200, r.body)
  const { links } = JSON.parse(r.body)
  tokens = Object.fromEntries(Object.entries(links).map(([k, l]) => [k, new URL(l).searchParams.get('pw')]))
  assert.ok(links.auto.startsWith(`https://${TUNNEL}/?pw=`))
  assert.ok(tokens.auto && tokens.review && tokens.auto !== tokens.review)
})

test('a guest without the token is turned away; the link sets the cookie', { skip }, async () => {
  assert.equal((await request(D, '/', { headers: guest('wrong') })).status, 403)
  const r = await request(D, `/?pw=${tokens.review}`, { headers: guest('') })
  assert.equal(r.status, 302)
  assert.match(r.headers['set-cookie'][0], /pw_t=.*HttpOnly.*Secure/)
})

test('a guest gets the shell, with every local address pointed at the tunnel', { skip }, async () => {
  const page = await request(D, '/', { headers: guest(tokens.review) })
  assert.match(page.body, /<title>Shell<\/title>/)
  assert.ok(page.body.includes(`https://${TUNNEL}/about`))
  assert.ok(!page.body.includes('localhost'))
  assert.ok(!page.body.includes('/__pw/overlay.js'), 'the overlay comes with the remote, not the shell')
  const cfg = await request(D, '/config.json', { headers: guest(tokens.review) })
  assert.equal(JSON.parse(cfg.body).remote, `https://${TUNNEL}/__pw/mfe/remoteEntry.js`)
})

test('a guest gets the remote under /__pw/mfe, rewritten, with the overlay from the tunnel', { skip }, async () => {
  const r = await request(D, '/__pw/mfe/remoteEntry.js', { headers: guest(tokens.review) })
  assert.ok(r.body.includes(`https://${TUNNEL}/__pw/mfe/static/js/chunk.js`))
  assert.ok(!/localhost|127\.0\.0\.1/.test(r.body.replace(/https:\/\/test-tunnel/g, '')), r.body)
  assert.ok(r.body.includes(`https://${TUNNEL}/__pw/overlay.js`))
  // What the shell's dev server doesn't have may be the remote's (root-relative assets).
  const only = await request(D, '/only-remote.js', { headers: guest(tokens.review) })
  assert.match(only.body, /onlyRemote/)
})

test('review-link notes wait and run under the guest rules; YOLO-link notes run as the host\'s', { skip }, async () => {
  const post = (token) =>
    request(D, '/__pw/notes', { method: 'POST', headers: guest(token, { 'content-type': 'application/json' }), body: JSON.stringify({ page: '/', text: 'make it red' }) }).then((r) => JSON.parse(r.body))
  const review = await post(tokens.review)
  assert.equal(review.approved, false)
  assert.equal(review.guest, true)
  const yolo = await post(tokens.auto)
  assert.equal(yolo.approved, true)
  assert.equal(yolo.guest, false)
})
