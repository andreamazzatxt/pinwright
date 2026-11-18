import { defineConfig } from '@rsbuild/core'

// The shell finds the remote at REMOTE_URL: pinwright's port, in the tests.
export default defineConfig({
  server: { port: 5605, strictPort: true },
  moduleFederation: { options: { name: 'shell', remotes: { remote: `remote@${process.env.REMOTE_URL ?? 'http://localhost:5604'}/remoteEntry.js` } } },
})
