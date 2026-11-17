import { createInterface } from 'node:readline/promises'

/* Tiny terminal prompts, no dependencies. */

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
export const bold = paint('1')
export const dim = paint('2')
export const pink = paint('38;5;205')
export const green = paint('32')
export const red = paint('31')

export const interactive = (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI

export interface Choice<T> {
  label: string
  hint?: string
  value: T
}

/** Arrow-key menu. Ctrl+C quits. */
export function select<T>(question: string, choices: Choice<T>[]): Promise<T> {
  const out = process.stdout
  const inp = process.stdin
  let i = 0
  const line = (c: Choice<T>, on: boolean) => `\x1b[2K${on ? pink('❯ ' + c.label) : '  ' + c.label}${c.hint ? '  ' + dim(c.hint) : ''}\n`
  const draw = (first: boolean) => {
    if (!first) out.write(`\x1b[${choices.length}A`)
    choices.forEach((c, j) => out.write(line(c, j === i)))
  }
  out.write(`${pink('?')} ${bold(question)}  ${dim('↑↓ · enter')}\n\x1b[?25l`)
  draw(true)
  inp.setRawMode(true)
  inp.resume()
  return new Promise((ok) => {
    const done = () => {
      inp.off('data', onKey)
      inp.setRawMode(false)
      inp.pause()
      // Collapse the menu into one answered line.
      out.write(`\x1b[${choices.length + 1}A\x1b[0J${green('✓')} ${bold(question)}  ${pink(choices[i].label)}\n\x1b[?25h`)
    }
    const onKey = (buf: Buffer) => {
      const k = buf.toString()
      if (k === '\x03') {
        done()
        process.exit(130)
      }
      if (k === '\r' || k === '\n') {
        done()
        return ok(choices[i].value)
      }
      if (k === '\x1b[A' || k === 'k') i = (i - 1 + choices.length) % choices.length
      else if (k === '\x1b[B' || k === 'j') i = (i + 1) % choices.length
      else if (/^[1-9]$/.test(k) && Number(k) <= choices.length) i = Number(k) - 1
      draw(false)
    }
    inp.on('data', onKey)
  })
}

/** Free text with a default: enter keeps it. */
export async function ask(question: string, def = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const a = await rl.question(`${pink('?')} ${bold(question)}${def ? '  ' + dim(def) : ''}\n${pink('›')} `)
    return a.trim() || def
  } finally {
    rl.close()
  }
}
