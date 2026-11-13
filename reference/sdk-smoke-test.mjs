import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY
const srv = createSdkMcpServer({ name: 'pw', version: '0.0.1', tools: [
  tool('note_done', 'mark done', { summary: z.string() }, async (a) => { console.log('TOOL CALLED', a); return { content: [{ type: 'text', text: 'ok' }] } }) ] })
let sid
for await (const m of query({ prompt: 'Call the note_done tool with summary "hello" then reply OK.', options: { env, model: 'haiku', mcpServers: { pw: srv }, allowedTools: ['mcp__pw__note_done'], maxTurns: 4, cwd: '/tmp' } })) {
  if (m.type === 'system' && m.subtype === 'init') { sid = m.session_id; console.log('init', m.apiKeySource, m.model) }
  if (m.type === 'result') console.log('result', m.subtype, m.result, m.total_cost_usd)
}
for await (const m of query({ prompt: 'What summary did you pass before?', options: { env, model: 'haiku', resume: sid, maxTurns: 2, cwd: '/tmp' } })) if (m.type === 'result') console.log('resumed:', m.result)
