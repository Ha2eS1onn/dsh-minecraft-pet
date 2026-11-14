// 单帧耗时基准：把 buildParts + drawParts 循环 N 次，报中位数 / p95。
// plan.md §11.2 的预算是 < 6 ms（352×416，8 px/单位）。
// 用法：node tools/bench-frame.mjs [皮肤路径] [--frames=120]

import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { decodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts } from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'prototype', 'da-skin.png')
const frames = Number(process.argv.find((a) => a.startsWith('--frames='))?.slice(9) || 120)

const W = 352
const H = 416

const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))
const frame = createFrame(W, H)

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
}

function bench(label, poseOf) {
  const samples = []
  for (let i = 0; i < frames; i++) {
    const pose = poseOf(i / 60)
    const t0 = performance.now()
    clearFrame(frame)
    drawParts(frame, buildParts(pose, skin, { outer: true }), skin)
    samples.push(performance.now() - t0)
  }
  console.log(
    `${label.padEnd(26)} 中位 ${median(samples).toFixed(2)} ms   p95 ${p95(samples).toFixed(2)} ms   最大 ${Math.max(...samples).toFixed(2)} ms`,
  )
  return median(samples)
}

console.log(`${path.relative(root, skinPath)}  ${skin.width}×${skin.height}  画布 ${W}×${H}  ${frames} 帧`)
console.log(`识别格：${skin.eyes ? '有（会画眼皮薄片）' : '无（不画眼皮）'}`)

const base = defaultPose()
bench('idle 睁眼（无薄片）', () => ({ ...base, eyelid: 1 }))
bench('idle 闭眼（2 片薄片）', () => ({ ...base, eyelid: 0 }))
bench('idle 呼吸（eyelid 变化）', (t) => ({ ...base, eyelid: 1 - 0.5 + 0.5 * Math.cos(t * 2) }))
bench('working 坐姿 + 键盘', () => ({ ...base, sit: 1, body_pitch: -0.087 }))
