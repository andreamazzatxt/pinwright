import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CanUseTool, HookCallback, HookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import type { Ctx } from './context.js'

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const NETWORK_TOOLS = ['WebFetch', 'WebSearch']
const FORBIDDEN_DIRS = new Set(['.git', 'node_modules', '.pinwright'])
const LOCK_WAIT_MS = 3 * 60_000
export const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'LS'])

/**
 * Files no note may change: what runs code on the next install, build or dev start (manifests, lockfiles,
 * tool configs, scripts, CI) and secrets. A note about the page never needs them; a malicious one would.
 */
const PROTECTED: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json)$/,
  /(^|\/)\.(npmrc|yarnrc(\.yml)?|pnpmfile\.c?js|nvmrc|tool-versions)$/,
  /(^|\/)[^/]*\.config\.(js|cjs|mjs|ts|cts|mts|json)$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  /\.(sh|bash|zsh|ps1|bat|cmd)$/,
  /(^|\/)(Makefile|Dockerfile[^/]*|docker-compose[^/]*|compose\.ya?ml|Procfile)$/,
  /(^|\/)\.(github|husky|gitlab|circleci|vscode)\//,
  /(^|\/)\.git(attributes|ignore|modules)$/,
  /(^|\/)pinwright\.config\.[^/]+$/,
]
/** Files a guest's note may not even read: they could be copied into the page everyone sees. */
const SECRET = /(^|\/)(\.env(\.[^/]*)?|\.npmrc|id_[a-z0-9]+|[^/]*\.(pem|key|p12|pfx|crt|keystore|jks)|credentials[^/]*|secrets?[^/]*)$/i

/**
 * Files that run on this machine, not in the browser: a guest of the review link may not touch them. The host
 * approves a note's text, not its diff, and the dev server runs whatever lands here at once.
 */
const SERVER_FILES: RegExp[] = [
  // Nuxt/Nitro server/, Next pages/api and app/**/api, Netlify-style functions/.
  /(^|\/)(server|api|middleware|functions)\//,
  // Remix/React Router and SvelteKit server modules, SvelteKit endpoints.
  /(^|\/)[^/]*\.server\.[^/]+$/,
  /(^|\/)\+server\.[^/]+$/,
  // Next route handlers (.ts/.js: no JSX), middleware/proxy, instrumentation, SvelteKit hooks.
  /(^|\/)route\.[cm]?[jt]s$/,
  /(^|\/)(middleware|proxy|instrumentation|hooks)\.[cm]?[jt]sx?$/,
]

/**
 * Code that reaches the machine from code that renders on the server (Next.js server components, Astro
 * frontmatter, loaders): env, processes, files, network, eval. A review-link note may not add any.
 */
const SERVER_CODE: RegExp[] = [
  /\bprocess\s*\./,
  /child_process|worker_threads|\bnode:[a-z]/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /from\s+['"](fs|path|os|net|http|https|http2|child_process|crypto|vm|dgram|tls|cluster|dns|module|v8|inspector)(\/[^'"]*)?['"]/,
  /\$env\/|import\.meta\.env/,
  /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/,
  /\b(Deno|Bun)\./,
  /['"]use server['"]/,
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|\bsendBeacon\b/,
]

const count = (re: RegExp, s: string) => (s.match(new RegExp(re.source, 'g')) ?? []).length

/** Why `after` may not replace `before` in a review-link note: it adds code that reaches the machine. */
export function codeVerdict(before: string, after: string): string | null {
  const hit = SERVER_CODE.find((re) => count(re, after) > count(re, before))
  return hit ? `a note from the review link may not add code that reaches the machine (env, processes, files, network, eval): ${hit.source}` : null
}

/** Why a note may not edit this file, if it may not. `guest`: from the review link (YOLO notes count as the host's). */
export function editVerdict(rel: string, guest: boolean, guestDirs: string[]): string | null {
  if (PROTECTED.some((re) => re.test(rel))) return `${rel} is protected (configs, manifests, scripts and secrets can't be changed from a note)`
  if (guest && !rel.split('/').slice(0, -1).some((d) => guestDirs.includes(d))) {
    return `this note comes from a shared link: it may only change files under ${guestDirs.map((d) => `${d}/`).join(', ')}`
  }
  if (guest && SERVER_FILES.some((re) => re.test(rel))) return `${rel} runs on the server: a note from the review link may only change what renders in the browser`
  return null
}

/** Why a read tool may not look there, if it may not. Reads stay inside the project; guests' notes skip secrets. */
export function readVerdict(root: string, input: Record<string, unknown>, guest: boolean): string | null {
  const p = (input.file_path ?? input.notebook_path ?? input.path) as string | undefined
  if (p) {
    const abs = isAbsolute(p) ? p : resolve(root, p)
    const rel = relative(root, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) return `${p} is outside the project`
    if (guest && SECRET.test(rel.split(sep).join('/'))) return `${p} may hold secrets: not readable for a note from a shared link`
  }
  if (guest && typeof input.glob === 'string' && /\.env|\.pem|\.key|id_/.test(input.glob)) return 'secrets are not readable for a note from a shared link'
  return null
}

/** A PreToolUse hook that keeps read-only tools (the planner's) inside the same limits. */
export function readHook(root: string, isGuest: () => boolean): HookCallback {
  return async (input) => {
    const { tool_name: name, tool_input } = input as PreToolUseHookInput
    if (!READ_TOOLS.has(name)) return {}
    const why = readVerdict(root, (tool_input ?? {}) as Record<string, unknown>, isGuest())
    return why ? deny(why) : {}
  }
}

/** Shell commands the agents may not run: history rewrites, network, installs, file edits that bypass undo. */
const BASH_DENY: [RegExp, string][] = [
  [/\bgit\s+(commit|push|reset|checkout|restore|stash|clean|rebase|merge|switch|cherry-pick|revert|am|tag|branch\s+-[dDmM])\b/, 'git history and branch commands are off limits'],
  [/\b(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp)\b/, 'no network access'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|rm|uninstall|up|update|upgrade|publish|link)\b/, 'no package installs'],
  [/\bsudo\b/, 'no sudo'],
  [/\b(sed|perl)\s+(-\S*\s+)*-[a-zA-Z]*i/, 'edit files with Edit/Write so the reviewer can undo'],
  [/(^|[;&|]\s*)(rm|mv|cp|tee|touch|truncate)\s/, 'change files with Edit/Write so the reviewer can undo'],
  [/(^|[^0-9&>=-])>>?\s*(?!&|\/dev\/)[\w./~$'"-]/, 'no shell redirects into files: use Edit/Write so the reviewer can undo'],
]

export function bashVerdict(cmd: string): string | null {
  for (const [re, why] of BASH_DENY) if (re.test(cmd)) return why
  return null
}

/** Path relative to root with forward slashes, or an error message. */
export function checkPath(root: string, p: string): { rel: string; abs: string } | { error: string } {
  if (typeof p !== 'string' || !p) return { error: 'missing file path' }
  const abs = isAbsolute(p) ? p : resolve(root, p)
  const rel = relative(root, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { error: `${p} is outside the project root (${root})` }
  const parts = rel.split(sep)
  if (parts.some((s) => FORBIDDEN_DIRS.has(s))) return { error: `${p} is inside .git, node_modules or .pinwright` }
  return { rel: parts.join('/'), abs }
}

/** The text an edit replaces and the text it puts in its place. */
function beforeAfter(name: string, ti: Record<string, unknown>, abs: string): [string, string] {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (name === 'Edit') return [str(ti.old_string), str(ti.new_string)]
  if (name === 'MultiEdit' && Array.isArray(ti.edits)) {
    const edits = ti.edits as Record<string, unknown>[]
    return [edits.map((e) => str(e.old_string)).join('\n'), edits.map((e) => str(e.new_string)).join('\n')]
  }
  if (name === 'NotebookEdit') return ['', str(ti.new_source)]
  return [existsSync(abs) ? readFileSync(abs, 'utf8') : '', str(ti.content)]
}

const deny = (reason: string): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
})
const allow = (): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })

/**
 * PreToolUse runs for every tool call, even the ones a project's settings auto-allow,
 * so the path checks, the file locks and the undo record live here rather than in canUseTool.
 */
export function guardHook(ctx: Ctx, noteId: string, beforeEdit: () => Promise<unknown>): HookCallback {
  const { cfg, store, locks, bus } = ctx
  return async (input, _id, { signal }) => {
    const { tool_name: name, tool_input } = input as PreToolUseHookInput
    const ti = (tool_input ?? {}) as Record<string, unknown>
    // Read at every call: a guest's reply turns a host's note into a guest note.
    const guest = Boolean(store.get(noteId)?.guest)
    if (READ_TOOLS.has(name)) {
      const why = readVerdict(cfg.root, ti, guest)
      return why ? deny(why) : {}
    }
    if (EDIT_TOOLS.has(name)) {
      const checked = checkPath(cfg.root, (ti.file_path ?? ti.notebook_path) as string)
      if ('error' in checked) return deny(checked.error)
      const { rel, abs } = checked
      const refused = editVerdict(rel, guest, cfg.guestDirs) ?? (guest ? codeVerdict(...beforeAfter(name, ti, abs)) : null)
      if (refused) return deny(`Not allowed: ${refused}.`)
      const other = locks.holder(rel, noteId)
      if (other) bus.setActivity(noteId, `Waiting for ${rel} (busy with note ${other})`)
      if (!(await locks.acquireOne(noteId, rel, LOCK_WAIT_MS, signal))) {
        return deny(`${rel} is busy for another note. Try again later, or edit something else.`)
      }
      await beforeEdit()
      if (!store.change(noteId, rel)) store.recordOriginal(noteId, rel, existsSync(abs) ? readFileSync(abs, 'utf8') : null)
      return allow()
    }
    if (name === 'Bash') {
      const why = bashVerdict(String(ti.command ?? ''))
      return why ? deny(`Not allowed in pinwright: ${why}.`) : allow()
    }
    if (NETWORK_TOOLS.includes(name)) return deny('no network access')
    return {}
  }
}

/** Whatever reaches the permission prompt already went through the hook: let it run. */
export const canUseTool: CanUseTool = async (name, input) =>
  NETWORK_TOOLS.includes(name) ? { behavior: 'deny', message: 'no network access' } : { behavior: 'allow', updatedInput: input }
