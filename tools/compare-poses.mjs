// M1 摆位对照：站 / 坐 / 蹲 / 举臂 / 歪头，并排成一张图。
// 用法：node tools/compare-poses.mjs [皮肤路径] [输出路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { buildParts } from '../assets/skin-model.js'
import { makePose } from './pose-presets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'assets', 'default-skin.png')
const outPath = process.argv[3] || path.join(root, 'prototype', 'compare-poses.png')

const W = 352
const H = 416
const GAP = 12
const BG = [26, 26, 30, 255]
const LIST = ['stand', 'sit', 'arm', 'arms-up', 'tilt']

const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))

function render(name) {
  const frame = createFrame(W, H)
  clearFrame(frame)
  drawParts(frame, buildParts(makePose(name), skin, { outer: true, armWidth: 4 }), skin)
  return { rgba: toImageData(frame), bounds: frame.bounds }
}

const shots = LIST.map((name) => ({ name, ...render(name) }))

const totalW = W * shots.length + GAP * (shots.length - 1)
const out = new Uint8ClampedArray(totalW * H * 4)
for (let i = 0; i < out.length; i += 4) out.set(BG, i)

shots.forEach((shot, idx) => {
  const dx = idx * (W + GAP)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4
      const a = shot.rgba[si + 3]
      if (a === 0) continue
      const o = (y * totalW + dx + x) * 4
      const inv = 255 - a
      out[o] = (shot.rgba[si] * a + BG[0] * inv) / 255
      out[o + 1] = (shot.rgba[si + 1] * a + BG[1] * inv) / 255
      out[o + 2] = (shot.rgba[si + 2] * a + BG[2] * inv) / 255
      out[o + 3] = 255
    }
  }
})

fs.writeFileSync(outPath, encodePng(totalW, H, out))
for (const s of shots) {
  console.log(
    `${s.name.padEnd(9)} bounds=[${s.bounds.join(',')}]  高=${s.bounds[3] - s.bounds[1]}px  宽=${s.bounds[2] - s.bounds[0]}px`,
  )
}
console.log(`\nwrote ${path.relative(root, outPath)} (${totalW}×${H})`)
