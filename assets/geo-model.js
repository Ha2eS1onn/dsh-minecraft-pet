// Bedrock `.geo.json` 装饰模型（P2-b，plan.md §6.7）。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/decoration_models.rs:1-46
//
// 只做一件事：把 geckolib/Bedrock 的骨骼盒子模型转成 drawBox 能吃的 part 列表。
// 五个容易错的地方（尽量照抄，别自己推）：
//   ① 骨骼用 `parent` 串起来，父节点可能**后定义** → 递归求 + 缓存（MDP 单趟查表其实有洞）
//   ② pivot 旋转是 T(pivot)·R·T(-pivot)，旋转顺序 ZYX（Rz·Ry·Rx），单位是度
//   ③ Bedrock 前后轴与渲染空间相反 → `conversion = rotY(π)`，**每个 cube 前后各套一次**
//   ④ 底部对齐用「摆好姿势后的几何最低点」，不是 origin 的 y
//   ⑤ 贴图宽度必须等于 description.texture_width（高度同理）
//
// 只支持 box UV（`cube.uv` 是 [u,v]）；per-face UV 的对象形式直接报错，
// 因为我们的 drawBox 只有一套展开公式。

import { translate, scale, multiply, identity, transformPoint } from './skin-render.js'
import * as Q from './quat.js'

const DEG = Math.PI / 180
/** Bedrock 的 +Z 与渲染空间的 +Z 相反（decoration_models.rs:15）。 */
const CONVERSION = Q.toMatrix(Q.rotY(Math.PI))

function triple(v, dflt = [0, 0, 0]) {
  if (!Array.isArray(v)) return dflt.slice()
  return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
}

/**
 * 节点自身的 pivot 旋转：T(pivot) · Rz·Ry·Rx · T(-pivot)。
 * 骨骼与 cube 都可能带 pivot/rotation，同一套公式。
 */
export function pivotRotation(node) {
  const p = triple(node && node.pivot)
  const r = triple(node && node.rotation).map((d) => d * DEG)
  const rot = Q.multiply(Q.multiply(Q.rotZ(r[2]), Q.rotY(r[1])), Q.rotX(r[0]))
  return multiply(multiply(translate(p[0], p[1], p[2]), Q.toMatrix(rot)), translate(-p[0], -p[1], -p[2]))
}

function asObject(input) {
  if (typeof input === 'string') return JSON.parse(input)
  if (input && typeof input === 'object') return input
  throw new Error('geo 模型必须是 JSON 文本或对象')
}

/**
 * 解析模型。
 * @param {string|object} input `.geo.json` 内容
 * @returns {{identifier:string, textureWidth:number, textureHeight:number,
 *            parts:{size:number[],uv:number[],transform:number[],mirror:boolean}[],
 *            bottom:number}}
 */
export function parseGeo(input) {
  const data = asObject(input)
  const list = data['minecraft:geometry'] || data.geometry
  const geo = Array.isArray(list) ? list[0] : null
  if (!geo) throw new Error('geo 模型缺少 minecraft:geometry[0]')
  const desc = geo.description || {}
  const textureWidth = Number(desc.texture_width) || 0
  const textureHeight = Number(desc.texture_height) || 0
  const bones = Array.isArray(geo.bones) ? geo.bones : []

  const byName = new Map()
  for (const b of bones) if (b && typeof b.name === 'string') byName.set(b.name, b)
  const cache = new Map()
  function boneTransform(bone, depth = 0) {
    if (cache.has(bone.name)) return cache.get(bone.name)
    const parent = bone.parent ? byName.get(bone.parent) : null
    // 父节点后定义也能拿到；同时挡住 parent 成环
    const base = parent && depth < 32 ? boneTransform(parent, depth + 1) : identity()
    const m = multiply(base, pivotRotation(bone))
    cache.set(bone.name, m)
    return m
  }

  const parts = []
  for (const bone of bones) {
    if (!bone) continue
    const boneM = boneTransform(bone)
    const cubes = Array.isArray(bone.cubes) ? bone.cubes : []
    for (const cube of cubes) {
      if (!cube) continue
      if (!Array.isArray(cube.uv)) {
        throw new Error('geo 模型只支持 box UV（cube.uv 必须是 [u, v]）')
      }
      const size = triple(cube.size)
      const origin = triple(cube.origin)
      const center = [origin[0] + size[0] / 2, origin[1] + size[1] / 2, origin[2] + size[2] / 2]
      const m = multiply(
        multiply(
          multiply(multiply(CONVERSION, boneM), pivotRotation(cube)),
          translate(center[0], center[1], center[2]),
        ),
        CONVERSION,
      )
      parts.push({
        size,
        uv: [Number(cube.uv[0]) || 0, Number(cube.uv[1]) || 0],
        transform: m,
        mirror: cube.mirror === true,
      })
    }
  }

  // 摆好姿势后的最低点：8 个角都要看（plan §6.7 第 5 条）
  let bottom = Infinity
  for (const p of parts) {
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          const v = transformPoint(p.transform, [
            (p.size[0] * x) / 2,
            (p.size[1] * y) / 2,
            (p.size[2] * z) / 2,
          ])
          if (v[1] < bottom) bottom = v[1]
        }
      }
    }
  }
  if (!parts.length) bottom = 0

  return {
    identifier: String(desc.identifier || ''),
    textureWidth,
    textureHeight,
    parts,
    bottom,
  }
}

/** 校验贴图尺寸与模型声明一致（MDP 是 assert_eq，这里给可读的错）。 */
export function checkTextureSize(model, tex) {
  if (!tex) throw new Error('缺少装饰贴图')
  if (model.textureWidth && tex.width !== model.textureWidth) {
    throw new Error(`装饰贴图宽度 ${tex.width} 与模型声明 ${model.textureWidth} 不一致`)
  }
  if (model.textureHeight && tex.height !== model.textureHeight) {
    throw new Error(`装饰贴图高度 ${tex.height} 与模型声明 ${model.textureHeight} 不一致`)
  }
  return true
}

/** 头部挂载矩阵：头部完整矩阵 × 等比缩放(head.size.y / 8)（同 P1 装饰）。 */
function headMount(headPart) {
  const s = headPart.size[1] / 8
  const m = headPart.transform
  return [m[0] * s, m[1] * s, m[2] * s, m[3], m[4] * s, m[5] * s, m[6] * s, m[7], m[8] * s, m[9] * s, m[10] * s, m[11], m[12], m[13], m[14], m[15]]
}

/**
 * 把模型挂到头顶。
 * @param {object} headPart buildParts 里 key === 'head' 且 inflate === 0 的部件
 * @param {object} model parseGeo 的结果
 * @param {{texture:object, scale?:number, lift?:number}} opts
 *   scale 0.36 是 MDP 对美西螈的比例；lift 4.55 让底部正好压在头的外层皮肤（Y=4.5）之上
 */
export function geoParts(headPart, model, { texture, scale: k = 0.36, lift = 4.55 } = {}) {
  if (!headPart || !model || !model.parts.length) return []
  if (!texture) throw new Error('geo 装饰需要贴图')
  // 底部对齐：elevation 让模型最低点落在 lift 上
  const elevation = lift - model.bottom * k
  const mount = multiply(
    headMount(headPart),
    multiply(translate(0, elevation, 0), scale(k, k, k)),
  )
  return model.parts.map((p) => ({
    key: 'decoration',
    size: p.size,
    uv: p.uv,
    transform: multiply(mount, p.transform),
    inflate: 0,
    mirror: p.mirror,
    texture,
  }))
}
