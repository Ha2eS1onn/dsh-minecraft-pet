// R1 自检：不装进 DSH，用一个假 ctx 把宿主跑起来，逐条验四路数据与状态机。
// 用法：node tools/test-host.mjs
//
// 覆盖 plan.md §16.5 R1 的验收：「四个 GET 接口跑通」+ 状态沿六态优先级。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCore, createGuard } from '../lib/index.js'
import { createPetState, isPeak, nextPeakChangeAt, bjDayKey, costOf } from '../lib/pet-data.mjs'
import {
  parseIdentity,
  textureHash,
  decodeTextures,
  pngInfo,
  validateSkin,
  validateCape,
  request as accountRequest,
  bindAccount,
  TEXTURE_PREFIX,
} from '../lib/skin-account.mjs'
import { encodePng, decodePng } from './png.mjs'

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

// ---------------------------------------------------------------- M5 账号解析（plan.md §7.2）
{
  const ok = (v) => parseIdentity(v)
  check('用户名解析', ok('Notch').id === 'Notch' && ok('Notch').isUuid === false)
  check('用户名前后空格被裁掉', ok('  Notch ').id === 'Notch')
  check('带连字符 UUID', ok('069a79f4-44e9-4726-a5be-fca90e38aaf5').id === '069a79f444e94726a5befca90e38aaf5' && ok('069a79f4-44e9-4726-a5be-fca90e38aaf5').isUuid)
  check('32 位 UUID 直接认', ok('069a79f444e94726a5befca90e38aaf5').isUuid === true)
  const bad = ['', '  ', '../etc/passwd', '太长太长太长太长太长太长了', 'has space', 'a'.repeat(17), '名字']
  let rejected = 0
  for (const v of bad) {
    try {
      parseIdentity(v)
    } catch (err) {
      if (err && err.code === 'IDENTITY') rejected++
    }
  }
  check('非法输入全部拒绝（空 / 路径 / 超长 / 空格 / 中文）', rejected === bad.length, `${rejected}/${bad.length}`)

  // ① 白名单：只认 textures.minecraft.net/texture/<hex>，http/https 都收（Mojang 真实返回是 http）
  check('官方 https 地址通过', textureHash(TEXTURE_PREFIX + 'abcdef0123') === 'abcdef0123')
  check('官方 http 写法也认（真实 profile 就是 http）', textureHash('http://textures.minecraft.net/texture/abcdef') === 'abcdef')
  check('下载地址统一升级成 https', TEXTURE_PREFIX.indexOf('https://') === 0)
  check('别的域名被拒', textureHash('https://evil.example/texture/abcdef') === null)
  check('相似域名被拒', textureHash('https://textures.minecraft.net.evil.com/texture/abc') === null)
  check('带路径穿越被拒', textureHash(TEXTURE_PREFIX + '../../etc') === null)
  check('非 hex 被拒', textureHash(TEXTURE_PREFIX + 'zzzz') === null)
  check('超长 hash 被拒', textureHash(TEXTURE_PREFIX + 'a'.repeat(129)) === null)

  // ② textures 属性解码
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
  const full = decodeTextures(
    b64({
      textures: {
        SKIN: { url: TEXTURE_PREFIX + 'aabb', metadata: { model: 'slim' } },
        CAPE: { url: TEXTURE_PREFIX + 'ccdd' },
      },
    }),
  )
  check('解出皮肤 hash 与 slim', full.skin.hash === 'aabb' && full.model === 'slim')
  check('解出披风 hash', full.cape && full.cape.hash === 'ccdd')
  const noCape = decodeTextures(b64({ textures: { SKIN: { url: TEXTURE_PREFIX + 'aabb' } } }))
  check('没有 CAPE 时 cape 为 null', noCape.cape === null && noCape.model === 'classic')
  let noSkin = ''
  try {
    decodeTextures(b64({ textures: {} }))
  } catch (err) {
    noSkin = err.code || 'x'
  }
  check('没有 SKIN 时报错', noSkin === 'SKIN', noSkin)
  let badB64 = ''
  try {
    decodeTextures('***')
  } catch (err) {
    badB64 = err.code || 'x'
  }
  check('非法 base64 被拒', badB64 === 'TEXTURES', badB64)

  // 尺寸校验
  const skinBytes = fs.readFileSync(path.resolve('assets/default-skin.png'))
  check('pngInfo 读出 64×64', JSON.stringify(pngInfo(skinBytes)) === '{"width":64,"height":64}')
  check('真实皮肤通过校验', validateSkin(skinBytes).width === 64 && validateSkin(skinBytes).legacy === false)
  const legacySkin = decodePng(skinBytes)
  const legacyData = new Uint8ClampedArray(64 * 32 * 4)
  for (let i = 0; i < legacyData.length; i += 4) {
    legacyData[i] = 120
    legacyData[i + 1] = 90
    legacyData[i + 2] = 60
    legacyData[i + 3] = 255
  }
  check('64×32 legacy 皮肤被认成 legacy', validateSkin(encodePng(64, 32, legacyData)).legacy === true)
  let badSize = ''
  try {
    validateSkin(encodePng(48, 48, new Uint8ClampedArray(48 * 48 * 4)))
  } catch (err) {
    badSize = err.code || 'x'
  }
  check('48×48 皮肤被拒', badSize === 'PNG', badSize)
  let notPng = ''
  try {
    validateSkin(Buffer.from('not a png at all, definitely not'))
  } catch (err) {
    notPng = err.code || 'x'
  }
  check('非 PNG 被拒', notPng === 'PNG', notPng)
  void legacySkin

  const capeData = new Uint8ClampedArray(64 * 32 * 4)
  for (let i = 0; i < capeData.length; i += 4) {
    capeData[i] = 200
    capeData[i + 1] = 30
    capeData[i + 2] = 30
    capeData[i + 3] = 255
  }
  const capeBytes = encodePng(64, 32, capeData)
  check('64×32 披风通过校验', validateCape(capeBytes).width === 64)
  let badCape = ''
  try {
    validateCape(encodePng(64, 64, new Uint8ClampedArray(64 * 64 * 4)))
  } catch (err) {
    badCape = err.code || 'x'
  }
  check('高≠宽/2 的伪披风被拒', badCape === 'PNG', badCape)
  check('皮肤尺寸 8 MB 上限生效', (() => {
    try {
      validateSkin(Buffer.concat([skinBytes, Buffer.alloc(8 * 1024 * 1024)]))
      return false
    } catch (err) {
      return err.code === 'SIZE'
    }
  })())
}

// ---------------------------------------------------------------- M5 网络链路（假 fetch，不联网）
{
  const skinBytes = fs.readFileSync(path.resolve('assets/default-skin.png'))
  const capeData = new Uint8ClampedArray(64 * 32 * 4)
  for (let i = 0; i < capeData.length; i += 4) {
    capeData[i] = 30
    capeData[i + 1] = 160
    capeData[i + 2] = 220
    capeData[i + 3] = 255
  }
  const capeBytes = encodePng(64, 32, capeData)
  const texturesB64 = Buffer.from(
    JSON.stringify({
      textures: {
        SKIN: { url: TEXTURE_PREFIX + 'aa11', metadata: { model: 'slim' } },
        CAPE: { url: TEXTURE_PREFIX + 'bb22' },
      },
    }),
  ).toString('base64')

  /** 简单 Response 替身：body 可选流式，用来测「边下边限大小」。 */
  function res(status, body, headers = {}, stream = false) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const r = {
      status,
      type: 'basic',
      headers: { get: (k) => headers[String(k).toLowerCase()] },
      arrayBuffer: async () => buf,
    }
    if (stream) {
      r.body = {
        async *[Symbol.asyncIterator]() {
          // 切成 8 KB 一片，模拟真实下载
          for (let at = 0; at < buf.length; at += 8192) yield buf.subarray(at, at + 8192)
        },
      }
    }
    return r
  }

  const routes = {
    'api.mojang.com/users/profiles/minecraft/Notch': () =>
      res(200, JSON.stringify({ id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' })),
    'sessionserver.mojang.com/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5': () =>
      res(200, JSON.stringify({ name: 'Notch', properties: [{ name: 'textures', value: texturesB64 }] })),
    [`textures.minecraft.net/texture/aa11`]: () => res(200, skinBytes, {}, true),
    [`textures.minecraft.net/texture/bb22`]: () => res(200, capeBytes, {}, true),
  }
  const fakeFetch = (overrides = {}) => async (url) => {
    const u = String(url)
    for (const key of Object.keys(overrides)) if (u.indexOf(key) >= 0) return overrides[key](u)
    for (const key of Object.keys(routes)) if (u.indexOf(key) >= 0) return routes[key]()
    throw new Error('unexpected url: ' + u)
  }

  const r1 = await bindAccount('Notch', { fetchImpl: fakeFetch() })
  check('用户名 → UUID → profile → 皮肤链路打通', r1.name === 'Notch' && r1.uuid === '069a79f444e94726a5befca90e38aaf5')
  check('模型类型带到结果里', r1.model === 'slim')
  check('皮肤字节返回并校验过', r1.skinBytes.length === skinBytes.length && r1.skinInfo.width === 64)
  check('披风字节返回', !!r1.capeBytes && r1.capeError === '')
  check('披风被校验为 64×32', r1.capeBytes && r1.capeBytes.length === capeBytes.length)

  // 已给 UUID 时不该再打 api.mojang.com
  let hitUuidApi = false
  await bindAccount('069a79f4-44e9-4726-a5be-fca90e38aaf5', {
    fetchImpl: fakeFetch({ 'api.mojang.com': () => { hitUuidApi = true; return res(200, '{}') } }),
  })
  check('给 UUID 时跳过用户名接口', hitUuidApi === false)

  // ⑤ 披风失败不算失败
  const r2 = await bindAccount('Notch', { fetchImpl: fakeFetch({ 'texture/bb22': () => res(500, 'boom') }) })
  check('披风 500 时皮肤照常返回', r2.skinBytes.length > 0 && r2.capeBytes === null)
  check('披风失败留下原因', r2.capeError.length > 0)
  const r3 = await bindAccount('Notch', {
    fetchImpl: fakeFetch({ 'texture/bb22': () => res(200, Buffer.from('not a png at all')) }),
  })
  check('披风不是有效 PNG 时也只降级不抛错', r3.capeBytes === null && r3.capeError.length > 0)

  // ④ 不跟随重定向
  let redirectCode = ''
  try {
    await accountRequest(TEXTURE_PREFIX + 'aa11', {
      fetchImpl: async () => res(302, '', { location: 'https://evil.example/x' }),
      limit: 1024,
    })
  } catch (err) {
    redirectCode = err.code || 'x'
  }
  check('302 被拒绝', redirectCode === 'REDIRECT', redirectCode)
  let opaquecode = ''
  try {
    await accountRequest(TEXTURE_PREFIX + 'aa11', {
      fetchImpl: async () => ({ status: 0, type: 'opaqueredirect', headers: { get: () => null } }),
      limit: 1024,
    })
  } catch (err) {
    opaquecode = err.code || 'x'
  }
  check('opaque redirect 被拒绝', opaquecode === 'REDIRECT', opaquecode)

  // ③ 限大小
  let lenCode = ''
  try {
    await accountRequest(TEXTURE_PREFIX + 'aa11', {
      fetchImpl: async () => res(200, 'x', { 'content-length': String(9 * 1024 * 1024) }),
      limit: 1024 * 1024,
    })
  } catch (err) {
    lenCode = err.code || 'x'
  }
  check('content-length 超限就停', lenCode === 'SIZE', lenCode)
  let streamCode = ''
  try {
    await accountRequest(TEXTURE_PREFIX + 'aa11', {
      fetchImpl: async () => res(200, Buffer.alloc(3 * 1024 * 1024), {}, true),
      limit: 1024 * 1024,
    })
  } catch (err) {
    streamCode = err.code || 'x'
  }
  check('流式下载超限就停', streamCode === 'SIZE', streamCode)

  // 状态码 → 人话
  const codes = {}
  for (const [status, key] of [[404, 'NOT_FOUND'], [429, 'RATE'], [503, 'HTTP']]) {
    try {
      await accountRequest(TEXTURE_PREFIX + 'aa11', { fetchImpl: async () => res(status, 'x'), limit: 1024 })
    } catch (err) {
      codes[key] = err.code
    }
  }
  check('404 / 429 / 5xx 各有对应提示', codes.NOT_FOUND === 'NOT_FOUND' && codes.RATE === 'RATE' && codes.HTTP === 'HTTP', JSON.stringify(codes))
  let netCode = ''
  try {
    await accountRequest(TEXTURE_PREFIX + 'aa11', {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
      limit: 1024,
    })
  } catch (err) {
    netCode = err.code || 'x'
  }
  check('网络错误归到 NETWORK', netCode === 'NETWORK', netCode)

  // ---------------------------------------------------------------- 绑定落盘 / 解绑还原
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-m5-'))
  const role2 = path.join(home2, 'pet-role')
  fs.mkdirSync(role2, { recursive: true })
  fs.writeFileSync(path.join(role2, 'meta.json'), JSON.stringify({ name: '本地角色', model: 'classic' }))
  fs.copyFileSync(path.resolve('assets/default-skin.png'), path.join(role2, 'skin.png'))
  const localSkin = fs.readFileSync(path.join(role2, 'skin.png'))

  const c2 = createCore({
    clock: () => now,
    roleDir: role2,
    stateFile: path.join(home2, 'state.json'),
    legacyRoleDir: path.join(home2, 'no-legacy'),
    fetchImpl: fakeFetch(),
  })
  check('绑定前 hasCape 为 false', c2.rolePayload().hasCape === false && c2.accountPayload().bound === false)
  const bound = await c2.bindAccount('Notch')
  check('绑定成功返回 ok', bound.ok === true && bound.bound === true, JSON.stringify(bound).slice(0, 120))
  check('绑定后 meta 记下账号', JSON.parse(fs.readFileSync(path.join(role2, 'meta.json'), 'utf8')).account.name === 'Notch')
  check('绑定后 name 换成账号名', c2.rolePayload().name === 'Notch')
  check('绑定后 model 跟着账号走', c2.rolePayload().model === 'slim')
  check('绑定后 skin.png 换成拉下来的皮肤', fs.existsSync(path.join(role2, 'skin.png')))
  check('绑定后 cape.png 落盘', fs.existsSync(path.join(role2, 'cape.png')))
  check('绑定后 hasCape 为 true', c2.rolePayload().hasCape === true)
  check('绑定后本地皮肤有备份', fs.existsSync(path.join(role2, 'skin.local.png')))
  check('capeBytes 读得到', !!c2.capeBytes() && c2.capeBytes().length === capeBytes.length)

  // 绑定失败：不能破坏现有皮肤
  const brokenCore = createCore({
    clock: () => now,
    roleDir: role2,
    stateFile: path.join(home2, 'state2.json'),
    legacyRoleDir: path.join(home2, 'no-legacy'),
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  let bindErr = ''
  try {
    await brokenCore.bindAccount('Notch')
  } catch (err) {
    bindErr = String(err.message || err)
  }
  check('断网绑定时抛错', bindErr.length > 0)
  check('断网后皮肤没被破坏', fs.existsSync(path.join(role2, 'skin.png')) && c2.rolePayload().hasCape === true)

  const unbound = c2.unbindAccount()
  check('解绑后 account 清空', unbound.bound === false && unbound.name === '')
  check('解绑后 cape.png 被删', fs.existsSync(path.join(role2, 'cape.png')) === false)
  check('解绑后 hasCape 回到 false', c2.rolePayload().hasCape === false)
  check('解绑后皮肤还原成本地那份', Buffer.compare(fs.readFileSync(path.join(role2, 'skin.png')), localSkin) === 0)
  check('解绑后名字/模型还原', c2.rolePayload().name === '本地角色' && c2.rolePayload().model === 'classic')
  check('解绑后备份文件清掉', fs.existsSync(path.join(role2, 'skin.local.png')) === false)
  try {
    fs.rmSync(home2, { recursive: true, force: true })
  } catch (err) {}
}

// ---------------------------------------------------------------- 插件装配（apply → 路由）
{
  // 让插件按临时 DSH_HOME 装配，别往真实用户目录里写角色
  process.env.DSH_HOME = tmpHome
  const { default: plugin } = await import('../lib/index.js')
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

  for (const p of ['/pet/state.json', '/pet/balance.json', '/pet/role.json', '/pet/skin.png', '/pet/cape.png', '/pet/audio-active.json', '/pet/account.json', '/pet/widget.js']) {
    check(`注册路由 ${p}`, routes.has(p))
  }

  // 假 req/res：只关心状态码与 body
  function call(p, headers, extra) {
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
    const req = {
      url: p,
      method: (extra && extra.method) || 'GET',
      headers,
      body: extra && extra.body,
    }
    return Promise.resolve(routes.get(p).handler(req, res)).then(() => res)
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

  // ---------------------------------------------------------------- M5 路由
  const acc0 = await call('/pet/account.json', loopback)
  check('GET /pet/account.json → 200 + bound:false', acc0.statusCode === 200 && /"bound":false/.test(acc0.body), acc0.body.slice(0, 80))
  const cape0 = await call('/pet/cape.png', loopback)
  check('没有披风时 GET /pet/cape.png → 404', cape0.statusCode === 404)

  // 非法用户名在解析阶段就被挡住，不会出网
  const badBind = await call('/pet/account.json', loopback, { method: 'POST', body: { account: '名字里有中文' } })
  check('POST 非法账号 → ok:false 且带原因', badBind.statusCode === 200 && /"ok":false/.test(badBind.body) && /用户名/.test(badBind.body), badBind.body.slice(0, 120))
  const put = await call('/pet/account.json', loopback, { method: 'PUT' })
  check('PUT /pet/account.json → 405', put.statusCode === 405)
  const crossBind = await call('/pet/account.json', { host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' }, { method: 'POST', body: { account: 'Notch' } })
  check('跨站 POST 绑定被 403', crossBind.statusCode === 403)

  // 手工放一张披风进去，验证 cape.png 路由与 role.json 联动，再 DELETE 解绑
  const pluginRoleDir = path.join(tmpHome, 'pet-role')
  fs.writeFileSync(path.join(pluginRoleDir, 'cape.png'), encodePng(64, 32, new Uint8ClampedArray(64 * 32 * 4).fill(255)))
  const cape1 = await call('/pet/cape.png', loopback)
  check('有披风时 GET /pet/cape.png → 200 + PNG', cape1.statusCode === 200 && String(cape1.body).indexOf('PNG') >= 0)
  const roleCape = await call('/pet/role.json', loopback)
  check('role.json hasCape 跟着变成 true', /"hasCape":true/.test(roleCape.body), roleCape.body.slice(0, 100))
  const del = await call('/pet/account.json', loopback, { method: 'DELETE' })
  check('DELETE /pet/account.json → 解绑', del.statusCode === 200 && /"bound":false/.test(del.body))
  const cape2 = await call('/pet/cape.png', loopback)
  check('解绑后披风 404', cape2.statusCode === 404)
  const emptyPost = await call('/pet/account.json', loopback, { method: 'POST', body: { account: '' } })
  check('POST 空账号按解绑处理', emptyPost.statusCode === 200 && /"bound":false/.test(emptyPost.body))
}

console.log(`\n${fail === 0 ? '全部通过' : fail + ' 项失败'}  (${pass} ok / ${fail} fail)`)
try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch (err) {}
process.exit(fail === 0 ? 0 : 1)
