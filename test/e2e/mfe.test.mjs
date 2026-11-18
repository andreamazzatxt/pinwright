// Microfrontends: a Module Federation remote run by `pinwright --mfe`, mounted by a separate shell. The overlay
// rides in the remote's JavaScript, notes stay inside --scope, and Go live shares the shell with the remote in it.
// The tunnel is a fake cloudflared; a guest is a browser whose requests carry the headers cloudflared adds.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { FAKE_CLOUDFLARED, fixture, launch, newPage, overlayReady, overlayState, patchFile, pinwright, portsClosed, run, sleep } from './helpers.mjs'

const REMOTE = fixture('mf-remote')
const SHELL = fixture('mf-shell')
const PORT = 4604
const REMOTE_SITE = 5604
const SHELL_SITE = 5605
const SCOPE = '[data-mfe="remote"]'
let pw, shell, browser

before(async () => {
  rmSync(join(REMOTE, '.pinwright'), { recursive: true, force: true })
  const config = join(mkdtempSync(join(tmpdir(), 'pinwright-e2e-')), 'pinwright.config.json')
  writeFileSync(config, JSON.stringify({ cloudflared: FAKE_CLOUDFLARED }))
  pw = pinwright(['--mfe', '--scope', SCOPE, '--port', String(PORT), '--no-open', '--agents', '0', '--config', config], { cwd: REMOTE })
  shell = run('npm', ['run', 'dev'], { cwd: SHELL, env: { REMOTE_URL: `http://localhost:${PORT}` } })
  await pw.waitFor(/microfrontend .* load it from/)
  await shell.waitFor(new RegExp(`localhost:${SHELL_SITE}`))
  browser = await launch()
})

after(async () => {
  await browser?.close()
  await Promise.all([pw?.stop(), shell?.stop()])
})

/** Note mode on, then a click: whether a note card opened. */
async function noteOpensOn(page, selector) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.move(5, 5)
  await page.keyboard.press('n')
  await page.locator(selector).click()
  await sleep(300)
  return (await overlayState(page)).form
}

test('the shell gets the overlay with the remote, from pinwright', async () => {
  const page = await newPage(browser)
  await page.goto(`http://localhost:${SHELL_SITE}/`)
  await page.locator('#remote-button').waitFor({ timeout: 60_000 })
  await overlayReady(page)
  assert.equal(await page.evaluate(() => document.querySelector('script[data-pinwright]').src), `http://localhost:${PORT}/__pw/overlay.js`)
  assert.deepEqual(page.errors, [])
})

test('notes only inside --scope; the rest of the shell clicks as usual', async () => {
  const page = await newPage(browser)
  await page.goto(`http://localhost:${SHELL_SITE}/`)
  await page.locator('#remote-button').waitFor({ timeout: 60_000 })
  await overlayReady(page)
  assert.equal(await noteOpensOn(page, '#shell-title'), false)
  assert.equal(await noteOpensOn(page, '#remote-button'), true)
})

test('the remote\'s HMR reaches the shell through pinwright', async () => {
  const page = await newPage(browser)
  await page.goto(`http://localhost:${SHELL_SITE}/`)
  await page.locator('#widget').waitFor({ timeout: 60_000 })
  const restore = patchFile(join(REMOTE, 'src', 'widget.js'), 'Remote widget', 'Remote widget HMR')
  try {
    await page.waitForFunction(() => document.querySelector('#widget')?.textContent === 'Remote widget HMR', null, { timeout: 30_000 })
  } finally {
    restore()
  }
})

test('Go live shares the shell with the remote inside, and nothing a guest loads goes elsewhere', async () => {
  const host = await newPage(browser)
  await host.goto(`http://localhost:${SHELL_SITE}/`)
  await overlayReady(host)
  // What Go live does, from the shell page.
  const { links } = await host.evaluate((port) => fetch(`http://localhost:${port}/__pw/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/' }) }).then((r) => r.json()), PORT)
  assert.match(links.review, /^https:\/\/test-tunnel\.trycloudflare\.com\/\?pw=/)
  const token = new URL(links.review).searchParams.get('pw')

  const guest = await newPage(browser, { headers: { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'http' } })
  const elsewhere = []
  guest.on('request', (r) => {
    const u = new URL(r.url())
    if (/^(https?|wss?):$/.test(u.protocol) && u.port !== String(PORT)) elsewhere.push(r.url())
  })
  await guest.goto(`http://localhost:${PORT}/?pw=${token}`)
  await guest.locator('#shell-title').waitFor({ timeout: 60_000 })
  await guest.locator('#remote-button').waitFor({ timeout: 60_000 })
  await overlayReady(guest)
  assert.equal(await guest.evaluate(() => document.querySelector('script[data-pinwright]').src), `http://localhost:${PORT}/__pw/overlay.js`)
  assert.equal(await noteOpensOn(guest, '#shell-title'), false)
  assert.equal(await noteOpensOn(guest, '#remote-button'), true)
  assert.deepEqual(elsewhere, [])
})

test('Ctrl+C stops pinwright and the remote\'s dev server', async () => {
  assert.equal(await pw.stop(), true)
  assert.ok(await portsClosed([PORT, REMOTE_SITE]))
})
