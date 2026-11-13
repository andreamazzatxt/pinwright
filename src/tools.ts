import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Ctx } from './context.js'
import type { Note } from './store.js'

export interface Outcome {
  kind: 'done' | 'ask' | 'handoff'
  text: string
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export const TOOL_NAMES = ['note_done', 'note_ask', 'note_handoff'].map((t) => `mcp__pinwright__${t}`)

const askTool = (state: { outcome: Outcome | null }, lang: string) =>
  tool(
    'note_ask',
    'Ask the reviewer ONE short question when the note is ambiguous. Then end your turn: you will be resumed with the answer.',
    { question: z.string().describe(`The question, in ${lang}.`) },
    async ({ question }) => {
      state.outcome = { kind: 'ask', text: question }
      return text('Question sent. End your turn now and wait for the answer.')
    },
  )

/** The in-process MCP server one note's agent talks through. `outcome` is set by the note_* tools. */
export function noteServer(ctx: Ctx, _note: Note, state: { outcome: Outcome | null }) {
  const { cfg } = ctx
  return createSdkMcpServer({
    name: 'pinwright',
    version: '0.1.0',
    tools: [
      ...(cfg.ask ? [askTool(state, cfg.lang)] : []),
      tool(
        'note_done',
        'Call when the note is handled. Then end your turn.',
        { summary: z.string().describe(`One or two lines for the reviewer, in ${cfg.lang}: what you changed.`) },
        async ({ summary }) => {
          state.outcome = { kind: 'done', text: summary }
          return text('Recorded. End your turn now.')
        },
      ),
      tool(
        'note_handoff',
        'The note needs more than a small focused change (redesign, many pages, a new feature): hand it to a human-driven session. Then stop.',
        { reason: z.string().describe(`One line, in ${cfg.lang}: why and what it would take.`) },
        async ({ reason }) => {
          state.outcome = { kind: 'handoff', text: reason }
          return text('Handed off. Stop now.')
        },
      ),
    ],
  })
}
