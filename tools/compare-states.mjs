// M2 六态姿态对照图 + 过渡序列图。
// 用法：node tools/compare-states.mjs [皮肤路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { buildParts } from '../assets/skin-model.js'
import { PET_STATES, targetPose, PetStateMachine, TRANSITION_MS } from '../assets/pet-state.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'assets', 'default-skin.png')
const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))

const W = 352
const H = 416
const BG = [26, 26, 30]

function renderTo(pose) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, buildParts(pose, skin, { outer: true, armWidth: 4 }), skin)
  return { rgba: toImageData(f), bounds: f.bounds }
}

function sheet(items, outPath, gap = 11) {
  const totalW = W * items.length + gap * (items.length - 1)
  const out = new Uint8ClampedArray(totalW * H * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = BG[0]
    out[i + 1] = BG[1]
    out[i + 2] = BG[2]
    out[i + 3] = 255
  }
  items.forEach((item, idx) => {
    const dx = idx * (W + gap)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4
        const a = item.rgba[si + 3]
        if (a === 0) continue
        const o = (y * totalW + dx + x) * 4
        const inv = 255 - a
        out[o] = (item.rgba[si] * a + BG[0] * inv) / 255
        out[o + 1] = (item.rgba[si + 1] * a + BG[1] * inv) / 255
        out[o + 2] = (item.rgba[si + 2] * a + BG[2] * inv) / 255
        out[o + 3] = 255
      }
    }
  })
  fs.writeFileSync(outPath, encodePng(totalW, H, out))
  return totalW
}

// 六态
const states = PET_STATES.map((name) => {
  const shot = renderTo(targetPose(name))
  console.log(`${name.padEnd(9)} bounds=${JSON.stringify(shot.bounds)}`)
  return shot
})
const w1 = sheet(states, path.join(root, 'prototype', 'm2-states.png'))
console.log(`\nwrote prototype/m2-states.png (${w1}×${H})  idle|thinking|working|waiting|done|error`)

// 过渡序列：idle → working，采样 0/45/90/135/180ms
{
  const m = new PetStateMachine(0)
  m.request('working', 400)
  const frames = [0, 0.25, 0.5, 0.75, 1].map((f) => renderTo(m.pose(400 + TRANSITION_MS * f)))
  const w2 = sheet(frames, path.join(root, 'prototype', 'm2-transition.png'), 8)
  console.log(`wrote prototype/m2-transition.png (${w2}×${H})  idle→working @ 0/45/90/135/180ms`)
}

// 过渡序列：working → done（跨越坐姿回到站姿）
{
  const m = new PetStateMachine(0)
  m.request('working', 400)
  m.tick(400 + TRANSITION_MS)
  m.request('done', 800)
  const frames = [0, 0.33, 0.66, 1].map((f) => renderTo(m.pose(800 + TRANSITION_MS * f)))
  const w3 = sheet(frames, path.join(root, 'prototype', 'm2-transition-done.png'), 8)
  console.log(`wrote prototype/m2-transition-done.png (${w3}×${H})  working→done @ 0/60/120/180ms`)
}
