import { EventEmitter } from 'node:events'
import type { Note } from './store.js'

export interface Events {
  note: [Note]
  activity: [{ id: string; text: string }]
  reload: []
}

/** In-process events, fanned out to the overlays over SSE. */
export class Bus extends EventEmitter<Events> {
  /** Last thing each running agent did ("Editing src/x.astro"). Memory only. */
  activity = new Map<string, string>()

  setActivity(id: string, text: string | null): void {
    if (text === null) this.activity.delete(id)
    else this.activity.set(id, text)
    this.emit('activity', { id, text: text ?? '' })
  }
}
