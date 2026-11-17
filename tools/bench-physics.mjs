// 物理参数定量表（P2-a v2 的阶段 0 工具）。
//
// 目的：把「多大动静算看得见」变成数字，而不是靠肉眼猜。第一版物理就是没有这一步，
// 交付时回弹峰值只有 2.8 px 也没人发现。
//
// 用法：node tools/bench-physics.mjs
//
// 输出的四张表：
//   ① squash 冲量响应  —— 打字 / 落地压缩的峰值（模型单位与屏幕 px）、过冲、收敛时间
//   ② 连续打字         —— 90 ms 一个键时的压缩量累积（会不会抖成一片）
//   ③ 转头阶跃         —— 30° 阶跃的峰值、过冲、到位时间
//   ④ 自由落体         —— 几个掉落高度的落地速度、反弹高度、总时长

import { Spring } from '../assets/spring.js'
import { PHYSICS } from '../assets/pet-anim.js'
import { SQUASH_SHAPE } from '../assets/skin-model.js'

const PX = 8 // 画布 352 宽 / 44 单位
const DT = 1 / 60
const DEG = 180 / Math.PI

/** 跑一根弹簧到收敛，逐帧记录。 */
function run(spring, target, frames = 240, drive = null) {
  const series = []
  for (let i = 0; i < frames; i++) {
    if (drive) drive(spring, i)
    series.push(spring.step(target, DT))
  }
  return series
}

function stats(series) {
  let peak = -Infinity
  let peakAt = 0
  let trough = Infinity
  let troughAt = 0
  const target = series[series.length - 1]
  let lastActive = -1
  const eps = 0.02
  for (let i = 0; i < series.length; i++) {
    if (series[i] > peak) {
      peak = series[i]
      peakAt = i
    }
    if (series[i] < trough) {
      trough = series[i]
      troughAt = i
    }
    // 收敛 = 之后再也不超过 eps（用"最后一次越界"而不是"第一次贴合"，否则穿过零点就算收敛）
    if (Math.abs(series[i] - target) >= eps) lastActive = i
  }
  return { peak, peakAt, trough, troughAt, settleAt: lastActive + 1, target }
}

const f3 = (v) => (v >= 0 ? ' ' : '') + v.toFixed(3)
const pad = (v, n) => String(v).padStart(n)
const ms = (frames) => (frames * DT * 1000).toFixed(0) + ' ms'

console.log('物理参数定量表（P2-a v2）')
console.log(`画布 352×416、${PX} px/模型单位；站立高 ${SQUASH_SHAPE.height} 单位。`)
console.log(
  `squash: k=${PHYSICS.squash.k} ζ=${PHYSICS.squash.zeta} impulse=${PHYSICS.squash.impulse}` +
    `   head: k=${PHYSICS.head.k} ζ=${PHYSICS.head.zeta}\n`,
)

// ① 单次冲量
{
  const s = new Spring({ ...PHYSICS.squash, value: 0 })
  s.impulse(PHYSICS.squash.impulse)
  const st = stats(run(s, 0))
  const topPx = st.peak * SQUASH_SHAPE.y * SQUASH_SHAPE.height * PX
  const stretch = st.trough < 0 ? -st.trough : 0
  const stretchPx = stretch * SQUASH_SHAPE.y * SQUASH_SHAPE.height * PX
  console.log('① squash 单次冲量（一次按键 / 一次落地满力）')
  console.log(
    `   峰值   ${f3(st.peak)} → 头顶下沉 ${topPx.toFixed(1)} px（${ms(st.peakAt)}）`,
  )
  console.log(
    `   过冲   ${f3(st.trough)} → 拉长 ${stretchPx.toFixed(1)} px（${ms(st.troughAt)}）`,
  )
  console.log(`   收敛   ${ms(st.settleAt)}`)
  console.log(`   横向   鼓起 ${((st.peak * SQUASH_SHAPE.xz) * 100).toFixed(1)}%（8 单位宽的躯干约 +${(st.peak * SQUASH_SHAPE.xz * 8 * PX).toFixed(1)} px）\n`)
}

// ② 连续打字：90 ms 一个键（约 11 键/秒，偏快的真实打字）
{
  const s = new Spring({ ...PHYSICS.squash, value: 0 })
  const every = Math.round(0.09 / DT)
  const series = run(s, 0, 150, (spring, i) => {
    if (i % every === 0 && i < 60) {
      // 与 pet-anim 的 press() 同一条衰减规则
      const gain = spring.value > PHYSICS.squash.repeatAt ? PHYSICS.squash.repeatGain : 1
      spring.impulse(PHYSICS.squash.impulse * gain)
    }
  })
  const stopAt = Math.round(60 / every) * every
  const afterStop = series.slice(stopAt)
  let tail = -1
  for (let i = 0; i < afterStop.length; i++) if (Math.abs(afterStop[i]) >= 0.02) tail = i
  console.log('② 连续打字（90 ms/键，持续 1 s）')
  console.log(
    `   峰值 ${f3(Math.max(...series))} → ${(Math.max(...series) * SQUASH_SHAPE.y * SQUASH_SHAPE.height * PX).toFixed(1)} px`,
  )
  const valley = Math.min(...series.slice(every, every * 2 + 1))
  console.log(
    `   键间谷值 ${f3(valley)} → ${(valley * SQUASH_SHAPE.y * SQUASH_SHAPE.height * PX).toFixed(1)} px` +
      `（峰谷差 ${((Math.max(...series) - valley) * SQUASH_SHAPE.y * SQUASH_SHAPE.height * PX).toFixed(1)} px，即每键一次可见回弹）`,
  )
  console.log(`   停手后 ${ms(tail + 1)} 归零\n`)
}

// ③ 转头阶跃
{
  const target = 30 / DEG
  const s = new Spring({ ...PHYSICS.head, value: 0 })
  const st = stats(run(s, target))
  console.log('③ 转头阶跃 0° → 30°')
  console.log(`   峰值 ${(st.peak * DEG).toFixed(1)}°，过冲 ${((st.peak - target) * DEG).toFixed(1)}°`)
  console.log(`   首次到位 ${ms(st.peakAt)}，稳定 ${ms(st.settleAt)}`)
  // 撤回中立（手势/状态介入时目标变 0）
  const back = new Spring({ ...PHYSICS.head, value: target })
  const st2 = stats(run(back, 0))
  console.log(
    `   回中立过冲 ${((0 - st2.trough) * DEG).toFixed(1)}°，稳定 ${ms(st2.settleAt)}\n`,
  )
}

// ④ 自由落体（挂件侧像素积分，与 widget.js 的常量一致）
{
  const G = 2600
  const REST = 0.34
  const MIN_V = 70
  const MAX_BOUNCE = 2
  console.log('④ 拖拽落地（像素空间，g=2600、恢复系数 0.34、最多 2 次反弹）')
  console.log('   高度   首次落地   落地速度   第 1 次反弹   总时长')
  for (const drop of [120, 240, 480, 720]) {
    let y = 0
    let v = 0
    let t = 0
    let firstV = 0
    let firstT = 0
    let bounce = 0
    let apex = 0
    let bounces = 0
    let peakAfter = 0
    while (t < 3) {
      v += G * DT
      y += v * DT
      t += DT
      if (y >= drop) {
        y = drop
        if (!firstV) {
          firstV = v
          firstT = t
        }
        if (v > MIN_V && bounces < MAX_BOUNCE) {
          bounces += 1
          v = -v * REST
          bounce = 1
        } else {
          v = 0
          break
        }
      }
      if (bounce && v < 0) peakAfter = Math.max(peakAfter, drop - y)
    }
    void apex
    console.log(
      `   ${pad(drop, 4)}px  ${pad((firstT * 1000).toFixed(0), 6)} ms  ${pad(firstV.toFixed(0), 7)} px/s` +
        `  ${pad(peakAfter.toFixed(0), 9)} px  ${pad((t * 1000).toFixed(0), 6)} ms`,
    )
  }
}

// ⑤ 关闭物理时必须是 P1：弹簧不推进，压缩恒 0
{
  const s = new Spring({ ...PHYSICS.squash, value: 0 })
  s.impulse(PHYSICS.squash.impulse)
  s.reset(0)
  const v = s.step(0, DT)
  console.log(`\n⑤ physics=off：squash=${v}（必须 0）、settled=${s.settled}`)
}
