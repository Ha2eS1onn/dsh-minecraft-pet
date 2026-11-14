// 假宿主：给 prototype/plugin-harness.html 提供 /dsh-whale/* 的最小接口，
// 让 assets/whale-widget.js 能在真实浏览器里跑起来（含 skin 后端渲染）。
//
// 这不是 DSH 宿主，只够验挂件的前端接线：roles / wait / audio / skin 图。
// 真机验收仍需装进 DSH profile（见 docs/HANDOFF.md §6.6）。
//
// 用法：node tools/harness-server.mjs [port]   默认 8788
//   http://127.0.0.1:8788/prototype/plugin-harness.html?state=working

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2] || 8788)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
}

const STATE = ['idle', 'thinking', 'working', 'waiting', 'done', 'error']

function json(res, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(body.length) })
  res.end(body)
}

function rolePayload(state) {
  return {
    ok: true,
    roles: [
      {
        id: 'default',
        name: '方块人',
        kind: 'default',
        backend: 'skin',
        model: 'classic',
        hasCape: false,
        skinUrl: '/dsh-whale/role-skin.png?id=default',
        url: '/dsh-whale/role-skin.png?id=default',
        urlTemplate: '/dsh-whale/role-skin.png?id=default',
        states: ['idle'],
        stateVariants: {},
        stateRotate: {},
        format: 'png',
      },
    ],
    state: state,
  }
}

// 状态时间表：?seq=thinking,idle —— 每 3 次 wait.json 请求（约 3 秒）推进一步，
// 用来验「降级能不能走通」（进入 thinking 后回 idle）。
const seqCursor = new Map()

// 角色元数据：真机读的是 $DSH_HOME/pet-role/meta.json，harness 允许用 HARNESS_ROLE_META 指别处
function readRoleMeta() {
  const p = path.resolve(ROOT, process.env.HARNESS_ROLE_META || '')
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'))
    return { name: String(m.name || '方块小人'), model: m.model === 'slim' ? 'slim' : 'classic' }
  } catch (err) {
    return { name: '方块小人', model: 'classic' }
  }
}

function api(req, res, url) {
  const p = url.pathname
  // state / audio / seq 来自**页面 URL**（referer），因为挂件请求 API 时不带这些参数
  let state = 'idle'
  let audio = false
  let seq = []
  const refKey = String(req.headers.referer || '')
  try {
    const ref = new URL(refKey, `http://127.0.0.1:${PORT}`)
    if (STATE.includes(ref.searchParams.get('state'))) state = ref.searchParams.get('state')
    audio = ref.searchParams.get('audio') === '1'
    const raw = ref.searchParams.get('seq') || ''
    seq = raw.split(',').map((s) => s.trim()).filter((s) => STATE.includes(s))
  } catch (err) {}

  if (p === '/dsh-whale/roles.json') return json(res, rolePayload(state))

  // —— 新宿主（独立化 R1，lib/pet-host.js）的接口，字段见 plan.md §16.3 ——
  // R2 的 assets/widget.js 直接对着这套接口开发；状态/音频同样从 page URL 取。
  if (p === '/pet/state.json') {
    let cur = state
    if (seq.length) {
      const n = seqCursor.get(refKey) || 0
      cur = seq[Math.min(Math.floor(n / 3), seq.length - 1)]
      seqCursor.set(refKey, n + 1)
    }
    return json(res, {
      ok: true,
      state: cur,
      since: Date.now(),
      pending: '',
      turnCost: { seq: 128, turn: 12, amount: 0.0421, tokens: 18342, at: Date.now() - 4000 },
    })
  }
  if (p === '/pet/balance.json') {
    return json(res, {
      ok: true,
      balance: 58.42,
      currency: 'CNY',
      todayUsed: 1.37,
      peak: false,
      valley: true,
      period: 'valley',
      nextChangeAt: Math.floor(Date.now() / 1000) + 3600,
      at: Date.now(),
      error: '',
    })
  }
  if (p === '/pet/role.json') {
    const meta = readRoleMeta()
    return json(res, { ok: true, name: meta.name, model: meta.model, hasCape: false })
  }
  if (p === '/pet/skin.png') {
    const bytes = fs.readFileSync(path.resolve(ROOT, process.env.HARNESS_SKIN || 'assets/default-skin.png'))
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': String(bytes.length) })
    return res.end(bytes)
  }
  if (p === '/pet/audio-active.json') return json(res, { ok: true, active: audio, peak: audio ? 0.08 : 0 })
  if (p === '/pet/widget.js') {
    // R2 之前 widget.js 还不存在：先回落到旧的 whale-widget.js，方便对着新接口调样式
    const f = path.join(ROOT, 'assets', fs.existsSync(path.join(ROOT, 'assets', 'widget.js')) ? 'widget.js' : 'whale-widget.js')
    const text = fs.readFileSync(f)
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(text)
  }

  if (p === '/dsh-whale/wait.json') {
    let cur = state
    if (seq.length) {
      const n = seqCursor.get(refKey) || 0
      cur = seq[Math.min(Math.floor(n / 3), seq.length - 1)]
      seqCursor.set(refKey, n + 1)
    }
    return json(res, { ok: true, state: cur, since: Date.now(), pending: null, sessionName: '' })
  }
  if (p === '/dsh-whale/audio.json') return json(res, { ok: true, active: audio })
  if (p === '/dsh-whale/balance.json') return json(res, { ok: false })
  if (p === '/dsh-whale/last-turn.json') return json(res, { ok: false })
  if (p === '/dsh-whale/about.json') return json(res, { ok: true, plugin: { name: 'dsh-minecraft-pet', version: '0.1.0', channel: 'release', label: '0.1.0' } })
  if (p === '/dsh-whale/usage-settings.json') return json(res, { ok: false })
  if (p === '/dsh-whale/bubble.json') return json(res, { ok: false })
  if (p === '/dsh-whale/size.json') return json(res, { ok: true, scale: 1 })
  if (p === '/dsh-whale/audio.json') return json(res, { ok: true, active: false })
  if (p === '/dsh-whale/role-skin.png') {
    // 换皮验收：HARNESS_SKIN=prototype/da-skin.png node tools/harness-server.mjs
    const bytes = fs.readFileSync(path.resolve(ROOT, process.env.HARNESS_SKIN || 'assets/default-skin.png'))
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': String(bytes.length) })
    return res.end(bytes)
  }
  if (p === '/dsh-whale/image.png') {
    const bytes = fs.readFileSync(path.join(ROOT, 'assets', 'DSniang1.png'))
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) })
    return res.end(bytes)
  }
  if (p === '/dsh-whale/cape.png') {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('no cape')
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (url.pathname.startsWith('/dsh-whale/')) return api(req, res, url)
  if (url.pathname.startsWith('/pet/')) return api(req, res, url)

  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || rel === '') rel = '/prototype/plugin-harness.html'
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); return res.end()
  }
  fs.readFile(file, (err, bytes) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('not found: ' + rel)
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // 开发期必须关缓存：改了 widget.js 之后 Ctrl+F5 要能立刻看到
      'Cache-Control': 'no-store',
    })
    res.end(bytes)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`harness: http://127.0.0.1:${PORT}/prototype/plugin-harness.html`)
  console.log(`  ?state=idle|thinking|working|waiting|done|error   ?audio=1`)
})
