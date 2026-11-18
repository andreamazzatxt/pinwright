# Tests

| Folder | What | Needs | Run |
| --- | --- | --- | --- |
| `unit/` | One module at a time: locks, the guard (what agents may read, edit, run), notes (undo, replies, approval), the WebSocket framing, HTML injection. | Node | `pnpm test` |
| `integration/` | The daemon's HTTP server and proxy with fake dev servers and a fake `cloudflared`: the localhost guards (Host, websocket Origin), a microfrontend live session as a guest sees it, which link's notes run as whom. | Node (not on Windows) | `pnpm test` |
| `e2e/` | Real dev servers behind pinwright, driven by Chrome: the overlay (note mode, ⌥, dictation), HMR, the Vite and Next.js plugins, Module Federation in a shell with `--scope` and Go live. | Chrome, `npm install --prefix test/e2e` | `pnpm test:e2e` |
| `helpers/` | Shared by the above: a temp project with its store (`notes.mjs`), the fake `cloudflared`. | | |

Everything runs against the compiled package (`dist/`): both scripts build first.

No test calls Claude: daemons run with `maxAgents: 0` (`--agents 0`), so notes are stored but never picked up.

The e2e fixtures (`e2e/fixtures/`) are minimal apps with their own ports (46xx for pinwright, 56xx for the dev
servers), so the suites don't collide with whatever you have running. Each suite starts from an empty
`.pinwright/` and checks that stopping leaves no process, port or untracked file behind. Set `CHROME_PATH` to
use a browser other than the installed Chrome.
