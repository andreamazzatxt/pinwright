# Setting up pinwright

Instructions for a coding agent (Claude Code) adding [pinwright](https://github.com/andreamazzatxt/pinwright) to the
project in the current folder. pinwright lets the user leave notes on their dev site; Claude agents apply them to
the code. It only runs in dev mode: production builds must not change.

## 1. Check the prerequisites

- Node >= 22.13 (`node -v`).
- Claude Code installed and logged in. If `claude` is missing or not logged in, stop and tell the user to run
  `claude login`.

## 2. Install

Add `pinwright` as a **dev dependency** with the package manager the project already uses (look at the lockfile:
`pnpm-lock.yaml`, `yarn.lock`, `bun.lock(b)`, `package-lock.json`).

## 3. Wire it in

Find the framework from `package.json` and its config files, then apply **one** of these. Keep the existing
config as it is; only add pinwright.

**Vite, and frameworks built on it** (SvelteKit, React Router / Remix, SolidStart, Qwik, plain Vite apps):
add the plugin to `vite.config.*`.

```js
import pinwright from 'pinwright/vite'
export default defineConfig({ plugins: [/* existing plugins */, pinwright()] })
```

**Astro**: add the integration to `astro.config.*`.

```js
import pinwright from 'pinwright/astro'
export default defineConfig({ integrations: [/* existing */, pinwright()] })
```

**Nuxt**: add the module to `nuxt.config.*`.

```js
export default defineNuxtConfig({ modules: [/* existing */, 'pinwright/nuxt'] })
```

**Next.js** (Turbopack or webpack): two changes.

```js
// next.config.*: wrap whatever is exported today
import { withPinwright } from 'pinwright/next'
export default withPinwright(nextConfig)
```

```jsx
// app/layout.* (app router): last child of <body>
import { Pinwright } from 'pinwright/next/script'
// ...
<body>
  {children}
  <Pinwright />
</body>
```

With the pages router, render `<Pinwright />` at the end of `<body>` in `pages/_document.*` instead. It renders
nothing outside `next dev`.

**Webpack 5, Rspack, Rsbuild**: add the plugin (for Rsbuild, under `tools.rspack.plugins`).

```js
import { PinwrightPlugin } from 'pinwright/rspack' // same plugin as 'pinwright/webpack'
export default { plugins: [/* existing */, new PinwrightPlugin()] }
```

**Anything else** (Rails, Django, Laravel, Hugo, a custom server…): add a `pinwright` script to `package.json`
(create a minimal one if there is none) that puts pinwright in front of the dev server:

```json
{ "scripts": { "pinwright": "pinwright --target http://localhost:3000" } }
```

Use the real dev server URL. The user then opens `http://localhost:4340/` instead of the dev server.

## 4. Don't change anything else

No other files, no config refactors, no new dependencies besides `pinwright`. pinwright keeps its state in
`.pinwright/`, which ignores itself in git.

## 5. Verify

Start the dev server (or the `pinwright` script) in the background and check that the log prints
`[pinwright] listening on http://127.0.0.1:4340`. If the port is taken, set another one with
`pinwright({ port: 4350 })` (or `--port 4350`) and try again. Then stop the server.

## 6. Tell the user

- which URL to open (the dev server's, or `http://localhost:4340/` with the proxy);
- hold **⌥** and click any element to leave a note, or press **N**;
- **Go live** in the notes list shares the page with up to 8 people.
