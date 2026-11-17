import type { Options } from './index.js'
import { currentDaemon, ensureDaemon, loaderCode, releaseDaemon } from './plugin.js'
import { trackSiteUrl } from './vite.js'

/** Astro integration: in `astro dev`, starts pinwright and loads the overlay on every page. */
export default function pinwright(opts: Options = {}) {
  return {
    name: 'pinwright',
    hooks: {
      'astro:config:setup': async ({ command, injectScript }: { command: string; injectScript: (stage: 'page', code: string) => void }) => {
        if (command !== 'dev') return
        try {
          const pw = await ensureDaemon(opts)
          // Held until astro:server:done; a restart acquires again before releasing the old one.
          injectScript('page', loaderCode(pw.scriptUrl))
        } catch (e) {
          releaseDaemon()
          console.error(`[pinwright] not started: ${(e as Error).message}`)
        }
      },
      'astro:server:setup': async ({ server }: { server: Parameters<typeof trackSiteUrl>[0] }) => {
        const pw = await currentDaemon()
        if (pw) trackSiteUrl(server, pw, opts.siteUrl)
      },
      'astro:server:done': () => releaseDaemon(),
    },
  }
}
