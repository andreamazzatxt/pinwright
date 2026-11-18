// The fixtures import `pinwright/vite`, `pinwright/next`…: link this repo in as `pinwright`, as an install would.
// (A `file:../..` dependency would make npm walk the repo's own pnpm-managed node_modules.)
import { lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const link = join(here, 'node_modules', 'pinwright')
mkdirSync(dirname(link), { recursive: true })
try {
  lstatSync(link)
  rmSync(link, { recursive: true, force: true })
} catch {}
symlinkSync(join(here, '..', '..'), link, process.platform === 'win32' ? 'junction' : 'dir')
