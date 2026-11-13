import { query } from '@anthropic-ai/claude-agent-sdk'
import { agentEnv, type Ctx } from './context.js'
import { notePrompt } from './agent.js'
import type { Note } from './store.js'

const SYSTEM = `You plan work for a code agent. Given a review note pinned on a web page, find which source files the fix will most likely edit.
Use Glob and Grep (Read only if needed) to locate the element: search for its distinctive text, classes or ids. Be quick: a few searches.
Answer with ONLY a JSON object, no prose: {"files": ["relative/path", ...]}.
List at most 5 files, relative to the project root. Use a directory path only if you truly cannot narrow it down. If unsure, {"files": []}.`

/**
 * Predicts which files a note touches, so non-overlapping notes can run side by side.
 * Never throws: on any failure the answer is [] and the edit-time locks take over.
 */
export async function plan(ctx: Ctx, note: Note, signal: AbortSignal): Promise<{ files: string[]; cost: number }> {
  const abort = new AbortController()
  const onAbort = () => abort.abort()
  signal.addEventListener('abort', onAbort)
  const timer = setTimeout(() => abort.abort(), 90_000)
  let text = ''
  let cost = 0
  try {
    for await (const m of query({
      prompt: `${notePrompt(note)}\n\nWhich files will the fix edit? JSON only.`,
      options: {
        cwd: ctx.cfg.root,
        model: ctx.cfg.models.planner,
        tools: ['Read', 'Glob', 'Grep'],
        settingSources: [],
        systemPrompt: SYSTEM,
        maxTurns: 8,
        persistSession: false,
        abortController: abort,
        env: agentEnv(ctx.cfg),
        canUseTool: async (name, input) =>
          ['Read', 'Glob', 'Grep'].includes(name) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'read-only' },
      },
    })) {
      if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'text') text = b.text
      if (m.type === 'result') {
        cost = m.total_cost_usd
        if (m.subtype === 'success') text = m.result || text
      }
    }
  } catch (e) {
    ctx.cfg.log(`${note.id}: planner failed: ${(e as Error).message.split('\n')[0]}`)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  try {
    const files = (JSON.parse(json ?? '{}') as { files?: unknown }).files
    if (Array.isArray(files)) {
      return { files: files.filter((f): f is string => typeof f === 'string' && f.length > 0).slice(0, 8), cost }
    }
  } catch {}
  return { files: [], cost }
}
