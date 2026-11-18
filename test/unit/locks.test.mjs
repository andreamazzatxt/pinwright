// File locks: what overlaps, and waiting for the holder.
// Runs against the compiled package: build first (`npm test` does).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Locks } from '../../dist/locks.js'

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
