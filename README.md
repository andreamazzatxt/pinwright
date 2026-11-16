# pinwright

Pin feedback on your running site; Claude agents fix it while you keep reviewing.

Press **N** on any page, click an element, write what's wrong. A small daemon queues the note, a Claude
agent edits your code, and you watch the change land live. When it's done you get a notice with a summary and
the cost; the note's panel has the diff and an **Undo** button. The agent doesn't verify anything itself (no
screenshots, builds or tests): you are the check. Notes that don't touch the same files run in parallel. The agent never stops to ask: when a
note is ambiguous it picks the likeliest reading, applies it, and says what it assumed; you follow up on the pin
("not quite…") and the same session resumes. Changes show up live while the agent works.

Hold **⌥** and click anywhere to drop a note without entering note mode; the cursor turns into a pin while ⌥
is down.

## Live sessions

Open the notes list and press **Go live** (bottom right of the list): pinwright opens a [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
quick tunnel and gives you a link with a secret token. The **YOLO mode** switch (off every time the page loads) picks which
link you copy:

- **Off**: guests' notes, replies and retries wait, marked *To approve*, until you press **Approve** in the note
  (or **Discard** it). You get a toast when one arrives.
- **On** (the box gets an iridescent border that follows the pointer): guests' notes go straight to the agents, like yours.

While live, the link box sits at the top of the notes card, and the closed button shows the live state with a copy button. Note and share
actions are icons; hover one to see what it does. Both links stay valid at once: the switch only changes which one you copy.

Whoever opens a link (up to 8 people in all) sees the site and every note, adds notes and replies, and everyone
sees everyone's cursor, each with its own colour and a made-up name ("Volpe Ninja", "Gufo Turbo"…); click your own avatar to pick a name. Notes and
replies carry their author's name. **Stop** closes the tunnel and voids both links.

Notes make agents edit your code (inside the guardrails below): give the YOLO link only to people
you'd let do that. Remote visitors can't share, approve, take notes or read the daemon's status.
Guests need only a browser. On your side pinwright uses `cloudflared`: the one on your PATH if there is one,
else it downloads Cloudflare's official build from their GitHub releases on the first share (once per machine,
into `~/.cache/pinwright`; on macOS the download must carry Cloudflare's signature). Set `cloudflared` in the
config to point at a binary of your own.

Requires Node ≥ 22.13 and a logged-in Claude Code (`claude login`). The optional before/after thumbnails
(`shots: true`) need Google Chrome and the optional `playwright-core` dependency.

## Use

### Proxy (any stack)

```sh
npx pinwright --target http://localhost:4330
# open http://localhost:4340/
```

Point it at a dev server (`astro dev`, `vite`) and edits appear through HMR as the agent makes them; the
websocket goes through the proxy. Without HMR (e.g. `astro preview`), give it a rebuild command:
`--rebuild ./scripts/rebuild.sh`. It runs after every edit (coalesced) and open pages reload, back at the same
scroll position.

### Vite

```js
// vite.config.js
import pinwright from '@andreamazza/pinwright/vite'
export default { plugins: [pinwright()] }
```

### Astro

```js
// astro.config.mjs
import pinwright from '@andreamazza/pinwright/astro'
export default { integrations: [pinwright()] }
```

The daemon starts and stops with `vite dev` / `astro dev`; nothing runs in builds.

## Config

`pinwright.config.mjs` in the project root (all optional; plugin options and CLI flags override it):

```js
export default {
  target: 'http://127.0.0.1:4330',   // proxy mode only
  port: 4340,
  rebuild: './scripts/rebuild.sh',   // proxy mode without HMR
  rebuildOnEdit: true,               // rebuild after every edit, not only at the end
  ask: false,                        // true lets the agent ask a question (a `?` on the pin) instead of guessing
  maxAgents: 3,
  models: { planner: 'haiku', worker: 'sonnet' }, // planner: false skips planning
  viewports: [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }],
  shots: false,                      // true adds before/after thumbnails to the panel
  maxTurns: 30,
  timeoutMin: 20,
  lang: 'en',                        // language of the overlay and of the agent's messages
  instructions: '',                  // appended to the agent's system prompt
  useApiKey: false,                  // true lets ANTHROPIC_API_KEY through instead of `claude login`
}
```

## CLI

```
pinwright [start] --target <url>   run the daemon (proxy mode when there's a target)
pinwright list [--all]             notes in the running daemon
pinwright take <id>                mark a note taken and print a prompt for an interactive session
pinwright done <id> [summary]      close a note you handled by hand
pinwright reply <id> <text>        follow up on a note (or answer, with ask: true)
```

`claude "$(pinwright take abc123)"` pulls a handed-off note into Claude Code.

## How it works

- **Store**: SQLite (`node:sqlite`) in `.pinwright/` (ignored by git automatically). The queue survives
  restarts; notes left mid-flight go back in the queue.
- **Scheduler**: a Haiku planner predicts which files each note touches; notes whose files don't overlap run
  side by side, up to `maxAgents`. Locks are also taken at edit time, so a wrong guess only means waiting.
- **Worker**: Claude Agent SDK, one session per note, with only the note in the prompt (text, page,
  selector, outerHTML, computed styles) plus your project's CLAUDE.md. No shell, no screenshots, no
  builds or tests: it finds the source, edits, and closes the note through in-process tools (`note_done`,
  `note_handoff`, and `note_ask` with `ask: true`).
- **Guardrails**: reads and edits only inside the project root (never `.git`, `node_modules`, `.pinwright`), no
  git history commands, no network, no installs, no file changes through the shell (so undo always works).
  No note may change what runs code on the next install, build or dev start: `package.json`, lockfiles,
  `*.config.*`, `.env*`, shell scripts, Dockerfiles, CI and editor folders.
- **Guest notes** (written on a shared link, or replied to from one) also may only edit files under a source or
  asset folder (`src/`, `public/`, `app/`, `pages/`, `components/`, `styles/`, `assets/`…, set with `guestDirs`)
  and may not read secrets (`.env*`, keys, certificates), so nothing private can be copied into the page.
- **Undo** restores the note's files. If another edit changed them since, the note's own patch is reversed on
  top; if it doesn't apply cleanly, undo is refused and lists the files.
- The daemon binds 127.0.0.1 and only answers pages from localhost origins, plus visitors who come through the
  share tunnel with its token (link once, then an HttpOnly SameSite cookie).
- The live channel (note events, presence, cursors) is a WebSocket on `/__pw/ws`: tunnels buffer SSE but pass
  WebSockets through.
