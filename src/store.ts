import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Bus } from './bus.js'

export type Status =
  | 'queued'
  | 'planning'
  | 'working'
  | 'done'
  | 'asking'
  | 'handoff'
  | 'failed'
  | 'archived'
  | 'undone'
  | 'taken'
  | 'deleted'

/** Statuses the overlay still shows as pins. */
export const VISIBLE: Status[] = ['queued', 'planning', 'working', 'done', 'asking', 'handoff', 'failed']

export interface Shots {
  before: string[]
  after: string[]
  /** What the reviewer saw of the area they dragged out, taken in their browser. */
  area?: string
}

/** An area dragged out on the page, in page pixels at the reviewer's viewport. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface Note {
  id: string
  page: string
  url: string | null
  selector: string | null
  element: string | null
  html: string | null
  styles: Record<string, string> | null
  fx: number | null
  fy: number | null
  pageX: number | null
  pageY: number | null
  viewport: string | null
  /** Pinned to something on top of the page (a modal, a menu): when it closes, the pin goes with it. */
  floating: boolean
  /** A note on an area rather than a point: the pin sits on its top-left corner. */
  region: Region | null
  text: string
  author: string | null
  approved: boolean
  /** Someone on a shared link wrote it, or replied to it: the agent works under the guest rules. */
  guest: boolean
  status: Status
  area: string[] | null
  sessionId: string | null
  attempts: number
  summary: string | null
  diff: string | null
  shots: Shots
  costUsd: number
  /** All tokens of the note's session: input, output, cache reads and writes. */
  tokens: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
}

export interface Message {
  id: number
  noteId: string
  role: 'user' | 'agent' | 'system'
  text: string
  /** Who wrote it, for user messages in a live session (the made-up name). */
  author: string | null
  at: string
}

export interface Change {
  noteId: string
  file: string
  original: string | null
  final: string | null
}

export type NewNote = Pick<Note, 'page' | 'text'> & Partial<Pick<Note, 'url' | 'selector' | 'element' | 'html' | 'styles' | 'fx' | 'fy' | 'pageX' | 'pageY' | 'viewport' | 'floating' | 'region' | 'shots' | 'author' | 'approved' | 'guest'>>

type Row = Record<string, unknown>

const now = () => new Date().toISOString()
const id = () => Date.now().toString(36).slice(-5) + randomBytes(2).toString('hex')
const parse = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function toNote(r: Row): Note {
  return {
    id: r.id as string,
    page: r.page as string,
    url: (r.url as string) ?? null,
    selector: (r.selector as string) ?? null,
    element: (r.element as string) ?? null,
    html: (r.html as string) ?? null,
    styles: parse(r.styles, null),
    fx: (r.fx as number) ?? null,
    fy: (r.fy as number) ?? null,
    pageX: (r.page_x as number) ?? null,
    pageY: (r.page_y as number) ?? null,
    viewport: (r.viewport as string) ?? null,
    floating: Boolean(r.floating),
    region: parse(r.region, null),
    text: r.text as string,
    author: (r.author as string) ?? null,
    approved: Boolean(r.approved),
    guest: Boolean(r.guest),
    status: r.status as Status,
    area: parse(r.area, null),
    sessionId: (r.session_id as string) ?? null,
    attempts: r.attempts as number,
    summary: (r.summary as string) ?? null,
    diff: (r.diff as string) ?? null,
    shots: parse(r.shots, { before: [], after: [] }),
    costUsd: r.cost_usd as number,
    tokens: (r.tokens as number) ?? 0,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    startedAt: (r.started_at as string) ?? null,
  }
}

const COLUMNS: Record<string, string> = {
  status: 'status',
  area: 'area',
  sessionId: 'session_id',
  attempts: 'attempts',
  summary: 'summary',
  diff: 'diff',
  shots: 'shots',
  costUsd: 'cost_usd',
  tokens: 'tokens',
  startedAt: 'started_at',
  approved: 'approved',
  guest: 'guest',
  text: 'text',
}
const JSON_COLS = new Set(['area', 'shots'])

export type Patch = Partial<Pick<Note, 'status' | 'area' | 'sessionId' | 'attempts' | 'summary' | 'diff' | 'shots' | 'costUsd' | 'tokens' | 'startedAt' | 'approved' | 'guest' | 'text'>>

export class Store {
  constructor(
    private db: DatabaseSync,
    private bus: Bus,
  ) {}

  create(n: NewNote): Note {
    const t = now()
    const note = {
      id: id(),
      page: n.page,
      url: n.url ?? null,
      selector: n.selector ?? null,
      element: n.element?.slice(0, 300) ?? null,
      html: n.html?.slice(0, 1500) ?? null,
      styles: n.styles ? JSON.stringify(n.styles) : null,
      fx: n.fx ?? null,
      fy: n.fy ?? null,
      page_x: n.pageX ?? null,
      page_y: n.pageY ?? null,
      viewport: n.viewport ?? null,
      floating: n.floating ? 1 : 0,
      region: n.region ? JSON.stringify(n.region) : null,
      ...(n.shots ? { shots: JSON.stringify(n.shots) } : {}),
      text: n.text,
      author: n.author ?? null,
      approved: n.approved === false ? 0 : 1,
      guest: n.guest ? 1 : 0,
      created_at: t,
      updated_at: t,
    }
    const cols = Object.keys(note)
    this.db.prepare(`INSERT INTO notes (${cols.join(',')}) VALUES (${cols.map((c) => `:${c}`).join(',')})`).run(note)
    this.message(note.id, 'user', n.text, n.author ?? null)
    const created = this.get(note.id)!
    this.bus.emit('note', created)
    return created
  }

  get(id: string): Note | undefined {
    const r = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
    return r && toNote(r)
  }

  /** Visible notes by default; pass statuses to filter otherwise. */
  list(statuses: Status[] = VISIBLE): Note[] {
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`)
      .all(...statuses) as Row[]
    return rows.map(toNote)
  }

  update(id: string, patch: Patch): Note | undefined {
    const sets: string[] = ['updated_at = :updated_at']
    const params: Record<string, string | number | null> = { id, updated_at: now() }
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMNS[k]
      if (!col || v === undefined) continue
      sets.push(`${col} = :${col}`)
      params[col] = JSON_COLS.has(k) ? (v === null ? null : JSON.stringify(v)) : typeof v === 'boolean' ? Number(v) : (v as string | number | null)
    }
    this.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = :id`).run(params)
    const note = this.get(id)
    if (note) this.bus.emit('note', note)
    return note
  }

  message(noteId: string, role: Message['role'], text: string, author: string | null = null): void {
    this.db.prepare('INSERT INTO messages (note_id, role, text, author, at) VALUES (?, ?, ?, ?, ?)').run(noteId, role, text, author, now())
  }

  messages(noteId: string): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE note_id = ? ORDER BY id').all(noteId) as Row[]
    return rows.map((r) => ({
      id: r.id as number,
      noteId: r.note_id as string,
      role: r.role as Message['role'],
      text: r.text as string,
      author: (r.author as string) ?? null,
      at: r.at as string,
    }))
  }

  change(noteId: string, file: string): Change | undefined {
    const r = this.db.prepare('SELECT * FROM changes WHERE note_id = ? AND file = ?').get(noteId, file) as Row | undefined
    return r && { noteId, file, original: (r.original as string) ?? null, final: (r.final as string) ?? null }
  }

  changes(noteId: string): Change[] {
    const rows = this.db.prepare('SELECT * FROM changes WHERE note_id = ? ORDER BY file').all(noteId) as Row[]
    return rows.map((r) => ({ noteId, file: r.file as string, original: (r.original as string) ?? null, final: (r.final as string) ?? null }))
  }

  /** Remembers the file as it was before the note first touched it. Later calls keep the first original. */
  recordOriginal(noteId: string, file: string, original: string | null): void {
    this.db.prepare('INSERT OR IGNORE INTO changes (note_id, file, original, final) VALUES (?, ?, ?, ?)').run(noteId, file, original, original)
  }

  setFinal(noteId: string, file: string, final: string | null): void {
    this.db.prepare('UPDATE changes SET final = ? WHERE note_id = ? AND file = ?').run(final, noteId, file)
  }

  dropChange(noteId: string, file: string): void {
    this.db.prepare('DELETE FROM changes WHERE note_id = ? AND file = ?').run(noteId, file)
  }
}
