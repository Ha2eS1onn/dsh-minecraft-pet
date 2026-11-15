// M5 自检：披风（plan.md §7.5）。
// 用法：node tools/test-cape.mjs
//
// 三条底线：
//   ① 不传披风时，静止帧必须还是 M0 基线（25928 px / c2c43ab4）——披风不能污染原有渲染
//   ② 传了披风，朝向相机的那一面必须采到官方图案区 (1,1)..(11,17)
//   ③ 背对相机的那一面（内衬区 12..22）不能被采到
//
// 用一张自造披风：只填图案区、其余全透明，所以「画面上出现品红」= 采对了区域。

import fs from 'node:fs'
import { decodePng } from './png.mjs'
import {
  createFrame,
  clearFrame,
  skinFromImage,
  textureFromImage,
  drawParts,
  toImageData,
} from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'

let failed = 0
let total = 0
const check = (name, ok, detail = '') => {
  total++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

const W = 352
const H = 416
const fnv = (b) => {
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const read = (p) => decodePng(fs.readFileSync(p))
const userSkin = skinFromImage(read('assets/default-skin.png'))

/** 官方披风图案区 (1,1)..(11,17) 涂成品红，其余全透明。 */
function magentaCape(w = 64) {
  return blockCape(w, 1, 11, [255, 0, 255])
}

/** 内衬区 (12,1)..(22,17) 涂成蓝色，图案区透明——用来证明背面没被采到。 */
function liningCape(w = 64) {
  return blockCape(w, 12, 22, [0, 0, 255])
}

function blockCape(w, x0, x1, rgb) {
  const h = w / 2
  const k = w / 64
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 1 * k; y < 17 * k; y++) {
    for (let x = x0 * k; x < x1 * k; x++) {
      const i = (y * w + x) * 4
      data[i] = rgb[0]
      data[i + 1] = rgb[1]
      data[i + 2] = rgb[2]
      data[i + 3] = 255
    }
  }
  return textureFromImage({ width: w, height: h, data })
}

const capeTex = magentaCape()

function render(parts, skin = userSkin) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, skin)
  const rgba = toImageData(f)
  let opaque = 0
  let magenta = 0
  let blue = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) opaque++
    // 品红/蓝经 6 面明暗 LUT 后色相不变，只压亮度
    if (rgba[i] > 90 && rgba[i + 2] > 90 && rgba[i + 1] < 80) magenta++
    if (rgba[i + 2] > 120 && rgba[i] < 80 && rgba[i + 1] < 80) blue++
  }
  return { hash: fnv(rgba), rgba, frame: f, opaque, magenta, blue }
}

const partsOf = (pose, opts = {}) => buildParts(pose, userSkin, { outer: true, armWidth: 4, ...opts })

// ---------------------------------------------------------------- 1) 无披风 = M0 基线
{
  const base = render(partsOf(defaultPose()))
  check('不传披风时没有 cape part', partsOf(defaultPose()).every((p) => p.key !== 'cape'))
  check('不传披风：静止帧仍是 M0 基线哈希', base.hash === 'c2c43ab4', base.hash)
  check('不传披风：不透明像素仍是 25928', base.opaque === 25928, String(base.opaque))
  check('不传披风：画面里没有品红', base.magenta === 0, String(base.magenta))
  const nullCape = render(partsOf(defaultPose(), { cape: null }))
  check('显式传 null 与不传逐像素一致', nullCape.hash === base.hash)
}

// ---------------------------------------------------------------- 2) part 结构与 UV 推导
{
  const parts = partsOf(defaultPose(), { cape: capeTex })
  const cape = parts.find((p) => p.key === 'cape')
  check('存在 cape part', !!cape)
  check('尺寸 10×16×1', cape && String(cape.size) === '10,16,1', cape && String(cape.size))
  check('UV 起点 0,0（图案给朝向相机那面）', cape && cape.uv[0] === 0 && cape.uv[1] === 0, cape && String(cape.uv))
  check('纹理挂在 part.texture 上', cape && cape.texture === capeTex)
  check('披风不吃外层膨胀', cape && cape.inflate === 0 && cape.mirror === false)
  // +Z 面区域公式：(u + d, v + d) = (0 + 1, 0 + 1) = (1,1)，即官方图案区
  const u = cape.uv[0]
  const d = cape.size[2]
  const w = cape.size[0]
  check('+Z 面落在官方图案区 (1,1)', u + d === 1 && cape.uv[1] + d === 1, `${u + d},${cape.uv[1] + d}`)
  check('-Z 面落在内衬区 (12,1)', u + 2 * d + w === 12 && cape.uv[1] + d === 1, `${u + 2 * d + w},${cape.uv[1] + d}`)
  check('±X 落在两侧边条', u + d + w === 11 && u === 0)
}

// ---------------------------------------------------------------- 3) 画出来了
{
  const base = render(partsOf(defaultPose()))
  const withCape = render(partsOf(defaultPose(), { cape: capeTex }))
  check('披风改变画面', withCape.hash !== base.hash)
  check('披风增加了不透明像素', withCape.opaque > base.opaque, `${base.opaque} → ${withCape.opaque}`)
  check('画面出现品红（采到了图案区）', withCape.magenta >= 100, String(withCape.magenta))
  check('披风不越出画布下沿', withCape.frame.bounds[3] <= H)

  // 反证：把图案换成内衬区，画面必须一点蓝都不多出来（那一面背对相机）
  // 注意 base 自身就有 54 个蓝色像素（皮肤画的衣服），所以比增量而不是比 0
  const lining = render(partsOf(defaultPose(), { cape: liningCape() }))
  check('内衬区（-Z）没有被采到', lining.blue === base.blue, `${base.blue} → ${lining.blue}`)
  check('只有内衬时披风不可见', lining.opaque === base.opaque && lining.hash === base.hash, `${base.opaque} vs ${lining.opaque}`)
}

// ---------------------------------------------------------------- 4) 跟着躯干走
{
  const straight = render(partsOf(defaultPose(), { cape: capeTex }))
  const twisted = defaultPose()
  twisted.body_yaw = 0.5
  const turned = render(partsOf(twisted, { cape: capeTex }))
  check('body_yaw 改变 → 披风跟着转', turned.hash !== straight.hash)
  const leaned = defaultPose()
  leaned.body_pitch = 0.2
  check('body_pitch 改变 → 披风跟着前倾', render(partsOf(leaned, { cape: capeTex })).hash !== straight.hash)
  const sunk = { ...defaultPose(), sink: -0.8 }
  check('整体下沉 → 披风跟着沉', render(partsOf(sunk, { cape: capeTex })).hash !== straight.hash)
}

// ---------------------------------------------------------------- 5) 六态下都能画（含坐姿键盘）
{
  for (const state of ['idle', 'thinking', 'working', 'waiting', 'done', 'error']) {
    const pose = targetPose(state)
    const noCape = render(partsOf(pose))
    const shot = render(partsOf(pose, { cape: capeTex }))
    check(`${state}：披风可见且不崩`, shot.magenta > 0 && shot.hash !== noCape.hash, `magenta=${shot.magenta}`)
  }
  const sit = targetPose('working')
  const parts = partsOf(sit, { cape: capeTex })
  check('坐姿：披风与键盘同时存在', !!parts.find((p) => p.key === 'cape') && !!parts.find((p) => p.key === 'keyboard'))
}

// ---------------------------------------------------------------- 6) 换皮肤不影响披风纹理
{
  const w = 64
  const h = 64
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 40
    data[i + 1] = 160
    data[i + 2] = 40
    data[i + 3] = 255
  }
  const greenSkin = skinFromImage({ width: w, height: h, data })
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, buildParts(defaultPose(), greenSkin, { cape: capeTex }), greenSkin)
  const rgba = toImageData(f)
  let magenta = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] > 90 && rgba[i + 2] > 90 && rgba[i + 1] < 80) magenta++
  }
  check('披风用披风纹理，不是皮肤纹理', magenta > 0, String(magenta))
}

// ---------------------------------------------------------------- 7) HD 披风（128×64）
{
  const hd = magentaCape(128)
  const shot = render(partsOf(defaultPose(), { cape: hd }))
  check('HD 128×64 披风同样采对区域', shot.magenta > 0, String(shot.magenta))
  const sd = render(partsOf(defaultPose(), { cape: capeTex }))
  // 分辨率不同、覆盖的贴图像素一样多 → 品红像素数应接近（同一块矩形贴图）
  check('HD 与 64 宽披风覆盖面接近', Math.abs(shot.magenta - sd.magenta) <= Math.max(6, sd.magenta * 0.1), `${sd.magenta} vs ${shot.magenta}`)
}

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}  (${total - failed} ok / ${failed} fail)`)
process.exit(failed === 0 ? 0 : 1)
