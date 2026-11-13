import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CanUseTool, HookCallback, HookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import type { Ctx } from './context.js'

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const NETWORK_TOOLS = ['WebFetch', 'WebSearch']
const FORBIDDEN_DIRS = new Set(['.git', 'node_modules', '.pinwright'])
const LOCK_WAIT_MS = 3 * 60_000

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
    if (EDIT_TOOLS.has(name)) {
      const checked = checkPath(cfg.root, (ti.file_path ?? ti.notebook_path) as string)
      if ('error' in checked) return deny(checked.error)
      const { rel, abs } = checked
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
