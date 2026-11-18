// A daemon's parts without the server: a temp project, its store and ops, and an agent's edit as the guard sees it.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeChanges } from '../../dist/agent.js'
import { Bus } from '../../dist/bus.js'
import { loadConfig } from '../../dist/config.js'
import { openDb } from '../../dist/db.js'
import { Locks } from '../../dist/locks.js'
import { Ops } from '../../dist/ops.js'
import { Rebuilder } from '../../dist/rebuild.js'
import { Store } from '../../dist/store.js'
import { guardHook } from '../../dist/guard.js'

export async function setup() {
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
export async function agentEdits(ctx, noteId, file, content) {
  const hook = guardHook(ctx, noteId, async () => {})
  const out = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file } }, 'x', { signal: new AbortController().signal })
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow')
  writeFileSync(join(ctx.cfg.root, file), content)
}

export function finish(ctx, noteId) {
  const diff = finalizeChanges(ctx, noteId)
  ctx.locks.releaseAll(noteId)
  ctx.store.update(noteId, { status: 'done', diff })
  return diff
}
