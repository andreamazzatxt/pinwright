// --target: the site behind pinwright is told the browser's address, so the absolute URLs it builds itself
// (an auth redirect's redirect_url) bring the browser back to pinwright, not to the dev server.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { startPinwright } from '../../dist/index.js'

let site, pw, D

const freePort = () =>
  new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })

function get(path, headers = {}) {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port: D, path, headers: { host: `127.0.0.1:${D}`, ...headers } }, (res) => {
      let s = ''
      res.on('data', (c) => (s += c))
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: s }))
    })
    req.on('error', fail)
    req.end()
  })
}

before(async () => {
  // Like an auth middleware: the redirect back is an absolute URL built from the forwarded headers, else from Host.
  site = http.createServer((req, res) => {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host
    const proto = req.headers['x-forwarded-proto'] ?? 'http'
    const back = encodeURIComponent(`${proto}://${host}${req.url}`)
    res.writeHead(307, { location: `/sign-in?redirect_url=${back}`, 'x-seen': JSON.stringify(req.headers) }).end()
  })
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok))
  D = await freePort()
  pw = await startPinwright({
    root: mkdtempSync(join(tmpdir(), 'pinwright-fwd-')),
    config: false,
    port: D,
    target: `http://127.0.0.1:${site.address().port}`,
    maxAgents: 0,
    log: () => {},
  })
})

after(async () => {
  await pw?.stop()
  site?.close()
})

test('a redirect the site builds from its request points back at pinwright, not at the dev server', async () => {
  const r = await get('/admin/mail')
  assert.equal(r.status, 307)
  assert.equal(r.headers.location, `/sign-in?redirect_url=${encodeURIComponent(`http://127.0.0.1:${D}/admin/mail`)}`)
  const seen = JSON.parse(r.headers['x-seen'])
  assert.equal(seen.host, `127.0.0.1:${site.address().port}`)
  assert.equal(seen['x-forwarded-port'], String(D))
})
