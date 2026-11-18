import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  server: { port: 5604, strictPort: true },
  output: { assetPrefix: 'auto' },
  moduleFederation: { options: { name: 'remote', filename: 'remoteEntry.js', exposes: { './widget': './src/widget.js' } } },
})
