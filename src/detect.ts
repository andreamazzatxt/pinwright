import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devCommand } from './run.js'

export interface Project {
  /** Human name of the stack, e.g. "Next.js". */
  name: string
  /** The command that starts its dev server, when there is a sensible guess. */
  dev: string[] | null
  /** pinwright is already in package.json: the dev server loads it on its own. */
  installed: boolean
  /** A pinwright plugin exists for this stack (else: proxy only). */
  pluggable: boolean
  /** Has a package.json dev script pinwright can be added to. */
  js: boolean
  /** A Module Federation remote (exposes modules to a shell). */
  mfe: boolean
}

/** First match wins: meta-frameworks before the bundlers they're built on. */
const JS: [dep: string, name: string][] = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['astro', 'Astro'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['@react-router/dev', 'React Router'],
  ['@remix-run/dev', 'Remix'],
  ['@solidjs/start', 'SolidStart'],
  ['@builder.io/qwik-city', 'Qwik City'],
  ['@rsbuild/core', 'Rsbuild'],
  ['@rspack/core', 'Rspack'],
  ['vite', 'Vite'],
  ['webpack', 'webpack'],
]

/** Projects without package.json scripts: the file that gives them away and how they start. */
const OTHER: [file: string, name: string, dev: string[]][] = [
  ['bin/rails', 'Ruby on Rails', ['bin/rails', 'server']],
  ['manage.py', 'Django', ['python', 'manage.py', 'runserver']],
  ['artisan', 'Laravel', ['php', 'artisan', 'serve']],
  ['hugo.toml', 'Hugo', ['hugo', 'server']],
  ['hugo.yaml', 'Hugo', ['hugo', 'server']],
  ['_config.yml', 'Jekyll', ['bundle', 'exec', 'jekyll', 'serve']],
]

export function detectProject(root: string): Project {
  const pkgFile = join(root, 'package.json')
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as Record<string, Record<string, string> | undefined>
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const hit = JS.find(([dep]) => deps[dep])
    let dev: string[] | null = null
    try {
      dev = devCommand(root)
    } catch {}
    if (hit || dev) return { name: hit?.[1] ?? 'JavaScript project', dev, installed: !!deps.pinwright, pluggable: !!hit, js: !!dev, mfe: isRemote(root) }
  }
  const other = OTHER.find(([file]) => existsSync(join(root, file)))
  if (other) return { name: other[1], dev: other[2], installed: false, pluggable: false, js: false, mfe: false }
  return { name: 'unknown project', dev: null, installed: false, pluggable: false, js: false, mfe: false }
}

/** Exposes modules through Module Federation: the bundler config (or a federation config) has `exposes`. */
function isRemote(root: string): boolean {
  const files = ['module-federation.config', 'rsbuild.config', 'rspack.config', 'webpack.config', 'vite.config']
  for (const f of files)
    for (const ext of ['.ts', '.js', '.mjs', '.cjs', '.mts'])
      try {
        const text = readFileSync(join(root, f + ext), 'utf8')
        if (/exposes\s*:/.test(text) && /federation/i.test(text)) return true
      } catch {}
  return false
}

/** Claude Code on PATH (the agents run through it). */
export function hasClaude(): boolean {
  try {
    return spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0
  } catch {
    return false
  }
}
