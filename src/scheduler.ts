import { MAX_ATTEMPTS, runNote } from './agent.js'
import type { Ctx } from './context.js'
import { plan } from './planner.js'
import type { Note } from './store.js'

const MAX_PLANNERS = 2

/**
 * Queue → planner → locks → workers. Ticks every second and whenever a note changes.
 * Every step is caught: the scheduler must outlive any agent.
 */
export class Scheduler {
  private running = new Map<string, AbortController>()
  private jobs = new Set<Promise<unknown>>()
  private planning = new Map<string, AbortController>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private again = false
  private onNote = () => this.wake()

  constructor(private ctx: Ctx) {}

  start(): void {
    const { store, cfg } = this.ctx
    // Whatever was mid-flight when the daemon stopped goes back in the queue.
    for (const n of store.list(['working', 'planning'])) {
      store.update(n.id, { status: 'queued', attempts: n.status === 'working' ? n.attempts + 1 : n.attempts })
      cfg.log(`${n.id}: recovered, back in the queue`)
    }
    this.timer = setInterval(() => this.tick(), 1000)
    this.ctx.bus.on('note', this.onNote)
    this.wake()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.ctx.bus.off('note', this.onNote)
    for (const a of [...this.running.values(), ...this.planning.values()]) a.abort(new Error('shutdown'))
    // Let the aborted agents write their status back before the database closes.
    await Promise.race([Promise.allSettled([...this.jobs]), new Promise((ok) => setTimeout(ok, 5000))])
  }

  get busy(): string[] {
    return [...this.running.keys()]
  }

  /** Stops a note's agent or planner (the note was deleted or taken). */
  abort(id: string, why = 'deleted'): void {
    this.running.get(id)?.abort(new Error(why))
    this.planning.get(id)?.abort(new Error(why))
  }

  wake(): void {
    setImmediate(() => this.tick())
  }

  private tick(): void {
    if (!this.timer) return
    if (this.ticking) {
      this.again = true
      return
    }
    this.ticking = true
    try {
      this.schedule()
    } catch (e) {
      this.ctx.cfg.log(`scheduler: ${(e as Error).message}`)
    } finally {
      this.ticking = false
      if (this.again) {
        this.again = false
        this.wake()
      }
    }
  }

  private schedule(): void {
    const { store, cfg, locks } = this.ctx
    if (cfg.maxAgents < 1) return
    const queued = store.list(['queued']).filter((n) => n.approved && !this.running.has(n.id) && !this.planning.has(n.id))
    for (const note of queued) {
      if (note.attempts >= MAX_ATTEMPTS) {
        store.message(note.id, 'system', 'Failed too many times.')
        store.update(note.id, { status: 'failed' })
        continue
      }
      if (note.area === null) {
        // Nothing to run alongside: planning would only add latency.
        const alone = this.running.size === 0 && this.planning.size === 0 && queued.length === 1
        if (!cfg.models.planner || alone) store.update(note.id, { area: [] })
        else if (this.planning.size < MAX_PLANNERS) this.startPlan(note)
        if (store.get(note.id)?.area === null) continue
        note.area = []
      }
      if (this.running.size >= cfg.maxAgents) continue
      if (!locks.tryAcquire(note.id, note.area)) continue
      this.startWork(note)
    }
  }

  private startPlan(note: Note): void {
    const { store, cfg } = this.ctx
    const abort = new AbortController()
    this.planning.set(note.id, abort)
    store.update(note.id, { status: 'planning' })
    this.ctx.bus.setActivity(note.id, 'Planning')
    plan(this.ctx, note, abort.signal)
      .then(({ files, cost }) => {
        const cur = store.get(note.id)
        if (!cur || cur.status !== 'planning') return
        cfg.log(`${note.id}: area ${files.length ? files.join(', ') : '(unknown)'} ($${cost.toFixed(3)})`)
        store.update(note.id, { status: 'queued', area: files })
      })
      .catch((e) => {
        cfg.log(`${note.id}: planning failed: ${(e as Error).message}`)
        if (store.get(note.id)?.status === 'planning') store.update(note.id, { status: 'queued', area: [] })
      })
      .finally(() => {
        this.planning.delete(note.id)
        this.ctx.bus.setActivity(note.id, null)
        this.wake()
      })
  }

  private startWork(note: Note): void {
    const { store, cfg, locks } = this.ctx
    const abort = new AbortController()
    this.running.set(note.id, abort)
    const started = store.update(note.id, { status: 'working', startedAt: new Date().toISOString() }) ?? note
    cfg.log(`${note.id}: working on “${note.text.split('\n')[0].slice(0, 70)}”${note.area?.length ? ` [${note.area.join(', ')}]` : ''}`)
    const job = runNote(this.ctx, started, abort)
      .catch((e) => {
        // runNote is not supposed to throw; if it does, the note goes back in the queue.
        cfg.log(`${note.id}: worker crashed: ${(e as Error).stack ?? e}`)
        const cur = store.get(note.id)
        if (cur?.status === 'working') store.update(note.id, { status: 'queued', attempts: cur.attempts + 1 })
      })
      .finally(() => {
        this.running.delete(note.id)
        this.jobs.delete(job)
        locks.releaseAll(note.id)
        this.wake()
      })
    this.jobs.add(job)
  }
}
