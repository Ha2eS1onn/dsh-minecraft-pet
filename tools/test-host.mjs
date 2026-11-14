// R1 自检：不装进 DSH，用一个假 ctx 把宿主跑起来，逐条验四路数据与状态机。
// 用法：node tools/test-host.mjs
//
// 覆盖 plan.md §16.5 R1 的验收：「四个 GET 接口跑通」+ 状态沿六态优先级。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCore, createGuard } from '../lib/pet-host.js'
import { createPetState, isPeak, nextPeakChangeAt, bjDayKey, costOf } from '../lib/pet-data.mjs'

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log(`ok    ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`)
  }
}

// 临时「DSH_HOME」：不碰真实用户目录
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-r1-'))
const roleDir = path.join(tmpHome, 'pet-role')
fs.mkdirSync(roleDir, { recursive: true })
fs.writeFileSync(path.join(roleDir, 'meta.json'), JSON.stringify({ name: '测试角色', model: 'slim' }))
fs.copyFileSync(path.resolve('assets/default-skin.png'), path.join(roleDir, 'skin.png'))

let now = 1_800_000_000_000 // 2027-01 附近，避开节假日表
const core = createCore({
  clock: () => now,
  roleDir,
  stateFile: path.join(tmpHome, 'state.json'),
  legacyRoleDir: path.join(tmpHome, 'no-legacy'),
})

// ---------------------------------------------------------------- 角色
{
  const r = core.rolePayload()
  check('role.json 读到 meta', r.ok && r.name === '测试角色' && r.model === 'slim', JSON.stringify(r))
  check('role.json hasCape 恒 false（M5 前）', r.hasCape === false)
  const skin = core.skinBytes()
  check('skin.png 返回字节', skin && skin.length > 100, `${skin ? skin.length : 0} B`)
}

// ---------------------------------------------------------------- 状态机
{
  const s = core.state
  const t0 = now
  s.noteEvent({ type: 'turn/start', data: {} }, t0)
  check('turn/start → thinking', s.snapshot(t0).state === 'thinking')
  s.noteEvent({ type: 'tool/call', data: { name: 'read' } }, t0 + 400)
  check('tool/call → working', s.snapshot(t0 + 400).state === 'working')
  s.noteEvent({ type: 'tool/call', data: { name: 'ask_user_question' } }, t0 + 800)
  check('ask_user_question → waiting', s.snapshot(t0 + 800).state === 'waiting')
  // 低优先级不能把 waiting 打回去
  s.noteEvent({ type: 'tool/call', data: { name: 'read' } }, t0 + 1200)
  check('waiting 不被普通事件降级', s.snapshot(t0 + 1200).state === 'waiting')
  s.noteEvent({ type: 'tool/result', data: {} }, t0 + 1600)
  check('挂起解除 → working（force 出 waiting）', s.snapshot(t0 + 1600).state === 'working')
  s.noteEvent({ type: 'turn/end', data: { reason: { kind: 'completed' } } }, t0 + 2000)
  check('turn/end completed → done', s.snapshot(t0 + 2000).state === 'done')
  check('done 3 秒内保持', s.snapshot(t0 + 4000).state === 'done')
  check('done 3 秒后回 idle（惰性结算）', s.snapshot(t0 + 5200).state === 'idle')
  s.noteEvent({ type: 'turn/end', data: { reason: { kind: 'error' } } }, t0 + 5600)
  check('turn/end error → error', s.snapshot(t0 + 5600).state === 'error')
  s.noteEvent({ type: 'turn/start', data: {} }, t0 + 5700)
  check('error 停留可被新的 turn/start 打断', s.snapshot(t0 + 5700).state === 'thinking')
  s.noteStream({ type: 'text-delta' }, t0 + 5900)
  check('正文开始 → 立刻 idle', s.snapshot(t0 + 5900).state === 'idle')
  // 30 秒兜底
  s.noteEvent({ type: 'tool/call', data: { name: 'read' } }, t0 + 6000)
  check('30 秒内保持 working', s.snapshot(t0 + 20000).state === 'working')
  const fresh = createPetState(t0)
  fresh.noteEvent({ type: 'turn/start', data: {} }, t0)
  check('thinking 30 秒无事件兜底回 idle', fresh.snapshot(t0 + 31000).state === 'idle')
  const exempt = createPetState(t0)
  exempt.noteEvent({ type: 'tool/call', data: { name: 'read' } }, t0)
  check('working 豁免 30 秒兜底（长构建不误判）', exempt.snapshot(t0 + 120000).state === 'working')
  // 最短停留
  const box = createPetState(t0)
  box.noteEvent({ type: 'turn/start', data: {} }, t0)
  box.noteEvent({ type: 'tool/call', data: { name: 'read' } }, t0 + 100)
  check('300ms 内同级/降级被拦（thinking→working 是升级，允许）', box.snapshot(t0 + 100).state === 'working')
}

// ---------------------------------------------------------------- 每轮计费
{
  const t = now
  core.onSessionEvent({ id: 's1' }, { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, message: { source: { model: 'deepseek-flash' } } } })
  core.onSessionEvent({ id: 's1' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  const p = core.statePayload()
  // 1M 输入 token：谷价 1 元 / 峰价 2 元
  const expected = isPeak(Math.floor(t / 1000)) ? 2 : 1
  check('turnCost 按峰谷计价', p.turnCost && Math.abs(p.turnCost.amount - expected) < 1e-6, JSON.stringify(p.turnCost))
  check('今日已用累加了这一轮', Math.abs(core.usage.used - expected) < 1e-6, String(core.usage.used))
  check('turnCost 带 seq', p.turnCost && p.turnCost.seq >= 1)
  check('costOf 缓存命中按 hit 价', Math.abs(costOf({ cacheReadTokens: 1e6, inputTokens: 0, outputTokens: 0 }, 'deepseek-flash', Math.floor(t / 1000)) - (isPeak(Math.floor(t / 1000)) ? 0.04 : 0.02)) < 1e-9)
}

// ---------------------------------------------------------------- 余额
{
  const account = {
    getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', total_balance: 12.5 }], bonusWallets: [{ currency: 'CNY', balance: 2.5 }] }),
  }
  const withAcc = createCore({
    clock: () => now,
    roleDir,
    stateFile: path.join(tmpHome, 'state2.json'),
    legacyRoleDir: path.join(tmpHome, 'no-legacy'),
    ctx: { get: (k) => (k === 'deepseekAccount' ? account : null) },
  })
  const p = await withAcc.balancePayload()
  check('balance.json 汇总充值 + 赠金', p.ok && Math.abs(p.balance - 15) < 1e-9, JSON.stringify(p))
  check('balance.json 带 period 与 nextChangeAt', (p.period === 'peak' || p.period === 'valley') && typeof p.nextChangeAt === 'number')
  const noAcc = createCore({ clock: () => now, roleDir, stateFile: path.join(tmpHome, 'state3.json'), legacyRoleDir: path.join(tmpHome, 'no-legacy'), ctx: { get: () => null } })
  const q = await noAcc.balancePayload()
  check('没有账号服务 → ok:false 且带原因', q.ok === false && q.error.length > 0, JSON.stringify(q))
  check('拿不到余额时 todayUsed 仍可用', typeof q.todayUsed === 'number')
}

// ---------------------------------------------------------------- 峰谷规则
{
  const at = (iso) => Math.floor(new Date(iso + '+08:00').getTime() / 1000)
  check('周三 10:00 是峰时', isPeak(at('2026-11-18T10:00:00')) === true)
  check('周三 12:30 是谷时', isPeak(at('2026-11-18T12:30:00')) === false)
  check('周六全天谷价', isPeak(at('2026-11-14T10:00:00')) === false)
  check('国庆 10/2 全天谷价', isPeak(at('2026-10-02T10:00:00')) === false)
  check('nextPeakChangeAt 落在未来', nextPeakChangeAt(at('2026-11-18T10:00:00')) > at('2026-11-18T10:00:00'))
  check('北京日键按 +8h 算', bjDayKey(Date.UTC(2026, 10, 13, 17, 0, 0)) === '2026-11-14')
}

// ---------------------------------------------------------------- 音频
{
  const a = core.audioPayload()
  check('audio-active 恒返回 ok', a.ok === true && typeof a.active === 'boolean')
}

// ---------------------------------------------------------------- 信任栅栏
{
  const g = createGuard({ get: () => null })
  const req = (headers) => ({ headers })
  check('回环 Host 放行', g(req({ host: '127.0.0.1:5173' })) === null)
  check('localhost 放行', g(req({ host: 'localhost:5173' })) === null)
  check('非回环 Host 拒绝', g(req({ host: 'evil.example:80' })) === 403)
  check('相似域名不误判', g(req({ host: '127.0.0.1.evil.com' })) === 403)
  check('cross-site 拒绝', g(req({ host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' })) === 403)
  check('异源 Origin 拒绝', g(req({ host: '127.0.0.1:5173', origin: 'http://evil.example' })) === 403)
  check('同源 Origin 放行', g(req({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })) === null)
  check('缺 Host 拒绝', g({ headers: {} }) === 403)
}

// ---------------------------------------------------------------- 旧角色迁移
{
  const legacy = path.join(tmpHome, 'legacy-role')
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'meta.json'), JSON.stringify({ name: '旧角色', model: 'classic' }))
  fs.copyFileSync(path.resolve('assets/default-skin.png'), path.join(legacy, 'skin.png'))
  const empty = path.join(tmpHome, 'fresh-role')
  const c = createCore({ clock: () => now, roleDir: empty, stateFile: path.join(tmpHome, 'state4.json'), legacyRoleDir: legacy })
  check('首次启动从 DWS 角色目录搬皮肤', fs.existsSync(path.join(empty, 'skin.png')))
  check('搬运后读到的名字来自旧 meta', c.rolePayload().name === '旧角色')
}

// ---------------------------------------------------------------- 插件装配（apply → 路由）
{
  // 让插件按临时 DSH_HOME 装配，别往真实用户目录里写角色
  process.env.DSH_HOME = tmpHome
  const { default: plugin } = await import('../lib/pet-host.js')
  check('插件名是 dsh-minecraft-pet', plugin.name === 'dsh-minecraft-pet')

  const routes = new Map()
  const injectRows = []
  const listeners = new Map()
  const root = {
    on(type, cb) {
      listeners.set(type, cb)
      return () => listeners.delete(type)
    },
    inject(_names, cb) {
      cb(ctx)
    },
    effect() {},
  }
  const ctx = {
    get: () => null,
    effect: () => {},
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      tapIndex: () => () => {},
    },
    on(type, cb) {
      listeners.set(type, cb)
      return () => listeners.delete(type)
    },
  }
  plugin.apply(root)

  check('apply 立刻注册了注入行', typeof listeners.get('webserver/index-inject') === 'function')
  const table = []
  listeners.get('webserver/index-inject')(table)
  check('注入行指向 /pet/widget.js', table.length === 1 && String(table[0].text).indexOf('/pet/widget.js') >= 0)
  listeners.get('webserver/index-inject')(table)
  check('注入行不重复推', table.length === 1)

  for (const p of ['/pet/state.json', '/pet/balance.json', '/pet/role.json', '/pet/skin.png', '/pet/audio-active.json', '/pet/widget.js']) {
    check(`注册路由 ${p}`, routes.has(p))
  }

  // 假 req/res：只关心状态码与 body
  function call(p, headers) {
    const res = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead(code, h) {
        this.statusCode = code
        this.headers = h || null
      },
      end(b) {
        this.body = b === undefined ? '' : String(b)
      },
    }
    return Promise.resolve(routes.get(p).handler({ url: p, method: 'GET', headers }, res)).then(() => res)
  }

  const loopback = { host: '127.0.0.1:5173' }
  const st = await call('/pet/state.json', loopback)
  check('GET /pet/state.json → 200 + 六态之一', st.statusCode === 200 && /"state":"(idle|thinking|working|waiting|done|error)"/.test(st.body), st.body.slice(0, 80))
  const rl = await call('/pet/role.json', loopback)
  check('GET /pet/role.json → 200 + model', rl.statusCode === 200 && /"model":"(classic|slim)"/.test(rl.body), rl.body.slice(0, 80))
  const skin = await call('/pet/skin.png', loopback)
  check('GET /pet/skin.png → 200 + PNG 头', skin.statusCode === 200 && String(skin.body).indexOf('PNG') >= 0)
  const au = await call('/pet/audio-active.json', loopback)
  check('GET /pet/audio-active.json → 200 + active', au.statusCode === 200 && /"active":/.test(au.body))
  const widget = await call('/pet/widget.js', loopback)
  // R2 之前这里断言 404；assets/widget.js 落地后改成「有内容且是挂件本体」
  check('GET /pet/widget.js → 200 + 含 DSH_PET 产物', widget.statusCode === 200 && String(widget.body).indexOf('DSH_PET') >= 0, `code=${widget.statusCode}`)
  const bad = await call('/pet/state.json', { host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' })
  check('跨站请求 403', bad.statusCode === 403)
}

console.log(`\n${fail === 0 ? '全部通过' : fail + ' 项失败'}  (${pass} ok / ${fail} fail)`)
try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch (err) {}
process.exit(fail === 0 ? 0 : 1)
