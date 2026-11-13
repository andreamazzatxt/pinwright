# pinwright: handoff

> Pin feedback on your running site; Claude agents fix it while you keep reviewing.

This package extracts and replaces an earlier project-local "notes" overlay (copied into `reference/`). Today it is a proxy that injects `overlay.js`, stores notes in a JSON file, and
relies on an interactive Claude Code session watching that file with a Monitor. That watch expires, and a
single long session saturates its context. pinwright replaces it with a small daemon that receives notes and
spawns agents.

Status: **nothing built yet.** Repo scaffolded: package.json, deps installed, Agent SDK smoke test passed.
Everything below was decided with the user (Andrea) on 2026-11-13.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Name | `pinwright`. Package `@andreamazza/pinwright`, bin `pinwright` (unscoped `pinwright` is also free on npm) |
| Distribution | Own GitHub repo, published on npm later. **Never publish without an explicit yes.** |
| Integration | Generic proxy CLI (`pinwright --target http://localhost:4330`) **plus** a Vite plugin (`pinwright/vite`) and an Astro integration (`pinwright/astro`) that start the daemon together with the dev server |
| Agent engine | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), in process |
| Auth | Existing `claude login`. Verified: it works when `ANTHROPIC_API_KEY` is removed from the env (`apiKeySource: none`). Strip that key by default; an option can let a key through |
| Parallelism | Scheduler with file locks. A cheap planner (Haiku) predicts which files or areas a note touches. Notes that don't overlap run in parallel in the same working tree. `canUseTool` also enforces the locks at edit time |
| Review | Edits go straight to the working tree. The overlay shows the diff, before/after screenshots and an **undo** button |
| Interactive session | The daemon works on its own. Notes too big or ambiguous go to "handoff", and the user pulls them into Claude Code with `pinwright take <id>` |
| Ambiguity | The agent asks (a `?` on the pin), frees its slot and locks, and the same session resumes (`resume: session_id`) when the user answers |
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
  overlay.js    plain browser JS, shipped as-is, it/en strings (cfg.lang or navigator.language)
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
  lang: 'it',
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
