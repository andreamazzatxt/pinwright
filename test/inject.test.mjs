import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { injectIntoHtml } from '../dist/inject.js'

const TAG = '<script data-pinwright></script>'

async function serve(handler, headers = {}) {
  const server = http.createServer((req, res) => {
    injectIntoHtml(req, res, TAG)
    handler(res)
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/`, { headers })
    return { body: await r.text(), length: r.headers.get('content-length') }
  } finally {
    server.close()
  }
}

test('injects before </body> and drops content-length', async () => {
  const html = '<html><body><p>hi</p></body></html>'
  const r = await serve((res) => {
    res.setHeader('content-type', 'text/html')
    res.setHeader('content-length', Buffer.byteLength(html))
    res.end(html)
  })
  assert.equal(r.body, `<html><body><p>hi</p>${TAG}</body></html>`)
  assert.equal(r.length, null)
})

test('streams through writeHead and chunks, headers as an object or a raw array', async () => {
  for (const headers of [{ 'content-type': 'text/html; charset=utf-8', 'content-length': '99' }, ['content-type', 'text/html', 'content-length', '99']]) {
    const r = await serve((res) => {
      res.writeHead(200, headers)
      res.write('<html><body><main>')
      res.write(Buffer.from('a</main></body>'))
      res.end('</html>')
    })
    assert.equal(r.body, `<html><body><main>a</main>${TAG}</body></html>`)
  }
})

test('appends when there is no </body>, once', async () => {
  const r = await serve((res) => {
    res.setHeader('content-type', 'text/html')
    res.write('<p>a</p>')
    res.end()
  })
  assert.equal(r.body, `<p>a</p>${TAG}`)
})

test('leaves other responses alone', async () => {
  const js = 'console.log("</body>")'
  const r = await serve((res) => {
    res.setHeader('content-type', 'text/javascript')
    res.end(js)
  })
  assert.equal(r.body, js)
  const already = `<body>${TAG}</body>`
  const r2 = await serve((res) => {
    res.setHeader('content-type', 'text/html')
    res.end(already)
  })
  assert.equal(r2.body, already)
  const r3 = await serve((res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<body></body>')
  }, { 'sec-fetch-dest': 'iframe' })
  assert.equal(r3.body, '<body></body>')
})
