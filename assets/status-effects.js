// 状态粒子：waiting 问号 / thinking 灯泡 / error 感叹号 / done 烟花。
//
// 素材来源：
//   - 问号位图取自 Minecraft-Desktop-Pet (MIT) — native/src/render_effects.rs:247
//     （7 行 × 5 列，原代码注释 "Original seven-row pixel question mark; solid pink and shadow"）
//   - 灯泡、感叹号、烟花为自绘的 8×8 像素图案 / 纯粒子，**不含任何 Mojang 资产**
//     所以不需要进 THIRD_PARTY_NOTICES 的资产表。
//
// 做法与音符一致：图标先做成「白色形状纹理」，绘制时用 tint 上色；
// 阴影是同一张纹理偏移 0.6 个像素再画一遍（照 MDP 的双层画法）。
// 全部走 drawSprite 的屏幕空间 blit，画在人物之后。

import { project, transformPoint, drawSprite, textureFromImage } from './skin-render.js'

/** 状态 → 图标。done 不走图标，它是一次性烟花。 */
const ICON_BY_STATE = { waiting: 'question', thinking: 'bulb', error: 'bang' }

const SHAPES = {
  question: {
    layers: [
      {
        rows: [
          '..###...',
          '.##.##..',
          '....##..',
          '...##...',
          '...#....',
          '........',
          '...#....',
          '........',
        ],
        chars: '#',
        color: [255, 158, 199],
        shadow: [98, 46, 77],
      },
    ],
  },
  bulb: {
    layers: [
      {
        rows: [
          '..####..',
          '.######.',
          '########',
          '########',
          '########',
          '.######.',
          '..####..',
          '........',
        ],
        chars: '#',
        color: [255, 214, 90],
        shadow: [150, 96, 20],
      },
      {
        rows: [
          '........',
          '........',
          '........',
          '........',
          '........',
          '........',
          '........',
          '..====..',
        ],
        chars: '=',
        color: [152, 152, 162],
        shadow: [64, 64, 72],
      },
    ],
  },
  bang: {
    layers: [
      {
        rows: [
          '..###...',
          '..###...',
          '..###...',
          '..###...',
          '..###...',
          '........',
          '..###...',
          '........',
        ],
        chars: '#',
        color: [232, 72, 72],
        shadow: [96, 24, 24],
      },
    ],
  },
}

/** 烟花配色，取自 MC 的染料色板。 */
const FIREWORK_COLORS = [
  [255, 92, 92],
  [255, 196, 64],
  [120, 220, 120],
  [96, 180, 255],
  [200, 128, 255],
  [255, 255, 255],
]

/** 图标/烟花的基准边长：每单位 5.6 px（原来 4.2，用户要求大一点）。 */
const ICON_SCALE = 5.6
/** 每波烟花颗数。 */
const BURST_COUNT = 18
/** 相邻两波烟花的间隔（秒）。done 持续 3s，能连爆约 5 波。 */
const BURST_INTERVAL = 0.6
/** 同时存在的粒子上限。 */
const MAX_PARTICLES = 60

/** 白色形状 → 纹理（1×1 也会用到，见 DOT）。 */
function shapeTexture(rows, chars) {
  const h = rows.length
  const w = rows[0].length
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!chars.includes(rows[y][x])) continue
      const i = (y * w + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
  }
  return textureFromImage({ width: w, height: h, data })
}

const DOT = shapeTexture(['#'], '#')

/** 把 0..255 的颜色转成 drawSprite 要的 0..1 乘数。 */
const tintOf = (rgb) => [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]

const LAYER_TEXTURES = new Map()
function layerTex(name, index, rows, chars) {
  const key = `${name}:${index}`
  if (!LAYER_TEXTURES.has(key)) LAYER_TEXTURES.set(key, shapeTexture(rows, chars))
  return LAYER_TEXTURES.get(key)
}

export class StatusEffects {
  /** @param {{rng?: () => number}} opts rng 供测试注入确定性方向 */
  constructor({ rng = Math.random } = {}) {
    this.rng = rng
    this.state = null
    this.particles = []
    /** 下一波烟花的时刻；done 期间每 BURST_INTERVAL 补一波。 */
    this.nextBurst = 0
  }

  /** 状态变化时起爆；done 期间持续补波。返回当前存活粒子数。 */
  update(now, state) {
    if (state !== this.state) {
      this.state = state
      this.nextBurst = now
    }
    if (this.state === 'done' && now >= this.nextBurst) {
      this._burst(now)
      this.nextBurst = now + BURST_INTERVAL
    }
    if (this.particles.length) this.particles = this.particles.filter((p) => now - p.start < p.life)
    return this.particles.length
  }

  get active() {
    return this.particles.length > 0 || this.state in ICON_BY_STATE
  }

  _burst(now) {
    // 一波从头顶炸开：方向均布 + 随机偏移，初速 55~115 px/s，带向上抛与重力。
    // 每波起爆点再横向抖 ±12px、纵向 ±6px，连爆时才像一串烟花而不是同一个环。
    const ox = (this.rng() - 0.5) * 24
    const oy = (this.rng() - 0.5) * 12
    for (let i = 0; i < BURST_COUNT; i++) {
      // 方向半均布 + ±0.6 rad 抖动、速度 45~140 px/s 拉大差异：波内不成规整的圆环。
      const angle = ((i + 0.5) / BURST_COUNT) * Math.PI * 2 + (this.rng() - 0.5) * 1.2
      const speed = 45 + this.rng() * 95
      this.particles.push({
        start: now,
        life: 0.9 + this.rng() * 0.5,
        ox,
        oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        size: 3 + Math.floor(this.rng() * 4),
        color: FIREWORK_COLORS[i % FIREWORK_COLORS.length],
      })
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES)
  }

  /**
   * 绘制。图标与粒子都挂在头顶 `(0, 头半高 + 0.5, 0)` 的投影点上。
   * @param {object} headPart buildParts 里 key === 'head' 且 inflate 为 0 的那个
   */
  draw(frame, headPart, now) {
    if (!headPart) return
    const top = transformPoint(headPart.transform, [0, headPart.size[1] / 2 + 0.5, 0])
    const origin = project(top, frame.width, frame.height)
    const scale = frame.width / 44

    const icon = ICON_BY_STATE[this.state]
    if (icon) this._icon(frame, icon, origin, scale, now)

    if (this.particles.length) {
      const size = Math.max(16, ICON_SCALE * scale)
      const baseY = origin[1] - 2 * scale - 0.2 * size
      for (const p of this.particles) {
        const t = now - p.start
        const alpha = Math.max(0, 1 - t / p.life)
        // 重力 120 px/s²
        const x = origin[0] + p.ox + p.vx * t
        const y = baseY + p.oy + p.vy * t + 120 * t * t
        drawSprite(frame, DOT, x, y, p.size, tintOf(p.color), alpha)
      }
    }
  }

  _icon(frame, name, origin, scale, now) {
    const def = SHAPES[name]
    const size = Math.max(16, ICON_SCALE * scale)
    const unit = size / 8
    // 各自的待机小动作：问号上下漂、灯泡呼吸、感叹号抖（呼应 error 的摇头）。
    let bob = 0
    let sway = 0
    if (name === 'question') bob = Math.sin(now * 2.6) * unit * 0.45
    else if (name === 'bulb') bob = Math.sin(now * 3.1) * unit * 0.35
    else if (name === 'bang') sway = Math.sin(now * 26) * unit * 0.35

    const cx = origin[0] + sway
    // MDP 的公式是 origin.y - 2s - 4s·height - size/2，但那是 360×420 画布、头顶更高；
    // 我们 352×416 里站立头顶只到 y≈66，照搬会把图标顶出画布。改成贴头顶上方一小段，
    // 再 clamp 到画布内（抬手/跳起时头顶会更高）。
    const cy = Math.max(size / 2 + 2, origin[1] - size / 2 - 0.9 * scale + bob)

    for (let i = 0; i < def.layers.length; i++) {
      const layer = def.layers[i]
      const tex = layerTex(name, i, layer.rows, layer.chars)
      // 阴影先画、偏移 0.6 格（MDP 的双层画法）。
      drawSprite(frame, tex, cx + unit * 0.6, cy + unit * 0.6, size, tintOf(layer.shadow), 1)
      drawSprite(frame, tex, cx, cy, size, tintOf(layer.color), 1)
    }
  }
}
