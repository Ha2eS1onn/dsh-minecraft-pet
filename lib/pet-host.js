// dsh-minecraft-pet —— 宿主侧（独立化重写的 R1，plan.md §16.3）。
//
// 只做四件事，每件都能单独测：
//   余额  GET /pet/balance.json      { ok, balance, todayUsed, period, peak, valley, nextChangeAt, at }
//   状态  GET /pet/state.json        { ok, state, since, turnCost }
//   角色  GET /pet/role.json         { ok, name, model, hasCape }
//        GET /pet/skin.png          皮肤字节（缺则回内置默认）
//   音频  GET /pet/audio-active.json { ok, active, peak }
// 另加一条 GET /pet/widget.js：挂件本体（assets/widget.js，R2 产出）。
//
// 设计约束（从 DWS 那版学到的，必须保留）：
//   ① 零新增定时器：状态由会话事件驱动，前端自己 1 秒轮询一次 state.json
//   ② 所有路由走 DSH 既有鉴权，不开额外权限；只读，没有写接口
//   ③ 不轮询 Mojang（M5 才接账号，且只在绑定时请求一次）
//   ④ 任一路数据缺失都返回 ok:false，绝不让挂件白屏

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createPetState, createTurnMeter, isPeak, nextPeakChangeAt, bjDayKey } from './pet-data.mjs'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// DSH_HOME 每次现算，不在模块顶层固化：测试可以改 process.env.DSH_HOME 后再装配插件，
// 免得跑一次自检就往真实用户目录里写角色。
const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const roleDir = () => path.join(dshHome(), 'pet-role')
const stateFile = () => path.join(dshHome(), '.dsh-pet-state.json')
/** 旧插件（DWS 版）的角色目录：首次启动时把皮肤搬过来，用户不用重导。 */
const legacyRoleDir = () => path.join(dshHome(), 'whale-roles', 'default')

const DEFAULT_SKIN = path.join(PACKAGE_ROOT, 'assets', 'default-skin.png')
const WIDGET_FILE = path.join(PACKAGE_ROOT, 'assets', 'widget.js')
const AUDIO_SCRIPT = path.join(PACKAGE_ROOT, 'lib', 'audio-meter.ps1')

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

const AUDIO_PEAK_THRESHOLD = 0.001
const AUDIO_ACTIVE_WINDOW_MS = 1500
const BALANCE_TTL_MS = 5000

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (err) {
    return null
  }
}

function writeJson(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p + '.tmp', JSON.stringify(obj))
    fs.renameSync(p + '.tmp', p)
  } catch (err) {}
}

/**
 * 核心：所有数据都在这里，route 只是把 payload 序列化出去。
 * clock 可注入，测试才能控制「3 秒后」「30 秒后」。
 */
export function createCore(opts = {}) {
  const clock = opts.clock || (() => Date.now())
  const roleDirPath = opts.roleDir || roleDir()
  const stateFilePath = opts.stateFile || stateFile()
  const legacyRolePath = opts.legacyRoleDir || legacyRoleDir()
  const defaultSkin = opts.defaultSkin || DEFAULT_SKIN
  const ctx = opts.ctx || null

  const state = createPetState(clock())
  const meter = createTurnMeter()

  // —— 今日已用（自有账本，不用 DWS 的 .dshw-usage.json）——
  const usage = { day: bjDayKey(clock()), used: 0 }
  let usageTimer = 0
  {
    const saved = readJson(stateFilePath)
    if (saved && typeof saved === 'object') {
      meter.restoreSeq(saved.seq)
      if (saved.day === usage.day && isFinite(Number(saved.used))) usage.used = Number(saved.used)
    }
  }

  function flushUsage() {
    usageTimer = 0
    writeJson(stateFilePath, { day: usage.day, used: usage.used, seq: meter.lastTurn ? meter.lastTurn.seq : 0 })
  }
  function noteUsage(amount) {
    const day = bjDayKey(clock())
    if (day !== usage.day) {
      usage.day = day
      usage.used = 0
    }
    usage.used += Number(amount) || 0
    if (!usageTimer) {
      // 一轮结束才写一次；延迟合并，避免连续小写入
      usageTimer = setTimeout(flushUsage, 1000)
      if (usageTimer.unref) usageTimer.unref()
    }
  }

  // —— 角色：单角色模型（plan.md §16.4）——
  function ensureRole() {
    try {
      if (fs.existsSync(path.join(roleDirPath, 'skin.png'))) return
      fs.mkdirSync(roleDirPath, { recursive: true })
      const legacySkin = path.join(legacyRolePath, 'skin.png')
      if (fs.existsSync(legacySkin)) {
        fs.copyFileSync(legacySkin, path.join(roleDirPath, 'skin.png'))
        const legacyMeta = path.join(legacyRolePath, 'meta.json')
        if (fs.existsSync(legacyMeta)) fs.copyFileSync(legacyMeta, path.join(roleDirPath, 'meta.json'))
      }
    } catch (err) {}
  }

  function rolePayload() {
    const meta = readJson(path.join(roleDirPath, 'meta.json')) || {}
    return {
      ok: true,
      name: String(meta.name || '方块小人'),
      model: meta.model === 'slim' ? 'slim' : 'classic',
      // M5 之前恒 false：披风是账号数据，不内嵌任何披风贴图（plan.md §7）
      hasCape: false,
    }
  }

  function skinBytes() {
    try {
      const b = fs.readFileSync(path.join(roleDirPath, 'skin.png'))
      if (b && b.length) return b
    } catch (err) {}
    try {
      return fs.readFileSync(defaultSkin)
    } catch (err) {
      return null
    }
  }

  // —— 音频：常驻 PowerShell 读 WASAPI 峰值，失败即静默降级 ——
  let audioProc = null
  let audioSpawned = false
  let audioPeak = 0
  let audioActiveUntil = 0

  function startAudioMeter() {
    if (audioProc || audioSpawned) return
    audioSpawned = true
    try {
      if (process.platform !== 'win32') return
      if (!fs.existsSync(AUDIO_SCRIPT)) return
      const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', AUDIO_SCRIPT], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      audioProc = child
      let buf = ''
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          const m = /^peak=([0-9]*\.?[0-9]+)$/.exec(line)
          if (!m) continue
          const peak = Number(m[1])
          if (!Number.isFinite(peak)) continue
          audioPeak = peak
          if (peak > AUDIO_PEAK_THRESHOLD) audioActiveUntil = clock() + AUDIO_ACTIVE_WINDOW_MS
        }
      })
      const stop = () => { audioProc = null }
      child.on('exit', stop)
      child.on('error', stop)
    } catch (err) {
      audioProc = null
    }
  }

  function audioPayload() {
    startAudioMeter()
    return { ok: true, active: clock() < audioActiveUntil, peak: audioPeak }
  }

  // —— 余额：只走 DSH 账号服务（不自己拼 HTTP，token/失效清理交给它）——
  let balanceCache = null
  let balanceInFlight = null

  async function readAccount() {
    let acc = null
    try {
      acc = ctx && typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null
    } catch (err) {
      acc = null
    }
    if (!acc || typeof acc.getBalance !== 'function') return { ok: false, error: '当前 DSH 没有账号服务' }
    let result = null
    try {
      result = await acc.getBalance({
        version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
        locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
    } catch (err) {
      return { ok: false, error: '账号余额接口失败: ' + String((err && err.message) || err).slice(0, 120) }
    }
    if (!result) return { ok: false, error: '未登录 DeepSeek 账号' }
    if (result.status !== 'ready') return { ok: false, error: '账号余额未就绪: ' + String(result.status || 'unknown') }
    // 充值钱包与赠金钱包一起看：只有赠金的新账号 normal 是空数组，单看它会误判成「没有余额」
    const wallets = [...(Array.isArray(result.value) ? result.value : []), ...(Array.isArray(result.bonusWallets) ? result.bonusWallets : [])]
    let total = 0
    let currency = ''
    let hit = false
    for (const w of wallets) {
      const v = Number(w && (w.total_balance !== undefined ? w.total_balance : w.balance))
      if (!Number.isFinite(v)) continue
      total += v
      hit = true
      if (!currency) currency = String((w && w.currency) || '')
    }
    if (!hit) return { ok: false, error: '账号没有余额钱包' }
    return { ok: true, balance: total, currency: currency || 'CNY' }
  }

  async function balancePayload() {
    const now = clock()
    if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache.payload
    if (balanceInFlight) return balanceInFlight
    balanceInFlight = (async () => {
      const acc = await readAccount()
      const sec = Math.floor(clock() / 1000)
      const peak = isPeak(sec)
      const payload = {
        ok: !!acc.ok,
        balance: acc.ok ? acc.balance : null,
        currency: acc.ok ? acc.currency : 'CNY',
        todayUsed: Number(usage.used.toFixed(4)),
        // 峰谷：both 字段留给前端做样式开关，period 是权威值
        peak,
        valley: !peak,
        period: peak ? 'peak' : 'valley',
        nextChangeAt: nextPeakChangeAt(sec),
        at: clock(),
        error: acc.ok ? '' : String(acc.error || ''),
      }
      balanceCache = { at: clock(), payload }
      return payload
    })()
    try {
      return await balanceInFlight
    } finally {
      balanceInFlight = null
    }
  }

  function statePayload() {
    const snap = state.snapshot(clock())
    const lt = meter.lastTurn
    return {
      ok: true,
      state: snap.state,
      since: snap.since,
      pending: snap.pending,
      // 每轮消耗提示：只给最近一轮，前端自己决定要不要显示
      turnCost: lt ? { seq: lt.seq, turn: lt.turn, amount: Number(lt.amount.toFixed(4)), tokens: lt.tokens, at: lt.at } : null,
    }
  }

  // —— 事件接线 ——
  const childSessions = new Set()

  function rememberChild(info) {
    const id = info && info.id ? String(info.id) : ''
    if (id) childSessions.add(id)
  }

  function onSessionEvent(session, event) {
    const sid = session && session.id ? String(session.id) : 'default'
    const isChild = childSessions.has(sid)
    const now = clock()
    const type = event && event.type
    const data = (event && event.data) || {}
    if (type === 'assistant/message') {
      meter.noteMessage(sid, data, now)
    } else if (type === 'turn/end') {
      const t = meter.finalize(sid)
      if (t && !isChild) noteUsage(t.amount)
    }
    state.noteEvent(event, now, isChild)
  }

  function onStream(payload) {
    const frame = payload && payload.frame
    if (!frame || frame.type !== 'chunk') return
    const sid = payload.agent && payload.agent.session && payload.agent.session.id ? String(payload.agent.session.id) : ''
    state.noteStream(frame.chunk, clock(), sid ? childSessions.has(sid) : false)
  }

  function dispose() {
    if (usageTimer) clearTimeout(usageTimer)
    usageTimer = 0
    try { if (audioProc) audioProc.kill() } catch (err) {}
  }

  ensureRole()

  return {
    state,
    meter,
    usage,
    rolePayload,
    skinBytes,
    audioPayload,
    balancePayload,
    statePayload,
    onSessionEvent,
    onStream,
    rememberChild,
    dropSession: (session) => {
      if (session && session.id) meter.drop(String(session.id))
    },
    dispose,
  }
}

// ---------------------------------------------------------------- 信任栅栏

function isLoopbackHostname(hn) {
  const h = String(hn || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  if (Number(m[1]) !== 127) return false
  return [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
}

/**
 * 只读路由的守卫。三条规则（与 DWS 版的结论一致，实现重写）：
 *   ① Host 必须是回环，或在 DSHW_TRUSTED_HOSTS 里显式声明；
 *   ② `Sec-Fetch-Site: cross-site` 一律拒（防跨站读取余额）；
 *   ③ 带 Origin 时必须与 Host 同源。
 * 宿主自己还有一层（connection.requestRejection），有就委托；它抛异常按拒绝处理。
 */
export function createGuard(ctx) {
  const trusted = String(process.env.DSHW_TRUSTED_HOSTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

  function fence() {
    try {
      const conn = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : ctx && ctx.connection
      return conn && typeof conn.requestRejection === 'function' ? conn : null
    } catch (err) {
      return null
    }
  }

  return function guard(req) {
    let code = null
    try {
      const headers = (req && req.headers) || {}
      let u = null
      try {
        u = new URL('http://' + String(headers.host || ''))
      } catch (err) {
        return 403
      }
      const conn = fence()
      if (!isLoopbackHostname(u.hostname)) {
        const authority = u.host.toLowerCase()
        const hostname = u.hostname.toLowerCase()
        const listed = trusted.some((e) => (e.indexOf(':') >= 0 ? e === authority : e === hostname))
        if (!listed && !conn) return 403
      }
      if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
      const origin = headers.origin
      if (typeof origin === 'string' && origin && origin !== 'null') {
        try {
          if (new URL(origin).host.toLowerCase() !== u.host.toLowerCase()) return 403
        } catch (err) {
          return 403
        }
      }
      if (conn) {
        try {
          code = conn.requestRejection(req)
        } catch (err) {
          return 403
        }
        if (code !== undefined && code !== null && code !== false) return typeof code === 'number' ? code : 403
      }
      return null
    } catch (err) {
      return 403
    }
  }
}

// ---------------------------------------------------------------- 挂件脚本

let widgetCache = null
function loadWidget() {
  try {
    const st = fs.statSync(WIDGET_FILE)
    if (widgetCache && widgetCache.mtimeMs === st.mtimeMs) return widgetCache.text
    const text = fs.readFileSync(WIDGET_FILE, 'utf8')
    widgetCache = { text, mtimeMs: st.mtimeMs }
    return text
  } catch (err) {
    return null
  }
}

const WIDGET_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'var s=document.createElement("script");s.src="/pet/widget.js";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

export default {
  name: 'dsh-minecraft-pet',
  apply(root) {
    // ① 注入行必须**立刻**注册：桌面端的注入表是宿主启动时一次性收集的
    //    （collectIndexInjections → IPC → 渲染层），晚一步这一行就永远进不了表。
    try {
      root.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          for (const row of table) {
            if (!row) continue
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf('/pet/widget.js') >= 0) return
            if (row.kind === 'script-src' && row.src === '/pet/widget.js') return
          }
          table.push({ kind: 'script', placement: 'body', text: WIDGET_ROW_TEXT })
        } catch (err) {}
      })
    } catch (err) {}

    // ② 其余逻辑等服务就绪
    root.inject(['webServer', 'connection'], (ctx) => {
      const core = createCore({ ctx })
      const guard = createGuard(ctx)
      const disposers = []

      function route(p, handler) {
        const wrapped = {
          kind: 'exact',
          path: p,
          handler: async (req, res) => {
            const denied = guard(req)
            if (denied) {
              try {
                res.statusCode = denied
                res.end()
              } catch (err) {}
              return
            }
            try {
              await handler(req, res)
            } catch (err) {
              try {
                res.writeHead(500, JSON_HEADERS)
                res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err).slice(0, 160) }))
              } catch (e2) {}
            }
          },
        }
        disposers.push(ctx.webServer.register(wrapped))
      }

      const json = (res, payload) => {
        const body = JSON.stringify(payload)
        res.writeHead(200, JSON_HEADERS)
        res.end(body)
      }

      route('/pet/state.json', async (req, res) => json(res, core.statePayload()))
      route('/pet/balance.json', async (req, res) => json(res, await core.balancePayload()))
      route('/pet/role.json', async (req, res) => json(res, core.rolePayload()))
      route('/pet/audio-active.json', async (req, res) => json(res, core.audioPayload()))
      route('/pet/skin.png', async (req, res) => {
        const bytes = core.skinBytes()
        if (!bytes) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('skin unavailable')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache',
          'Content-Length': String(bytes.length),
        })
        res.end(bytes)
      })
      route('/pet/widget.js', async (req, res) => {
        const text = loadWidget()
        if (!text) {
          // R2 之前这是正常状态：宿主先落地，挂件随后
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('widget not built yet (assets/widget.js)')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(text)
      })

      disposers.push(ctx.on('subagent/start', (info) => core.rememberChild(info)))
      disposers.push(ctx.on('subagent/end', (info) => core.rememberChild(info)))
      disposers.push(ctx.on('session/event', (session, event) => core.onSessionEvent(session, event)))
      disposers.push(ctx.on('session/disposed', (session) => core.dropSession(session)))
      // global：插件级 ctx 未打 scope 标记，帧来自任意 agent；子会话在 core 里按 session id 过滤
      disposers.push(ctx.on('agent/assistant-stream', (payload) => core.onStream(payload), { global: true }))

      try {
        disposers.push(ctx.webServer.tapIndex((html) => {
          if (String(html).indexOf('/pet/widget.js') !== -1) return html
          const tag = '<script defer src="/pet/widget.js"></script>'
          return String(html).indexOf('</body>') !== -1 ? String(html).replace('</body>', tag + '</body>') : String(html) + tag
        }))
      } catch (err) {}

      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          for (const d of disposers) {
            try {
              d()
            } catch (err) {}
          }
          core.dispose()
        })
      }
    })
  },
}
