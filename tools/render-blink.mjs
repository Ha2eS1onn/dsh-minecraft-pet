// 眨眼验收图：跑识别格检测 → 打三帧（睁 / 半 / 闭），自动裁到脸部差异区放大。
// 用法：node tools/render-blink.mjs [皮肤路径] [输出路径]
// 默认素材是 prototype/da-skin.png（用户提供的 DA 识别格皮肤）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'prototype', 'da-skin.png')
const outPath = process.argv[3] || path.join(root, 'prototype', 'blink-check.png')

const W = 352
const H = 416

const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))
if (!skin.eyes) {
  console.log(`识别格：未检测到 —— ${path.relative(root, skinPath)} 不眨眼（预期行为）`)
  process.exit(0)
}
console.log(
  `识别格：right x${skin.eyes.right.x0}..${skin.eyes.right.x1} y${skin.eyes.right.y0} h${skin.eyes.right.rows} lid=${JSON.stringify(skin.eyes.right.lid)}`,
)

const shot = (eyelid) => {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, buildParts({ ...defaultPose(), eyelid }, skin, { outer: true }), skin)
  return toImageData(f)
}

const lids = [1, 0.55, 0]
const frames = lids.map(shot)

const diff = (a, b) => {
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      if (d > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return [x0, y0, x1, y1]
}

const [dx0, dy0, dx1, dy1] = diff(frames[0], frames[2])
if (dx1 < 0) {
  console.log('睁眼与闭眼渲染完全一致 —— 眼皮薄片没画出来')
  process.exit(1)
}
console.log(`睁闭差异区：x${dx0}..${dx1} y${dy0}..${dy1}`)

const pad = 28
const x0 = Math.max(0, dx0 - pad)
const y0 = Math.max(0, dy0 - pad)
const x1 = Math.min(W - 1, dx1 + pad)
const y1 = Math.min(H - 1, dy1 + pad)
const cw = x1 - x0 + 1
const ch = y1 - y0 + 1
const zoom = 6
const gap = 8

const outW = cw * zoom * frames.length + gap * (frames.length + 1)
const outH = ch * zoom + gap * 2
const out = new Uint8ClampedArray(outW * outH * 4)
for (let i = 0; i < out.length; i += 4) {
  out[i] = 26
  out[i + 1] = 26
  out[i + 2] = 30
  out[i + 3] = 255
}
frames.forEach((rgba, n) => {
  const ox = gap + n * (cw * zoom + gap)
  const oy = gap
  for (let y = 0; y < ch * zoom; y++) {
    for (let x = 0; x < cw * zoom; x++) {
      const sx = x0 + Math.floor(x / zoom)
      const sy = y0 + Math.floor(y / zoom)
      const si = (sy * W + sx) * 4
      const a = rgba[si + 3] / 255
      const o = ((oy + y) * outW + ox + x) * 4
      out[o] = rgba[si] * a + out[o] * (1 - a)
      out[o + 1] = rgba[si + 1] * a + out[o + 1] * (1 - a)
      out[o + 2] = rgba[si + 2] * a + out[o + 2] * (1 - a)
      out[o + 3] = 255
    }
  }
})
fs.writeFileSync(outPath, encodePng(outW, outH, out))
console.log(`wrote ${path.relative(root, outPath)} (${outW}×${outH})  eyelid=${lids.join(' / ')}`)
