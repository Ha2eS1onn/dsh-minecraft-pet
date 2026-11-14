import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { decodePng } from './tools/png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts } from './assets/skin-render.js'
import { buildParts, defaultPose } from './assets/skin-model.js'
const skin = skinFromImage(decodePng(fs.readFileSync('prototype/da-skin.png')))
const W = 352, H = 416
const frame = createFrame(W, H)
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const buildT = [], drawT = []
const parts = buildParts({ ...defaultPose(), eyelid: 1 }, skin, { outer: true })
for (let i = 0; i < 120; i++) {
  let t = performance.now(); const p = buildParts({ ...defaultPose(), eyelid: 1 }, skin, { outer: true }); buildT.push(performance.now() - t)
  clearFrame(frame)
  t = performance.now(); drawParts(frame, p, skin); drawT.push(performance.now() - t)
}
console.log(`buildParts ${med(buildT).toFixed(2)} ms   drawParts ${med(drawT).toFixed(2)} ms   part 数 ${parts.length}`)
