// A microfrontend guest's HMR client, pointed at the link: each dev server's way of naming its socket.
// Runs against the compiled package: build first (`npm test` does).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guestHmr } from '../../dist/server.js'

test('Rsbuild: path under /__pw/mfe, port and host from the page', () => {
  const src = `(0,hmr.init)('tok', {\n    "path": "/rsbuild-hmr",\n    "port": 9001,\n    "host": "",\n    "overlay": true\n}, "localhost", 9001, "/", true);`
  const { s, hit } = guestHmr(src)
  assert.ok(hit)
  assert.match(s, /"path": "\/__pw\/mfe\/rsbuild-hmr",\n\s*"port": 0,\n\s*"host": ""/)
})

test('webpack-dev-server / Rspack dev server: the client query uses the page\'s host, port and protocol', () => {
  const src = 'var __resourceQuery = "?protocol=ws%3A&hostname=localhost&port=8080&pathname=%2Fws&logging=info&overlay=true&reconnect=10&hot=true&live-reload=true";'
  const { s, hit } = guestHmr(src)
  assert.ok(hit)
  assert.ok(s.includes('"?protocol=auto%3A&hostname=0.0.0.0&port=0&pathname=%2F__pw%2Fmfe%2Fws&logging=info'), s)
})

test('Vite: the socket goes to the page\'s host and port, under /__pw/mfe', () => {
  const src = [
    'const serverHost = "localhost:5173/";',
    'const hmrPort = 24678;',
    'const socketHost = `${"localhost" || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/"}`;',
  ].join('\n')
  const { s, hit } = guestHmr(src)
  assert.ok(hit)
  assert.ok(s.includes('const hmrPort = null;'))
  assert.ok(s.includes('const socketHost = `${null || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/__pw/mfe/"}`;'), s)
})

test('anything else stays as it is', () => {
  const src = 'const port = 8080; fetch("/api?port=1&pathname=x"); const o = {"path": "/api", "port": 3}'
  assert.deepEqual(guestHmr(src), { s: src, hit: false })
})
