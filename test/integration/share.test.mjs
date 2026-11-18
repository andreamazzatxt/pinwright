// Go live on a fixed address: your own tunnel (publicUrl) or your named Cloudflare tunnel, and the hooks that
// tell your setup about it. No real tunnel opens here: cloudflared is a fake.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startPinwright } from '../../dist/index.js'

const skip = process.platform === 'win32' && 'the fake cloudflared is a shebang script'
const FAKE_CLOUDFLARED = fileURLToPath(new URL('../helpers/fake-cloudflared.mjs', import.meta.url))

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

/** A daemon in front of a tiny site, with these options. */
async function daemon(opts) {
  const site = http.createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>site</body></html>'))
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok))
  const port = await freePort()
  const pw = await startPinwright({ root: mkdtempSync(join(tmpdir(), 'pinwright-share-')), config: false, port, target: `http://localhost:${site.address().port}`, maxAgents: 0, log: () => {}, ...opts })
  return { port, stop: async () => (await pw.stop(), site.close()) }
}

const share = (port) => request(port, '/__pw/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/a' }) }).then((r) => JSON.parse(r.body))

test('publicUrl: the links are built on it, nothing opens, and stopping voids them while your tunnel stays up', { skip }, async () => {
  const d = await daemon({ publicUrl: 'https://review.example.com/' })
  try {
    const { links } = await share(d.port)
    assert.match(links.review, /^https:\/\/review\.example\.com\/a\?pw=/)
    const token = new URL(links.review).searchParams.get('pw')
    // A tunnel that adds no header still names the public host: that's a guest, so the token is needed.
    const visitor = { host: 'review.example.com' }
    assert.equal((await request(d.port, '/a', { headers: visitor })).status, 403)
    const r = await request(d.port, `/a?pw=${token}`, { headers: visitor })
    assert.equal(r.status, 302)
    assert.match(r.headers['set-cookie'][0], /Secure/, 'the public URL is https')
    assert.match((await request(d.port, '/a', { headers: { ...visitor, cookie: `pw_t=${token}` } })).body, /site/)
    await request(d.port, '/__pw/share', { method: 'DELETE' })
    assert.equal((await request(d.port, '/a', { headers: { ...visitor, cookie: `pw_t=${token}` } })).status, 403)
  } finally {
    await d.stop()
  }
})

test('named Cloudflare tunnel: runs it on this port, links on its hostname', { skip }, async () => {
  const argsFile = join(mkdtempSync(join(tmpdir(), 'pinwright-cf-')), 'args.json')
  process.env.FAKE_CLOUDFLARED_ARGS = argsFile
  const d = await daemon({ cloudflared: FAKE_CLOUDFLARED, tunnel: 'review', hostname: 'review.example.com' })
  try {
    const { links } = await share(d.port)
    assert.match(links.auto, /^https:\/\/review\.example\.com\/a\?pw=/)
    assert.deepEqual(JSON.parse(readFileSync(argsFile, 'utf8')), ['tunnel', '--no-autoupdate', 'run', '--url', `http://127.0.0.1:${d.port}`, 'review'])
  } finally {
    await d.stop()
    delete process.env.FAKE_CLOUDFLARED_ARGS
  }
})

test('a named tunnel without its hostname is refused', { skip }, async () => {
  const d = await daemon({ cloudflared: FAKE_CLOUDFLARED, tunnel: 'review' })
  try {
    const r = await request(d.port, '/__pw/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(r.status, 500)
    assert.match(r.body, /hostname/)
  } finally {
    await d.stop()
  }
})

test('onShare / onUnshare: a command gets the URL in PINWRIGHT_URL, once per share', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinwright-hooks-'))
  const log = join(dir, 'log')
  const d = await daemon({
    publicUrl: 'https://me.example.com',
    onShare: `node -e "require('fs').appendFileSync(process.argv[1], 'share ' + process.env.PINWRIGHT_URL + '\\n')" ${log}`,
    onUnshare: `node -e "require('fs').appendFileSync(process.argv[1], 'unshare ' + process.env.PINWRIGHT_URL + '\\n')" ${log}`,
  })
  try {
    await share(d.port)
    await share(d.port)
    await request(d.port, '/__pw/share', { method: 'DELETE' })
    assert.equal(readFileSync(log, 'utf8'), 'share https://me.example.com\nunshare https://me.example.com\n')
  } finally {
    await d.stop()
  }
})

test('onShare as a function; a failing hook is logged and the share still works', { skip }, async () => {
  const seen = []
  const logs = []
  const d = await daemon({ publicUrl: 'https://me.example.com', onShare: (url) => seen.push(url), onUnshare: 'exit 3', log: (m) => logs.push(m) })
  try {
    assert.ok((await share(d.port)).links)
    assert.deepEqual(seen, ['https://me.example.com'])
    await request(d.port, '/__pw/share', { method: 'DELETE' })
    assert.ok(logs.some((m) => /onUnshare failed: exited 3/.test(m)), logs.join('\n'))
  } finally {
    await d.stop()
  }
})
