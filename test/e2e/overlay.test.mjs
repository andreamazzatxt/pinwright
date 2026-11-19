// The overlay on a plain Vite site run through `npx pinwright` (stealth mode): note mode, ⌥, dictation, HMR,
// and that stopping leaves nothing behind.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, afterEach, before, test } from 'node:test'
import { fixture, launch, newPage as openPage, notes, overlayReady, overlayState, patchFile, pinwright, portsClosed, REPO, sleep } from './helpers.mjs'

const DIR = fixture('vite')
const PORT = 4601
const SITE = 5601
let pw, browser, url
/** Files git doesn't know about in the fixture (gitignored ones aside): pinwright must not add any. */
const untracked = () => execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', DIR], { cwd: REPO, encoding: 'utf8' })
/** The fixture's changes against git (your own edits, before a commit, included): pinwright must add none. */
const changed = () => execFileSync('git', ['diff', '--stat', '--', DIR], { cwd: REPO, encoding: 'utf8' })
let untrackedBefore, changedBefore

before(async () => {
  // A fresh store: notes (and their pins) from an earlier run would sit under the clicks.
  rmSync(join(DIR, '.pinwright'), { recursive: true, force: true })
  untrackedBefore = untracked()
  changedBefore = changed()
  pw = pinwright(['-y', '--no-open', '--port', String(PORT), '--agents', '0'], { cwd: DIR })
  url = (await pw.waitFor(/open (http:\/\/localhost:\d+\/)/))[1]
  browser = await launch()
})

/** Pages close after each test: an open one stays on the live channel and counts as a person. */
const opened = []
const newPage = async (...args) => {
  const p = await openPage(...args)
  opened.push(p)
  return p
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((p) => p.context().close()))
})

after(async () => {
  await browser?.close()
  await pw?.stop()
})

test('runs the dev script behind the proxy and loads the overlay', async () => {
  assert.equal(url, `http://localhost:${PORT}/`)
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  assert.equal(await page.textContent('#title'), 'Fixture title')
  assert.deepEqual(page.errors, [])
})

test('HMR goes through the proxy', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  const restore = patchFile(join(DIR, 'main.js'), 'Fixture title', 'Fixture title HMR')
  try {
    await page.waitForFunction(() => document.querySelector('#title')?.textContent === 'Fixture title HMR', null, { timeout: 20_000 })
  } finally {
    restore()
  }
})

test('the hub enters note mode compact; a second click opens the list; Esc steps back', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  const hub = page.locator('pinwright-root .hub')
  await hub.click()
  assert.deepEqual((({ mode, list }) => ({ mode, list }))(await overlayState(page)), { mode: true, list: false })
  await hub.click()
  assert.equal((await overlayState(page)).list, true)
  await page.keyboard.press('Escape')
  assert.deepEqual((({ mode, list }) => ({ mode, list }))(await overlayState(page)), { mode: true, list: false })
  await page.keyboard.press('Escape')
  assert.equal((await overlayState(page)).mode, false)
})

test('holding ⌥ highlights, ⌥ + click writes a note, Enter saves it', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  const box = await page.locator('#title').boundingBox()
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 12, box.y + 12)
  assert.equal((await overlayState(page)).highlight, true)
  await page.mouse.click(box.x + 12, box.y + 12)
  await page.keyboard.up('Alt')
  assert.equal((await overlayState(page)).form, true)
  await page.keyboard.type('make the title bigger')
  await page.keyboard.press('Enter')
  await sleep(300)
  const saved = (await notes(page)).find((n) => n.text === 'make the title bigger')
  assert.ok(saved, 'note saved')
  assert.equal(saved.selector, '#title')
})

test('⌥ still works on a page that swallows every key', async () => {
  const page = await newPage(browser, { swallowKeys: true })
  await page.goto(url)
  await overlayReady(page)
  const box = await page.locator('#cta').boundingBox()
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 8, box.y + 8)
  assert.equal((await overlayState(page)).highlight, true)
  await page.mouse.click(box.x + 8, box.y + 8)
  await page.keyboard.up('Alt')
  assert.equal((await overlayState(page)).form, true)
})

/** ⌥ + click on an element, keeping ⌥ down for `holdMs`, then letting go. */
async function altHoldClick(page, selector, holdMs) {
  // Off the left edge, where earlier tests' notes left their pins.
  const box = await page.locator(selector).boundingBox()
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.move(x, y)
  await page.keyboard.down('Alt')
  await page.mouse.click(x, y)
  await sleep(holdMs)
  const during = await overlayState(page)
  await page.keyboard.up('Alt')
  await sleep(300)
  return during
}

test('new code that React does not redraw: a round button offers the reload; redrawn code does not', async () => {
  const page = await newPage(browser)
  // React's DevTools hook, as a page whose React started before it (no renderer) or one that redraws (one).
  await page.addInitScript(() => {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(window.name === 'redraws' ? [[1, {}]] : []), onCommitFiberRoot() {} }
  })
  await page.goto(url)
  await overlayReady(page)
  const stale = () => page.evaluate(() => !document.querySelector('pinwright-root').shadowRoot.querySelector('.stale').hidden)
  assert.equal(await stale(), false)
  // A hot update, the way Vite fetches one, and no redraw after it.
  await page.evaluate(() => fetch(`/main.js?t=${Date.now()}`))
  await page.waitForFunction(() => !document.querySelector('pinwright-root').shadowRoot.querySelector('.stale').hidden, null, { timeout: 5000 })
  // No renderer on record, no extension: the tip suggests React DevTools.
  assert.match(await page.locator('pinwright-root .stale').getAttribute('data-tip'), /React DevTools/)
  // A click reloads the page, and the button is gone.
  await Promise.all([page.waitForEvent('load'), page.locator('pinwright-root .stale').click()])
  await overlayReady(page)
  assert.equal(await stale(), false)
  // The same update on a page whose React redraws: no button.
  await page.evaluate(() => (window.name = 'redraws'))
  await page.reload()
  await overlayReady(page)
  await page.evaluate(async () => {
    await fetch(`/main.js?t=${Date.now()}`)
    await new Promise((r) => setTimeout(r, 100))
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, {})
  })
  await sleep(2500)
  assert.equal(await stale(), false)
  assert.deepEqual(page.errors, [])
})

test('on a phone: the button arms one note, a tap puts it there, the card fits the screen', async () => {
  const page = await newPage(browser, { phone: true })
  await page.goto(url)
  await overlayReady(page)
  const hub = page.locator('pinwright-root .hub')
  await hub.tap()
  assert.equal((await overlayState(page)).mode, true)
  assert.match(await hub.textContent(), /Tap where the note goes/)
  const box = await page.locator('#title').boundingBox()
  // Away from the pins earlier tests left on the title.
  await page.touchscreen.tap(box.x + box.width - 20, box.y + box.height / 2)
  await page.waitForFunction(() => !!document.querySelector('pinwright-root').shadowRoot.querySelector('.form'), null, { timeout: 5000 })
  // One note per press: the page is the page's again.
  assert.equal((await overlayState(page)).mode, false)
  const card = await page.locator('pinwright-root .form').boundingBox()
  assert.ok(card.x >= 8 && card.x + card.width <= 390 - 8, `card inside the screen: ${JSON.stringify(card)}`)
  await page.keyboard.type('bigger on mobile')
  await page.locator('pinwright-root .form .ok').tap()
  await sleep(300)
  const saved = (await notes(page)).find((n) => n.text === 'bigger on mobile')
  assert.ok(saved, 'note saved')
  assert.equal(saved.selector, '#title')
  assert.equal(saved.viewport, '390x844')
  assert.deepEqual(page.errors, [])
})

test('on a phone, press and hold in note mode: a ring around the finger, the note is dictated, lifting saves it', async () => {
  const page = await newPage(browser, { phone: true, speech: true })
  await page.goto(url)
  await overlayReady(page)
  await page.evaluate(() => (window.__say = 'said with a finger down'))
  await page.locator('pinwright-root .hub').tap()
  const box = await page.locator('#title').boundingBox()
  const pt = { x: box.x + box.width - 30, y: box.y + box.height / 2 }
  // The pins earlier tests left on the title stay out of the finger's way.
  await page.evaluate(() => document.querySelector('pinwright-root').shadowRoot.querySelectorAll('.pin').forEach((p) => (p.style.pointerEvents = 'none')))
  const cdp = await page.context().newCDPSession(page)
  const touch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: pt.x, y: pt.y }] })
  await touch('touchStart')
  await sleep(800)
  const ring = await page.evaluate(() => {
    const r = document.querySelector('pinwright-root').shadowRoot.querySelector('.talkring')
    return { shown: !r.hidden, state: r.dataset.state, left: parseFloat(r.style.left), top: parseFloat(r.style.top) }
  })
  assert.equal(ring.shown, true)
  assert.equal(ring.state, 'rec')
  assert.ok(Math.abs(ring.left - pt.x) < 2 && Math.abs(ring.top - pt.y) < 2, JSON.stringify(ring))
  assert.equal((await overlayState(page)).text, 'said with a finger down')
  // Note mode is over by now, but the finger is still down: no iOS menu, link preview or selection under it.
  const still = () => page.evaluate(() => [document.querySelector('pinwright-root').hasAttribute('data-press'), getComputedStyle(document.querySelector('#title')).userSelect])
  assert.deepEqual(await still(), [true, 'none'])
  // Safari ends its recognizer by itself after a moment: with the finger still down, listening goes on.
  await page.evaluate(() => {
    window.__say = 'and a bit more'
    window.__recognizers.at(-1).onend()
  })
  await sleep(200)
  assert.equal(await page.evaluate(() => window.__recognizers.length), 2)
  assert.equal((await overlayState(page)).text, 'said with a finger down and a bit more')
  // Or it fails along the way: still the finger is down, so a new one listens, and nothing said is lost.
  await page.evaluate(() => {
    window.__say = ''
    const r = window.__recognizers.at(-1)
    r.onerror({ error: 'network' })
    r.onend()
  })
  await sleep(200)
  assert.equal(await page.evaluate(() => window.__recognizers.length), 3)
  assert.equal((await overlayState(page)).text, 'said with a finger down and a bit more')
  await touch('touchEnd')
  await sleep(400)
  const saved = (await notes(page)).find((n) => n.text === 'said with a finger down and a bit more')
  assert.ok(saved, 'note saved')
  assert.equal(saved.selector, '#title')
  const after = await page.evaluate(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.talkring').hidden)
  assert.equal(after, true)
  assert.equal((await overlayState(page)).form, false)
  assert.deepEqual(await still(), [false, 'auto'])
  assert.deepEqual(page.errors, [])
})

test('the notes pill can be dragged; it stays where it was dropped, and the drag is not a click', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  const hub = page.locator('pinwright-root .hub')
  const a = await hub.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x - 200, a.y - 150, { steps: 8 })
  await page.mouse.up()
  const b = await hub.boundingBox()
  assert.ok(Math.abs(b.x - (a.x - 200 - a.width / 2)) < 3 && Math.abs(b.y - (a.y - 150 - a.height / 2)) < 3, JSON.stringify({ a, b }))
  assert.equal((await overlayState(page)).mode, false, 'the drag did not turn note mode on')
  await page.reload()
  await overlayReady(page)
  const c = await hub.boundingBox()
  assert.ok(Math.abs(c.x - b.x) < 3 && Math.abs(c.y - b.y) < 3, JSON.stringify({ b, c }))
  // Still a button: a click turns note mode on.
  await hub.click()
  assert.equal((await overlayState(page)).mode, true)
  await page.evaluate(() => localStorage.removeItem('pw-dock'))
  assert.deepEqual(page.errors, [])
})

test('dictation: hold ⌥ after the click, talk, let go: the note is saved as said', async () => {
  const page = await newPage(browser, { speech: true })
  await page.goto(url)
  await overlayReady(page)
  await page.evaluate(() => (window.__say = 'make the button green'))
  const during = await altHoldClick(page, '#cta', 700)
  assert.equal(during.listening, true)
  assert.equal(during.text, 'make the button green')
  assert.equal((await overlayState(page)).form, false, 'saved and closed')
  assert.ok((await notes(page)).some((n) => n.text === 'make the button green'))
})

test('dictation: nothing said, the card shakes and says so; a quick ⌥ + click never listens', async () => {
  const page = await newPage(browser, { speech: true })
  await page.goto(url)
  await overlayReady(page)
  await altHoldClick(page, '#text', 700)
  const s = await overlayState(page)
  assert.equal(s.form, true)
  assert.equal(s.shake, true)
  assert.equal(s.nudge, 'You didn’t say anything')
  await page.keyboard.press('Escape')
  const quick = await altHoldClick(page, '#title', 50)
  assert.equal(quick.listening, false)
  assert.equal(await page.evaluate(() => window.__recognizers.length), 1, 'only the first hold started one')
})

test('dictation: a blocked microphone is explained; ⌥ + another key types instead', async () => {
  const page = await newPage(browser, { speech: true })
  await page.goto(url)
  await overlayReady(page)
  await page.evaluate(() => (window.__speechError = 'not-allowed'))
  await altHoldClick(page, '#text', 700)
  assert.match((await overlayState(page)).nudge, /Microphone blocked/)
  await page.evaluate(() => (window.__speechError = null))
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyG')
  await sleep(600)
  await page.keyboard.up('Alt')
  assert.equal(await page.evaluate(() => window.__recognizers.length), 1)
})

test('dictation: the mic button starts and stops, and leaves the text to edit', async () => {
  const page = await newPage(browser, { speech: true })
  await page.goto(url)
  await overlayReady(page)
  await page.evaluate(() => (window.__say = 'tighter spacing'))
  await page.keyboard.press('n')
  await page.locator('#text').click()
  const mic = page.locator('pinwright-root .form .mic')
  await mic.click()
  await sleep(200)
  assert.equal((await overlayState(page)).listening, true)
  await mic.click()
  await sleep(200)
  const s = await overlayState(page)
  assert.deepEqual([s.listening, s.form, s.text], [false, true, 'tighter spacing'])
})

/** Two people on the site: each page with its own tab id, both on the live channel. */
async function twoPeople() {
  const [a, b] = [await newPage(browser), await newPage(browser)]
  for (const p of [a, b]) {
    await p.setViewportSize({ width: 1000, height: 700 })
    await p.goto(url)
    await overlayReady(p)
  }
  // Each sees the other's avatar.
  for (const p of [a, b]) await p.waitForFunction(() => document.querySelector('pinwright-root').shadowRoot.querySelectorAll('.people span').length === 2)
  return [a, b]
}
const otherChip = (p) => p.locator('pinwright-root .people span:not(.me)')
const followFrameShown = (p) => p.evaluate(() => !document.querySelector('pinwright-root').shadowRoot.querySelector('.followframe').hidden)

test('clicking someone\'s avatar: Go to brings my view to theirs', async () => {
  const [a, b] = await twoPeople()
  await b.mouse.move(300, 300)
  await b.evaluate(() => scrollTo(0, 1800))
  await sleep(400)
  await otherChip(a).click()
  await a.locator('pinwright-root .personcard button', { hasText: 'Go to' }).click()
  await a.waitForFunction(() => Math.abs(scrollY - 1800) < 50, null, { timeout: 5000 })
  assert.equal(await followFrameShown(a), false, 'going there is not following')
})

test('Follow: my view keeps up with theirs, across pages, until I scroll myself', async () => {
  const [a, b] = await twoPeople()
  await otherChip(a).click()
  await a.locator('pinwright-root .personcard button', { hasText: 'Follow' }).click()
  assert.equal(await followFrameShown(a), true)
  await b.mouse.move(300, 300)
  await b.evaluate(() => scrollTo(0, 1200))
  await a.waitForFunction(() => Math.abs(scrollY - 1200) < 50, null, { timeout: 5000 })
  // They change page: so do I, and I keep following there.
  await b.goto(new URL('/about.html', url).href)
  await overlayReady(b)
  await b.mouse.move(200, 200)
  await a.waitForURL(/\/about\.html$/, { timeout: 10_000 })
  await overlayReady(a)
  await a.waitForFunction(() => !document.querySelector('pinwright-root').shadowRoot.querySelector('.followframe').hidden, null, { timeout: 10_000 })
  await b.evaluate(() => scrollTo(0, 900))
  await a.waitForFunction(() => Math.abs(scrollY - 900) < 50, null, { timeout: 5000 })
  // My own wheel takes over.
  await a.mouse.move(500, 300)
  await a.mouse.wheel(0, 200)
  await sleep(200)
  assert.equal(await followFrameShown(a), false)
  await b.evaluate(() => scrollTo(0, 2500))
  await sleep(600)
  assert.ok(Math.abs((await a.evaluate(() => scrollY)) - 2500) > 300, 'no longer following')
})

test('in a live session my own pointer wears my colour', async () => {
  const [a] = await twoPeople()
  const color = await a.evaluate(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.people span.me').style.getPropertyValue('--pc'))
  const cursor = await a.evaluate(() => getComputedStyle(document.documentElement).cursor)
  assert.ok(cursor.startsWith('url('), cursor)
  assert.ok(decodeURIComponent(cursor).includes(`fill='${color}'`), `${color} in ${decodeURIComponent(cursor).slice(0, 200)}`)
})

test('while someone writes a note, the others see a pin in their colour there, with dots, until it is closed', async () => {
  const [a, b] = await twoPeople()
  const typing = () => b.evaluate(() => {
    const el = document.querySelector('pinwright-root').shadowRoot.querySelector('.pin.typing')
    return el && el.style.display !== 'none' ? { color: el.style.getPropertyValue('--c'), dots: el.querySelectorAll('.dots b').length } : null
  })
  const color = await a.evaluate(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.people span.me').style.getPropertyValue('--pc'))
  const box = await a.locator('#text').boundingBox()
  await a.keyboard.down('Alt')
  await a.mouse.click(box.x + 20, box.y + 5)
  await a.keyboard.up('Alt')
  await b.waitForFunction(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.pin.typing')?.style.display === 'grid', null, { timeout: 5000 })
  assert.deepEqual(await typing(), { color, dots: 3 })
  await a.keyboard.press('Escape')
  await b.waitForFunction(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.pin.typing')?.style.display === 'none', null, { timeout: 5000 })
})

test('the round + button: one note, then note mode ends by itself; pressed again, it cancels', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  const add = page.locator('pinwright-root .addone')
  await add.click()
  assert.equal((await overlayState(page)).mode, true)
  const box = await page.locator('#text').boundingBox()
  await page.mouse.click(box.x + box.width - 30, box.y + 5)
  assert.equal((await overlayState(page)).form, true)
  assert.equal((await overlayState(page)).mode, false)
  await page.keyboard.press('Escape')
  await add.click()
  await add.click()
  assert.equal((await overlayState(page)).mode, false)
})

test('in note mode the button still offers Go live', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  await page.locator('pinwright-root .hub').click()
  assert.equal((await overlayState(page)).mode, true)
  assert.equal(await page.locator('pinwright-root .face .golive').count(), 1)
})

test('the list shows only the three latest done notes', async () => {
  const page = await newPage(browser)
  await page.goto(url)
  await overlayReady(page)
  const ids = []
  for (let i = 0; i < 5; i++) {
    const n = await page.evaluate((i) => fetch('/__pw/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/', text: `done ${i}`, selector: '#cta', fx: 0.5, fy: 0.5 }) }).then((r) => r.json()), i)
    await page.evaluate((id) => fetch(`/__pw/notes/${id}/done`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), n.id)
    ids.push(n.id)
    await sleep(20)
  }
  await sleep(300)
  await page.locator('pinwright-root .hub').click()
  await page.locator('pinwright-root .hub').click()
  const listed = () => page.evaluate(() => [...document.querySelector('pinwright-root').shadowRoot.querySelectorAll('.list li')].map((li) => li.textContent).filter((t) => /done \d/.test(t)))
  const shown = await listed()
  assert.equal(shown.length, 3, shown.join(' | '))
  assert.ok(['done 4', 'done 3', 'done 2'].every((t) => shown.some((s) => s.includes(t))), shown.join(' | '))
})

test('the page keeps the five latest done pins; a long press hides one, and it waits in the list, where a click puts it back', async () => {
  const page = await newPage(browser)
  await page.goto(new URL('/about.html', url).href)
  await overlayReady(page)
  for (let i = 0; i < 7; i++) {
    const n = await page.evaluate((i) => fetch('/__pw/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/about.html', text: `about ${i}`, selector: '#about', fx: 0.05 + i * 0.12, fy: 0.5 }) }).then((r) => r.json()), i)
    await page.evaluate((id) => fetch(`/__pw/notes/${id}/done`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), n.id)
    await sleep(20)
  }
  const shadow = (fn, arg) => page.evaluate(([fn, arg]) => new Function('s', 'arg', `return (${fn})(s, arg)`)(document.querySelector('pinwright-root').shadowRoot, arg), [fn.toString(), arg])
  const pins = () => shadow((s) => s.querySelectorAll('.pin.s-done').length)
  const chip = () => shadow((s) => (s.querySelector('.hiddenchip').hidden ? null : s.querySelector('.hiddenchip').textContent))
  await page.waitForFunction(() => document.querySelector('pinwright-root').shadowRoot.querySelectorAll('.pin.s-done').length === 5, null, { timeout: 5000 })
  assert.equal(await chip(), null)
  // Hold one down: it goes, the panel doesn't open, and a short notice says where it went.
  const pin = page.locator('pinwright-root .pin.s-done').first()
  const id = await pin.getAttribute('data-id')
  const box = await pin.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await sleep(800)
  await page.mouse.up()
  await sleep(300)
  assert.equal(await shadow((s) => !!s.querySelector('.panel')), false)
  assert.equal(await chip(), 'Pin hidden: it’s in the list')
  assert.equal(await shadow((s, id) => !!s.querySelector(`.pin[data-id="${id}"]`), id), false)
  assert.equal(await pins(), 5, 'the next latest takes its place')
  // The notice goes by itself.
  await page.waitForFunction(() => document.querySelector('pinwright-root').shadowRoot.querySelector('.hiddenchip').hidden, null, { timeout: 7000 })
  // Still put away after a reload, and in the list, marked hidden; a click there brings the pin back.
  await page.reload()
  await overlayReady(page)
  await page.locator('pinwright-root .hub').click()
  await page.locator('pinwright-root .hub').click({ position: { x: 20, y: 20 } })
  const row = page.locator('pinwright-root .list li.hid')
  await row.waitFor({ timeout: 5000 })
  assert.match(await row.textContent(), /hidden/)
  await row.click()
  await page.waitForFunction((id) => !!document.querySelector('pinwright-root').shadowRoot.querySelector(`.pin[data-id="${id}"]`), id, { timeout: 5000 })
})

test('single-page navigation: a note made after it belongs to the new path, and whoever is there sees its pin live', async () => {
  const [a, b] = await twoPeople()
  await b.goto(new URL('/spa-route', url).href)
  await overlayReady(b)
  // A arrived at / and moves on with the router, no reload.
  await a.locator('#spa-link').click()
  assert.equal(new URL(a.url()).pathname, '/spa-route')
  const box = await a.locator('#text').boundingBox()
  await a.mouse.move(box.x + box.width / 2, box.y + 5)
  await a.keyboard.down('Alt')
  await a.mouse.click(box.x + box.width / 2, box.y + 5)
  await a.keyboard.up('Alt')
  await a.keyboard.type('note on the client-side route')
  await a.keyboard.press('Enter')
  await sleep(300)
  const n = (await notes(a)).find((x) => x.text === 'note on the client-side route')
  assert.equal(n.page, '/spa-route')
  const hasPin = (p) => p.evaluate((id) => !!document.querySelector('pinwright-root').shadowRoot.querySelector(`.pin[data-id="${id}"]`), n.id)
  await b.waitForFunction((id) => !!document.querySelector('pinwright-root').shadowRoot.querySelector(`.pin[data-id="${id}"]`), n.id, { timeout: 5000 })
  assert.equal(await hasPin(a), true)
  // Back on /, that pin isn't there.
  await a.goBack()
  await a.waitForFunction(() => location.pathname === '/')
  await sleep(700)
  assert.equal(await hasPin(a), false)
})

test('Ctrl+C stops pinwright and the dev server, and leaves git clean', async () => {
  assert.equal(await pw.stop(), true)
  assert.ok(await portsClosed([PORT, SITE]))
  assert.equal(untracked(), untrackedBefore)
  assert.equal(changed(), changedBefore)
})
