// 零依赖静态服务器，只为在浏览器里打开原型（file:// 下 ES module 受限）。
// 用法：node tools/serve.mjs [端口]

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || 8787)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    const rel = url === '/' ? '/prototype/m0.html' : url
    const abs = path.resolve(root, '.' + rel)
    if (!abs.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    fs.readFile(abs, (err, buf) => {
      if (err) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      })
      res.end(buf)
    })
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`M0 原型: http://127.0.0.1:${port}/prototype/m0.html`)
  })
