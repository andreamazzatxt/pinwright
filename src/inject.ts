import type { IncomingMessage, OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse } from 'node:http'

/**
 * Wraps a response so that, if it turns out to be an HTML page, `tag` is inserted before `</body>` (or appended
 * when there is none). Works with any framework that renders through Node's response, streaming included:
 * chunks pass through as they come, only the one holding `</body>` is touched.
 */
export function injectIntoHtml(req: IncomingMessage, res: ServerResponse, tag: string): void {
  if (req.method !== 'GET' || (req.headers['sec-fetch-dest'] && req.headers['sec-fetch-dest'] !== 'document')) return
  const orig = { writeHead: res.writeHead, write: res.write, end: res.end }
  let html: boolean | null = null
  let done = false

  const isHtml = (): boolean => {
    if (html !== null) return html
    const type = String(res.getHeader('content-type') ?? '')
    html = res.statusCode >= 200 && res.statusCode < 300 && type.includes('text/html') && !res.getHeader('content-encoding')
    if (html) res.removeHeader('content-length')
    return html
  }
  const patch = (chunk: unknown, last: boolean): unknown => {
    if (done || chunk == null || typeof chunk === 'function') return chunk
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8')
    if (text.includes('data-pinwright')) {
      done = true
      return chunk
    }
    const i = text.lastIndexOf('</body>')
    if (i >= 0) {
      done = true
      return text.slice(0, i) + tag + text.slice(i)
    }
    if (last) {
      done = true
      return text + tag
    }
    return chunk
  }

  res.writeHead = function (this: ServerResponse, status: number, ...rest: unknown[]) {
    // Fold the headers into the response first, so the content type can be read and content-length dropped.
    const headers = rest.find((r) => r && typeof r === 'object') as OutgoingHttpHeaders | OutgoingHttpHeader[] | undefined
    const message = rest.find((r) => typeof r === 'string') as string | undefined
    if (Array.isArray(headers)) {
      const pairs = headers.length && Array.isArray(headers[0]) ? (headers as unknown as [string, string][]) : chunkPairs(headers as string[])
      const merged = new Map<string, string[]>()
      for (const [k, v] of pairs) merged.set(k, [...(merged.get(k) ?? []), String(v)])
      for (const [k, v] of merged) res.setHeader(k, v.length === 1 ? v[0] : v)
    } else if (headers) {
      for (const [k, v] of Object.entries(headers)) if (v !== undefined) res.setHeader(k, v)
    }
    res.statusCode = status
    isHtml()
    return message ? (orig.writeHead as (...a: unknown[]) => ServerResponse).call(this, status, message) : orig.writeHead.call(this, status)
  } as typeof res.writeHead

  res.write = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
    if (isHtml()) chunk = patch(chunk, false)
    return (orig.write as (...a: unknown[]) => boolean).call(this, chunk, ...rest)
  } as typeof res.write

  res.end = function (this: ServerResponse, chunk?: unknown, ...rest: unknown[]) {
    if (isHtml() && !done) {
      if (typeof chunk === 'function') {
        rest.unshift(chunk)
        chunk = undefined
      }
      chunk = patch(chunk ?? '', true)
    }
    return (orig.end as (...a: unknown[]) => ServerResponse).call(this, chunk, ...rest)
  } as typeof res.end
}

function chunkPairs(flat: string[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]])
  return out
}

/**
 * Browser code that loads the overlay once. A classic script, so the overlay can find its own origin through
 * document.currentScript. Automated browsers are skipped (the overlay skips them too).
 */
export function loaderCode(scriptUrl: string): string {
  return `if(typeof window!=='undefined'&&!navigator.webdriver&&!document.querySelector('script[data-pinwright]')){const s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};s.dataset.pinwright='';(document.body||document.documentElement).append(s)}`
}

/** The tag to put in served HTML. */
export function scriptTag(scriptUrl: string): string {
  return `<script src="${scriptUrl}" data-pinwright defer></script>`
}
