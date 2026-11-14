// 分辨率对照：同一个皮肤、同一个显示尺寸，两种逻辑分辨率并排。
// 左 = 现状 176×208 放大 2 倍显示；右 = 352×416 原尺寸显示（采样点翻倍）。
// 用法：node tools/compare-res.mjs [皮肤路径] [输出路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { staticParts } from '../assets/skin-model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'assets', 'default-skin.png')
const outPath = process.argv[3] || path.join(root, 'prototype', 'compare-res.png')

const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))

function render(W, H) {
  const t0 = performance.now()
  const frame = createFrame(W, H)
  clearFrame(frame)
  drawParts(frame, staticParts(skin, { outer: true, armWidth: 4 }), skin)
  const rgba = toImageData(frame)
  return { rgba, frame, ms: performance.now() - t0 }
}

const lo = render(176, 208)
const hi = render(352, 416)
const hi2 = render(704, 832)

const DISPLAY_W = 352
const DISPLAY_H = 416
const GAP = 16
const TOTAL_W = DISPLAY_W * 3 + GAP * 2
const BG = [26, 26, 30, 255]

const out = new Uint8ClampedArray(TOTAL_W * DISPLAY_H * 4)
for (let i = 0; i < out.length; i += 4) out.set(BG, i)

function blitNearest(src, sw, sh, dx, dw, dh) {
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh))
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw))
      const si = (sy * sw + sx) * 4
      const a = src[si + 3]
      if (a === 0) continue
      const o = (y * TOTAL_W + (dx + x)) * 4
      const inv = 255 - a
      out[o] = (src[si] * a + BG[0] * inv) / 255
      out[o + 1] = (src[si + 1] * a + BG[1] * inv) / 255
      out[o + 2] = (src[si + 2] * a + BG[2] * inv) / 255
      out[o + 3] = 255
    }
  }
}

blitNearest(lo.rgba, 176, 208, 0, DISPLAY_W, DISPLAY_H)
blitNearest(hi.rgba, 352, 416, DISPLAY_W + GAP, DISPLAY_W, DISPLAY_H)
blitNearest(hi2.rgba, 704, 832, (DISPLAY_W + GAP) * 2, DISPLAY_W, DISPLAY_H)

fs.writeFileSync(outPath, encodePng(TOTAL_W, DISPLAY_H, out))
console.log(
  JSON.stringify(
    {
      canvas_176x208: { fill: lo.frame.bounds, ms: +lo.ms.toFixed(2) },
      canvas_352x416: { fill: hi.frame.bounds, ms: +hi.ms.toFixed(2) },
      canvas_704x832: { fill: hi2.frame.bounds, ms: +hi2.ms.toFixed(2) },
      out: path.relative(root, outPath),
      note: '三格显示尺寸相同（352×416），仅逻辑分辨率不同',
    },
    null,
    2,
  ),
)
