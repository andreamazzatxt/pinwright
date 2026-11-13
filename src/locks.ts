import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Two paths overlap when equal or when one is a directory prefix of the other. */
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || a === '' || b === ''

/** Which note holds which file (or directory). Paths are relative to root, with forward slashes. */
export class Locks {
  private held = new Map<string, string>()

  constructor(private root: string) {}

  norm(p: string): string {
    const abs = isAbsolute(p) ? p : resolve(this.root, p)
    return relative(this.root, abs).split(sep).join('/').replace(/\/$/, '')
  }

  holder(file: string, except?: string): string | undefined {
    const f = this.norm(file)
    for (const [k, owner] of this.held) if (owner !== except && overlaps(k, f)) return owner
    return undefined
  }

  /** All or nothing: takes every path, or none if any overlaps another note's. */
  tryAcquire(noteId: string, files: string[]): boolean {
    const fs = files.map((f) => this.norm(f)).filter((f) => !f.startsWith('..'))
    if (fs.some((f) => this.holder(f, noteId))) return false
    for (const f of fs) this.held.set(f, noteId)
    return true
  }

  /** Waits for one path, polling, until the timeout or the signal. */
  async acquireOne(noteId: string, file: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (!signal?.aborted) {
      if (this.tryAcquire(noteId, [file])) return true
      if (Date.now() > end) return false
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  releaseAll(noteId: string): void {
    for (const [k, owner] of this.held) if (owner === noteId) this.held.delete(k)
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.held)
  }
}
