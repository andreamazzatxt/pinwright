// What an agent may read, edit and run, for the host and for guests.
// Runs against the compiled package: build first (`npm test` does).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { bashVerdict, checkPath, guardHook } from '../../dist/guard.js'
import { setup } from '../helpers/notes.mjs'

test('guard: shell denylist', () => {
  for (const c of ['git commit -m x', 'git push', 'curl x', 'pnpm add y', 'sed -i "" s/a/b/ f', 'echo a > f', 'rm -rf dist', 'mv a b'])
    assert.ok(bashVerdict(c), c)
  for (const c of ['git status', 'git diff', 'pnpm -s typecheck 2>&1 | tail', 'ls > /dev/null', 'grep -rn "=>" src']) assert.equal(bashVerdict(c), null, c)
})

test('guard: paths outside root or in protected dirs are refused', () => {
  assert.deepEqual(checkPath('/p', 'src/a.ts'), { rel: 'src/a.ts', abs: resolve('/p', 'src/a.ts') })
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

test('guard: protected files for every note, source dirs only for guests, reads stay in the project', async () => {
  const { editVerdict, readVerdict } = await import('../../dist/guard.js')
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

test('review-link notes: no server files, no code that reaches the machine', async () => {
  const { editVerdict, codeVerdict } = await import('../../dist/guard.js')
  const dirs = ['src', 'app']
  for (const f of ['src/app/api/x/route.ts', 'src/routes/+page.server.ts', 'src/routes/api/+server.ts', 'src/hooks.server.ts', 'src/middleware.ts', 'app/routes/home.server.tsx', 'src/server/db.ts'])
    assert.ok(editVerdict(f, true, dirs), f)
  for (const f of ['src/App.tsx', 'src/routes/posts/route.tsx', 'app/page.tsx', 'src/components/Hero.astro'])
    assert.equal(editVerdict(f, true, dirs), null, f)
  // The host (and the YOLO link) may.
  assert.equal(editVerdict('src/app/api/x/route.ts', false, dirs), null)
  for (const code of ['process.env.SECRET', "import fs from 'fs'", "import { readFileSync } from 'node:fs'", 'eval(x)', "await fetch('http://10.0.0.1')", "'use server'", "require('child_process')", 'await import(u)'])
    assert.ok(codeVerdict('<h1 class="a">Hi</h1>', `<h1 class="a">Hi</h1>{${code}}`), code)
  assert.equal(codeVerdict('<h1 class="a">Hi</h1>', '<h1 class="b" style={{ color: "red" }}>Hello</h1>'), null)
  // Already there, kept as it was: fine.
  assert.equal(codeVerdict('const k = process.env.X; <b>a</b>', 'const k = process.env.X; <b>b</b>'), null)
})
