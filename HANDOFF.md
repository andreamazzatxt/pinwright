# pinwright: handoff

> Pin feedback on your running site; Claude agents fix it while you keep reviewing.

This package extracts and replaces an earlier project-local "notes" overlay (copied into `reference/`). Today it is a proxy that injects `overlay.js`, stores notes in a JSON file, and
relies on an interactive Claude Code session watching that file with a Monitor. That watch expires, and a
single long session saturates its context. pinwright replaces it with a small daemon that receives notes and
spawns agents.

Status (2026-11-13): **milestones 1–5 done except publishing**: built, tested (unit tests, fixture site, real
Vite/Astro), packaged, README written. Dogfooding on a real Astro site
started (proxy in front of `astro dev`, HMR verified). Everything below was decided with the user (Andrea)
on 2026-11-13; "Implementation notes" at the end records where the build deviates or adds.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Name | `pinwright`. Package `pinwright`, bin `pinwright` (unscoped `pinwright` is also free on npm) |
| Distribution | Own GitHub repo, published on npm later. **Never publish without an explicit yes.** |
| Integration | Generic proxy CLI (`pinwright --target http://localhost:4330`) **plus** a Vite plugin (`pinwright/vite`) and an Astro integration (`pinwright/astro`) that start the daemon together with the dev server |
| Agent engine | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), in process |
| Auth | Existing `claude login`. Verified: it works when `ANTHROPIC_API_KEY` is removed from the env (`apiKeySource: none`). Strip that key by default; an option can let a key through |
| Parallelism | Scheduler with file locks. A cheap planner (Haiku) predicts which files or areas a note touches. Notes that don't overlap run in parallel in the same working tree. `canUseTool` also enforces the locks at edit time |
| Review | Edits go straight to the working tree. The overlay shows the diff, before/after screenshots and an **undo** button |
| Interactive session | The daemon works on its own. Notes too big or ambiguous go to "handoff", and the user pulls them into Claude Code with `pinwright take <id>` |
| Ambiguity | **Changed 2026-11-13 after dogfooding:** the agent never asks. It picks the likeliest reading, applies it and states the assumption in the summary; the user follows up or undoes. `ask: true` brings back the question flow (`?` pin, resume on answer) |
| Agent scope | **Changed 2026-11-13 after dogfooding:** the agent doesn't verify. No screenshot or rebuild tools, no Bash, no `check`: it edits and calls note_done; the reviewer validates live. Daemon before/after shots are off by default (`shots: true` brings them back). maxTurns 30. A trivial note now takes ~10 s |
| Done notes | **Added 2026-11-13:** hidden by default (toggle "Mostra fatte" in the list, per browser); a bottom-right notice appears when a note becomes done/failed/handoff, with summary and tokens · $; click opens the panel. Working pins show three typing dots instead of the number. A click outside closes every open card |
| Live sessions | **Added 2026-11-13:** a link to send someone in a call. cloudflared quick tunnel + secret token (link → HttpOnly SameSite cookie; remote = non-loopback or cf-connecting-ip/x-forwarded-for). Max 8 people (raised from 4 on 2026-11-16), made-up names ("Animal Trait" in it, "Trait Animal" in en) or one the person sets by clicking their own chip (remembered per browser, unique in the session), 8 colours, live cursors anchored to the element under the pointer (selector + fx/fy, fallback x ratio + page y). Notes/replies carry the author's name (messages.author). Remote visitors can't share, take, or read /status. Stop = kill tunnel + new token next time + guests disconnected. cloudflared: config path → PATH → `~/.cache/pinwright` → download of the latest official release on first share (macOS: codesign must be Cloudflare's team 68WVV388M8, then `--version` must run; otherwise deleted) |
| Two share links | **Added 2026-11-16:** sharing makes two links, the share box shows one with a "YOLO mode" switch (off on every page load, never remembered; on = iridescent border that turns and lights up towards the pointer, remembered per browser) that swaps them (two tokens; the cookie keeps the token, so the server knows which link a guest came from). `review`: notes, replies and retries from it are stored with `approved = 0` (the column the scheduler already filters on) and show as "To approve" until the host presses Approve (`POST /notes/:id/approve`, host only) or discards the note; the host gets a toast. `auto`: guests' notes run like the host's |
| Overlay UI | **Changed 2026-11-16:** English by default (`lang: 'it'` for Italian; the browser's language no longer decides). Actions are icon buttons with a hover label (inline SVG, `data-tip`). One element (the hub) bottom right: closed it's the pink pill ("Notes 6", badges for questions and notes to approve, live dot + copy while sharing); a click morphs it (size, corners, colour, 340 ms) into the dark notes card: one header line (the note-mode hint + ×), the link box while live, the notes, then "Show done" and "Go live". The YOLO border lives on the hub, open or closed. Short, dry copy |
| Guest guardrails | **Added 2026-11-16:** every note: reads only inside root (PreToolUse on Read/Glob/Grep, planner too, since auto-allowed reads skip canUseTool) and no edits to manifests, lockfiles, `*.config.*`, `.env*`, scripts, Docker/CI/editor dirs (they run code on the next install/build/dev start). Guest notes (`notes.guest`: created on a shared link, or a guest replied): edits only under `cfg.guestDirs`, no reads of secrets; the prompt tells the agent the note is from a guest. Reason: a link lets strangers steer an agent on the host's machine |
| ⌥ shortcut | **Added 2026-11-13:** holding ⌥ is a temporary note mode, cursor becomes a pin in the person's colour (light-DOM style with an SVG cursor); a click with altKey counts even if the keydown never reached the page |
| Live transport | **Changed 2026-11-13:** SSE replaced by a WebSocket (`/__pw/ws`, own minimal RFC 6455 server in `src/ws.ts`) because cloudflared quick tunnels buffer text/event-stream entirely; cursors go over the same socket. Overlay reconnects with backoff |
| Live | **Added 2026-11-13:** the user must see changes while the agent works. Prefer a dev server with HMR as target (ws passes through the proxy); with a rebuild command, it runs after every edit (`rebuildOnEdit`, coalesced) |
| Lifecycle | Runs with the dev server. While it runs, the listener **must never die**. The queue persists and resumes on restart |
| Verification | Playwright screenshots before and after, multi-viewport (the note's viewport plus mobile and desktop). The overlay captures the element's outerHTML and computed styles so the agent searches less |
| Limits | Max parallel agents (default 3). Model per task: Haiku for the planner, a strong model (default sonnet, configurable) for fixes |
| Guardrail | Minimal: free inside the project root. No git commit/push/reset/checkout, no network (curl, wget, ssh, WebFetch, WebSearch), no edits outside root or inside `.git`/`node_modules`/`.pinwright` |
| Storage | SQLite through Node's built-in `node:sqlite` (Node ≥ 22.13, no native deps), in `.pinwright/` (git-ignored), WAL mode |
| Users | Localhost only for now (bind 127.0.0.1). The schema already has `author` and `approved` so the team can come later |

## Architecture

```
browser ── overlay.js (shadow DOM) ──HTTP/SSE──▶ daemon (node http, 127.0.0.1:4340)
                                                  ├─ proxy mode: forwards to --target, injects <script src="/__pw/overlay.js">, ws upgrade passthrough for HMR
                                                  ├─ store: node:sqlite (.pinwright/db.sqlite)
                                                  ├─ scheduler: queue → planner (haiku) → locks → workers (max N)
                                                  ├─ worker: Agent SDK query() + in-process MCP tools + canUseTool guard
                                                  ├─ shots: playwright-core with system Chrome (channel 'chrome'), optional dep
                                                  └─ rebuild: configured command (proxy mode), serialized + coalesced, then SSE 'reload'
```

### Suggested layout

```
src/
  config.ts     loads pinwright.config.{mjs,js,json}; defaults
  db.ts         schema + migrations (node:sqlite)
  store.ts      notes/messages/changes CRUD, status transitions
  bus.ts        EventEmitter → SSE (note changed, activity, reload)
  locks.ts      file → noteId map; tryAcquire(files), acquireOne(file, timeout), releaseAll(note); a path prefix counts as overlap
  planner.ts    haiku, read-only tools (Read/Glob/Grep), returns {files: string[]}; on failure [] (rely on dynamic locks)
  agent.ts      worker: prompt, options, stream handling, outcome, diff, after shots
  tools.ts      MCP server per note: note_ask, note_done, note_handoff, screenshot, rebuild
  guard.ts      canUseTool: path checks, lock wait, record originals for undo, bash denylist
  shots.ts      shared browser, capture(url, viewport, selector) → .pinwright/shots/*.jpg
  rebuild.ts
  scheduler.ts  tick every 1s + wake on events; recovery on start (working/planning → queued, attempts++)
  server.ts     API + SSE + proxy + static shots, CORS only for localhost origins
  index.ts      startPinwright(opts) → { url, stop() }
  cli.ts        start | list | take <id> | done <id> [summary] | reply <id> <text>
  vite.ts       plugin: apply 'serve', configureServer starts daemon, transformIndexHtml injects script, stop on close
  astro.ts      integration: astro:config:setup injectScript('page', loader) in dev; astro:server:setup/done
overlay/
  overlay.js    plain browser JS, shipped as-is, it/en strings (cfg.lang, English by default)
```

### Data model

- `notes`: id, page, selector, element (text), html (outerHTML, max 1.5k), styles (json), fx, fy, page_x, page_y,
  viewport, text, author, approved, status, area (json files), session_id, attempts, summary, diff,
  shots (json {before:[], after:[]}), cost_usd, created_at, updated_at, started_at.
- `messages`: id, note_id, role (user|agent|system), text, at. This is the note's thread, and any follow-up re-queues the note.
- `changes`: (note_id, file) PK, original (null = file didn't exist), final. Used for diff and undo.

Statuses: `queued → planning → working → done | asking | handoff | failed`, then `asking --answer--> queued (resume)`,
`done --follow-up--> queued (resume)`, `done → archived`, `done → undone`, `handoff → taken`, any → `deleted`
(abort the agent first if it's running).

### Worker details

- `query({ prompt, options: { cwd: root, model, resume, settingSources: ['project','local'],
  systemPrompt: { type:'preset', preset:'claude_code', append }, mcpServers: { pinwright }, allowedTools:
  ['Read','Glob','Grep', ...mcp tools], permissionMode: 'default', canUseTool, abortController, maxTurns, env } })`
- The prompt holds only the note: text, page, viewport, selector, element text, outerHTML, computed styles, and the pin
  position (fx, fy). The project's CLAUDE.md comes in through settingSources. Never pass the history of other notes.
  This is what keeps context small.
- Prompt rules for the agent:
  - smallest change, edits only via Edit/Write (no `sed -i` or redirects), so they can be undone;
  - no commit or installs;
  - verify with `rebuild` plus `screenshot` at the note's viewport and the other one;
  - `note_ask` (one short question, in the user's language, then end the turn) when ambiguous;
  - `note_handoff` when it's too big;
  - `note_done` with a one-to-two-line summary in the user's language;
  - if `check` is configured, run it before `note_done`.
- `canUseTool` for Edit/Write/MultiEdit:
  - deny if the path is outside root;
  - acquire the file lock, waiting up to about 3 minutes; on timeout, deny with "busy for another note";
  - store the original content the first time the note touches the file.
- After the stream ends:
  - store each file's final content, compute the diff (`diff` package, createTwoFilesPatch), release the locks;
  - on done: rebuild, then after shots for every configured viewport;
  - if no tool was called: success → done with the result text, error → requeue until attempts = 2, then failed.
- Undo restores the originals only if every file's current content still equals `final`. Otherwise it refuses and lists the files.
- Broadcast "activity" (last tool used, e.g. "Editing src/x.astro") over SSE. Keep it in memory, not in the DB.
- The screenshot tool returns the image to the agent (jpeg, ~800px wide, q≈60) as MCP image content.
  Shots load the target directly, without the overlay: the overlay exits early if `navigator.webdriver`.

### Never dying

- Every agent runs inside a try/catch with a timeout (default 20 minutes). A crash puts its note back in the queue.
- The scheduler tick is wrapped in a try/catch, and every promise has a catch.
- In CLI mode only: `uncaughtException`/`unhandledRejection` log and keep running, and SIGINT/SIGTERM → `stop()` then exit.
  In plugin mode, don't install process-wide handlers (they would swallow the host's crashes).
- On startup, notes left in working/planning go back to queued.

### Overlay (port `reference/overlay.js`)

- Keep:
  - selector building, pins that follow their element (selector + fx/fy);
  - the popover top layer, re-raised inside an open modal `<dialog>`;
  - the `N` / `⌥N` toggle, the save form, two-click delete;
  - live reload that keeps scroll position and waits while a form is open.
- Change:
  - everything inside a shadow root (`<pinwright-root>`), with the element highlight drawn as a box in the shadow DOM rather than a class on page elements;
  - API base taken from `document.currentScript.src`, so it works cross-origin in Vite/Astro mode;
  - SSE instead of polling.
- Pin colours: queued pink, working purple with a spinner, asking cyan with a bouncing `?`, done green ✓ (stays until "archive"),
  failed red, handoff orange.
- Panel on a pin:
  - the thread;
  - live activity;
  - an answer box when asking;
  - for done notes: summary, collapsible coloured diff, before/after thumbnails;
  - buttons: Archive, Undo, follow-up box ("not quite…"), Retry (failed), Hand off, Delete.

### Config (`pinwright.config.mjs`)

```js
export default {
  target: 'http://127.0.0.1:4330',   // proxy mode only
  port: 4340,
  rebuild: './scripts/rebuild.sh',   // proxy mode without HMR; omitted in Vite/Astro
  check: 'pnpm -s typecheck',        // optional
  maxAgents: 3,
  models: { planner: 'haiku', worker: 'sonnet' },
  viewports: [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }],
  maxTurns: 60, timeoutMin: 20,
  lang: 'en',
  instructions: '',                  // extra system prompt
}
```

## Build plan (milestones)

1. Daemon, SQLite and proxy, with the old overlay moved into a shadow DOM and onto the new API. Matches today's features.
2. Agent SDK worker with MCP tools, one agent at a time, ask/resume, handoff and `pinwright take`.
3. Planner, locks, parallel workers, dynamic lock enforcement in canUseTool.
4. Screenshots and diff/undo in the overlay, Vite plugin and Astro integration.
5. README, packaging (`files`, bin shebang), dogfood on a real site in place of the old notes overlay:
   - proxy in front of the site's preview or dev server;
   - rebuild script for preview mode: see `reference/rebuild.sh` (builds into dist-next, then swaps);
   - use a port other than the old notes server's.

## Verified facts

- `reference/sdk-smoke-test.mjs`: with `ANTHROPIC_API_KEY` removed from env, `query()` ran on haiku through the claude login.
  An in-process MCP tool (`createSdkMcpServer` + `tool`) was called, and `resume: session_id` remembered the earlier turn.
  Cost of the test: about $0.008.
- Toolchain: Node 24.14, pnpm 10.11, Claude Code 2.1.323, SDK 0.3.323, TypeScript 7, Google Chrome installed (Playwright `channel: 'chrome'`).
- Node in node_modules won't strip types, so the package must ship compiled JS (`tsc` → dist).

## Implementation notes (build of 2026-11-13)

- Guard lives in a **PreToolUse hook**, not in `canUseTool`: hooks run even for tools a project's settings
  auto-allow, so path checks, locks and the undo record can't be bypassed. `canUseTool` just allows what reaches it.
  No bare `allowedTools` (the SDK warns that they shadow the callback).
- The bash denylist also blocks `rm/mv/cp/tee/touch`, `sed -i`/`perl -i` and redirects into files, so every edit
  goes through Edit/Write and stays undoable.
- PostToolUse hook on edit tools triggers a background rebuild (`rebuildOnEdit`). `note_ask` is registered only with `ask: true`;
  a note left in `asking` and retried resumes with "don't wait, pick the likeliest reading".
- The overlay saves scroll, note mode and open panel on every `pagehide` and restores them on a reload of the same
  page, so HMR full reloads keep the position too.
- Before shots run while the agent reads; the guard makes its first edit wait for them.
- Planner is skipped when a note is alone (nothing to parallelize); `models.planner: false` turns it off.
- Undo: files untouched since go back to `original`; files changed since get the note's patch reversed
  (context 0); refused only if that doesn't apply.
- Vite/Astro share one daemon per process with a refcount: dev servers open the new server before closing the
  old one on restart, so the daemon stops 1.5 s after the last release.
- API under `/__pw/*` (notes, events SSE, shots, status, overlay.js). Requests from non-localhost origins → 403.

### Tested (fixture site in proxy mode, haiku as worker)

Note → agent → done with summary/diff/before-after shots; live activity on the pin; ask → `pinwright reply` →
same session resumed; three notes at once (planner put two on different files, ran in parallel); undo,
double undo, undo across two notes on the same file; `take`/`done`; clean SIGINT stop; Vite plugin lifecycle
with a simulated dev server (restart keeps the daemon, last close stops it).

### Tested afterwards (same day)

- `pnpm test` (node:test on dist): locks, guard denylist and paths, an edit waiting on another note's lock, undo
  (restore, created files, reverse patch across notes, refusal on conflict), reply re-queue.
- Timeout path: with `timeoutMin: 0.05` the note fails after 2 attempts.
- Real Vite 8 and Astro 7 dev servers (packages linked from an existing local install): daemon starts with the dev
  server, overlay loads cross-origin with SSE, a note from the UI lands live through HMR, the notice shows; the
  daemon stops with the dev server (SIGINT for Vite, `astro dev stop` for Astro, which runs detached).
- Overlay inside an open modal `<dialog>` (a site's contact form).
- `npm pack --dry-run`: dist, overlay, README, LICENSE, package.json (42 files). Not published.

### Still open

- Dogfooding on a real Astro site is in progress (proxy → `astro dev`).
- Publishing to npm: only with an explicit yes from the user.

### Own server for Go live (2026-11-24)

Opt-in: the default stays the Cloudflare quick tunnel (works at once). `--ssh user@host --hostname <name>` opens
`ssh -N -R 127.0.0.1:<sshPort>:127.0.0.1:<guestPort>` (BatchMode: key or agent only) and the share counts as up once
`https://<name>/__pw/probe?n=<nonce>` comes back through the guest port (204). Every tunnel (cloudflared too) now
reaches the daemon on a separate 127.0.0.1 guest port: sockets accepted there are guests whatever their headers,
so a proxy that rewrites Host and adds no X-Forwarded-For (nginx defaults) can't make a guest look like the host.

### Releasing

A version tag publishes: `npm version patch -m "%s: what changed"` (commit + tag `v…`), then
`git push --follow-tags`. `.github/workflows/release.yml` checks the tag against package.json, runs the tests,
publishes to npm through Trusted Publishing (no token, with provenance; a version already on npm is skipped) and
makes the GitHub release with the commits since the previous tag. Pushing a tag is publishing: only with the user's yes.
