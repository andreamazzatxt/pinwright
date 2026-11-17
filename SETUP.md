# Setting up pinwright

Instructions for a coding agent (Claude Code) bringing [pinwright](https://github.com/andreamazzatxt/pinwright) into
the project in the current folder. pinwright lets the user leave notes on their dev site; Claude agents apply them
to the code. It only ever runs in dev mode: production builds must not change.

## 1. Check the prerequisites

- Node >= 22.13 (`node -v`).
- Claude Code installed and logged in. If `claude` is missing or not logged in, stop and tell the user to run
  `claude login`.

## 2. Look at the project

Work out, without changing anything:

- **the stack**, from `package.json` dependencies (first match: `next` Next.js, `nuxt` Nuxt, `astro` Astro,
  `@sveltejs/kit` SvelteKit, `@react-router/dev` React Router, `@remix-run/dev` Remix, `@solidjs/start` SolidStart,
  `@builder.io/qwik-city` Qwik City, `@rsbuild/core` Rsbuild, `@rspack/core` Rspack, `vite` Vite, `webpack` webpack)
  or from the files of other stacks (`bin/rails` Rails, `manage.py` Django, `artisan` Laravel, `hugo.toml` Hugo…);
- **the dev command**: the `dev` script (else `start`, `serve`) run with the package manager of the lockfile
  (`pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock(b)` bun, else npm), or the stack's own (`bin/rails server`,
  `python manage.py runserver`, `php artisan serve`, `hugo server`);
- **whether pinwright is already there**: `pinwright` in `package.json`.

Tell the user in one line, e.g. "Next.js project, dev command `npm run dev`, pinwright not installed yet."

## 3. Ask how they want to start

Ask with a multiple-choice question (in Claude Code, the AskUserQuestion tool), these options in this order:

1. **Start the dev server**: only if pinwright is already in the project. Its plugin starts with the dev server.
2. **Run it now**: nothing is installed in the project.
3. **Add it to the project**: install pinwright so the usual dev script always starts with it. Only for projects
   with a `package.json` dev script.
4. **Review a site that is already running**: they give its URL.
5. **Review it inside its shell**: only for a Module Federation remote (its bundler config has `exposes`). Offer it
   first in that case.

Then follow the matching section below and nothing else.

## 4a. Start the dev server

Nothing to change. Tell the user to start their dev command as usual and open the URL it prints.

## 4b. Run it now

Change no file. Tell the user to run this in their terminal, from the project's folder:

- `npx pinwright -y` when the dev command is the `dev`/`start`/`serve` script;
- `npx pinwright -- <dev command>` otherwise, e.g. `npx pinwright -- bin/rails server`.

pinwright starts the dev server, puts itself in front of it and opens the page in the browser. Its state lives in
`.pinwright/`, which git ignores. Without `-y`, `npx pinwright` asks these same questions in the terminal.

## 4c. Add it to the project

The goal: from now on the project's usual dev script (`npm run dev` or equivalent) starts with pinwright.
Add `pinwright` as a **dev dependency** with the project's package manager, then:

- **stacks with a plugin** (all the ones below): wire it in with **one** of these. The dev script stays as it is
  and loads pinwright by itself.
- **any other JavaScript project**: don't touch config files. Keep the current dev script under `dev:plain` and
  make `dev` run it through pinwright, e.g. `"dev": "vite"` becomes `"dev": "pinwright -- vite"` and
  `"dev:plain": "vite"`. pinwright starts the command, puts itself in front of it and opens the page.

Keep the existing config as it is; only add pinwright.

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

Change nothing else: no other files, no config refactors, no new dependencies besides `pinwright`.

Verify: start the usual dev script in the background and check that its log prints
`[pinwright] listening on http://127.0.0.1:4340` (with the wrapped script, the port may be the next free one). If the port is taken, set another one with
`pinwright({ port: 4350 })` and try again. Then stop the server, and tell the user to start their dev server as
usual from now on.

## 4d. Review a site that is already running

Ask for the URL if they didn't give it (e.g. `http://localhost:3000`). Change no file. Tell the user to run
`npx pinwright --target <url>` in their terminal: pinwright opens the site with the overlay on top.

## 4e. Review it inside its shell

Change no file. Ask for the CSS selector of the element the shell mounts this remote into (notes will only be
allowed inside it; look for a mount wrapper or a `data-*` attribute naming the remote in the shell). Tell the user:

1. run `npx pinwright --mfe --scope '<selector>' --port 4380` in this folder: it starts the remote's dev server;
2. make the shell load this remote from `http://localhost:4380` instead of its own dev server port (wherever the
   shell maps its remotes);
3. open the shell as usual: the overlay comes with the remote.

## 5. Tell the user

- how to start it (from the section above) and that the browser opens the page;
- hold **⌥** and click any element to leave a note, or press **N**;
- **Go live** in the notes list shares the page with up to 8 people.
