import type { Options } from './index.js'
import { tryDaemon } from './plugin.js'

type ConfigInput<C> = C | ((phase: string, ctx: any) => C | Promise<C>)

/**
 * Next.js: wrap the config, then render `<Pinwright />` (from `pinwright/next/script`) in the root layout.
 * In `next dev` this starts pinwright and tells the component where the overlay lives; in builds it does nothing.
 *
 *   export default withPinwright(nextConfig)
 */
export function withPinwright<C extends object>(config: ConfigInput<C> = {} as C, opts: Options = {}) {
  return async (phase: string, ctx: any): Promise<C> => {
    const base = typeof config === 'function' ? await (config as (phase: string, ctx: any) => C | Promise<C>)(phase, ctx) : config
    if (phase !== 'phase-development-server') return base
    // next dev also loads the config in a detached telemetry process that outlives the server: no daemon there.
    if (process.argv.some((a) => a.includes('telemetry'))) return base
    // Next loads its config in more than one process; children inherit the env, so only the first starts the daemon.
    let src = process.env.PINWRIGHT_SRC
    if (!src) {
      const pw = await tryDaemon(opts)
      if (!pw) return base
      src = process.env.PINWRIGHT_SRC = pw.scriptUrl
    }
    const env = (base as { env?: Record<string, string> }).env
    return { ...base, env: { ...env, PINWRIGHT_SRC: src } }
  }
}

export default withPinwright
