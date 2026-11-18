// The overlay on a plain Vite site run through `npx pinwright` (stealth mode): note mode, ⌥, dictation, HMR,
// and that stopping leaves nothing behind.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fixture, launch, newPage, notes, overlayReady, overlayState, patchFile, pinwright, portsClosed, REPO, sleep } from './helpers.mjs'

const DIR = fixture('vite')
const PORT = 4601
const SITE = 5601
let pw, browser, url
/** Files git doesn't know about in the fixture (gitignored ones aside): pinwright must not add any. */
const untracked = () => execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', DIR], { cwd: REPO, encoding: 'utf8' })
let untrackedBefore

before(async () => {
  // A fresh store: notes (and their pins) from an earlier run would sit under the clicks.
  rmSync(join(DIR, '.pinwright'), { recursive: true, force: true })
  untrackedBefore = untracked()
  pw = pinwright(['-y', '--no-open', '--port', String(PORT), '--agents', '0'], { cwd: DIR })
  url = (await pw.waitFor(/open (http:\/\/localhost:\d+\/)/))[1]
  browser = await launch()
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

test('Ctrl+C stops pinwright and the dev server, and leaves git clean', async () => {
  assert.equal(await pw.stop(), true)
  assert.ok(await portsClosed([PORT, SITE]))
  assert.equal(untracked(), untrackedBefore)
  assert.equal(execFileSync('git', ['diff', '--stat', '--', DIR], { cwd: REPO, encoding: 'utf8' }), '')
})
