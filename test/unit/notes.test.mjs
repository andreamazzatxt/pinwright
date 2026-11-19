// A note's life: undo, replies, approval, guests.
// Runs against the compiled package: build first (`npm test` does).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { setup, agentEdits, finish } from '../helpers/notes.mjs'

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

test('a guest reply turns the note into a guest note', async () => {
  const { store, ops } = await setup()
  const n = store.create({ page: '/', text: 'host note' })
  assert.equal(n.guest, false)
  store.update(n.id, { status: 'done' })
  assert.equal(ops.reply(n.id, 'more', 'Gufo', true, true).guest, true)
})

test('an area note keeps its rectangle and its picture, and the prompt says what they are', async () => {
  const { store } = await setup()
  const { notePrompt } = await import('../../dist/agent.js')
  const n = store.create({ page: '/', text: 'tidy this', selector: 'main > section', region: { x: 10, y: 20, w: 300, h: 120 }, shots: { before: [], after: [], area: 'area-x.jpg' } })
  assert.deepEqual(n.region, { x: 10, y: 20, w: 300, h: 120 })
  assert.equal(n.shots.area, 'area-x.jpg')
  // Later shots don't lose it.
  const m = store.update(n.id, { shots: { ...n.shots, after: ['a.jpg'] } })
  assert.equal(m.shots.area, 'area-x.jpg')
  assert.match(notePrompt(n), /dragged out an area of 300×120px at 10,20 on the page: the image shows what they saw there/)
  assert.doesNotMatch(notePrompt(store.create({ page: '/', text: 'plain' })), /area/)
})
