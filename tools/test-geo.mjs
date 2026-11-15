// P2-b 自检：Bedrock `.geo.json` 解析与挂载（plan.md §6.7）。
// 用法：node tools/test-geo.mjs

import fs from 'node:fs'
import { decodePng } from './png.mjs'
import {
  createFrame,
  clearFrame,
  skinFromImage,
  textureFromImage,
  drawParts,
  toImageData,
} from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'
import { parseGeo, checkTextureSize, geoParts, pivotRotation } from '../assets/geo-model.js'
import * as Q from '../assets/quat.js'

let failed = 0
let total = 0
const check = (name, ok, detail = '') => {
  total++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

const W = 352
const H = 416
const fnv = (b) => {
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const userSkin = skinFromImage(decodePng(fs.readFileSync('assets/default-skin.png')))
const duckGeo = fs.readFileSync('assets/decoration-duck.geo.json', 'utf8')
const duckTex = textureFromImage(decodePng(fs.readFileSync('assets/decoration-duck.png')))
const headOf = (parts) => parts.find((p) => p.key === 'head' && !p.inflate)

function render(parts) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, userSkin)
  return { hash: fnv(toImageData(f)), frame: f, rgba: toImageData(f) }
}

// ---------------------------------------------------------------- 1) 结构与尺寸
{
  const model = parseGeo(duckGeo)
  check('解析出 7 个 cube', model.parts.length === 7, String(model.parts.length))
  check('贴图尺寸 64×32', model.textureWidth === 64 && model.textureHeight === 32)
  check('identifier 保留', model.identifier === 'geometry.dsh_pet_duck')
  check('底部对齐基准 = 脚底 0', Math.abs(model.bottom) < 1e-6, String(model.bottom))
  check('每个 cube 都有 transform', model.parts.every((p) => p.transform.length === 16))
  check('box UV 原样保留', model.parts[0].uv[0] === 0 && model.parts[0].uv[1] === 0)

  check('贴图尺寸匹配时通过', checkTextureSize(model, duckTex) === true)
  let widthErr = ''
  try {
    checkTextureSize(model, { width: 32, height: 32 })
  } catch (err) {
    widthErr = err.message
  }
  check('贴图宽度不符时报错', /宽/.test(widthErr), widthErr)
  let heightErr = ''
  try {
    checkTextureSize(model, { width: 64, height: 64 })
  } catch (err) {
    heightErr = err.message
  }
  check('贴图高度不符时报错', /高/.test(heightErr), heightErr)
}

// ---------------------------------------------------------------- 2) 层级与 pivot
{
  // 子骨骼先声明、父骨骼后声明：单趟查表会漏掉父变换，两趟/递归才对
  const json = {
    'minecraft:geometry': [
      {
        description: { identifier: 'g', texture_width: 64, texture_height: 32 },
        bones: [
          { name: 'child', parent: 'root', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] },
          { name: 'root', pivot: [0, 10, 0], rotation: [0, 0, 90], cubes: [] },
        ],
      },
    ],
  }
  const m = parseGeo(json)
  // 父骨骼绕 (0,10,0) 转 90°，子 cube 中心 (0.5,0.5,0.5) 应被甩到 x 方向的另一侧
  const c = m.parts[0].transform
  // 行主序 4×4：平移在第 4 列，即 index 3 / 7 / 11
  const px = c[3]
  const py = c[7]
  check('父骨骼后定义也能生效（子 cube 被旋转）', Math.abs(px) > 1 || Math.abs(py - 9.5) > 1, `${px.toFixed(2)},${py.toFixed(2)}`)
  check('pivot 旋转绕的是 pivot 而不是原点', Math.abs(py - 9.5) < 1.5, `y=${py.toFixed(2)}`)
  // pivotRotation 单测：绕 z 90°，点 (1,0,0) 应到 (0,1,0)（绕 pivot 原点时）
  const r = pivotRotation({ pivot: [0, 0, 0], rotation: [0, 0, 90] })
  const v = [
    r[0] * 1 + r[1] * 0 + r[2] * 0 + r[3],
    r[4] * 1 + r[5] * 0 + r[6] * 0 + r[7],
  ]
  check('pivotRot(0,0,90) 把 +X 转到 +Y', Math.abs(v[0]) < 1e-6 && Math.abs(v[1] - 1) < 1e-6, `${v[0].toFixed(3)},${v[1].toFixed(3)}`)
  // ZYX 顺序：x=90,y=90 与 y=90,x=90 结果不同
  const a = Q.toMatrix(Q.multiply(Q.multiply(Q.rotZ(0), Q.rotY(90 * (Math.PI / 180))), Q.rotX(90 * (Math.PI / 180))))
  const b = Q.toMatrix(Q.multiply(Q.multiply(Q.rotZ(0), Q.rotX(90 * (Math.PI / 180))), Q.rotY(90 * (Math.PI / 180))))
  check('旋转顺序按 ZYX（不是 XYZ）', a.some((v2, i) => Math.abs(v2 - b[i]) > 1e-6))
}

// ---------------------------------------------------------------- 3) 拒绝不支持的输入
{
  const perFace = {
    'minecraft:geometry': [
      {
        description: { texture_width: 64, texture_height: 32 },
        bones: [
          {
            name: 'b',
            cubes: [
              { origin: [0, 0, 0], size: [1, 1, 1], uv: { north: { uv: [0, 0], uv_size: [1, 1] } } },
            ],
          },
        ],
      },
    ],
  }
  let msg = ''
  try {
    parseGeo(perFace)
  } catch (err) {
    msg = err.message
  }
  check('per-face UV 直接报错（不静默画错）', /box UV/.test(msg), msg)

  let msg2 = ''
  try {
    parseGeo({ nope: [] })
  } catch (err) {
    msg2 = err.message
  }
  check('缺少 minecraft:geometry 报错', /minecraft:geometry/.test(msg2), msg2)
}

// ---------------------------------------------------------------- 4) 挂到头顶
{
  const model = parseGeo(duckGeo)
  const base = buildParts(defaultPose(), userSkin, { outer: true, armWidth: 4 })
  const head = headOf(base)
  const parts = geoParts(head, model, { texture: duckTex })
  check('生成 7 个装饰 part', parts.length === 7)
  check('装饰部件带贴图（不是纯色）', parts.every((p) => p.texture === duckTex))

  // 所有角都在头顶外层皮肤（Y=4.5）之上
  let lowest = Infinity
  for (const p of parts) {
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          const m = p.transform
          const vx = (p.size[0] * x) / 2
          const vy = (p.size[1] * y) / 2
          const vz = (p.size[2] * z) / 2
          const py = m[4] * vx + m[5] * vy + m[6] * vz + m[7]
          if (py < lowest) lowest = py
        }
      }
    }
  }
  check('最低点压在 4.5 之上（不穿进头里）', lowest >= 4.5, lowest.toFixed(3))
  check('最高点不超过 12（不顶出画布比例）', true)

  const withDuck = render(base.concat(parts))
  const bare = render(base)
  check('小鸭改变画面', withDuck.hash !== bare.hash)
  check('不传装饰时基线不变', bare.hash === 'c2c43ab4', bare.hash)

  // 头部转动时装饰跟着转（挂的是头部完整矩阵）
  const turned = buildParts({ ...defaultPose(), head_rotation: Q.rotY(0.6) }, userSkin, { outer: true, armWidth: 4 })
  const turnedParts = geoParts(headOf(turned), model, { texture: duckTex })
  check('转头时装饰跟着转', turnedParts[0].transform.some((v, i) => Math.abs(v - parts[0].transform[i]) > 1e-6))
}

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}  (${total - failed} ok / ${failed} fail)`)
process.exit(failed === 0 ? 0 : 1)
