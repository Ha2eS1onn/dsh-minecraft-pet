// M0 命令行自检：用同一份 assets/skin-render.js 渲染静止小人并输出 PNG。
// 用法：node tools/render-m0.mjs [皮肤路径] [输出路径]
// 替代品是 prototype/m0.html（浏览器），两者共用渲染器，不会漂移。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import {
  createFrame,
  clearFrame,
  skinFromImage,
  drawParts,
  toImageData,
} from '../assets/skin-render.js'
import { buildParts } from '../assets/skin-model.js'
import { makePose } from './pose-presets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'assets', 'default-skin.png')
const outPath = process.argv[3] || path.join(root, 'prototype', 'm0-preview.png')
const slim = process.argv.includes('--slim')
const noOuter = process.argv.includes('--no-outer')
const poseArg = process.argv.find((a) => a.startsWith('--pose='))?.slice(7) || 'stand'

const W = 352
const H = 416

const skinImg = decodePng(fs.readFileSync(skinPath))
const skin = skinFromImage(skinImg)
const frame = createFrame(W, H)
clearFrame(frame)
const parts = buildParts(makePose(poseArg), skin, { outer: !noOuter, armWidth: slim ? 3 : 4 })
drawParts(frame, parts, skin)
const rgba = toImageData(frame)

// 统计自检：非透明像素数与包围盒
let opaque = 0
for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) opaque++
const [bx0, by0, bx1, by1] = frame.bounds

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, encodePng(W, H, rgba))
console.log(
  JSON.stringify(
    {
      skin: path.relative(root, skinPath),
      size: `${skin.width}x${skin.height}`,
      legacy: skin.legacy,
      canvas: `${W}x${H}`,
      opaquePixels: opaque,
      bounds: [bx0, by0, bx1, by1],
      out: path.relative(root, outPath),
    },
    null,
    2,
  ),
)
