import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config, Viewport } from './config.js'

/* playwright-core is optional: typed loosely so the package builds and runs without it. */
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void>; isConnected(): boolean }
type Context = { newPage(): Promise<Page>; close(): Promise<void> }
type Page = {
  goto(url: string, o: object): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  screenshot(o: object): Promise<Buffer>
  locator(s: string): { first(): { scrollIntoViewIfNeeded(o: object): Promise<void> } }
  evaluate(fn: string): Promise<unknown>
}

export interface Shot {
  file: string
  data: Buffer
  viewport: Viewport
}

/** Parses "390x844" from the overlay. */
export function parseViewport(v: string | null | undefined, name = 'note'): Viewport | null {
  const m = v?.match(/^(\d+)x(\d+)$/)
  return m ? { name, width: Number(m[1]), height: Number(m[2]) } : null
}

/** One shared headless Chrome, launched on first use and closed with the daemon. */
export class Shooter {
  private browser: Promise<Browser | null> | null = null
  private warned = false

  constructor(private cfg: Config) {}

  get dir(): string {
    return join(this.cfg.root, '.pinwright', 'shots')
  }

  private launch(): Promise<Browser | null> {
    if (!this.browser) {
      this.browser = (async () => {
        try {
          const pw = (await import('playwright-core' as string)) as { chromium: { launch(o: object): Promise<Browser> } }
          return await pw.chromium.launch({ channel: 'chrome', headless: true })
        } catch (e) {
          if (!this.warned) this.cfg.log(`screenshots off: ${(e as Error).message.split('\n')[0]}`)
          this.warned = true
          return null
        }
      })()
    }
    return this.browser.then(async (b) => {
      if (b && !b.isConnected()) {
        this.browser = null
        return this.launch()
      }
      return b
    })
  }

  /** The site URL for a page, without the overlay (screenshots load the target directly). */
  urlFor(page: string, fallback?: string | null): string | null {
    if (this.cfg.siteUrl) return this.cfg.siteUrl + (page.startsWith('/') ? page : `/${page}`)
    return fallback ?? null
  }

  async capture(url: string, viewport: Viewport, opts: { selector?: string | null; tag: string; noteId: string }): Promise<Shot | null> {
    if (!this.cfg.shots) return null
    const browser = await this.launch()
    if (!browser) return null
    // Wide viewports render at a lower device scale so the image stays around 800px wide.
    const scale = Math.min(1, 800 / viewport.width)
    const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: scale })
    try {
      const page = await ctx.newPage()
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
      } catch {
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
      }
      if (opts.selector) {
        try {
          await page.locator(opts.selector).first().scrollIntoViewIfNeeded({ timeout: 3000 })
        } catch {}
      }
      await page.waitForTimeout(400)
      const data = await page.screenshot({ type: 'jpeg', quality: 60 })
      const file = `${opts.noteId}-${opts.tag}-${viewport.name}-${Date.now().toString(36)}.jpg`
      writeFileSync(join(this.dir, file), data)
      return { file, data, viewport }
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  async close(): Promise<void> {
    const b = await this.browser?.catch(() => null)
    this.browser = null
    await b?.close().catch(() => {})
  }
}
