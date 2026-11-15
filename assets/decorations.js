// 装饰物（P1 四种）：兔耳 / 猫耳 / 爱心 / 棒棒糖。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render_decorations.rs:11-72
//
// 两个照抄的关键点：
//   ① 纯色材质：所有装饰都是「1×1 纯色贴图 + 同一个 drawBox」，不另写无贴图渲染路径。
//   ② 挂载点：挂在**头部的完整矩阵**上，再按「头高/8」归一化缩放，
//      所以转头时装饰跟着转，不同皮肤尺寸下比例也一致。
//
// 每个 cube 的局部坐标与尺寸都是常量，按 kind 缓存一次；每帧只做 mount × translate。

import { geoParts } from './geo-model.js'

// 调色板，取自 render_decorations.rs:5 的 palette。
const WHITE = [244, 240, 241]
const PINK = [246, 164, 184]
const DARK = [65, 62, 69]
const BLUSH = [244, 164, 186]
const CREAM = [250, 247, 237]
const RED = [224, 42, 55]

/** duck 是 P2 的 Bedrock `.geo.json` 模型（见 geo-model.js），其余四种是纯色 cube。 */
export const DECORATIONS = ['none', 'rabbit', 'cat', 'heart', 'lollipop', 'duck']

const TAU = Math.PI * 2

/** 挂载矩阵：头部完整矩阵 × 等比缩放(head.size.y / 8)（render_decorations.rs:17）。 */
function headMount(headPart) {
  const s = headPart.size[1] / 8
  const m = headPart.transform
  return [m[0] * s, m[1] * s, m[2] * s, m[3], m[4] * s, m[5] * s, m[6] * s, m[7], m[8] * s, m[9] * s, m[10] * s, m[11], m[12], m[13], m[14], m[15]]
}

/** 装饰的局部 cube 列表：[中心, 尺寸, 颜色]。与 pose 无关，可以缓存。 */
const CUBE_CACHE = new Map()

function localCubes(kind, heartTex) {
  if (CUBE_CACHE.has(kind)) return CUBE_CACHE.get(kind)
  const out = []
  const cube = (center, size, color) => out.push([center, size, color])

  if (kind === 'rabbit') {
    for (const sign of [-1, 1]) {
      cube([sign * 2.3, 6.9, 0], [1.7, 5, 1], WHITE)
      cube([sign * 2.3, 6.9, 0.53], [0.8, 3.7, 0.12], PINK)
    }
  } else if (kind === 'cat') {
    for (const sign of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const width = 2.6 - row * 0.7
        cube([sign * (2.5 + row * 0.15), 4.9 + row * 0.7, 0], [width, 0.75, 1.2], DARK)
        if (row < 2) {
          cube([sign * (2.5 + row * 0.15), 4.95 + row * 0.7, 0.63], [width - 0.8, 0.55, 0.1], BLUSH)
        }
      }
    }
  } else if (kind === 'heart') {
    // 爱心形状直接取自 assets/heart.png 的 8×8 像素：每个不透明像素一个 cube。
    if (!heartTex) throw new Error('爱心装饰需要 heart 纹理（assets/heart.png）')
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * heartTex.width + x) * 4
        if (heartTex.rgba[i + 3] === 0) continue
        cube([(x - 3.5) * 0.55, 8.4 - y * 0.55, 0], [0.55, 0.55, 0.35], [
          heartTex.rgba[i],
          heartTex.rgba[i + 1],
          heartTex.rgba[i + 2],
        ])
      }
    }
  } else if (kind === 'lollipop') {
    const angle = 0.55
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const origin = [-3.6, 4.5, 4.85]
    const point = (x, y) => [
      origin[0] + cos * x - sin * y,
      origin[1] + sin * x + cos * y,
      origin[2],
    ]
    // 棒：从盘心向外的一排小方块。
    for (let i = 0; i < 14; i++) {
      const t = 1.7 + i * 0.27
      cube([origin[0] - 0.8 * t, origin[1] - 0.6 * t, origin[2]], [0.32, 0.32, 0.28], CREAM)
    }
    // 盘：180 点螺旋 + 17×17 网格逐点判定，红色是螺旋带，其余奶油色。
    const spiral = []
    for (let i = 0; i < 180; i++) {
      const t = i / 179
      const a = t * TAU * 1.8
      const radius = 0.8 + t * 7.2
      spiral.push([Math.cos(a) * radius, Math.sin(a) * radius])
    }
    for (let y = -8; y <= 8; y++) {
      for (let x = -8; x <= 8; x++) {
        if (Math.hypot(x, y) > 8.2) continue
        const red = spiral.some(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2 < 0.85 * 0.85)
        cube(point(x * 0.23, y * 0.23), [0.245, 0.245, 0.38], red ? RED : CREAM)
      }
    }
  }

  CUBE_CACHE.set(kind, out)
  return out
}

/**
 * 生成装饰的 part 列表。
 * @param {object} headPart buildParts 里 key === 'head' 且 inflate === 0 的那个
 * @param {string} kind 'rabbit' | 'cat' | 'heart' | 'lollipop' | 'duck' | 'none'
 * @param {{heart?: object, geo?: {model: object, texture: object}}} [assets]
 *   爱心需要 heart.png 纹理；duck 需要已解析的 geo 模型 + 贴图
 */
export function decorationParts(headPart, kind, assets = {}) {
  if (!kind || kind === 'none') return []
  if (!headPart) return []
  // Bedrock geo 模型：走 geoParts（自带底部对齐与贴图），不复用下面的纯色 cube 路径
  if (kind === 'duck') {
    if (!assets.geo || !assets.geo.model) return []
    return geoParts(headPart, assets.geo.model, { texture: assets.geo.texture })
  }
  const cubes = localCubes(kind, assets.heart)
  const mount = headMount(headPart)
  return cubes.map(([center, size, color]) => ({
    key: 'decoration',
    size,
    uv: [0, 0],
    transform: [
      mount[0], mount[1], mount[2], mount[0] * center[0] + mount[1] * center[1] + mount[2] * center[2] + mount[3],
      mount[4], mount[5], mount[6], mount[4] * center[0] + mount[5] * center[1] + mount[6] * center[2] + mount[7],
      mount[8], mount[9], mount[10], mount[8] * center[0] + mount[9] * center[1] + mount[10] * center[2] + mount[11],
      0, 0, 0, 1,
    ],
    inflate: 0,
    mirror: false,
    solid: color,
  }))
}
