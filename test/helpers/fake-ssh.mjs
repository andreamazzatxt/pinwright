#!/usr/bin/env node
// Stands in for `ssh -N -R 127.0.0.1:<remote>:127.0.0.1:<local> user@host` and for the user's server behind it:
// listens on <remote> and pipes each connection to <local>, the way the server's web server plus the tunnel would.
// Notes its arguments where FAKE_SSH_ARGS says. FAKE_SSH_FAIL: refuses the login, as ssh does without a key.
import { writeFileSync } from 'node:fs'
import net from 'node:net'

const args = process.argv.slice(2)
if (process.env.FAKE_SSH_ARGS) writeFileSync(process.env.FAKE_SSH_ARGS, JSON.stringify(args))
if (process.env.FAKE_SSH_FAIL) {
  process.stderr.write('user@server: Permission denied (publickey).\n')
  process.exit(255)
}
const [, remote, , local] = args[args.indexOf('-R') + 1].split(':')
net
  .createServer((c) => {
    const up = net.connect(Number(local), '127.0.0.1')
    c.pipe(up).pipe(c)
    up.on('error', () => c.destroy())
    c.on('error', () => up.destroy())
  })
  .listen(Number(remote), '127.0.0.1')
