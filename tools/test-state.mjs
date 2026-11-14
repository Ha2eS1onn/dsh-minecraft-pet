// M2 自检：状态机规则 + 过渡插值不改变静止画面。
// 用法：node tools/test-state.mjs

import { decodePng, encodePng } from './png.mjs'
import fs from 'node:fs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { buildParts } from '../assets/skin-model.js'
import {
  PET_STATES,
  MIN_STAY_MS,
  TERMINAL_MS,
  IDLE_TIMEOUT_MS,
  TRANSITION_MS,
  blendPose,
  targetPose,
  PoseTransition,
  PetStateMachine,
} from '../assets/pet-state.js'

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

const fnv = (b) => {
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const skin = skinFromImage(decodePng(fs.readFileSync('assets/default-skin.png')))
const renderHash = (pose, outer = true) => {
  const f = createFrame(352, 416)
  clearFrame(f)
  drawParts(f, buildParts(pose, skin, { outer, armWidth: 4 }), skin)
  return fnv(toImageData(f))
}

const BASELINE = 'c2c43ab4'

// 1) 静止帧不能被状态机包装改变
check('targetPose(idle) 哈希 = 基线', renderHash(targetPose('idle')) === BASELINE, renderHash(targetPose('idle')))
check(
  'blendPose(idle,idle,0.5) 哈希 = 基线（四元数路径不引入偏差）',
  renderHash(blendPose(targetPose('idle'), targetPose('idle'), 0.5)) === BASELINE,
  renderHash(blendPose(targetPose('idle'), targetPose('idle'), 0.5)),
)

// 2) 六个状态各自出图，且互不相同
const hashes = {}
for (const s of PET_STATES) hashes[s] = renderHash(targetPose(s))
check('六态姿态互不相同', new Set(Object.values(hashes)).size === 6, JSON.stringify(hashes))

// 3) 状态机：最短停留
{
  const m = new PetStateMachine(0)
  check('idle → working（已停留 >300ms）', m.request('working', 400) === true, `state=${m.state}`)
  check('立刻再切 waiting（未满 300ms）被拒', m.request('waiting', 500) === false, `state=${m.state}`)
  check('满 300ms 后可切 waiting', m.request('waiting', 750) === true, `state=${m.state}`)
}

// 4) 状态机：不降级
{
  const m = new PetStateMachine(0)
  m.request('waiting', 400)
  check('waiting 时 request idle 被拒', m.request('idle', 900) === false, `state=${m.state}`)
  check('waiting 时 request thinking（低优先级）被拒', m.request('thinking', 900) === false, `state=${m.state}`)
}

// 5) 终结态锁定 3s 后自动回 idle
{
  const m = new PetStateMachine(0)
  m.request('done', 400)
  check('done 进入', m.state === 'done')
  check('done 期间 request error 被拒（锁定）', m.request('error', 1000) === false, `state=${m.state}`)
  m.tick(400 + TERMINAL_MS - 1)
  check('3s 前仍是 done', m.state === 'done', m.state)
  m.tick(400 + TERMINAL_MS + 1)
  check('3s 后自动回 idle', m.state === 'idle', m.state)
}

// 6) 30s 无事件兜底（working / waiting 豁免）
{
  const m = new PetStateMachine(0)
  m.request('thinking', 400)
  m.tick(400 + IDLE_TIMEOUT_MS + 1)
  check('thinking 30s 无事件回 idle', m.state === 'idle', m.state)

  const w = new PetStateMachine(0)
  w.request('working', 400)
  w.tick(400 + IDLE_TIMEOUT_MS + 1)
  check('working 豁免 30s 兜底', w.state === 'working', w.state)
}

// 7) 过渡：180ms 内是中间帧，结束后精确等于目标
{
  const m = new PetStateMachine(0)
  m.request('working', 400)
  const a = m.pose(400)
  const b = m.pose(400 + TRANSITION_MS / 2)
  const c = m.pose(400 + TRANSITION_MS)
  check('过渡起点 sit≈0', Math.abs(a.sit - 0) < 0.01, `sit=${a.sit}`)
  check('过渡中点 0 < sit < 1', b.sit > 0.05 && b.sit < 0.95, `sit=${b.sit.toFixed(3)}`)
  check('过渡结束后 sit = 1', Math.abs(c.sit - 1) < 1e-9, `sit=${c.sit}`)
  check('过渡中点既不是起也不是终', renderHash(b) !== renderHash(a) && renderHash(b) !== renderHash(c))
}

// 8) 过渡中途改目标不跳变（直接测 PoseTransition：状态机受最短停留限制，过渡早已结束）
{
  const tr = new PoseTransition(targetPose('idle'), 0)
  tr.setTarget(targetPose('working'), 100)
  const mid = tr.sample(100 + TRANSITION_MS / 2) // 过渡中点
  tr.setTarget(targetPose('waiting'), 100 + TRANSITION_MS / 2) // 此刻改目标
  const after = tr.sample(100 + TRANSITION_MS / 2 + 1) // 紧接着的下一帧
  const jump = Math.abs(after.sit - mid.sit) + Math.abs(after.body_pitch - mid.body_pitch)
  check('中途改目标：插值连续（不跳回起点）', jump < 0.05, `jump=${jump.toFixed(4)} sit=${after.sit.toFixed(3)}`)
  check('中途改目标：仍从当前姿态出发', Math.abs(after.sit - mid.sit) < 0.05, `sit ${mid.sit.toFixed(3)} → ${after.sit.toFixed(3)}`)
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
