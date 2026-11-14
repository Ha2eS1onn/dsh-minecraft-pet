// 数据层：六态状态机、每轮计费、峰谷判定。plan.md §16.3 的四路数据里，
// 除了「角色」是纯文件读写，其余三路都在这里 —— 不碰 fs、不碰 ctx、不读时钟，
// 全由调用方注入 `now` 与事件，所以 tools/test-host.mjs 能直接单测（§16.5 R1 的要求）。

export const STATES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error']

/** 优先级只约束普通（非 force）切换；数值与 plan.md §1.1 一致。 */
export const PRIORITY = { idle: 10, thinking: 30, working: 40, done: 50, error: 60, waiting: 70 }

const MIN_STAY_MS = 300
const TERMINAL_MS = 3000
const IDLE_TIMEOUT_MS = 30000

/** 挂起等用户的工具：一个提问，一个计划审批。 */
const WAIT_TOOLS = new Set(['ask_user_question', 'exit_plan_mode'])

/**
 * turn/end 的 reason 决定终结态。DSH 的 reason 是 `{ kind }` 或字符串：
 * completed / blocked / aborted / interrupted / error / max-tokens / forked。
 * 用户主动停止与中断算 idle（不是「完成」），否则会白放一次庆祝烟花。
 */
export function turnEndState(data) {
  const r = data && data.reason
  const kind = typeof r === 'string' ? r : r && r.kind ? String(r.kind) : ''
  if (!kind || kind === 'completed') return 'done'
  if (kind === 'error' || kind === 'max-tokens') return 'error'
  return 'idle'
}

export function createPetState(now0 = Date.now()) {
  const s = {
    name: 'idle',
    since: now0,
    holdUntil: 0,
    lastEventAt: now0,
    /** 当前挂起的提问/审批；只保留最新一条（单槽，与 plan.md §1.1 一致）。 */
    pending: null,
  }

  const commit = (name, now) => {
    s.name = name
    s.since = now
    s.holdUntil = name === 'done' || name === 'error' ? now + TERMINAL_MS : 0
  }

  /** 惰性结算：终结态停留与 30 秒兜底都在读取时算，不挂定时器。 */
  function expire(now) {
    if (s.name === 'idle') return
    if (s.holdUntil && now >= s.holdUntil) return commit('idle', now)
    // working 豁免兜底：长 build/子 agent 期间没有新事件是常态。
    // waiting 更不能超时 —— 它就是在等人。
    if (s.name !== 'waiting' && s.name !== 'working' && now - s.lastEventAt >= IDLE_TIMEOUT_MS) {
      commit('idle', now)
    }
  }

  /**
   * 请求切换。force 只留给生命周期事件（turn/start、turn/end）与「挂起解除」，
   * 否则 waiting(70) 一旦进入就再也出不来。
   */
  function request(name, now, force = false) {
    if (!PRIORITY[name]) return false
    expire(now)
    if (name === s.name) return false
    if (!force) {
      if (PRIORITY[name] < PRIORITY[s.name]) return false
      // 高优先级可以立刻打断，但同级/降级要满足最短停留
      if (now - s.since < MIN_STAY_MS && PRIORITY[name] <= PRIORITY[s.name]) return false
    }
    commit(name, now)
    return true
  }

  function noteEvent(event, now, isChild = false) {
    expire(now) // 必须先用旧的 lastEventAt 结算兜底，再刷新活动时间
    s.lastEventAt = now
    if (isChild) return false // 子会话只贡献「有活动」，不驱动全局状态
    const type = String((event && event.type) || '')
    const data = (event && event.data) || {}

    if (type === 'turn/start') {
      s.pending = null
      return request('thinking', now, true)
    }
    if (type === 'turn/end') {
      s.pending = null
      return request(turnEndState(data), now, true)
    }
    if (type === 'tool/call') {
      const name = String(data.name || data.toolName || '')
      const wait = WAIT_TOOLS.has(name)
      if (wait) s.pending = { tool: name, at: now }
      return request(wait ? 'waiting' : 'working', now)
    }
    if (type === 'tool/result') {
      // 挂起的那次调用返回了 → 只有确实清空了挂起才允许 force 出 waiting
      const had = s.pending
      s.pending = null
      return request('working', now, s.name === 'waiting' && had != null)
    }
    if (type === 'approval/asked') return request('waiting', now)
    if (type === 'approval/policy') return false // 策略审计，不是挂起落地
    if (type.indexOf('approval/') === 0) {
      const had = s.pending
      s.pending = null
      return request('working', now, s.name === 'waiting' && had != null)
    }
    return false
  }

  /**
   * 正文开始流出就回 idle。
   * 理由（旧宿主的实测结论）：`session/event` 里没有流式正文，直播帧走 `agent/assistant-stream`；
   * 而且工具参数流（write 一整份文件）可能流几十秒，那期间必须算 working。
   */
  function noteStream(chunk, now, isChild = false) {
    expire(now)
    s.lastEventAt = now
    if (isChild || !chunk) return false
    const type = String(chunk.type || '')
    if (type === 'tool-call-delta' || (type === 'block-start' && chunk.blockType === 'tool-call')) {
      return s.name === 'idle' || s.name === 'thinking' ? request('working', now) : false
    }
    const body = type === 'text-delta' || (type === 'block-start' && chunk.blockType === 'text')
    if (!body) return false
    // 不打断 done/error 的 3 秒停留：标题生成等旁路调用也会发流
    return s.name === 'thinking' || s.name === 'working' ? request('idle', now, true) : false
  }

  function snapshot(now) {
    expire(now)
    return { state: s.name, since: s.since, pending: s.pending ? s.pending.tool : '' }
  }

  return { request, noteEvent, noteStream, snapshot, expire, raw: s }
}

// ---------------------------------------------------------------- 计费

/** 元/百万 token。数组下标 [谷, 峰]。Pro 是 Flash 的 3 倍价（2026-08-17 生效）。 */
const FLASH = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }
const PRO = { hit: [0.06, 0.12], miss: [3, 6], out: [12, 24] }

export function priceFor(model) {
  const m = String(model || '').toLowerCase()
  if (m.indexOf('pro') >= 0) return PRO
  return FLASH
}

const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]

/** 法定节假日全天谷价（只需列放假的日期；调休上班日都落在周末，本来就是谷价）。 */
const HOLIDAY_VALLEY = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
])

/** 北京时间日历日的键（YYYY-MM-DD）。账本按这个键分天。 */
export function bjDayKey(ms) {
  return new Date(Number(ms) + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * 是否峰时（epoch 秒）。规则与官方计费脚注一致：
 * 周一至周五 09:00-12:00 / 14:00-18:00 为峰时，其余（含周末、法定节假日）为谷价。
 */
export function isPeak(sec) {
  const n = Number(sec)
  if (!isFinite(n)) return false
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  const dow = bj.getUTCDay() // 平移 +8h 后按 UTC 读，就是北京日历
  if (dow === 0 || dow === 6) return false
  if (HOLIDAY_VALLEY.has(bj.toISOString().slice(0, 10))) return false
  const hour = bj.getUTCHours()
  return PEAK_HOURS.some(([a, b]) => hour >= a && hour < b)
}

/** 下一次峰谷切换的时刻（epoch 秒）；扫 12 天够覆盖最长的春节假期。 */
export function nextPeakChangeAt(sec) {
  const n = Number(sec)
  if (!isFinite(n)) return null
  const cur = isPeak(n)
  const day0 = Math.floor((n + 8 * 3600) / 86400) * 86400
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const cand = day0 + d * 86400 + edge * 3600 - 8 * 3600
      if (cand <= n + 1) continue
      if (isPeak(cand) !== cur) return cand
    }
  }
  return null
}

/** 一段 usage 的钱（元）。口径：reasoningTokens 已含在 outputTokens 里，不再重复计。 */
export function costOf(usage, model, atSec) {
  const cache = Number(usage && usage.cacheReadTokens) || 0
  const input = Number(usage && usage.inputTokens) || 0
  const output = Number(usage && usage.outputTokens) || 0
  const p = priceFor(model)
  const off = isPeak(atSec) ? 1 : 0
  return (cache / 1e6) * p.hit[off] + (input / 1e6) * p.miss[off] + (output / 1e6) * p.out[off]
}

/**
 * 每轮消耗：按 (sessionId, turn) 分桶。主会话与子代理会并行发 assistant/message，
 * 不分桶就会串账（旧宿主踩过）。
 */
export function createTurnMeter() {
  const buckets = new Map()
  let lastTurn = null
  let seq = 0

  function finalize(sessionId) {
    const b = buckets.get(sessionId)
    if (!b) return null
    buckets.delete(sessionId)
    seq += 1
    lastTurn = { seq, turn: b.turn, amount: b.amount, tokens: b.tokens, at: b.lastAt }
    return lastTurn
  }

  function noteMessage(sessionId, data, now) {
    const turn = Number(data && data.turn)
    const usage = data && data.usage
    if (!usage || !isFinite(turn)) return null
    let b = buckets.get(sessionId)
    if (!b || b.turn !== turn) {
      if (b) finalize(sessionId) // 上一轮没收到 turn/end 就换了轮次
      b = { turn, amount: 0, tokens: 0, lastAt: now }
      buckets.set(sessionId, b)
    }
    const model = data.message && data.message.source ? String(data.message.source.model || '') : ''
    const input = Number(usage.inputTokens) || 0
    const cache = Number(usage.cacheReadTokens) || 0
    const output = Number(usage.outputTokens) || 0
    b.amount += costOf(usage, model, Math.floor(now / 1000))
    b.tokens += input + cache + output
    b.lastAt = now
    return b
  }

  return {
    noteMessage,
    finalize,
    drop: (sessionId) => buckets.delete(sessionId),
    get lastTurn() { return lastTurn },
    /** 供持久化：重启后 seq 继续递增，前端不会把新一轮误判成旧轮。 */
    restoreSeq(n) { seq = Math.max(seq, Number(n) || 0) },
  }
}
