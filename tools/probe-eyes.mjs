// 识别格探针：逐格打印 12 个候选格的两行像素与对比度，用来看清某张皮肤
// 到底画了哪一格（plan.md §6.9）。detectEyes 只返回第一个命中的格子，
// 皮肤同时画了多格时要靠这张表判断命中是否符合画图者的意图。
// 用法：node tools/probe-eyes.mjs [皮肤路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from './png.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const file = process.argv[2] || path.join(root, 'prototype', 'da-skin.png')
const img = decodePng(fs.readFileSync(file))
const { width, data } = img
const at = (x, y) => {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}
const luma = (p) => p[0] + p[1] + p[2]

const CELLS = [
  [4, 6, 2, '行6'], [4, 4, 2, '行5'], [4, 2, 2, '行4'], [4, 0, 2, '行3'],
  [24, 5, 2, '行5 h2'], [24, 2, 2, '行4 h2'], [28, 5, 2, '行3 h2'], [28, 2, 2, '行2 h2'],
  [32, 4, 2, '行4 h3'], [32, 2, 3, '行5 w3'], [32, 0, 3, '行4 w3'], [36, 6, 2, '行5 偏右'],
]

console.log(`${path.relative(root, file)}  ${img.width}×${img.height}`)
for (const [x, y, w, note] of CELLS) {
  const r0 = Array.from({ length: w }, (_, i) => at(x + i, y))
  const r1 = Array.from({ length: w }, (_, i) => at(x + i, y + 1))
  const opaque = [...r0, ...r1].every((p) => p[3] >= 128)
  const c0 = Math.max(...r0.map(luma)) - Math.min(...r0.map(luma))
  const c1 = Math.max(...r1.map(luma)) - Math.min(...r1.map(luma))
  const hit = opaque && Math.max(c0, c1) >= 60
  const fmt = (r) => r.map((p) => (p[3] < 128 ? '  透明  ' : p.slice(0, 3).join('/'))).join(' | ')
  console.log(
    `${hit ? '命中' : '    '} (${String(x).padStart(2)},${y}) w${w} ${note.padEnd(7)} 对比 ${String(c0).padStart(3)}/${String(c1).padStart(3)}`,
  )
  console.log(`       上 ${fmt(r0)}`)
  console.log(`       下 ${fmt(r1)}`)
}
