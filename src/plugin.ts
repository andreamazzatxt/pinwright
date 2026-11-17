import { startPinwright, type Options, type Pinwright } from './index.js'

/*
 * Shared by every framework plugin: one daemon per process. Dev servers restart by opening the new
 * server before closing the old one, so the daemon stops only when the last user has let it go for a moment.
 */
let current: Promise<Pinwright> | null = null
let users = 0
let stopTimer: NodeJS.Timeout | null = null

export function ensureDaemon(opts: Options): Promise<Pinwright> {
  users++
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
  current ??= startPinwright({ ...opts, mode: 'plugin' }).catch((e) => {
    current = null
    throw e
  })
  return current
}

export function currentDaemon(): Promise<Pinwright | null> {
  return current?.catch(() => null) ?? Promise.resolve(null)
}

export function releaseDaemon(): void {
  users = Math.max(0, users - 1)
  if (users || stopTimer) return
  stopTimer = setTimeout(() => {
    stopTimer = null
    if (users) return
    const c = current
    current = null
    void c?.then((pw) => pw.stop()).catch(() => {})
  }, 1500)
  stopTimer.unref()
}

/** Starts the daemon for a plugin, logging instead of throwing: a dev server must come up without pinwright. */
export async function tryDaemon(opts: Options): Promise<Pinwright | null> {
  try {
    return await ensureDaemon(opts)
  } catch (e) {
    releaseDaemon()
    console.error(`[pinwright] not started: ${(e as Error).message}`)
    return null
  }
}

/**
 * Browser code that loads the overlay once. A classic script, so the overlay can find its own origin through
 * document.currentScript. Automated browsers are skipped (the overlay skips them too).
 */
export function loaderCode(scriptUrl: string): string {
  return `if(typeof window!=='undefined'&&!navigator.webdriver&&!document.querySelector('script[data-pinwright]')){const s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};s.dataset.pinwright='';(document.body||document.documentElement).append(s)}`
}

/** The tag to put in served HTML. */
export function scriptTag(scriptUrl: string): string {
  return `<script src="${scriptUrl}" data-pinwright defer></script>`
}
