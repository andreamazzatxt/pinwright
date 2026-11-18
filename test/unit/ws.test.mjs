// The live channel's WebSocket framing.
// Runs against the compiled package: build first (`npm test` does).
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('websocket: handshake, short, medium and long messages both ways', async () => {
  const http = await import('node:http')
  const { acceptWs } = await import('../../dist/ws.js')
  const server = http.createServer()
  server.on('upgrade', (req, socket) => {
    const c = acceptWs(req, socket)
    c.on('message', (m) => c.send(`echo:${m}`))
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/`)
  await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)))
  const got = []
  ws.onmessage = (e) => got.push(e.data)
  const msgs = ['hi', 'x'.repeat(300), 'y'.repeat(70000)]
  for (const m of msgs) ws.send(m)
  await new Promise((ok) => {
    const t = setInterval(() => got.length === msgs.length && (clearInterval(t), ok()), 20)
  })
  assert.deepEqual(got, msgs.map((m) => `echo:${m}`))
  ws.close()
  server.close()
})
