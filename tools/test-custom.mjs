// 自定义姿态 / 键盘外观 / 视线中心偏移的自检。
// 重点守两件事：① 默认值下必须与改动前的基线逐像素一致；② 真的能改出东西（不是静默无效）。
// 用法：node tools/test-custom.mjs

import fs from 'node:fs'
import { decodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData, transformPoint } from '../assets/skin-render.js'
import { buildParts, defaultPose, customRig } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'
import { PetAnimator } from '../assets/pet-anim.js'
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
const renderHash = (parts) => {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, skin)
  return fnv(toImageData(f))
}
const build = (opts = {}, pose = defaultPose()) => buildParts(pose, skin, { outer: true, armWidth: 4, ...opts })
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const arrNear = (a, b, eps = 1e-6) => a.every((v, i) => near(v, b[i], eps))

// ---------------------------------------------------------------- 1. 默认零配置

check('customRig(null) 返回 null', customRig(null, 0) === null)
check('customRig(空 pose) 返回 null', customRig({ pose: {} }, 0) === null)
check('customRig 全零角度返回 null', customRig({ pose: { stand: { head: [0, 0, 0] }, sit: {} }, rot: { x: 0, y: 0, z: 0 } }, 0) === null)

const BASE = 'c2c43ab4'
check('基线哈希仍是 c2c43ab4', renderHash(build()) === BASE, renderHash(build()))
check('custom=null 时与基线逐像素一致', renderHash(build({ custom: null })) === BASE)
check(
  '全零 rig 时与基线逐像素一致',
  renderHash(build({ custom: customRig({ pose: { stand: { head: [0, 0, 0] } } }, 0) })) === BASE,
)
const baselineKb = build({}, poseSit()).find((p) => p.key === 'keyboard').transform
function poseSit() {
  return { ...defaultPose(), sit: 1 }
}

// ---------------------------------------------------------------- 2. 部位偏移确实生效

const armRig = customRig({ pose: { stand: { leftArm: [0, 0, 45] } } }, 0)
check('左臂 Z 45° 改变画面', renderHash(build({ custom: armRig })) !== BASE)
check('左臂偏移不影响键盘矩阵', arrNear(build({ custom: armRig }, poseSit()).find((p) => p.key === 'keyboard').transform, baselineKb))

const headRig = customRig({ pose: { stand: { head: [0, 30, 0] } } }, 0)
check('头部 Y 30° 改变画面', renderHash(build({ custom: headRig })) !== BASE)
check('头部偏移会带动装饰挂点（head 矩阵不同）', !arrNear(build({ custom: headRig }).find((p) => p.key === 'head').transform, build().find((p) => p.key === 'head').transform))

const legRig = customRig({ pose: { stand: { leftLeg: [25, 0, 0] } } }, 0)
check('左腿 X 25° 改变画面', renderHash(build({ custom: legRig })) !== BASE)

// ---------------------------------------------------------------- 3. 整体角度

const rotRig = customRig({ pose: {}, rot: { x: 0, y: 40, z: 0 } }, 0)
check('整体转向 40° 改变画面', renderHash(build({ custom: rotRig })) !== BASE)
check('整体旋转绕 y=15 为支点（中心点不动）', arrNear(transformPoint(rotRig.rot, [0, 15, 0]), [0, 15, 0], 1e-9))
check('整体旋转会带走键盘（手/键对位的前提）', !arrNear(build({ custom: rotRig }, poseSit()).find((p) => p.key === 'keyboard').transform, baselineKb))

// ---------------------------------------------------------------- 4. 站姿/坐姿混合

const standOnly = customRig({ pose: { stand: { head: [0, 0, 60] } } }, 0)
const sitOnly = customRig({ pose: { sit: { head: [0, 0, 20] } } }, 1)
const half = customRig({ pose: { stand: { head: [0, 0, 60] }, sit: { head: [0, 0, 20] } } }, 0.5)
check('站/坐各自生效', renderHash(build({ custom: standOnly })) !== BASE && renderHash(build({ custom: sitOnly }, poseSit())) !== BASE)
check('sit=0.5 时两套偏移中间态（不是任一端的旧值）', renderHash(build({ custom: half })) !== BASE && renderHash(build({ custom: half })) !== renderHash(build({ custom: standOnly })))
check('只给站姿时，sit=1 不残留（回到基线）', renderHash(build({ custom: customRig({ pose: { stand: { head: [0, 0, 90] } } }, 1) }, poseSit())) === renderHash(build({}, poseSit())))
const bodyOnly = customRig({ pose: { stand: { body: [0, 20, 0] } } }, 0)
check('躯干偏移会被动效层用于肩点补偿（_typing 不脱键）', (() => {
  const anim = new PetAnimator(0)
  const ctx = (rig) => ({ width: W, height: H, armWidth: 4, cursor: null, state: 'working', customRig: rig, settings: { breath: false, blink: false, physics: false } })
  const p1 = anim.update(targetPose('working'), ctx(null), 1, 1 / 60)
  const arms1 = JSON.stringify(p1.arms)
  const p2 = anim.update(targetPose('working'), ctx(bodyOnly), 1.2, 1 / 60)
  return JSON.stringify(p2.arms) !== arms1
})())

// ---------------------------------------------------------------- 5. 键盘样式与颜色

const detail = build({}, poseSit())
const simple = build({ keycaps: false }, poseSit())
check('细节样式 15 个键帽', detail.filter((p) => p.key === 'keycap').length === 15)
check('简洁样式不画键帽', simple.filter((p) => p.key === 'keycap').length === 0)
check('简洁样式仍保留键盘盒', simple.filter((p) => p.key === 'keyboard').length === 1)
check('默认键盘色为内置常量', arrNear(detail.find((p) => p.key === 'keyboard').solid, [0x83, 0x87, 0x8a]))
check('默认键帽色为内置常量', arrNear(detail.find((p) => p.key === 'keycap').solid, [102, 105, 108]))

const red = build({ keyboardColor: [255, 0, 0] }, poseSit())
check('自定义键盘色生效', arrNear(red.find((p) => p.key === 'keyboard').solid, [255, 0, 0]))
check('键帽自动取 0.78 暗一档', arrNear(red.find((p) => p.key === 'keycap').solid, [199, 0, 0]))

// ---------------------------------------------------------------- 6. 视线中心偏移

const anim = new PetAnimator(0)
const cursorCtx = (settings) => ({ width: W, height: H, armWidth: 4, cursor: { x: 300, y: 120 }, state: 'idle', settings: { ...settings } })
const yawOf = (settings) => {
  const a = new PetAnimator(0)
  // 多跑几帧让 trackW 收满
  let pose = null
  for (let i = 0; i < 30; i++) pose = a.update(targetPose('idle'), cursorCtx(settings), i / 60, 1 / 60)
  return pose.yaw
}
const baseYaw = yawOf({ breath: false, blink: false, physics: false })
const shiftYaw = yawOf({ breath: false, blink: false, physics: false, centerX: 20 })
check('中心偏移把头部朝向推正（yaw 增大）', shiftYaw > baseYaw + 0.05, `${baseYaw.toFixed(3)} → ${shiftYaw.toFixed(3)}`)
check('中心偏移为 0 时与不带该字段一致', near(yawOf({ breath: false, blink: false, physics: false, centerX: 0 }), baseYaw, 1e-9))

// 范围夹取：center 很大时被 range 卡住
const clamped = yawOf({ breath: false, blink: false, physics: false, centerX: 60, rangeX: 10 })
const FRONT = Math.atan2(30, 70)
check('中心偏移受转动范围约束', Math.abs(clamped - FRONT) <= (10 * Math.PI) / 180 + 1e-6, `${clamped.toFixed(3)}`)

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`)
process.exit(failed === 0 ? 0 : 1)
