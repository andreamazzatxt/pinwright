import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { applyPatch, structuredPatch } from 'diff'
import { notePrompt } from './agent.js'
import type { Ctx } from './context.js'
import type { Scheduler } from './scheduler.js'
import type { Note } from './store.js'

export class OpError extends Error {
  constructor(
    message: string,
    public code = 400,
    public data?: unknown,
  ) {
    super(message)
  }
}

/** What reviewers (overlay) and the CLI can do to a note. */
export class Ops {
  constructor(
    private ctx: Ctx,
    private scheduler: Scheduler,
  ) {}

  private must(id: string): Note {
    const n = this.ctx.store.get(id)
    if (!n || n.status === 'deleted') throw new OpError('note not found', 404)
    return n
  }

  /** An answer to a question, or a follow-up on a finished note: either way the same session resumes. */
  reply(id: string, text: string): Note {
    const n = this.must(id)
    const t = text.trim()
    if (!t) throw new OpError('empty reply')
    if (['working', 'planning'].includes(n.status)) throw new OpError('the agent is still working on this note', 409)
    this.ctx.store.message(id, 'user', t)
    return this.ctx.store.update(id, { status: 'queued', attempts: 0 })!
  }

  archive(id: string): Note {
    this.must(id)
    return this.ctx.store.update(id, { status: 'archived' })!
  }

  retry(id: string): Note {
    const n = this.must(id)
    if (['working', 'planning', 'queued'].includes(n.status)) return n
    return this.ctx.store.update(id, { status: 'queued', attempts: 0 })!
  }

  handoff(id: string): Note {
    this.must(id)
    this.scheduler.abort(id, 'handed off')
    this.ctx.store.message(id, 'system', 'Handed off by the reviewer.')
    return this.ctx.store.update(id, { status: 'handoff' })!
  }

  delete(id: string): void {
    this.must(id)
    this.scheduler.abort(id)
    this.ctx.store.update(id, { status: 'deleted' })
  }

  /**
   * Restores what the note changed. A file nobody touched since goes back to its original; a file
   * another edit changed since gets the note's patch reversed on top, and if that doesn't apply
   * cleanly the whole undo is refused, listing the files.
   */
  async undo(id: string): Promise<Note> {
    const { store, cfg, rebuilder, locks } = this.ctx
    const n = this.must(id)
    if (['working', 'planning'].includes(n.status)) throw new OpError('the agent is still working on this note', 409)
    if (n.status === 'undone') throw new OpError('already undone')
    const changes = store.changes(id)
    if (!changes.length) throw new OpError('nothing to undo')
    const busy = changes.filter((c) => locks.holder(c.file, id))
    if (busy.length) throw new OpError(`files in use by another note: ${busy.map((c) => c.file).join(', ')}`, 409, { files: busy.map((c) => c.file) })
    const read = (f: string) => (existsSync(join(cfg.root, f)) ? readFileSync(join(cfg.root, f), 'utf8') : null)
    const plan: { file: string; content: string | null }[] = []
    const conflicts: string[] = []
    for (const c of changes) {
      const now = read(c.file)
      if (now === c.final) plan.push({ file: c.file, content: c.original })
      else if (now !== null && c.final !== null && c.original !== null) {
        const reverted = applyPatch(now, structuredPatch(c.file, c.file, c.final, c.original, "", "", { context: 0 }))
        if (reverted === false) conflicts.push(c.file)
        else plan.push({ file: c.file, content: reverted })
      } else conflicts.push(c.file)
    }
    if (conflicts.length) {
      throw new OpError(`changed since in a conflicting way, undo refused: ${conflicts.join(', ')}`, 409, { files: conflicts })
    }
    for (const { file, content } of plan) {
      const abs = join(cfg.root, file)
      if (content === null) unlinkSync(abs)
      else {
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content)
      }
    }
    store.message(id, 'system', `Undone: ${changes.map((c) => c.file).join(', ')}`)
    cfg.log(`${id}: undone`)
    const note = store.update(id, { status: 'undone' })!
    void rebuilder.request()
    return note
  }

  /** Pulls a note into an interactive Claude Code session: marks it taken and returns a ready prompt. */
  take(id: string): { note: Note; prompt: string } {
    const { store, cfg } = this.ctx
    const n = this.must(id)
    this.scheduler.abort(id, 'taken')
    const msgs = store.messages(id).slice(1)
    const thread = msgs.length ? `\n\nThread so far:\n${msgs.map((m) => `- ${m.role}: ${m.text}`).join('\n')}` : ''
    const prompt = `${notePrompt(n)}${thread}\n\nThis note was handed over from pinwright. Work on it here with me. When it's done, run \`pinwright done ${id} "<one-line summary>"\`.`
    store.message(id, 'system', 'Taken into an interactive session.')
    const note = store.update(id, { status: 'taken' })!
    cfg.log(`${id}: taken`)
    return { note, prompt }
  }

  /** Closes a note handled by hand (after `take`). */
  markDone(id: string, summary?: string): Note {
    const n = this.must(id)
    const s = summary?.trim() || 'Done by hand.'
    this.ctx.store.message(id, 'agent', s)
    return this.ctx.store.update(id, { status: 'done', summary: s, attempts: 0, shots: n.shots })!
  }
}
