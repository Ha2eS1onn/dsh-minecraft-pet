// 打字过渡对照图：press 之后的逐帧手臂位置，裁剪放大后横排，用来判断是否「一帧到位」。
// 用法：node tools/compare-typing.mjs [皮肤路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { buildParts } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'
import { PetAnimator, DEFAULT_ANIM } from '../assets/pet-anim.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'assets', 'default-skin.png')
const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))

const W = 352
const H = 416
const BG = [26, 26, 30]
const GAP = 6
const ZOOM = 3
/** 采样 press 之后的第几帧（1-based）。 */
const PICKS = [1, 2, 3, 5, 7, 8]

function renderTo(pose) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, buildParts(pose, skin, { outer: true, armWidth: 4 }), skin)
  return toImageData(f)
}

const anim = new PetAnimator(0)
const sit = targetPose('working')
const ctx = {
  width: W,
  height: H,
  armWidth: 4,
  settings: { ...DEFAULT_ANIM, breath: false, track: false, typing: true },
}
const step = 1 / 60
let t = 0
const entries = []
const advance = (n) => {
  for (let i = 0; i < n; i++) {
    t += step
    entries.push({ pose: anim.update(sit, ctx, t, step), w: anim.pressW[1] })
  }
}

advance(30)
const hoverEntry = entries[entries.length - 1]
const base = entries.length // press 之后的帧从这里开始
anim.press(t)
advance(PICKS[PICKS.length - 1])
const frameAt = (n) => entries[base + n - 1]

const hover = renderTo(hoverEntry.pose)
const pressed = renderTo(frameAt(PICKS[PICKS.length - 1]).pose)

// 用「悬停 vs 按下」的差异包围盒决定裁剪范围，避免手算屏幕坐标
let minX = W
let minY = H
let maxX = -1
let maxY = -1
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const d =
      Math.abs(hover[i] - pressed[i]) +
      Math.abs(hover[i + 1] - pressed[i + 1]) +
      Math.abs(hover[i + 2] - pressed[i + 2]) +
      Math.abs(hover[i + 3] - pressed[i + 3])
    if (d > 8) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}
const pad = 10
minX = Math.max(0, minX - pad)
minY = Math.max(0, minY - pad)
maxX = Math.min(W - 1, maxX + pad)
maxY = Math.min(H - 1, maxY + pad)
const cw = maxX - minX + 1
const ch = maxY - minY + 1

const cells = [hover, ...PICKS.map((n) => renderTo(frameAt(n).pose))]
const cellW = cw * ZOOM
const cellH = ch * ZOOM
const outW = cells.length * cellW + (cells.length - 1) * GAP
const out = new Uint8ClampedArray(outW * cellH * 4)
for (let i = 0; i < out.length; i += 4) {
  out[i] = BG[0]
  out[i + 1] = BG[1]
  out[i + 2] = BG[2]
  out[i + 3] = 255
}
cells.forEach((img, idx) => {
  const dx = idx * (cellW + GAP)
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((minY + y) * W + minX + x) * 4
      const a = img[si + 3]
      const inv = 255 - a
      for (let ry = 0; ry < ZOOM; ry++) {
        for (let rx = 0; rx < ZOOM; rx++) {
          const o = ((y * ZOOM + ry) * outW + dx + x * ZOOM + rx) * 4
          out[o] = (img[si] * a + BG[0] * inv) / 255
          out[o + 1] = (img[si + 1] * a + BG[1] * inv) / 255
          out[o + 2] = (img[si + 2] * a + BG[2] * inv) / 255
          out[o + 3] = 255
        }
      }
    }
  }
})

const file = path.join(root, 'prototype', 'm3-typing-transition.png')
fs.writeFileSync(file, encodePng(outW, cellH, out))
console.log(`crop x=${minX}..${maxX} y=${minY}..${maxY}  zoom=${ZOOM}  gap=${GAP}`)
for (const n of PICKS) console.log(`press +${n} 帧 (${((n / 60) * 1000).toFixed(0)}ms)  w=${frameAt(n).w.toFixed(3)}`)
console.log(`\nwrote prototype/m3-typing-transition.png (${outW}×${cellH})  悬停 | ${PICKS.map((n) => `+${n}`).join(' | ')}`)
