import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Each entry moves the schema one version up; never edit a shipped one, append a new one. */
const MIGRATIONS = [
  `CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    page TEXT NOT NULL,
    url TEXT,
    selector TEXT,
    element TEXT,
    html TEXT,
    styles TEXT,
    fx REAL, fy REAL, page_x REAL, page_y REAL,
    viewport TEXT,
    text TEXT NOT NULL,
    author TEXT,
    approved INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued',
    area TEXT,
    session_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    diff TEXT,
    shots TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT
  );
  CREATE INDEX notes_status ON notes(status);
  CREATE INDEX notes_page ON notes(page);
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX messages_note ON messages(note_id);
  CREATE TABLE changes (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    original TEXT,
    final TEXT,
    PRIMARY KEY (note_id, file)
  );`,
  `ALTER TABLE notes ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE messages ADD COLUMN author TEXT;`,
  `ALTER TABLE notes ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE notes ADD COLUMN floating INTEGER NOT NULL DEFAULT 0;`,
]

export function openDb(root: string): DatabaseSync {
  const dir = join(root, '.pinwright')
  mkdirSync(join(dir, 'shots'), { recursive: true })
  // Ignored even when the project's own .gitignore doesn't mention it.
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '*\n')
  const db = new DatabaseSync(join(dir, 'db.sqlite'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}
