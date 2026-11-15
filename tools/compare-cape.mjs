// M5 验收图：无披风 / 站立 + 披风 / 坐姿 + 披风，三联并排。
// 用法：node tools/compare-cape.mjs  → prototype/m5-cape.png（1056×416）与 m5-cape-tex.png
//
// 披风贴图是**自造**的（斜条 + 边框 + 一块色标），不使用任何 Mojang 披风素材，
// 所以这张图可以入库当回归基线。要换真披风看观感时：
//   CAPE_PNG=path/to/cape.png node tools/compare-cape.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const W = 352
const H = 416

/** 64×32 自造披风：图案区画斜条 + 黄边，内衬区纯灰（好看清哪一面被采到）。 */
function makeCape() {
  const w = 64
  const h = 32
  const data = new Uint8ClampedArray(w * h * 4)
  const put = (x, y, r, g, b, a = 255) => {
    const i = (y * w + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }
  // 图案区 (1,1)..(11,17)
  for (let y = 1; y < 17; y++) {
    for (let x = 1; x < 11; x++) {
      const stripe = (x + y) % 4 < 2
      put(x, y, stripe ? 46 : 232, stripe ? 110 : 74, stripe ? 172 : 52)
    }
  }
  // 黄边（左右各 1 列、上下各 1 行）
  for (let y = 1; y < 17; y++) {
    put(1, y, 250, 210, 60)
    put(10, y, 250, 210, 60)
  }
  for (let x = 1; x < 11; x++) {
    put(x, 1, 250, 210, 60)
    put(x, 16, 250, 210, 60)
  }
  // 内衬区 (12,1)..(22,17)：纯灰，用来确认它不出现在画面上
  for (let y = 1; y < 17; y++) for (let x = 12; x < 22; x++) put(x, y, 120, 120, 120)
  return { width: w, height: h, data }
}

const skinImg = decodePng(fs.readFileSync(path.join(root, 'assets', 'default-skin.png')))
const skin = skinFromImage(skinImg)

const capeEnv = process.env.CAPE_PNG
const capeImg = capeEnv ? decodePng(fs.readFileSync(capeEnv)) : makeCape()
if (!capeEnv) fs.writeFileSync(path.join(root, 'prototype', 'm5-cape-tex.png'), encodePng(capeImg.width, capeImg.height, capeImg.data))
const capeTex = textureFromImage(capeImg)

function render(pose, cape) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, buildParts(pose, skin, { outer: true, armWidth: 4, cape }), skin)
  return toImageData(f)
}

const panels = [
  render(defaultPose(), null),
  render(defaultPose(), capeTex),
  render(targetPose('working'), capeTex),
]

// 三联拼图
const TW = W * panels.length
const sheet = new Uint8ClampedArray(TW * H * 4)
for (let p = 0; p < panels.length; p++) {
  const src = panels[p]
  for (let y = 0; y < H; y++) {
    const from = y * W * 4
    const to = (y * TW + p * W) * 4
    sheet.set(src.subarray(from, from + W * 4), to)
  }
}
fs.mkdirSync(path.join(root, 'prototype'), { recursive: true })
fs.writeFileSync(path.join(root, 'prototype', 'm5-cape.png'), encodePng(TW, H, sheet))

const count = (rgba, test) => {
  let n = 0
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 0 && test(rgba, i)) n++
  return n
}
const report = panels.map((p) => ({
  opaque: count(p, () => true),
  capePixels: count(p, (c, i) => c[i + 2] > 110 && c[i] < 120 && c[i + 1] > 50 && c[i + 1] < 150),
}))
console.log(
  JSON.stringify(
    {
      cape: capeEnv ? path.relative(root, capeEnv) : 'synthetic 64x32',
      panels: { bare: report[0], idleCape: report[1], sitCape: report[2] },
      out: 'prototype/m5-cape.png',
    },
    null,
    2,
  ),
)
