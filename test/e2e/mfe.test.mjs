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
/** The guest of the live session, kept for the HMR test after it. */
let guest

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

test('a modal the remote renders through a React portal is in scope, and its focus trap leaves the note box alone', async () => {
  const page = await newPage(browser)
  await page.goto(`http://localhost:${SHELL_SITE}/`)
  await page.locator('#remote-button').waitFor({ timeout: 60_000 })
  await overlayReady(page)
  // What React leaves on a portal's DOM: fibers whose parents lead back into the remote's tree (here, faked).
  await page.evaluate((scope) => {
    const mount = document.querySelector(scope)
    const fiber = (stateNode, ret) => ({ stateNode, return: ret })
    const add = (id, ret) => {
      const box = document.createElement('div')
      box.id = id
      box.textContent = `${id} content`
      box.style.cssText = 'position:fixed;top:200px;left:200px;padding:30px;background:#fff'
      box.__reactFiber$test = fiber(box, fiber({ containerInfo: document.body }, ret))
      document.body.append(box)
      return box
    }
    add('remote-modal', fiber(mount, null))
    add('shell-modal', null).style.left = '600px'
    // A focus trap, the way MUI's works: focus that lands outside the modal is pulled back.
    const modal = document.querySelector('#remote-modal')
    modal.tabIndex = -1
    document.addEventListener('focusin', () => {
      if (!modal.contains(document.activeElement)) modal.focus()
    })
  }, SCOPE)
  assert.equal(await noteOpensOn(page, '#shell-modal'), false)
  assert.equal(await noteOpensOn(page, '#remote-modal'), true)
  await page.keyboard.type('typed inside a modal')
  assert.equal((await overlayState(page)).text, 'typed inside a modal')
  await page.keyboard.press('Enter')
  await sleep(300)
  // The modal closes: its pin goes with it, and comes back with it.
  const pinShown = () => page.evaluate(() => [...document.querySelector('pinwright-root').shadowRoot.querySelectorAll('.pin')].some((p) => p.style.display !== 'none' && /typed inside/.test(p.dataset.text)))
  assert.equal(await pinShown(), true)
  const modal = await page.evaluateHandle(() => document.querySelector('#remote-modal'))
  const frame = () => page.evaluate(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.scope').style.display)
  // In note mode the frame marks the microfrontend, but not across its own modal.
  assert.equal(await frame(), 'none')
  await page.evaluate((m) => m.remove(), modal)
  await sleep(200)
  assert.equal(await pinShown(), false)
  assert.equal(await frame(), 'block')
  await page.evaluate((m) => document.body.append(m), modal)
  await sleep(200)
  assert.equal(await pinShown(), true)
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

  guest = await newPage(browser, { headers: { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'http' } })
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

test('a guest sees the remote change by itself, through the link\'s HMR socket', async () => {
  // Reloaded once so the HMR socket opens while we watch.
  const sockets = []
  guest.on('websocket', (ws) => sockets.push(ws.url()))
  await guest.reload()
  await guest.locator('#widget').waitFor({ timeout: 60_000 })
  // An exposed module isn't hot-swapped: the dev server reloads the page, for the host and the guest alike.
  const restore = patchFile(join(REMOTE, 'src', 'widget.js'), 'Remote widget', 'Remote widget LIVE')
  try {
    await guest.waitForFunction(() => document.querySelector('#widget')?.textContent === 'Remote widget LIVE', null, { timeout: 30_000 })
    await overlayReady(guest)
    // No React in this shell: the hook pinwright adds for one doesn't make the update look stale.
    await sleep(2500)
    assert.equal(await guest.evaluate(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.stale').hidden), true)
  } finally {
    restore()
  }
  assert.ok(sockets.some((u) => u.startsWith(`ws://localhost:${PORT}/__pw/mfe/rsbuild-hmr`)), sockets.join(', '))
})

test('a note the host makes shows up on the guest\'s page live, and turns done live, without reloading anyone\'s page', async () => {
  const host = await newPage(browser)
  await host.goto(`http://localhost:${SHELL_SITE}/`)
  await host.locator('#remote-button').waitFor({ timeout: 60_000 })
  await overlayReady(host)
  await guest.locator('#remote-button').waitFor({ timeout: 60_000 })
  // The host's note, the way the overlay sends it.
  const note = await host.evaluate(
    (port) =>
      fetch(`http://localhost:${port}/__pw/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: location.pathname, text: 'host note', selector: '#remote-button', fx: 0.5, fy: 0.5 }) }).then((r) => r.json()),
    PORT,
  )
  const pin = (p, id) => p.evaluate((id) => document.querySelector('pinwright-root').shadowRoot.querySelector(`.pin[data-id="${id}"]`)?.className ?? null, id)
  await guest.waitForFunction((id) => !!document.querySelector('pinwright-root').shadowRoot.querySelector(`.pin[data-id="${id}"]`), note.id, { timeout: 5000 })
  // Done (by hand here: no agent runs in tests): the pin turns green, "Show done" off, and nobody's page reloads:
  // the changes come by HMR.
  await guest.evaluate(() => (window.__beforeDone = true))
  await host.evaluate(([port, id]) => fetch(`http://localhost:${port}/__pw/notes/${id}/done`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), [PORT, note.id])
  await guest.waitForFunction((id) => /s-done/.test(document.querySelector('pinwright-root').shadowRoot.querySelector(`.pin[data-id="${id}"]`)?.className ?? ''), note.id, { timeout: 5000 })
  assert.match(await pin(host, note.id), /s-done/)
  await sleep(3000)
  assert.equal(await guest.evaluate(() => window.__beforeDone), true, 'the guest is not reloaded')
  assert.equal(await host.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'navigate', 'the host is not reloaded')
})

test('Ctrl+C stops pinwright and the remote\'s dev server', async () => {
  assert.equal(await pw.stop(), true)
  assert.ok(await portsClosed([PORT, REMOTE_SITE]))
})
