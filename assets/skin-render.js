// Canvas 2D 实时栅格化：Minecraft 皮肤盒子模型。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render.rs
// https://github.com/DLmember/Minecraft-Desktop-Pet
// 对应段落：project():1196  draw_box():1847  triangle():2052  shade_lut():32  Skin::load():264
//
// 像素格式：frame.pixels 是**预乘 BGRA**（range 0..255），与 MDP 的 Frame::pixels 一致。
// 纹理采样用原始非预乘 RGBA，混合时再乘 alpha；输出走 toImageData() 反预乘。

/** 面序：0=+X 1=-X 2=+Y顶 3=-Y底 4=+Z前 5=-Z后 */
export const FACE_SHADES = [0.8, 0.8, 1.0, 0.62, 0.94, 0.86]

const FORWARD = (() => {
  const x = 30
  const y = 23
  const z = 70
  const n = Math.hypot(x, y, z)
  return [x / n, y / n, z / n]
})()
const RIGHT = (() => {
  // Y × forward
  const x = 1 * FORWARD[2] - 0 * FORWARD[1]
  const y = 0 * FORWARD[0] - 0 * FORWARD[2]
  const z = 0 * FORWARD[1] - 1 * FORWARD[0]
  const n = Math.hypot(x, y, z)
  return [x / n, y / n, z / n]
})()
const UP = (() => {
  // forward × right
  const x = FORWARD[1] * RIGHT[2] - FORWARD[2] * RIGHT[1]
  const y = FORWARD[2] * RIGHT[0] - FORWARD[0] * RIGHT[2]
  const z = FORWARD[0] * RIGHT[1] - FORWARD[1] * RIGHT[0]
  return [x, y, z]
})()

/** 正交投影。v 为模型空间（Y 向上），返回屏幕坐标 + 深度。 */
export function project(v, width, height) {
  const x = v[0]
  const y = v[1] - 15
  const z = v[2]
  const scale = width / 44
  const dr = x * RIGHT[0] + y * RIGHT[1] + z * RIGHT[2]
  const du = x * UP[0] + y * UP[1] + z * UP[2]
  const df = x * FORWARD[0] + y * FORWARD[1] + z * FORWARD[2]
  return [width / 2 + dr * scale, height / 2 - du * scale, -df]
}

/** 6 面明暗 LUT：每面每通道 256 项，sRGB 线性化后乘系数再转回。 */
export function shadeLut() {
  const lut = new Uint8Array(6 * 3 * 256)
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 256; v++) {
      const c = v / 255
      const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      const l = linear * FACE_SHADES[f]
      const out = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
      const value = Math.max(0, Math.min(255, Math.round(out * 255)))
      for (let ch = 0; ch < 3; ch++) lut[f * 768 + ch * 256 + v] = value
    }
  }
  return lut
}

const SHADE_LUT = shadeLut()

// ---- 材质包识别格（plan.md §6.9 / render.rs:155 EYE_CELLS） ----
// 每格占贴图上的两行：上一行是眼睛，下一行是眼白/瞳孔。玩家在格子里画过眼睛，
// 眨眼时才会出现「眼皮盖住眼睛」；没画就是普通皮肤，不眨眼（预期行为）。

const EYE_CELLS = [
  // 2 像素宽、1 行高：眼睛分别画在脸部第 6/5/4/3 行
  { x: 4, y: 6, w: 2, row: 6, h: 1, u0: 5, u1: 6 },
  { x: 4, y: 4, w: 2, row: 5, h: 1, u0: 5, u1: 6 },
  { x: 4, y: 2, w: 2, row: 4, h: 1, u0: 5, u1: 6 },
  { x: 4, y: 0, w: 2, row: 3, h: 1, u0: 5, u1: 6 },
  // 2 像素宽、2 行高（大眼）
  { x: 24, y: 5, w: 2, row: 5, h: 2, u0: 5, u1: 6 },
  { x: 24, y: 2, w: 2, row: 4, h: 2, u0: 5, u1: 6 },
  { x: 28, y: 5, w: 2, row: 3, h: 2, u0: 5, u1: 6 },
  { x: 28, y: 2, w: 2, row: 2, h: 2, u0: 5, u1: 6 },
  // 2 像素宽、3 行高（特大眼）
  { x: 32, y: 4, w: 2, row: 4, h: 3, u0: 5, u1: 6 },
  // 3 像素宽（带眉毛的眼睛）
  { x: 32, y: 2, w: 3, row: 5, h: 1, u0: 5, u1: 7 },
  { x: 32, y: 0, w: 3, row: 4, h: 1, u0: 5, u1: 7 },
  // 抬高 1 像素的版本
  { x: 36, y: 6, w: 2, row: 5, h: 1, u0: 6, u1: 7 },
]

const luma = (p) => p[0] + p[1] + p[2]

/**
 * 按识别格读眨眼数据（对应 render.rs:179 `detect_eyes`）。
 * 返回 null 表示这张皮肤没画识别格，此时应当「不眨眼」，其它动效照常。
 * @returns {null|{left:object,right:object}}
 */
export function detectEyes(skin) {
  const { width, height, rgba } = skin
  if (width < 64 || height < 32) return null
  const k = Math.floor(width / 64)
  const half = Math.floor(k / 2)
  const at = (x, y) => {
    const px = Math.min(x * k + half, width - 1)
    const py = Math.min(y * k + half, height - 1)
    const i = (py * width + px) * 4
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
  }
  for (const cell of EYE_CELLS) {
    // 两行都必须实际画过（有不透明像素）。
    const rows = []
    for (let row = 0; row < 2; row++) {
      const px = []
      for (let i = 0; i < cell.w; i++) px.push(at(cell.x + i, cell.y + row))
      if (px.some((p) => p[3] < 128)) {
        rows.length = 0
        break
      }
      rows.push(px)
    }
    if (rows.length !== 2) continue
    // 眼睛必须真有对比：上一行是眼睛，下一行是瞳孔/眼白。
    const eyeRow = rows[0]
    const whiteRow = rows[1]
    const loEye = Math.min(...eyeRow.map(luma))
    const hiEye = Math.max(...eyeRow.map(luma))
    const loWhite = Math.min(...whiteRow.map(luma))
    const hiWhite = Math.max(...whiteRow.map(luma))
    const contrast = Math.max(hiEye - loEye, hiWhite - loWhite)
    if (contrast < 60) continue // 空白区被整体填成一种颜色，不算眼睛
    const pupil = Math.max(0, eyeRow.findIndex((p) => luma(p) === loEye))
    const faceX0 = cell.u0
    const faceX1 = cell.u1
    const lid = [cell.x, cell.y, cell.x + cell.w - 1, cell.y]
    const rightPupil = faceX0 + Math.min(pupil, cell.w - 1)
    const leftPupil = 7 - rightPupil
    return {
      right: {
        x0: faceX0,
        x1: faceX1,
        y0: cell.row,
        rows: cell.h,
        pupil: rightPupil,
        lid,
      },
      left: {
        x0: 7 - faceX1,
        x1: 7 - faceX0,
        y0: cell.row,
        rows: cell.h,
        pupil: leftPupil,
        // MDP 原码把左眼的 lid 元组反向成 (x1, y0, x0, y1)，`eyelid()` 里
        // `lx1 = lid[2] + 1` 于是得到 lx0 === lx1，UV 宽度为 0、左眼从不闭。
        // 这里双眼复用同一块格子（眼皮只有几个像素，是否镜像肉眼难辨）。
        lid,
      },
    }
  }
  return null
}

/** 分配一帧：预乘 BGRA 像素 + 深度缓冲。 */
export function createFrame(width, height) {
  return {
    width,
    height,
    pixels: new Uint8ClampedArray(width * height * 4),
    depth: new Float32Array(width * height),
    bounds: [width, height, 0, 0],
  }
}

export function clearFrame(frame) {
  frame.pixels.fill(0)
  frame.depth.fill(Infinity)
  frame.bounds = [frame.width, frame.height, 0, 0]
}

/**
 * 皮肤图集预处理（对应 Skin::load）。
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img 原始非预乘 RGBA
 */
export function skinFromImage(img) {
  const { width, height } = img
  if (width < 64 || width > 1024 || width % 64 !== 0 || (height !== width && height !== width / 2)) {
    throw new Error('皮肤必须为 64×64、64×32 或等比例高清 PNG，最大 1024×1024')
  }
  const k = width / 64
  const legacy = height * 2 === width
  const rgba = new Uint8ClampedArray(img.data)

  if (legacy) {
    // 64×32 皮肤的右上区域多数是脏数据：整块不透明就当作未使用并清空。
    let transparent = false
    for (let y = 0; y < 16 * k && !transparent; y++) {
      for (let x = 32 * k; x < 64 * k; x++) {
        if (rgba[(y * width + x) * 4 + 3] < 128) {
          transparent = true
          break
        }
      }
    }
    if (!transparent) {
      for (let y = 0; y < 16 * k; y++) {
        for (let x = 32 * k; x < 64 * k; x++) rgba[(y * width + x) * 4 + 3] = 0
      }
    }
  }

  // 头/身体/右肢的图集区域必须不透明，否则会露出底色。
  const regions = [
    [0, 0, 32, 16],
    [0, 16, 56, 16],
  ]
  if (!legacy) regions.push([16, 48, 32, 16])
  for (const [rx, ry, rw, rh] of regions) {
    for (let y = ry * k; y < (ry + rh) * k; y++) {
      for (let x = rx * k; x < (rx + rw) * k; x++) rgba[(y * width + x) * 4 + 3] = 255
    }
  }

  const skin = { width, height, k, legacy, rgba, lut: SHADE_LUT }
  skin.eyes = detectEyes(skin)
  return skin
}

/**
 * 任意尺寸的纹理（音符贴图等），不做皮肤校验。
 * 字段与 skin 同名，好让 triangle / drawQuad 共用同一条采样路径。
 */
export function textureFromImage(img) {
  return {
    width: img.width,
    height: img.height,
    k: img.width / 64,
    legacy: false,
    rgba: new Uint8ClampedArray(img.data),
    lut: SHADE_LUT,
  }
}

/** 1×1 纯色材质（对应 render_decorations.rs:2 `materials()` 的思路：纯色也走同一个 drawBox）。 */
const SOLID_CACHE = new Map()
export function solidSkin(rgb) {
  const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
  let tex = SOLID_CACHE.get(key)
  if (!tex) {
    tex = {
      width: 1,
      height: 1,
      k: 1 / 64,
      legacy: false,
      rgba: new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]),
      lut: SHADE_LUT,
    }
    SOLID_CACHE.set(key, tex)
  }
  return tex
}

/** 盒子 → 6 面 × 2 三角形的顶点/UV。part 字段：size/uv/transform/inflate/mirror。 */
export function drawBox(frame, part, skin) {
  const [uvW, uvH, uvD] = part.uvSize || part.size
  const [u, v] = part.uv
  const regions = [
    [u + uvD + uvW, v + uvD, uvD, uvH],
    [u, v + uvD, uvD, uvH],
    [u + uvD, v, uvW, uvD],
    [u + uvD + uvW, v, uvW, uvD],
    [u + uvD, v + uvD, uvW, uvH],
    [u + 2 * uvD + uvW, v + uvD, uvW, uvH],
  ]
  const inflate = part.inflate || 0
  const [sx, sy, sz] = part.size
  const w = sx + inflate
  const h = sy + inflate
  const d = sz + inflate
  // [uax, vax, wax, ud, vd, ww, hh, dd]
  const planes = [
    [2, 1, 0, -1, -1, d, h, w],
    [2, 1, 0, 1, -1, d, h, -w],
    [0, 2, 1, 1, 1, w, d, h],
    [0, 2, 1, 1, -1, w, d, -h],
    [0, 1, 2, 1, -1, w, h, d],
    [0, 1, 2, -1, -1, w, h, -d],
  ]
  const pos = [0, 0, 0, 0].map(() => [0, 0, 0])
  const uv = [0, 0, 0, 0].map(() => [0, 0])
  for (let f = 0; f < 6; f++) {
    const [uax, vax, wax, ud, vd, ww, hh, dd] = planes[f]
    const [rx, ry, tw, th] = regions[f]
    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) {
        const i = iy * 2 + ix
        const a = [0, 0, 0]
        a[uax] = (ix * ww - ww / 2) * ud
        a[vax] = (iy * hh - hh / 2) * vd
        a[wax] = dd / 2
        if (part.mirror) a[0] = -a[0]
        pos[i] = project(transformPoint(part.transform, a), frame.width, frame.height)
        uv[i][0] = rx + ix * tw
        uv[i][1] = ry + (f === 3 ? (1 - iy) * th : iy * th)
      }
    }
    for (const ids of [
      [0, 2, 1],
      [2, 3, 1],
    ]) {
      const area = edge(pos[ids[0]], pos[ids[1]], pos[ids[2]])
      // 外层（inflate>0）不剔除背面，才看得到内侧。
      if (inflate === 0 && (area >= 0) !== !!part.mirror) continue
      triangle(
        frame,
        [pos[ids[0]], pos[ids[1]], pos[ids[2]]],
        [uv[ids[0]], uv[ids[1]], uv[ids[2]]],
        f,
        part,
        skin,
      )
    }
  }
}

/**
 * 四边形（两个三角形）：眼皮薄片用。顶点已经是世界坐标，UV 是贴图坐标。
 * 对应 render.rs:2010 `eyelid()` / :1965 `pupil()` 的 corners + triangle 循环。
 * @param {{pos:number[][], uv:number[][], face?:number}} quad
 */
export function drawQuad(frame, quad, skin) {
  const face = quad.face ?? 4
  const pos = quad.pos.map((p) => project(p, frame.width, frame.height))
  for (const ids of [
    [0, 2, 1],
    [2, 3, 1],
  ]) {
    triangle(
      frame,
      [pos[ids[0]], pos[ids[1]], pos[ids[2]]],
      [quad.uv[ids[0]], quad.uv[ids[1]], quad.uv[ids[2]]],
      face,
      quad,
      skin,
    )
  }
}

/**
 * 屏幕空间贴图绘制（音符粒子）。对应 render_effects.rs:274 `self.overlay(...)` 的
 * 逐像素缩放：不加深度测试，直接按人物之后绘制的顺序覆盖。
 * @param {object} tex textureFromImage 的结果
 * @param {number} cx 屏幕 x（中心）
 * @param {number} cy 屏幕 y（中心）
 * @param {number} size 屏幕边长（像素）
 * @param {number[]} tint 三通道乘数 0..1
 * @param {number} alpha 0..1
 */
export function drawSprite(frame, tex, cx, cy, size, tint, alpha) {
  if (alpha <= 0.004) return
  const n = Math.max(1, Math.round(size))
  const x0 = Math.round(cx - n / 2)
  const y0 = Math.round(cy - n / 2)
  const txScale = tex.width / n
  const tyScale = tex.height / n
  for (let yy = 0; yy < n; yy++) {
    const py = y0 + yy
    if (py < 0 || py >= frame.height) continue
    const ty = Math.min(tex.height - 1, Math.floor(yy * tyScale))
    for (let xx = 0; xx < n; xx++) {
      const px = x0 + xx
      if (px < 0 || px >= frame.width) continue
      const ti = (ty * tex.width + Math.min(tex.width - 1, Math.floor(xx * txScale))) * 4
      const srcA = tex.rgba[ti + 3]
      if (srcA < 16) continue
      const a = Math.min(255, (srcA * alpha) | 0)
      if (a < 4) continue
      const r = Math.min(255, tex.rgba[ti] * tint[0]) | 0
      const g = Math.min(255, tex.rgba[ti + 1] * tint[1]) | 0
      const b = Math.min(255, tex.rgba[ti + 2] * tint[2]) | 0
      const i = py * frame.width + px
      const o = i * 4
      const inv = 255 - a
      frame.pixels[o] = ((b * a + frame.pixels[o] * inv + 127) / 255) | 0
      frame.pixels[o + 1] = ((g * a + frame.pixels[o + 1] * inv + 127) / 255) | 0
      frame.pixels[o + 2] = ((r * a + frame.pixels[o + 2] * inv + 127) / 255) | 0
      frame.pixels[o + 3] = (a + (frame.pixels[o + 3] * inv + 127) / 255) | 0
      if (px < frame.bounds[0]) frame.bounds[0] = px
      if (py < frame.bounds[1]) frame.bounds[1] = py
      if (px + 1 > frame.bounds[2]) frame.bounds[2] = px + 1
      if (py + 1 > frame.bounds[3]) frame.bounds[3] = py + 1
    }
  }
}

/**
 * 统一渲染入口：盒子、纯色盒子（装饰）与四边形（眼皮）混在一个 parts 列表里。
 * parts 元素约定：`kind:'quad'` → drawQuad；带 `solid` → 用 1×1 纯色材质画盒子。
 */
export function drawParts(frame, parts, skin) {
  for (const part of parts) {
    if (part.kind === 'quad') drawQuad(frame, part, skin)
    else if (part.solid) drawBox(frame, part, solidSkin(part.solid))
    else drawBox(frame, part, skin)
  }
}

function edge(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

function triangle(frame, p, uv, face, part, skin) {
  const area = edge(p[0], p[1], p[2])
  if (Math.abs(area) < 0.0001) return
  const minx = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])))
  const maxx = Math.min(frame.width, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])))
  const miny = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])))
  const maxy = Math.min(frame.height, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])))
  if (minx >= maxx || miny >= maxy) return
  const texscale = skin.width / 64
  const invArea = 1 / area
  const ax = -(p[2][1] - p[1][1]) * invArea
  const ay = (p[2][0] - p[1][0]) * invArea
  const cx = -(p[1][1] - p[0][1]) * invArea
  const cy = (p[1][0] - p[0][0]) * invArea
  const origin = [minx + 0.5, miny + 0.5, 0]
  const a0 = edge(p[1], p[2], origin) * invArea
  const c0 = edge(p[0], p[1], origin) * invArea
  const za = p[0][2] - p[1][2]
  const zc = p[2][2] - p[1][2]
  const tex = uv.map((t) => [t[0] * texscale, t[1] * texscale])
  const ta = [tex[0][0] - tex[1][0], tex[0][1] - tex[1][1]]
  const tc = [tex[2][0] - tex[1][0], tex[2][1] - tex[1][1]]
  const texW = skin.width
  const texH = skin.height
  const texData = skin.rgba
  const lut = skin.lut

  // 8.8 定点 + top-left rule：共享边只归一个三角形。
  const points = p.map((v) => [Math.round(v[0] * 256), Math.round(v[1] * 256)])
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ].map(([i, j]) => {
    const s = area > 0 ? points[i] : points[j]
    const e = area > 0 ? points[j] : points[i]
    const dx = e[0] - s[0]
    const dy = e[1] - s[1]
    const bias = dy < 0 || (dy === 0 && dx > 0) ? 0 : -1
    const start = dx * (miny * 256 + 128 - s[1]) - dy * (minx * 256 + 128 - s[0]) + bias
    return [dx, dy, start]
  })

  for (let y = miny; y < maxy; y++) {
    const rowA = a0 + (y - miny) * ay
    const rowC = c0 + (y - miny) * cy
    const coverage = edges.map(([dx, , start]) => start + dx * (y - miny) * 256)
    for (let x = minx; x < maxx; x++) {
      if (
        coverage[0] - edges[0][1] * (x - minx) * 256 < 0 ||
        coverage[1] - edges[1][1] * (x - minx) * 256 < 0 ||
        coverage[2] - edges[2][1] * (x - minx) * 256 < 0
      ) {
        continue
      }
      const a = rowA + (x - minx) * ax
      const c = rowC + (x - minx) * cx
      const z = p[1][2] + za * a + zc * c
      const i = y * frame.width + x
      if (z >= frame.depth[i]) continue
      const tx = tex[1][0] + ta[0] * a + tc[0] * c
      const ty = tex[1][1] + ta[1] * a + tc[1] * c
      const xx = Math.max(0, Math.min(texW - 1, Math.floor(tx)))
      const yy = Math.max(0, Math.min(texH - 1, Math.floor(ty)))
      const ti = (yy * texW + xx) * 4
      const alpha = texData[ti + 3]
      if (alpha < 16) continue
      // 采样时按面明暗查 LUT（等价于 MDP 预计算的 colors[face]）。
      const off = face * 768
      const r = lut[off + texData[ti]]
      const g = lut[off + 256 + texData[ti + 1]]
      const b = lut[off + 512 + texData[ti + 2]]
      const o = i * 4
      if (alpha === 255) {
        frame.pixels[o] = b
        frame.pixels[o + 1] = g
        frame.pixels[o + 2] = r
        frame.pixels[o + 3] = 255
      } else {
        const inv = 255 - alpha
        frame.pixels[o] = ((b * alpha + frame.pixels[o] * inv + 127) / 255) | 0
        frame.pixels[o + 1] = ((g * alpha + frame.pixels[o + 1] * inv + 127) / 255) | 0
        frame.pixels[o + 2] = ((r * alpha + frame.pixels[o + 2] * inv + 127) / 255) | 0
        frame.pixels[o + 3] = (alpha + (frame.pixels[o + 3] * inv + 127) / 255) | 0
      }
      frame.depth[i] = z
      if (x < frame.bounds[0]) frame.bounds[0] = x
      if (y < frame.bounds[1]) frame.bounds[1] = y
      if (x + 1 > frame.bounds[2]) frame.bounds[2] = x + 1
      if (y + 1 > frame.bounds[3]) frame.bounds[3] = y + 1
    }
  }
}

/** 预乘 BGRA → 非预乘 RGBA（对应 Frame::rgba）。 */
export function toImageData(frame) {
  const src = frame.pixels
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]
    if (a === 0) continue
    out[i] = Math.min(255, Math.floor((src[i + 2] * 255) / a))
    out[i + 1] = Math.min(255, Math.floor((src[i + 1] * 255) / a))
    out[i + 2] = Math.min(255, Math.floor((src[i] * 255) / a))
    out[i + 3] = a
  }
  return out
}

// ---- 4×4 仿射矩阵（行主序，仅用得上平移/旋转/缩放） ----

export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function translate(x, y, z) {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]
}

/** 等比缩放（对应 glam 的 `Mat4::from_scale(Vec3::splat(k))`）。 */
export function scale(x, y, z) {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
}

export function multiply(a, b) {
  const o = new Array(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c]
    }
  }
  return o
}

export function transformPoint(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
  ]
}
