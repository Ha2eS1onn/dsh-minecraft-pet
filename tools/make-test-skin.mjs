// 生成逐面配色测试皮肤：6 个面 6 种纯色，正面额外画一个朝上的箭头。
// 用于 M0 / 后续 §14.1 的 UV 逐面核对。用法：node tools/make-test-skin.mjs [输出路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './png.mjs'
import { OVERLAY_UV } from '../assets/skin-model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = process.argv[2] || path.join(root, 'prototype', 'test-skin.png')

// 面序与 render.js 一致：0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z
export const FACE_COLORS = [
  [255, 0, 255], // +X 品红（角色左侧）
  [0, 255, 255], // -X 青（角色右侧）
  [0, 255, 0], // +Y 绿（顶）
  [255, 255, 0], // -Y 黄（底）
  [255, 0, 0], // +Z 红（前）
  [0, 0, 255], // -Z 蓝（后）
]

// [u, v, w, h, d]
export const BOXES = {
  head: [0, 0, 8, 8, 8],
  body: [16, 16, 8, 12, 4],
  rightArm: [40, 16, 4, 12, 4],
  leftArm: [32, 48, 4, 12, 4],
  rightLeg: [0, 16, 4, 12, 4],
  leftLeg: [16, 48, 4, 12, 4],
}

/** 与 render.rs draw_box 的 regions 完全一致，返回 6 个 [x,y,w,h]。 */
export function faceRegions([u, v, w, h, d]) {
  return [
    [u + d + w, v + d, d, h],
    [u, v + d, d, h],
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u + d, v + d, w, h],
    [u + 2 * d + w, v + d, w, h],
  ]
}

// 外层（hat/jacket/sleeve/pants）区域填同一套面色的半透明版本，
// 用来验证 inflate 盒子、半透明叠加与 top-left rule（plan §14.1）。
export const OUTER_BOXES = {
  head: [32, 0, 8, 8, 8],
  body: [16, 32, 8, 12, 4],
  rightArm: [40, 32, 4, 12, 4],
  leftArm: [48, 48, 4, 12, 4],
  rightLeg: [0, 32, 4, 12, 4],
  leftLeg: [0, 48, 4, 12, 4],
}

const W = 64
const H = 64
const px = new Uint8ClampedArray(W * H * 4)
const put = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const o = (y * W + x) * 4
  px[o] = r
  px[o + 1] = g
  px[o + 2] = b
  px[o + 3] = a
}

// 底色：不透明的中灰，未覆盖区域一眼能看出是"漏画"还是"画了"
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [64, 64, 64])

for (const box of Object.values(BOXES)) {
  faceRegions(box).forEach(([x, y, w, h], face) => {
    const color = FACE_COLORS[face]
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, color)
    // 每面左上角打一个深色点，便于确认 uv 原点与朝向
    put(x, y, [16, 16, 16])
  })
}

for (const box of Object.values(OUTER_BOXES)) {
  faceRegions(box).forEach(([x, y, w, h]) => {
    // 外层统一用白色半透明：叠在内层面色上应得到变色（透出底层），
    // 叠在画布透明区上应得到灰白半透明——两种结果必须同时成立。
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, [255, 255, 255], 128)
  })
}

// 头部正面 (+Z) 画一个朝上的白色箭头：验证 v 轴方向没反
const [hx, hy, hw, hh] = faceRegions(BOXES.head)[4]
for (let i = 1; i < hh - 1; i++) put(hx + (hw >> 1), hy + i, [255, 255, 255])
for (let i = 1; i <= 2; i++) {
  put(hx + (hw >> 1) - i, hy + i, [255, 255, 255])
  put(hx + (hw >> 1) + i, hy + i, [255, 255, 255])
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, encodePng(W, H, px))
console.log(`wrote ${path.relative(root, out)}`)
