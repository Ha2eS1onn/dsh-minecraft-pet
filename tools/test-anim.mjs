// M3 动效自检：呼吸 / 眨眼 / 头跟随 / 打字，以及「全关时不影响静止画面」。
// 用法：node tools/test-anim.mjs

import fs from 'node:fs'
import { decodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData, project, transformPoint } from '../assets/skin-render.js'
import { buildParts, torsoSpace } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'
import { PetAnimator, blinkClosure, PRESS_SECONDS } from '../assets/pet-anim.js'
import * as Q from '../assets/quat.js'

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

const W = 352
const H = 416
const skin = skinFromImage(decodePng(fs.readFileSync('assets/default-skin.png')))
const fnv = (b) => {
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
const renderHash = (pose) => {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, buildParts(pose, skin, { outer: true, armWidth: 4 }), skin)
  return fnv(toImageData(f))
}

const OFF = { breath: false, track: false, typing: false, blink: false }
/** cursor 必须放 ctx 顶层（动效层读的是 ctx.cursor）。 */
const ctx = (extra = {}, cursor = null) => ({
  width: W,
  height: H,
  armWidth: 4,
  cursor,
  settings: { ...OFF, ...extra },
})

const dotAngle = (a, b) =>
  Math.abs(2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))))
const quatDist = (a, b) => a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0)

/** 与 pet-anim.js 内部一致的摄像机朝向。 */
const CAM_VIEW = Q.multiply(Q.rotY(Math.atan2(30, 70)), Q.rotX(-Math.atan(23 / Math.hypot(30, 70))))

// 1) 全关 + 无光标：不能改变静止画面
{
  const anim = new PetAnimator(0)
  const pose = anim.update(targetPose('idle'), ctx(), 0, 1 / 60)
  check('动效全关时 idle 哈希 = 基线', renderHash(pose) === 'c2c43ab4', renderHash(pose))
}

// 2) 呼吸
{
  const anim = new PetAnimator(0)
  let pose
  for (let i = 0; i < 120; i++) pose = anim.update(targetPose('idle'), ctx({ breath: true }), i / 60, 1 / 60)
  check('呼吸权重接近 1', anim.breath > 0.9, anim.breath.toFixed(3))
  check('breathing_bob 在 ±0.1 内', Math.abs(pose.breathing_bob) <= 0.1001, pose.breathing_bob.toFixed(4))

  // 覆盖 4 秒（sin 周期 3.7s），才能看出周期性
  const bobs = []
  for (let i = 0; i < 240; i++) {
    bobs.push(anim.update(targetPose('idle'), ctx({ breath: true }), i / 60, 1 / 60).breathing_bob)
  }
  check(
    '呼吸是周期变化（不是常量）',
    Math.max(...bobs) - Math.min(...bobs) > 0.15,
    `${Math.min(...bobs).toFixed(3)}~${Math.max(...bobs).toFixed(3)}`,
  )

  let off
  for (let i = 0; i < 240; i++) off = anim.update(targetPose('idle'), ctx({ breath: false }), 5 + i / 60, 1 / 60)
  check('关闭后权重衰减到 0', anim.breath === 0, anim.breath)
  check('关闭后呼吸起伏归零', off.breathing_bob === 0, off.breathing_bob)
  check('开启/关闭后仍不改变静止画面', renderHash(off) === 'c2c43ab4')
}

// 3) 头部跟随
{
  const anim = new PetAnimator(0)
  // 2026-11-14：头部跟随改成有条件 + 渐入（只有 idle、无待机手势才跟），
  // 采样前先跑 20 帧让 trackW 收敛到 1，否则单帧采样量到的是 12% 的权重。
  const at = (x, y) => {
    let p = anim.update(targetPose('idle'), ctx({ track: true }, { x, y }), 0, 1 / 60)
    for (let i = 0; i < 20; i += 1) p = anim.update(targetPose('idle'), ctx({ track: true }, { x, y }), 0, 1 / 60)
    return p
  }
  // 脖子投影点：光标放这里才是「正对摄像机」；画布中心在它下方，会低头看
  const neutral = (() => {
    const neck = transformPoint(torsoSpace(targetPose('idle')), [0, 12, 0])
    const ahead = Q.rotate(CAM_VIEW, [0, 3, 0])
    const pt = project([neck[0] + ahead[0], neck[1] + ahead[1], neck[2] + ahead[2]], W, H)
    return { x: pt[0], y: pt[1] }
  })()
  const center = at(neutral.x, neutral.y)
  const right = at(W * 0.95, neutral.y)
  const left = at(W * 0.05, neutral.y)
  const up = at(neutral.x, neutral.y - 120)
  const down = at(neutral.x, neutral.y + 120)

  check(
    '光标在脖子投影点时头正对摄像机（= front_yaw 23.2°，不是 identity）',
    dotAngle(center.head_rotation, CAM_VIEW) < 0.05,
    `与摄像机朝向差 ${dotAngle(center.head_rotation, CAM_VIEW).toFixed(4)} rad`,
  )
  check(
    '脖子投影点在画布中心上方（所以光标居中时是低头）',
    neutral.y < H / 2,
    `neck.y=${neutral.y.toFixed(1)} vs 画布中心 ${H / 2}`,
  )

  check(
    '光标左右朝向相反',
    dotAngle(right.head_rotation, left.head_rotation) > 0.3,
    dotAngle(right.head_rotation, left.head_rotation).toFixed(3),
  )
  check('光标右移后 yaw 增大（看向 +X 侧）', right.yaw > center.yaw, `${right.yaw.toFixed(3)} vs ${center.yaw.toFixed(3)}`)
  check('光标上移与下移朝向不同', dotAngle(up.head_rotation, down.head_rotation) > 0.2, dotAngle(up.head_rotation, down.head_rotation).toFixed(3))
  check('跟随改变了画面', renderHash(right) !== renderHash(center))
  check('无光标时不跟随', renderHash(anim.update(targetPose('idle'), ctx({ track: true }), 0, 1 / 60)) === 'c2c43ab4')

  // 待机手势：所有角度回正，结束后恢复（2026-11-14 用户要求）
  {
    const steady = at(W * 0.95, neutral.y)
    anim.gestures.trigger('tilt', 0)
    let t = 0.2
    let during = steady
    for (let i = 0; i < 60; i += 1) {
      during = anim.update(targetPose('idle'), ctx({ track: true }, { x: W * 0.95, y: neutral.y }), t, 1 / 60)
      t += 1 / 60
    }
    // 回正的判据是「跟随权重归零」而不是 head_rotation === identity：
    // tilt 本身就会歪头（那 0.3 rad 是手势动作，不是跟随残留）。
    check('手势进行中跟随权重归零（角度回正）', anim.trackW === 0, `trackW=${anim.trackW.toFixed(4)}`)
    // tilt 时长 2.4s + 回位 0.16s，再跑 4 秒必然结束后回到跟随
    for (let i = 0; i < 240; i += 1) {
      during = anim.update(targetPose('idle'), ctx({ track: true }, { x: W * 0.95, y: neutral.y }), t, 1 / 60)
      t += 1 / 60
    }
    const back = dotAngle(during.head_rotation, steady.head_rotation)
    check('手势结束后跟随角恢复', back < 0.15, `与手势前差 ${back.toFixed(3)} rad`)
  }
}

// 4) 打字（MDP 结构：按键事件驱动、按压 0.15s、无按键时双手悬停）
//    2026-11-14 起按压/抬起两端补过渡，禁止一帧到位，故这里逐帧推进采样
{
  const anim = new PetAnimator(0)
  const sit = targetPose('working')
  const step = 1 / 60
  let t = 0
  const frames = []
  const advance = (n) => {
    for (let i = 0; i < n; i++) {
      t += step
      frames.push(anim.update(sit, ctx({ typing: true }), t, step))
    }
  }

  advance(30) // 0 → 0.5s，无按键
  const hover = frames[frames.length - 1]
  check(
    '没有按键时双手悬停不动（MDP 默认）',
    quatDist(frames[0].arms[0], hover.arms[0]) < 1e-9 && quatDist(frames[0].arms[1], hover.arms[1]) < 1e-9,
  )

  // MDP 的 counter：counter%2===0 时取 side 1，故第一次按键落在右手
  anim.press(t)
  const pressStart = frames.length
  // 采样窗口按 PRESS_SECONDS 算（0.15s 时代是 8 帧；0.08s 时 4 帧），
  // 取 85% 的窗口避开 until 边界那一帧的浮点撞线。
  const pressFrames = Math.max(3, Math.round((PRESS_SECONDS * 0.85) / step))
  advance(pressFrames)
  const pressed = frames[frames.length - 1]
  const travel = quatDist(hover.arms[1], pressed.arms[1])
  check('press() 压下右手', travel > 1e-3, travel.toFixed(4))
  check('press() 不影响另一只手', quatDist(hover.arms[0], pressed.arms[0]) < 1e-9)

  // --- 按下过渡：不是一帧到位 ---
  const tripped = frames.slice(pressStart).map((f) => quatDist(hover.arms[1], f.arms[1]))
  const at90 = tripped.findIndex((v) => v >= travel * 0.9)
  check(
    '按下不是瞬移：首帧只走不到一半行程',
    tripped[0] > 1e-4 && tripped[0] < travel * 0.5,
    `首帧 ${tripped[0].toFixed(4)} / 行程 ${travel.toFixed(4)}`,
  )
  check(
    '按下不是瞬移：走完 90% 行程至少跨 3 帧（窗口缩短到 0.08s，采样只有 4 帧）',
    at90 >= 2,
    `第 ${at90 + 1} 帧才到 90%`,
  )
  check('按压过程单调推进（无抖动）', tripped.every((v, i) => i === 0 || v >= tripped[i - 1] - 1e-12))
  check('按压采样末行程到 0.85 以上', anim.pressW[1] > 0.85, anim.pressW[1].toFixed(3))

  // --- 抬起过渡：同样不是一帧归位 ---
  advance(2)
  const rise = quatDist(hover.arms[1], frames[frames.length - 1].arms[1])
  check('抬起不是瞬移：2 帧后仍在回落途中', rise > travel * 0.2, `剩 ${((rise / travel) * 100).toFixed(0)}%`)

  advance(30) // 再 0.5s
  check('抬起后回到悬停（逐位相同）', quatDist(hover.arms[1], frames[frames.length - 1].arms[1]) < 1e-9)

  let maxJump = 0
  for (let i = 1; i < frames.length; i++) {
    maxJump = Math.max(maxJump, quatDist(frames[i - 1].arms[1], frames[i].arms[1]))
  }
  check('全程无瞬移（单帧吃掉不到半程）', maxJump < travel * 0.5, maxJump.toFixed(4))

  // 第二次按键换手
  anim.press(t)
  advance(3)
  check(
    '第二次按键换到左手（counter 交替）',
    quatDist(hover.arms[0], frames[frames.length - 1].arms[0]) > 1e-3,
  )

  // 指定手（precise 模式 / 真实键位）
  const precise = new PetAnimator(0)
  precise.press(0, [-2.5, -0.4], 0)
  const pFrame = precise.update(sit, ctx({ typing: true }), step, step)
  check('可指定手与键位偏移', quatDist(hover.arms[0], pFrame.arms[0]) > 1e-3)

  const standAnim = new PetAnimator(0)
  const standPose = standAnim.update(targetPose('idle'), ctx({ typing: true }), 0, 1 / 60)
  check('站立时不触发打字（sit=0）', renderHash(standPose) === 'c2c43ab4', renderHash(standPose))
}

// 5) 眨眼
{
  check(
    'blinkClosure 恒在 0..1',
    (() => {
      for (let u = 0; u < 200; u += 0.01) {
        const c = blinkClosure(u)
        if (c < -1e-9 || c > 1 + 1e-9) return false
      }
      return true
    })(),
  )

  // 闭眼窗口：MDP 注释说「短促（约 0.2s）、间隔不规则」
  const runs = []
  let inRun = false
  let start = 0
  for (let u = 0; u < 200; u += 0.005) {
    const c = blinkClosure(u)
    if (c > 0.02 && !inRun) {
      inRun = true
      start = u
    } else if (c <= 0.02 && inRun) {
      inRun = false
      runs.push([start, u])
    }
  }
  check('会周期性地闭眼', runs.length > 5, `${runs.length} 段 / 200 rad`)
  const durations = runs.map(([a, b]) => b - a)
  check('每次闭眼短促（< 1 rad ≈ 0.4s）', Math.max(...durations) < 1, Math.max(...durations).toFixed(2))
  const gaps = runs.slice(1).map((r, i) => r[0] - runs[i][1])
  check('间隔不规则（不是固定周期）', new Set(gaps.map((g) => g.toFixed(1))).size > 1, gaps.slice(0, 6).map((g) => g.toFixed(1)).join(','))

  // 采样 20 秒，必然碰到至少一次闭眼
  const anim = new PetAnimator(0, { seed: 0.3 })
  const lids = []
  for (let i = 0; i < 1200; i++) lids.push(anim.update(targetPose('idle'), ctx({ blink: true }), i / 60, 1 / 60).eyelid)
  check('眨眼开启后 eyelid 会变化', Math.max(...lids) - Math.min(...lids) > 0.5, `${Math.min(...lids).toFixed(2)}~${Math.max(...lids).toFixed(2)}`)
  check('eyelid 恒在 0..1', lids.every((v) => v >= 0 && v <= 1))
  const closed = lids.filter((v) => v < 0.5).length
  check('闭眼占比很小（< 5%）', closed / lids.length < 0.05, `${((closed / lids.length) * 100).toFixed(2)}%`)

  const offAnim = new PetAnimator(0, { seed: 0.3 })
  const offLids = []
  for (let i = 0; i < 300; i++) offLids.push(offAnim.update(targetPose('idle'), ctx({ blink: false }), i / 60, 1 / 60).eyelid)
  check('眨眼关闭时 eyelid 恒为 1', offLids.every((v) => v === 1))
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
