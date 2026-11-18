# pinwright

**Give Claude feedback right on your dev site.** Click the element that's wrong, write what you want, and a
Claude agent edits your source while you keep reviewing. Up to 8 people can review the same page live.

![pinwright: eight reviewers on the same page, each with their own cursor](https://raw.githubusercontent.com/andreamazzatxt/pinwright/main/docs/cover.png)

Asking a coding agent to fix a page usually goes: take a screenshot, switch to the terminal, paste it,
describe the component ("the grey button under the title, no, the other one"), wait, switch back, check.
pinwright removes the round trip. The note is attached to the element you clicked, so the agent already
knows its selector, markup, computed styles and the page it lives on. It finds the source, edits it, and the
page updates through your dev server's HMR.

- **Point and write.** ⌥ + click anywhere, or press **N**, click an element, type the note.
- **Live edits.** The change lands on the page while the agent works; the note gets a summary, the cost,
  the diff and an **Undo** button.
- **Parallel agents.** Notes that touch different files run side by side.
- **Live sessions.** One link, up to 8 people on the same page, everyone's cursor visible, every note shared.
- **You stay in control.** Guest notes wait for your approval, and agents work inside strict guardrails.

## Set it up with Claude

Open Claude Code in your project's folder and paste this:

```text
Set up pinwright in this project: follow https://raw.githubusercontent.com/andreamazzatxt/pinwright/main/SETUP.md
```

Claude follows [SETUP.md](SETUP.md): it recognises your stack and asks the same questions as `npx pinwright`:
run it now without installing anything, add it to the project (it installs and wires the plugin, then checks
that it starts), or review a site that is already running.

## Or just run it with npx

```sh
npx pinwright
```

Run it in your project's folder. pinwright recognises the stack (Next.js, Nuxt, Astro, SvelteKit, Vite, Rspack,
Rails, Django, Laravel…) and asks how you want to start:

```
  pinwright 0.2.0 · give Claude feedback right on your dev site

  Project  Next.js · npm run dev
  Claude   ✓ Claude Code found

? How do you want to start?
❯ Run it now                              nothing is installed in the project
  Add it to the project                   Claude Code installs and wires the Next.js plugin
  Review a site that is already running   you give its URL
```

**Run it now** starts your dev command, reads the URL it prints, and opens the site with the overlay on top.
Nothing goes into `package.json` or your config files: notes and state live in `.pinwright/`, which git ignores,
so `git status` stays clean. **Add it to the project** hands [SETUP.md](SETUP.md) to Claude Code.

Skip the questions with flags:

```sh
npx pinwright -y                               # run the dev script straight away
npx pinwright -- bin/rails server              # your own dev command, any stack
npx pinwright --target http://localhost:3000   # a site that is already running
```

## Microfrontends

For a Module Federation remote that a shell mounts, run pinwright in the remote's folder:

```sh
npx pinwright --mfe --scope '[data-mfe="checkout"]' --port 4380
```

pinwright starts the remote's dev server and sits in front of it. Point your shell at `http://localhost:4380`
instead of the remote's own port, then open the shell as usual: the overlay comes with the remote's JavaScript, the
shell's URL and login don't change, and agents only edit the remote's code. `--scope` is the CSS selector of the
remote's mount point: notes can only be placed inside it (it's outlined while you place one), and the rest of the
shell keeps working. `npx pinwright` offers this mode by itself when the folder is a Module Federation remote.

**Go live** works here too: press it on the shell page and guests get the shell with the remote inside, all through
the one link. pinwright passes the shell along and points every `localhost` address in it (the remote's URL, its
assets and chunks) back at the link, so nothing a guest loads goes to `localhost`. The shell must run over plain
`http` on this machine; `--shell <url>` names it if Go live is pressed elsewhere.

## Manual setup

Requirements: Node ≥ 22.13 and Claude Code logged in (`claude login`). pinwright uses your Claude Code
subscription by default; no API key needed.

```sh
npm i -D pinwright
```

| Framework | Setup |
| --- | --- |
| Vite, SvelteKit, React Router, SolidStart, Qwik | `plugins: [pinwright()]` in `vite.config`, from `pinwright/vite` |
| Astro | `integrations: [pinwright()]` in `astro.config`, from `pinwright/astro` |
| Nuxt | `modules: ['pinwright/nuxt']` in `nuxt.config` |
| Next.js | `withPinwright(config)` + `<Pinwright />` in the root layout (below) |
| Webpack 5, Rspack, Rsbuild | `plugins: [new PinwrightPlugin()]`, from `pinwright/rspack` |
| Anything else | `npx pinwright` (no install, see above) |

The daemon starts and stops with your dev server. Nothing is added to production builds.

<details>
<summary>Code for each framework</summary>

**Vite** (and every framework built on it):

```js
// vite.config.js
import pinwright from 'pinwright/vite'
export default { plugins: [pinwright()] }
```

The plugin puts the overlay into every HTML page the Vite dev server sends, server-rendered ones included.

**Astro**

```js
// astro.config.mjs
import pinwright from 'pinwright/astro'
export default { integrations: [pinwright()] }
```

**Nuxt**

```js
// nuxt.config.ts
export default defineNuxtConfig({ modules: ['pinwright/nuxt'] })
```

**Next.js** (Turbopack or webpack)

```js
// next.config.js
import { withPinwright } from 'pinwright/next'
export default withPinwright({ /* your config */ })
```

```jsx
// app/layout.jsx
import { Pinwright } from 'pinwright/next/script'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Pinwright />
      </body>
    </html>
  )
}
```

`<Pinwright />` renders nothing outside `next dev`. With the pages router, put it in `pages/_document`.

**Webpack 5 / Rspack / Rsbuild**

```js
// rspack.config.js (or webpack.config.js; with Rsbuild, under tools.rspack.plugins)
import { PinwrightPlugin } from 'pinwright/rspack' // same plugin as '/webpack'
export default { plugins: [new PinwrightPlugin()] }
```

It runs in watch mode only (dev server, `--watch`) and adds a small entry that loads the overlay.

**Any other stack**: use `npx pinwright` (above). pinwright sits in front of your dev server as a proxy and
injects the overlay; HMR websockets pass through. If your server has no HMR, pass a rebuild command with
`--rebuild ./scripts/rebuild.sh`: it runs after edits and open pages reload at the same scroll position.

All plugins take the same options as the config file: `pinwright({ port: 4350 })`.

</details>

## Writing notes

Hold **⌥** and click anywhere to drop a note; the cursor turns into a pin while ⌥ is down. Or press **N** to
enter note mode, then click.

**Say it instead.** Keep holding ⌥ after the click and talk: the note fills in as you speak, and letting go
of ⌥ saves it as it is. Holding ⌥ in any note or reply box does the same. The mic button starts and stops
dictation with a click and leaves the text for you to edit. It uses the browser's speech recognition (Chrome,
Edge, Safari) in your browser's language; in Chrome the audio goes to Google's speech service.

A small local daemon queues the note and a Claude agent picks it up. The agent never stops to ask: if a note
is ambiguous it picks the likeliest reading, applies it and says what it assumed. Reply on the pin ("not
quite, make it smaller") and the same agent session resumes.

The agent doesn't verify its own work: no screenshots, builds or tests. You are the check, looking at the
page. That keeps notes fast and cheap. Set `ask: true` if you'd rather the agent ask a question (a `?` on
the pin) than guess.

## Live sessions

Open the notes list and press **Go live**. pinwright opens a Cloudflare quick tunnel and gives you a link with
a secret token. Anyone with the link (up to 8 people in all) sees the site and every note, adds notes and
replies, and sees everyone's cursor, each with its own colour and a made-up name they can change. Guests only
need a browser.

The **YOLO mode** switch picks which link you copy. It's off every time the page loads.

- **Off:** guests' notes, replies and retries wait as *To approve* until you press **Approve** (or
  **Discard**). A toast tells you when one arrives.
- **On:** guests' notes go straight to the agents and run as yours, with none of the guest limits below.
  Your dev server runs the code they lead to, so whoever has this link can run code on your machine. Give it
  only to people you'd hand your laptop to.

Everyone with a link gets the whole dev server through it: the pages, and the sources and endpoints it serves.

Both links stay valid at the same time. **Stop** closes the tunnel and voids them. Guests can't share,
approve, or read the daemon's status.

pinwright uses the `cloudflared` on your PATH if there is one. Otherwise, on the first share it downloads
Cloudflare's official build from their GitHub releases into `~/.cache/pinwright` (once per machine; on macOS
the binary must carry Cloudflare's signature). Set `cloudflared` in the config to use your own binary.

## Guardrails

Each note runs in its own Claude Agent SDK session with only the note in the prompt (text, page, selector,
outerHTML, computed styles) plus your project's `CLAUDE.md`.

- Reads and edits only inside the project root, never `.git`, `node_modules` or `.pinwright`.
- No shell edits, no git history commands, no network, no installs, so undo always works.
- No note may change what runs code on the next install, build or dev start: `package.json`, lockfiles,
  `*.config.*`, `.env*`, shell scripts, Dockerfiles, CI and editor folders.
- **Notes from the approval link** may only edit files under source and asset folders (`src/`, `public/`,
  `app/`, `pages/`, `components/`, `styles/`, `assets/`…, configurable with `guestDirs`), and can't read
  secrets (`.env*`, keys, certificates), so nothing private can be copied into the page. You approve their
  text, not their diff, so they also stay off code that runs on your machine: server files (`server/`, `api/`,
  `*.server.*`, route handlers, middleware, hooks) and, anywhere, new code that reaches env, processes, files,
  the network or `eval`. YOLO-link notes count as yours.
- The daemon binds `127.0.0.1` and only answers pages from localhost (by name, so a site that points its
  domain at 127.0.0.1 is refused), plus visitors who arrive through the tunnel with its token (exchanged once
  for an HttpOnly, SameSite cookie). Dev-server websockets pass through only for local pages.

## Config

`pinwright.config.mjs` in the project root. Everything is optional; plugin options and CLI flags override it.

```js
export default {
  target: 'http://127.0.0.1:4330',   // proxy mode only
  port: 4340,
  rebuild: './scripts/rebuild.sh',   // proxy mode without HMR
  rebuildOnEdit: true,               // rebuild after every edit, not only at the end
  ask: false,                        // let the agent ask a question instead of guessing
  maxAgents: 3,                      // notes running at once
  models: { planner: 'haiku', worker: 'sonnet' }, // planner: false skips planning
  viewports: [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }],
  shots: false,                      // before/after thumbnails (needs Chrome and playwright-core)
  maxTurns: 30,
  timeoutMin: 20,
  lang: 'en',                        // overlay and agent language: 'en' or 'it'
  instructions: '',                  // appended to the agent's system prompt
  guestDirs: ['src', 'public'],      // folder names guest notes may edit under (default: common source/asset dirs)
  cloudflared: '/path/to/cloudflared',
  useApiKey: false,                  // use ANTHROPIC_API_KEY instead of `claude login`
}
```

## CLI

```
pinwright                          ask how to start (in a terminal), or run the dev script (-y, or no terminal)
pinwright -- <command>             same, with your own dev command
pinwright --target <url>           review a site that is already running
pinwright --mfe --scope <css>      a microfrontend, reviewed inside its shell (see Microfrontends)
pinwright list [--all]             notes in the running daemon
pinwright take <id>                mark a note taken and print a prompt for an interactive session
pinwright done <id> [summary]      close a note you handled by hand
pinwright reply <id> <text>        follow up on a note (or answer, with ask: true)
```

To work a note yourself in Claude Code: `claude "$(pinwright take abc123)"`.

## How it works

- **Store:** SQLite (`node:sqlite`) in `.pinwright/`, ignored by git automatically. The queue survives
  restarts; notes left mid-flight go back in the queue.
- **Scheduler:** a Haiku planner predicts which files each note touches. Notes whose files don't overlap run
  in parallel, up to `maxAgents`. Files are also locked at edit time, so a wrong guess only means waiting.
- **Worker:** one Agent SDK session per note. It finds the source, edits, and closes the note through
  in-process tools (`note_done`, `note_handoff`, `note_ask`).
- **Undo** restores the note's files. If another edit changed them since, the note's own patch is reversed on
  top; if that doesn't apply cleanly, undo is refused and lists the files.
- **Live channel:** note events, presence and cursors travel over a WebSocket on `/__pw/ws`, which tunnels
  pass through without buffering.

## License

MIT
