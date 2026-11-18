#!/usr/bin/env node
// Stands in for cloudflared. `tunnel --url …` (quick tunnel): prints a trycloudflare URL the way it does.
// `tunnel run --url … <name>` (named tunnel): says it's connected. Either way it notes its arguments where
// FAKE_CLOUDFLARED_ARGS says, then waits to be killed.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (process.env.FAKE_CLOUDFLARED_ARGS) writeFileSync(process.env.FAKE_CLOUDFLARED_ARGS, JSON.stringify(args))
process.stderr.write(args.includes('run') ? 'INF Registered tunnel connection connIndex=0 location=fake\n' : 'INF |  https://test-tunnel.trycloudflare.com  |\n')
setInterval(() => {}, 1 << 30)
