import { defineConfig } from 'vite'
import pinwright from 'pinwright/vite'

export default defineConfig({ plugins: [pinwright({ port: 4602, maxAgents: 0 })] })
