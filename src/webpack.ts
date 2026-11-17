import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Options } from './index.js'
import { loaderCode, releaseDaemon, tryDaemon } from './plugin.js'

/* Structural types: no dependency on webpack or rspack. */
interface Hook<T extends unknown[] = unknown[]> {
  tap(name: string, fn: (...a: T) => void): void
  tapPromise(name: string, fn: (...a: T) => Promise<void>): void
}
interface Compiler {
  context: string
  options: { mode?: string }
  hooks: { watchRun: Hook; watchClose: Hook; shutdown?: Hook }
  webpack?: { EntryPlugin: new (context: string, entry: string, opts: { name: undefined }) => { apply(c: Compiler): void } }
  rspack?: Compiler['webpack']
}

/**
 * Webpack 5 / Rspack / Rsbuild plugin: in watch mode (dev server, `--watch`) starts pinwright and adds a tiny
 * entry that loads the overlay on every page. Production builds are left alone.
 *
 *   plugins: [new PinwrightPlugin()]
 */
export class PinwrightPlugin {
  constructor(private opts: Options = {}) {}

  apply(compiler: Compiler): void {
    if (compiler.options.mode === 'production') return
    const EntryPlugin = (compiler.rspack ?? compiler.webpack)?.EntryPlugin
    if (!EntryPlugin) return console.error('[pinwright] not started: this bundler has no EntryPlugin (webpack 5 or rspack needed)')
    const root = resolve(this.opts.root ?? compiler.context)
    const file = join(root, '.pinwright', 'loader.js')
    // Empty until the daemon is up: a one-off build (no watch) bundles nothing of pinwright.
    write(file, '')
    new EntryPlugin(compiler.context, file, { name: undefined }).apply(compiler)

    let started = false
    compiler.hooks.watchRun.tapPromise('pinwright', async () => {
      if (started) return
      started = true
      const pw = await tryDaemon({ ...this.opts, root })
      if (pw) write(file, loaderCode(pw.scriptUrl) + '\n')
    })
    let released = false
    const release = () => {
      if (!started || released) return
      released = true
      write(file, '')
      releaseDaemon()
    }
    compiler.hooks.watchClose.tap('pinwright', release)
    compiler.hooks.shutdown?.tap('pinwright', release)
  }
}

/** Writes only on change, so the bundler's watcher doesn't rebuild for nothing. */
function write(file: string, text: string): void {
  try {
    if (readFileSync(file, 'utf8') === text) return
  } catch {
    mkdirSync(join(file, '..'), { recursive: true })
  }
  writeFileSync(file, text)
}

export default PinwrightPlugin
