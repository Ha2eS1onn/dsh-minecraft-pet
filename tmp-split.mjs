import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { decodePng } from './tools/png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from './assets/skin-render.js'
import { buildParts, defaultPose } from './assets/skin-model.js'
const skin = skinFromImage(decodePng(fs.readFileSync('prototype/da-skin.png')))
const W = 352, H = 416
const frame = createFrame(W, H)
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const clearT = [], drawT = [], imgT = []
for (let i = 0; i < 120; i++) {
  let t = performance.now(); clearFrame(frame); clearT.push(performance.now() - t)
  const parts = buildParts({ ...defaultPose(), eyelid: 1 }, skin, { outer: true })
  t = performance.now(); drawParts(frame, parts, skin); drawT.push(performance.now() - t)
  t = performance.now(); toImageData(frame); imgT.push(performance.now() - t)
}
console.log(`clearFrame  ${med(clearT).toFixed(2)} ms`)
console.log(`drawParts   ${med(drawT).toFixed(2)} ms`)
console.log(`toImageData ${med(imgT).toFixed(2)} ms`)
console.log(`合计        ${(med(clearT) + med(drawT) + med(imgT)).toFixed(2)} ms`)
