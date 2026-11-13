import type { Bus } from './bus.js'
import type { Config } from './config.js'
import type { Locks } from './locks.js'
import type { Rebuilder } from './rebuild.js'
import type { Shooter } from './shots.js'
import type { Store } from './store.js'

/** Everything a worker needs, built once by startPinwright. */
export interface Ctx {
  cfg: Config
  store: Store
  bus: Bus
  locks: Locks
  shooter: Shooter
  rebuilder: Rebuilder
}

const LANGS: Record<string, string> = { it: 'Italian', en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese' }
export const langName = (code: string) => LANGS[code.slice(0, 2).toLowerCase()] ?? code

/** The env the agents run with: no API key unless the user lets it through, so `claude login` is used. */
export function agentEnv(cfg: Config): Record<string, string | undefined> {
  const env = { ...process.env }
  if (!cfg.useApiKey) delete env.ANTHROPIC_API_KEY
  // Launched from inside a Claude Code session: the child must not think it is nested.
  delete env.CLAUDECODE
  return env
}
