// Shared by the browser tests: start dev servers and pinwright as child processes, drive Chrome, clean up.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = join(here, '..', '..')
export const CLI = join(REPO, 'dist', 'cli.js')
export const FAKE_CLOUDFLARED = join(REPO, 'test', 'helpers', 'fake-cloudflared.mjs')
export const fixture = (name) => join(here, 'fixtures', name)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A child process in its own group (so stopping it takes its dev server along), with its output kept. */
export function run(cmd, args, { cwd, env = {} } = {}) {
  const proc = spawn(cmd, args, { cwd, detached: true, env: { ...process.env, BROWSER: 'none', NO_COLOR: '1', ...env } })
  let out = ''
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (out += d))
  const exited = new Promise((ok) => proc.on('exit', ok))
  return {
    proc,
    log: () => out,
    /** Waits for a line matching `re` in the output; returns the match. */
    async waitFor(re, ms = 120_000) {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const m = out.match(re)
        if (m) return m
        if (proc.exitCode !== null) break
        await sleep(250)
      }
      throw new Error(`${cmd} ${args.join(' ')}: no ${re} within ${ms} ms\n---\n${out.slice(-3000)}`)
    },
    /** Ctrl+C to the group, as a terminal would; killed if it hangs. */
    async stop() {
      if (proc.exitCode !== null) return
      try {
        process.kill(-proc.pid, 'SIGINT')
      } catch {}
      const done = await Promise.race([exited.then(() => true), sleep(10_000).then(() => false)])
      if (!done)
        try {
          process.kill(-proc.pid, 'SIGKILL')
        } catch {}
      return done
    },
  }
}

/** pinwright's own CLI, from the built package. */
export const pinwright = (args, opts) => run(process.execPath, [CLI, ...args], opts)

export const portOpen = (port) =>
  new Promise((ok) => {
    const s = net.connect(port, '127.0.0.1')
    s.on('connect', () => (s.destroy(), ok(true)))
    s.on('error', () => ok(false))
  })

/** Waits until nothing listens on these ports any more. */
export async function portsClosed(ports, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!(await Promise.all(ports.map(portOpen))).some(Boolean)) return true
    await sleep(250)
  }
  return false
}

/** Chrome (installed on the machine and on CI runners); CHROME_PATH picks another binary. */
export const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })

/**
 * A fresh page. The overlay skips automated browsers, so webdriver is hidden. `speech`: a fake recognizer that
 * "hears" window.__say (nothing by default) or fails with window.__speechError. `swallowKeys`: a page whose own
 * handlers eat every key before anyone else.
 */
export async function newPage(browser, { headers, speech = false, swallowKeys = false } = {}) {
  const ctx = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await ctx.newPage()
  await page.addInitScript(
    ({ speech, swallowKeys }) => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
      if (speech) {
        window.__recognizers = []
        window.SpeechRecognition = window.webkitSpeechRecognition = class {
          start() {
            window.__recognizers.push(this)
            if (window.__speechError) return void setTimeout(() => this.onerror?.({ error: window.__speechError }), 30)
            if (window.__say) setTimeout(() => this.onresult?.({ results: [[{ transcript: window.__say }]] }), 30)
          }
          stop() {
            this.stopped = true
            setTimeout(() => this.onend?.(), 30)
          }
          abort() {
            setTimeout(() => this.onend?.(), 30)
          }
        }
      }
      if (swallowKeys) for (const t of ['keydown', 'keyup']) addEventListener(t, (e) => e.stopImmediatePropagation(), true)
    },
    { speech, swallowKeys },
  )
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  return page
}

/** Waits for the overlay to be on the page. */
export const overlayReady = (page, ms = 30_000) => page.waitForFunction(() => !!document.querySelector('pinwright-root')?.shadowRoot?.querySelector('.hub'), null, { timeout: ms })

/** What the overlay shows right now. */
export const overlayState = (page) =>
  page.evaluate(() => {
    const s = document.querySelector('pinwright-root').shadowRoot
    const ta = s.querySelector('.form textarea')
    return {
      mode: document.documentElement.hasAttribute('data-pw-mode'),
      list: !s.querySelector('.list').hidden,
      highlight: s.querySelector('.hl')?.style.display === 'block',
      form: !!ta,
      text: ta?.value ?? null,
      listening: !!s.querySelector('.mic[data-on]'),
      shake: !!s.querySelector('.form[data-shake]'),
      nudge: s.querySelector('.nudge')?.textContent ?? null,
    }
  })

/** Changes a file for HMR checks; returns the function that puts it back. */
export function patchFile(file, from, to) {
  const orig = readFileSync(file, 'utf8')
  if (!orig.includes(from)) throw new Error(`${file} has no ${from}`)
  writeFileSync(file, orig.replace(from, to))
  return () => writeFileSync(file, orig)
}

/** The notes the daemon holds, as the overlay's API lists them. */
export const notes = (page) => page.evaluate(() => fetch('/__pw/notes').then((r) => r.json()))
