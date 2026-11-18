#!/usr/bin/env node
// Stands in for `cloudflared tunnel --url …`: prints a quick-tunnel URL the way it does, then waits to be killed.
process.stderr.write('INF |  https://test-tunnel.trycloudflare.com  |\n')
setInterval(() => {}, 1 << 30)
