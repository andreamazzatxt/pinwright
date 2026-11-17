import type { Options } from './index.js'
import { releaseDaemon, tryDaemon } from './plugin.js'

/* Structural types: no dependency on nuxt itself. */
interface Nuxt {
  options: { dev: boolean; app: { head: { script?: Record<string, unknown>[] } } }
  hook(name: 'close', fn: () => void): void
}

/**
 * Nuxt module: in `nuxt dev`, starts pinwright and adds the overlay to every page's head.
 * `modules: [['@andreamazza/pinwright/nuxt', { ...options }]]`
 */
export default async function pinwright(inline: Options = {}, nuxt: Nuxt): Promise<void> {
  if (!nuxt.options.dev) return
  const pw = await tryDaemon(inline ?? {})
  if (!pw) return
  const head = nuxt.options.app.head
  head.script = [...(head.script ?? []), { src: pw.scriptUrl, defer: true, 'data-pinwright': '', tagPosition: 'bodyClose' }]
  nuxt.hook('close', releaseDaemon)
}

// Read by Nuxt to name the module and its config key.
Object.assign(pinwright, { getMeta: async () => ({ name: 'pinwright', configKey: 'pinwright' }), getOptions: async (inline?: Options) => inline ?? {} })
