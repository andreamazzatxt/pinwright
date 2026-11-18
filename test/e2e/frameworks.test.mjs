// The framework plugins: each dev server started as usual loads the overlay by itself, keeps HMR, and takes
// the daemon down with it.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fixture, launch, newPage, overlayReady, patchFile, portsClosed, run } from './helpers.mjs'

let browser
before(async () => (browser = await launch()))
after(() => browser?.close())

/** One fixture: start its dev script, check the overlay and HMR on `page`, then stop it. */
function suite(name, { dir, site, daemon, ready, file, from, to, selector }) {
  describe(name, () => {
    let dev
    before(async () => {
      rmSync(join(dir, '.pinwright'), { recursive: true, force: true })
      dev = run('npm', ['run', 'dev'], { cwd: dir })
      await dev.waitFor(ready)
      await dev.waitFor(/\[pinwright\] listening on http:\/\/127\.0\.0\.1:\d+/)
    })
    after(() => dev?.stop())

    test('loads the overlay on the dev server\'s own URL', async () => {
      const page = await newPage(browser)
      await page.goto(`http://localhost:${site}/`)
      await overlayReady(page, 120_000)
      const src = await page.evaluate(() => document.querySelector('script[data-pinwright]')?.src ?? [...document.scripts].find((s) => s.src.includes('/__pw/'))?.src)
      assert.equal(src, `http://127.0.0.1:${daemon}/__pw/overlay.js`)
      assert.deepEqual(page.errors, [])
    })

    test('keeps HMR', async () => {
      const page = await newPage(browser)
      await page.goto(`http://localhost:${site}/`)
      await overlayReady(page, 120_000)
      const restore = patchFile(join(dir, file), from, to)
      try {
        await page.waitForFunction(([s, t]) => document.querySelector(s)?.textContent === t, [selector, to], { timeout: 60_000 })
      } finally {
        restore()
      }
    })

    test('stopping the dev server stops the daemon', async () => {
      assert.equal(await dev.stop(), true)
      assert.ok(await portsClosed([site, daemon]))
    })
  })
}

suite('Vite plugin', {
  dir: fixture('vite-plugin'),
  site: 5602,
  daemon: 4602,
  ready: /Local:\s+http:\/\/localhost:5602/,
  file: 'main.js',
  from: 'Fixture title',
  to: 'Fixture title HMR',
  selector: '#title',
})

suite('Next.js (withPinwright + <Pinwright />)', {
  dir: fixture('next'),
  site: 5603,
  daemon: 4603,
  ready: /Local:\s+http:\/\/localhost:5603/,
  file: 'app/page.jsx',
  from: 'Next fixture',
  to: 'Next fixture HMR',
  selector: '#title',
})
