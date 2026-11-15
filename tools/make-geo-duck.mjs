// 生成自造的「小鸭」Bedrock 装饰模型与贴图（P2-b）。
// 用法：node tools/make-geo-duck.mjs
//
// 为什么要写这个脚本：MDP 的 `.geo.json` 是 Mojang 的美西螈模型，不能随本项目分发
// （assets 边界见 PROVENANCE）。所以这里自造一个小鸭：盒子上限简单、但完整用到
// 骨骼 / pivot / box UV / 贴图尺寸校验四条路径，够验证解析器，也不引入任何游戏素材。
//
// 贴图色块按 drawBox 的六面展开公式算出来，模型与贴图同一份数据源，不会漂。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './png.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEX_W = 64
const TEX_H = 32

/** 每个 cube 一个底色；六面明暗由渲染器的 LUT 负责，贴图只管颜色。 */
const CUBES = [
  { name: 'body', origin: [-3.5, 0.8, -4], size: [7, 5, 8], uv: [0, 0], color: [240, 205, 80] },
  { name: 'head', origin: [-2.5, 5.8, -4.5], size: [5, 5, 5], uv: [30, 0], color: [250, 220, 95] },
  { name: 'beak', origin: [-1, 6.6, -6.2], size: [2, 1.2, 1], uv: [50, 10], color: [240, 150, 50] },
  { name: 'eye_l', origin: [-2.1, 8.4, -4.9], size: [0.8, 0.8, 0.3], uv: [52, 20], color: [40, 38, 45] },
  { name: 'eye_r', origin: [1.3, 8.4, -4.9], size: [0.8, 0.8, 0.3], uv: [56, 20], color: [40, 38, 45] },
  { name: 'foot_l', origin: [-2.6, 0, -2], size: [2, 0.8, 3], uv: [0, 16], color: [232, 140, 45] },
  { name: 'foot_r', origin: [0.6, 0, -2], size: [2, 0.8, 3], uv: [12, 16], color: [232, 140, 45] },
]

/** drawBox 的六面展开：与 assets/skin-render.js 的 regions 同源。 */
function faceRects(uv, size) {
  const [u, v] = uv
  const [w, h, d] = size
  return [
    [u + d + w, v + d, d, h],
    [u, v + d, d, h],
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u + d, v + d, w, h],
    [u + 2 * d + w, v + d, w, h],
  ]
}

const geo = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: {
        identifier: 'geometry.dsh_pet_duck',
        texture_width: TEX_W,
        texture_height: TEX_H,
        visible_bounds_width: 4,
        visible_bounds_height: 4,
        visible_bounds_offset: [0, 2, 0],
      },
      bones: [
        {
          name: 'duck',
          pivot: [0, 0, 0],
          cubes: CUBES.map((c) => ({ origin: c.origin, size: c.size, uv: c.uv })),
        },
      ],
    },
  ],
}

// 贴图：每个 cube 的六面区域都填成它的底色（留 1px 间隙，方便肉眼看布局）
const data = new Uint8ClampedArray(TEX_W * TEX_H * 4)
for (const c of CUBES) {
  for (const [x0, y0, w, h] of faceRects(c.uv, c.size)) {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
        if (x < 0 || x >= TEX_W || y < 0 || y >= TEX_H) continue
        const i = (y * TEX_W + x) * 4
        data[i] = c.color[0]
        data[i + 1] = c.color[1]
        data[i + 2] = c.color[2]
        data[i + 3] = 255
      }
    }
  }
}

// 越界检查：模型引用的 UV 不能超出贴图
for (const c of CUBES) {
  for (const [x0, y0, w, h] of faceRects(c.uv, c.size)) {
    if (x0 < 0 || y0 < 0 || x0 + w > TEX_W + 0.001 || y0 + h > TEX_H + 0.001) {
      throw new Error(`${c.name} 的 UV 越界: ${x0},${y0} ${w}x${h}`)
    }
  }
}

fs.writeFileSync(path.join(ROOT, 'assets', 'decoration-duck.geo.json'), JSON.stringify(geo, null, 2) + '\n')
fs.writeFileSync(path.join(ROOT, 'assets', 'decoration-duck.png'), encodePng(TEX_W, TEX_H, data))
console.log(
  JSON.stringify(
    { geo: 'assets/decoration-duck.geo.json', png: 'assets/decoration-duck.png', cubes: CUBES.length, texture: `${TEX_W}x${TEX_H}` },
    null,
    2,
  ),
)
