// 脸部贴图探针：把头部正面 8×8 逐像素按颜色符号打印，便于核对眼睛画在第几行、
// 眼皮格子（识别格）与脸部行号是否对得上（plan.md §6.9）。
// 用法：node tools/probe-face.mjs [皮肤路径]

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

const legend = new Map()
const SYMS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const sym = (p) => {
  if (p[3] < 128) return '.'
  const key = p.slice(0, 3).join(',')
  if (!legend.has(key)) legend.set(key, SYMS[legend.size % SYMS.length])
  return legend.get(key)
}

console.log(`${path.relative(root, file)}  脸部 = 贴图 (8..15, 8..15)`)
console.log('       u0 u1 u2 u3 u4 u5 u6 u7')
for (let row = 0; row < 8; row++) {
  const cells = []
  for (let u = 0; u < 8; u++) cells.push(sym(at(8 + u, 8 + row)))
  console.log(`脸行 ${row}  ${cells.join('  ')}`)
}
console.log('\n符号对照：')
for (const [rgb, s] of legend) console.log(`  ${s}  rgb(${rgb})`)
