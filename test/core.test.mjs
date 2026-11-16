// Runs against the compiled package: `pnpm build && pnpm test`.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { finalizeChanges } from '../dist/agent.js'
import { Bus } from '../dist/bus.js'
import { loadConfig } from '../dist/config.js'
import { openDb } from '../dist/db.js'
import { bashVerdict, checkPath, guardHook } from '../dist/guard.js'
import { Locks } from '../dist/locks.js'
import { Ops } from '../dist/ops.js'
import { Rebuilder } from '../dist/rebuild.js'
import { Store } from '../dist/store.js'

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pinwright-test-'))
  const cfg = await loadConfig({ root, config: false, log: () => {} })
  const bus = new Bus()
  const db = openDb(root)
  const store = new Store(db, bus)
  const ctx = { cfg, store, bus, locks: new Locks(root), shooter: null, rebuilder: new Rebuilder(cfg, bus) }
  const ops = new Ops(ctx, { abort() {} })
  const note = (text = 'n') => store.create({ page: '/', text })
  return { root, ctx, store, ops, note, db }
}

/** What the guard does before an edit, then the edit itself, then what the worker does after the run. */
async function agentEdits(ctx, noteId, file, content) {
  const hook = guardHook(ctx, noteId, async () => {})
  const out = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file } }, 'x', { signal: new AbortController().signal })
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow')
  writeFileSync(join(ctx.cfg.root, file), content)
}
function finish(ctx, noteId) {
  const diff = finalizeChanges(ctx, noteId)
  ctx.locks.releaseAll(noteId)
  ctx.store.update(noteId, { status: 'done', diff })
  return diff
}

test('locks: a directory overlaps the files inside it, and acquiring is all or nothing', () => {
  const l = new Locks('/p')
  assert.ok(l.tryAcquire('a', ['src/x.css']))
  assert.ok(!l.tryAcquire('b', ['src']))
  assert.ok(!l.tryAcquire('b', ['other.css', 'src/x.css']))
  assert.ok(l.tryAcquire('b', ['other.css']))
  assert.ok(l.tryAcquire('a', ['src/x.css']), 'the holder may take it again')
  l.releaseAll('a')
  assert.ok(l.tryAcquire('b', ['src']))
})

test('locks: acquireOne waits for the holder, and gives up at the timeout', async () => {
  const l = new Locks('/p')
  l.tryAcquire('a', ['f'])
  setTimeout(() => l.releaseAll('a'), 300)
  assert.ok(await l.acquireOne('b', 'f', 3000))
  assert.ok(!(await l.acquireOne('c', 'f', 200)))
})

test('guard: shell denylist', () => {
  for (const c of ['git commit -m x', 'git push', 'curl x', 'pnpm add y', 'sed -i "" s/a/b/ f', 'echo a > f', 'rm -rf dist', 'mv a b'])
    assert.ok(bashVerdict(c), c)
  for (const c of ['git status', 'git diff', 'pnpm -s typecheck 2>&1 | tail', 'ls > /dev/null', 'grep -rn "=>" src']) assert.equal(bashVerdict(c), null, c)
})

test('guard: paths outside root or in protected dirs are refused', () => {
  assert.deepEqual(checkPath('/p', 'src/a.ts'), { rel: 'src/a.ts', abs: '/p/src/a.ts' })
  for (const p of ['/etc/passwd', '../x', 'node_modules/a.js', '.git/config', '.pinwright/db.sqlite', 'apps/x/node_modules/y.js']) assert.ok('error' in checkPath('/p', p), p)
})

test('guard: an edit waits while another note holds the file', async () => {
  const { ctx, note } = await setup()
  const a = note('a')
  const b = note('b')
  writeFileSync(join(ctx.cfg.root, 'f.css'), 'x\n')
  ctx.locks.tryAcquire(a.id, ['f.css'])
  const hook = guardHook(ctx, b.id, async () => {})
  let done = false
  const p = hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'f.css' } }, 'x', { signal: new AbortController().signal }).then((r) => {
    done = true
    return r
  })
  await new Promise((r) => setTimeout(r, 400))
  assert.ok(!done, 'still waiting while a holds the lock')
  ctx.locks.releaseAll(a.id)
  assert.equal((await p).hookSpecificOutput.permissionDecision, 'allow')
  assert.equal(ctx.locks.holder('f.css'), b.id)
})

test('undo restores the original and removes created files', async () => {
  const { ctx, ops, note, root } = await setup()
  writeFileSync(join(root, 'a.css'), 'color: red;\n')
  const n = note()
  await agentEdits(ctx, n.id, 'a.css', 'color: blue;\n')
  await agentEdits(ctx, n.id, 'new.css', 'x\n')
  const diff = finish(ctx, n.id)
  assert.match(diff, /-color: red;/)
  assert.match(diff, /\+color: blue;/)
  await ops.undo(n.id)
  assert.equal(readFileSync(join(root, 'a.css'), 'utf8'), 'color: red;\n')
  assert.ok(!existsSync(join(root, 'new.css')))
  await assert.rejects(ops.undo(n.id), /already undone/)
})

test('undo of an earlier note keeps a later note on the same file', async () => {
  const { ctx, ops, note, root } = await setup()
  writeFileSync(join(root, 's.css'), ['.a { r: 4px; }', '.b { x: 1; }', '.c { c: #999; }', ''].join('\n'))
  const first = note('radius')
  await agentEdits(ctx, first.id, 's.css', ['.a { r: 12px; }', '.b { x: 1; }', '.c { c: #999; }', ''].join('\n'))
  finish(ctx, first.id)
  const second = note('color')
  await agentEdits(ctx, second.id, 's.css', ['.a { r: 12px; }', '.b { x: 1; }', '.c { c: #333; }', ''].join('\n'))
  finish(ctx, second.id)
  await ops.undo(first.id)
  assert.equal(readFileSync(join(root, 's.css'), 'utf8'), ['.a { r: 4px; }', '.b { x: 1; }', '.c { c: #333; }', ''].join('\n'))
})

test('undo is refused when a later edit rewrote the same lines', async () => {
  const { ctx, ops, note, root } = await setup()
  writeFileSync(join(root, 's.css'), 'a: 1;\n')
  const first = note()
  await agentEdits(ctx, first.id, 's.css', 'a: 2;\n')
  finish(ctx, first.id)
  writeFileSync(join(root, 's.css'), 'a: 3;\n')
  await assert.rejects(ops.undo(first.id), /undo refused: s.css/)
  assert.equal(readFileSync(join(root, 's.css'), 'utf8'), 'a: 3;\n')
})

test('a reply re-queues a finished note and resets its attempts', async () => {
  const { store, ops, note } = await setup()
  const n = note()
  store.update(n.id, { status: 'failed', attempts: 2 })
  const r = ops.reply(n.id, 'not quite')
  assert.equal(r.status, 'queued')
  assert.equal(r.attempts, 0)
  assert.deepEqual(store.messages(n.id).map((m) => m.text), ['n', 'not quite'])
})

test('websocket: handshake, short, medium and long messages both ways', async () => {
  const http = await import('node:http')
  const { acceptWs } = await import('../dist/ws.js')
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

test('approval link: notes and replies wait until the host approves', async () => {
  const { store, ops } = await setup()
  const n = store.create({ page: '/', text: 'from a guest', approved: false })
  assert.equal(n.approved, false)
  assert.equal(n.status, 'queued')
  assert.equal(ops.approve(n.id).approved, true)
  store.update(n.id, { status: 'done' })
  assert.equal(ops.reply(n.id, 'more', 'Gufo Zen', false).approved, false)
  assert.equal(ops.approve(n.id).approved, true)
  assert.equal(ops.reply(n.id, 'host follow-up').approved, true, 'the host never waits')
})

test('guard: protected files for every note, source dirs only for guests, reads stay in the project', async () => {
  const { editVerdict, readVerdict } = await import('../dist/guard.js')
  const dirs = ['src', 'public']
  for (const f of ['package.json', 'apps/web/package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'apps/landing/astro.config.mjs', '.env', 'apps/api/.env.local', 'scripts/deploy.sh', 'Dockerfile', '.github/workflows/ci.yml', 'pinwright.config.mjs', '.npmrc'])
    assert.ok(editVerdict(f, false, dirs), f)
  for (const f of ['src/a.css', 'apps/landing/src/pages/index.astro', 'public/logo.svg', 'README.md']) assert.equal(editVerdict(f, false, dirs), null, f)
  assert.equal(editVerdict('apps/landing/src/styles/brand.css', true, dirs), null)
  for (const f of ['README.md', 'index.html', 'lib/x.ts']) assert.ok(editVerdict(f, true, dirs), `guest ${f}`)
  assert.ok(readVerdict('/p', { file_path: '/Users/x/.ssh/id_rsa' }, false))
  assert.ok(readVerdict('/p', { path: '../other' }, false))
  assert.equal(readVerdict('/p', { file_path: 'src/a.ts' }, false), null)
  assert.equal(readVerdict('/p', { file_path: '.env' }, false), null, 'the host may read its env')
  assert.ok(readVerdict('/p', { file_path: '.env' }, true))
  assert.ok(readVerdict('/p', { file_path: 'certs/server.pem' }, true))
})

test('a guest reply turns the note into a guest note', async () => {
  const { store, ops } = await setup()
  const n = store.create({ page: '/', text: 'host note' })
  assert.equal(n.guest, false)
  store.update(n.id, { status: 'done' })
  assert.equal(ops.reply(n.id, 'more', 'Gufo', true, true).guest, true)
})
