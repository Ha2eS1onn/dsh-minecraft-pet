// 敲字浮现字的第二半：Letter 场（plan.md §17）。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render_effects.rs:314-340
//
// 一条字的一生：按键时把「键在键盘顶面的模型坐标」记下来 → 每帧投影到屏幕 →
// 随时间向上飘 + 二次方淡出 → 画两遍（暗色阴影 + 亮色正字）。
// 与音符的区别：音符挂在头顶、由音频驱动；浮现字挂在键盘上、由按键驱动。

import { project } from './skin-render.js'

/** 一枚字活多久（秒）。 */
export const LETTER_LIFE = 0.8
/** 同屏上限，超出丢最老的（MDP 也是 64）。 */
export const LETTER_MAX = 64
/** 一生的上升量，模型单位（MDP `rise = 10.8`）。 */
export const LETTER_RISE = 10.8
/** 屏幕上字的边长（像素）。MDP 是 `(24 * width/360).ceil()`，352 宽下约 24。 */
export const LETTER_SIZE = 24
/** 糖果色 9 选 1（MDP 的 letters palette）。量纲是 0..1 乘数，drawSprite 会乘在白色字模上。 */
const PALETTE_RGB = [
  [255, 120, 150],
  [255, 190, 90],
  [140, 220, 140],
  [120, 200, 255],
  [190, 160, 255],
  [255, 150, 90],
  [120, 230, 220],
  [250, 240, 120],
  [255, 120, 200],
]
export const LETTER_COLORS = PALETTE_RGB.map((c) => c.map((v) => v / 255))

/** 阴影色（MDP `letter()` pass 0 的 `[70,45,70]`，同样换算成 0..1）。 */
const SHADOW_TINT = [70 / 255, 45 / 255, 70 / 255]

/**
 * 单字模的横向步进：墨迹列跨度 + 3 格边距（MDP `label()` 的 `(right-left+3)*scale`）。
 * 比例缓存在 tex 上，94 个字模只扫一次；没有墨的字给一个默认宽度。
 */
function advanceOf(tex, size) {
  if (tex.advanceRatio == null) {
    let left = tex.width
    let right = -1
    for (let y = 0; y < tex.height; y++) {
      for (let x = 0; x < tex.width; x++) {
        if (tex.rgba[(y * tex.width + x) * 4 + 3] >= 128) {
          if (x < left) left = x
          if (x > right) right = x
        }
      }
    }
    const cols = right >= left ? right - left + 4 : 11
    tex.advanceRatio = cols / tex.width
  }
  return tex.advanceRatio * size
}

export class LetterField {
  constructor({ max = LETTER_MAX } = {}) {
    this.max = max
    /** @type {{pos:number[], label:string, start:number, color:number[]}[]} */
    this.items = []
    this.seq = 0
  }

  /**
   * @param {number[]} pos 模型空间坐标（键盘顶面该键的位置）
   * @param {string} label 要显示的文字（单字符或键名）
   * @param {number} now 秒
   */
  push(pos, label, now) {
    if (!pos || !label) return null
    const item = {
      pos: [pos[0], pos[1], pos[2]],
      label: String(label).slice(0, 5),
      start: now,
      color: LETTER_COLORS[this.seq % LETTER_COLORS.length],
    }
    this.seq += 1
    this.items.push(item)
    // 超出上限丢最老的：连打时不能越积越多
    while (this.items.length > this.max) this.items.shift()
    return item
  }

  /** 清掉过期的。每帧调用一次（与 NoteField 同节奏）。 */
  update(now) {
    if (!this.items.length) return
    let keep = 0
    for (let i = 0; i < this.items.length; i++) {
      if (now - this.items[i].start < LETTER_LIFE) this.items[keep++] = this.items[i]
    }
    this.items.length = keep
  }

  get active() {
    return this.items.length > 0
  }

  get count() {
    return this.items.length
  }

  /** 帧需求分级用：还有字在飘就别降帧。 */
  get busy() {
    return this.active
  }

  /**
   * @param {object} frame createFrame 产出的帧（用 width 算投影缩放）
   * @param {Map<string, object>} glyphs buildGlyphs 的结果
   * @param {number} now 秒
   * @param {(frame:object, tex:object, cx:number, cy:number, size:number, tint:number[], alpha:number)=>void} blit
   *   drawSprite；显式传进来，避免本模块依赖渲染器内部实现
   */
  draw(frame, glyphs, now, blit) {
    if (!this.items.length || !glyphs || typeof blit !== 'function') return 0
    const scale = frame.width / 44 // 与 project 同一把尺：44 单位铺满画布宽
    let drawn = 0
    for (const item of this.items) {
      const t = (now - item.start) / LETTER_LIFE
      if (t < 0 || t >= 1) continue
      // 逐字符排版（MDP `label()`）：'Space' / 'Enter' / 'F12' 这类多字符键名
      // 在 94 个单字模里查不到整串，必须拆开横排，否则这些键永远不显示。
      const chars = []
      let total = 0
      for (const ch of item.label) {
        const tex = glyphs.get(ch)
        if (!tex) continue
        const adv = advanceOf(tex, LETTER_SIZE)
        chars.push({ tex, adv })
        total += adv
      }
      if (!chars.length) continue
      const p = project(item.pos, frame.width, frame.height)
      // 向上飘 + 二次方淡出（MDP：alpha = 1 - t*t）
      const y = p[1] - LETTER_RISE * t * scale
      const alpha = 1 - t * t
      let x = p[0] - total / 2
      for (const c of chars) {
        const cx = x + c.adv / 2
        blit(frame, c.tex, cx + 1, y + 1, LETTER_SIZE, SHADOW_TINT, alpha * 0.45)
        blit(frame, c.tex, cx, y, LETTER_SIZE, item.color, alpha)
        x += c.adv
        drawn++
      }
    }
    return drawn
  }

  clear() {
    this.items.length = 0
  }
}
