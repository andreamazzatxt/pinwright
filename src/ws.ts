import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX = 1 << 20

/**
 * A minimal WebSocket (RFC 6455) server side: text messages, ping/pong, close. Enough for the live
 * channel, with no dependency. Tunnels like cloudflared buffer SSE but pass WebSockets through.
 */
export class WsConn extends EventEmitter<{ message: [string]; close: [] }> {
  private buf = Buffer.alloc(0)
  private parts: Buffer[] = []
  private closed = false

  constructor(private socket: Duplex) {
    super()
    socket.on('data', (d: Buffer) => this.read(d))
    socket.on('close', () => this.end())
    socket.on('error', () => this.end())
  }

  private read(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d])
    while (this.buf.length >= 2) {
      const b0 = this.buf[0]
      const b1 = this.buf[1]
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        off = 10
      }
      if (len > MAX) return this.close()
      const masked = (b1 & 0x80) !== 0
      const total = off + (masked ? 4 : 0) + len
      if (this.buf.length < total) return
      const payload = Buffer.from(this.buf.subarray(off + (masked ? 4 : 0), total))
      if (masked) {
        const mask = this.buf.subarray(off, off + 4)
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      }
      this.buf = this.buf.subarray(total)
      const fin = (b0 & 0x80) !== 0
      const op = b0 & 0x0f
      if (op === 0x8) return this.close()
      if (op === 0x9) this.frame(0xa, payload)
      else if (op === 0x1 || op === 0x0) {
        this.parts.push(payload)
        if (fin) {
          const msg = Buffer.concat(this.parts).toString('utf8')
          this.parts = []
          this.emit('message', msg)
        }
      }
    }
  }

  private frame(op: number, payload: Buffer): void {
    if (this.closed) return
    const n = payload.length
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10)
    if (n >= 126 && n < 65536) {
      head[0] = 0x80 | op
      head[1] = 126
      head.writeUInt16BE(n, 2)
    } else if (n >= 65536) {
      head[0] = 0x80 | op
      head[1] = 127
      head.writeBigUInt64BE(BigInt(n), 2)
    }
    this.socket.write(Buffer.concat([head, payload]))
  }

  send(text: string): void {
    this.frame(0x1, Buffer.from(text, 'utf8'))
  }

  ping(): void {
    this.frame(0x9, Buffer.alloc(0))
  }

  close(): void {
    if (this.closed) return
    this.frame(0x8, Buffer.alloc(0))
    this.socket.end()
    this.end()
  }

  private end(): void {
    if (this.closed) return
    this.closed = true
    this.socket.destroy()
    this.emit('close')
  }
}

/** Completes the handshake; null when the request isn't a WebSocket upgrade. */
export function acceptWs(req: IncomingMessage, socket: Duplex): WsConn | null {
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string' || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return null
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  return new WsConn(socket)
}
