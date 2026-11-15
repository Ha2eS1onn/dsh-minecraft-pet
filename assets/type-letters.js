// 敲字浮现字的第一半：键名 + 键位表（plan.md §17）。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render_effects.rs:17-40, 314-325
//                                              native/src/render.rs:318 key_position()
//
// 字模**不在这里造**：`buildGlyphs(rasterize)` 收一个光栅化函数（浏览器传离屏 canvas，
// 自测传假的），这样模块在 node 里也能跑，且不需要打包任何字体文件。
//
// 键位表按物理键位（`event.code`）索引，与键盘印字无关——中文输入法下 code 仍然稳定。

/** 键位表归一化后的横向范围（模型单位，键盘盒 19.6 宽）。 */
const KB_HALF_W = 9.8
/** 键盘盒深度 7.8，均分给 6 行。 */
const KB_ROWS = 6
const KB_DEPTH = 7.8

/**
 * 六行键位，每项是 [code, 宽度系数]。宽度系数是标准 60% 键盘的相对宽度，
 * 每行独立归一化到 19.6 单位（鼠标键盘比真实键盘小，不值得按毫米还原）。
 */
const ROWS = [
  [
    ['Escape', 1],
    ['F1', 1], ['F2', 1], ['F3', 1], ['F4', 1], ['F5', 1], ['F6', 1],
    ['F7', 1], ['F8', 1], ['F9', 1], ['F10', 1], ['F11', 1], ['F12', 1],
  ],
  [
    ['Backquote', 1],
    ['Digit1', 1], ['Digit2', 1], ['Digit3', 1], ['Digit4', 1], ['Digit5', 1],
    ['Digit6', 1], ['Digit7', 1], ['Digit8', 1], ['Digit9', 1], ['Digit0', 1],
    ['Minus', 1], ['Equal', 1], ['Backspace', 2],
  ],
  [
    ['Tab', 1.5],
    ['KeyQ', 1], ['KeyW', 1], ['KeyE', 1], ['KeyR', 1], ['KeyT', 1],
    ['KeyY', 1], ['KeyU', 1], ['KeyI', 1], ['KeyO', 1], ['KeyP', 1],
    ['BracketLeft', 1], ['BracketRight', 1], ['Backslash', 1.5],
  ],
  [
    ['CapsLock', 1.75],
    ['KeyA', 1], ['KeyS', 1], ['KeyD', 1], ['KeyF', 1], ['KeyG', 1],
    ['KeyH', 1], ['KeyJ', 1], ['KeyK', 1], ['KeyL', 1],
    ['Semicolon', 1], ['Quote', 1], ['Enter', 2.25],
  ],
  [
    ['ShiftLeft', 2.25],
    ['KeyZ', 1], ['KeyX', 1], ['KeyC', 1], ['KeyV', 1], ['KeyB', 1], ['KeyN', 1], ['KeyM', 1],
    ['Comma', 1], ['Period', 1], ['Slash', 1], ['ShiftRight', 2.75],
  ],
  [
    ['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25],
    ['Space', 6.25],
    ['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25],
  ],
]

/** code → [x, z]（键盘盒局部坐标，中心为原点，y 取顶面在调用方加）。 */
const POSITIONS = new Map()
for (let r = 0; r < ROWS.length; r++) {
  const row = ROWS[r]
  let total = 0
  for (const [, w] of row) total += w
  let cursor = 0
  const z = -KB_DEPTH / 2 + ((r + 0.5) * KB_DEPTH) / KB_ROWS
  for (const [code, w] of row) {
    const x = -KB_HALF_W + ((cursor + w / 2) / total) * KB_HALF_W * 2
    POSITIONS.set(code, [x, z])
    cursor += w
  }
}

export const KEY_POSITION_COUNT = POSITIONS.size

/**
 * 物理键位 → 键在键盘盒上的局部 [x, z]。拿不到映射（媒体键、输入法键）返回 null，
 * 调用方据此决定「不显示」而不是瞎猜一个位置。
 */
export function keyPositionFromCode(code) {
  if (typeof code !== 'string') return null
  const p = POSITIONS.get(code)
  return p ? [p[0], p[1]] : null
}

/** 少数键的显示名（单字符键直接用 key 本身）。 */
const NAMED = {
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Bksp',
  Escape: 'Esc',
  CapsLock: 'Caps',
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Meta: 'Cmd',
  ArrowUp: 'Up',
  ArrowDown: 'Dn',
  ArrowLeft: 'Lt',
  ArrowRight: 'Rt',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

/**
 * KeyboardEvent → 要浮出来的文字。返回 null 表示这次按键不该显示。
 * 中文输入法组合期间 `key` 是 `Process`/`Unidentified`，一律跳过（plan.md §17.2）。
 */
export function keyLabelFromEvent(e) {
  if (!e) return null
  if (e.isComposing || e.keyCode === 229) return null
  const k = e.key
  if (typeof k !== 'string' || !k) return null
  if (k === 'Unidentified' || k === 'Process' || k === 'Dead') return null
  if (k.length === 1) return k === ' ' ? 'Space' : k
  if (/^F([1-9]|1[0-2])$/.test(k)) return k
  return NAMED[k] || null
}

/** 字模格子的边长（像素）。MDP 是 24×24 覆盖率位图，这里沿用。 */
export const GLYPH_CELL = 24
/** 阈值：alpha >= 该值算「墨」，据此把系统字体的抗锯齿压成像素感。 */
const INK_THRESHOLD = 128

/**
 * 造字模表。
 * @param {(ch: string, cell: number) => Uint8ClampedArray|null} rasterize
 *   返回 cell×cell 的 RGBA（浏览器传 canvas 版，自测传假的）；返回 null 表示这个字符画不出来
 * @param {string} [chars] 要造的字符集，默认可打印 ASCII
 * @returns {Map<string, {width:number, height:number, rgba:Uint8ClampedArray}>}
 */
export function buildGlyphs(rasterize, chars) {
  const set = chars || defaultCharset()
  const out = new Map()
  for (const ch of set) {
    let raw = null
    try {
      raw = rasterize(ch, GLYPH_CELL)
    } catch (err) {
      raw = null
    }
    if (!raw || raw.length < GLYPH_CELL * GLYPH_CELL * 4) continue
    const rgba = new Uint8ClampedArray(GLYPH_CELL * GLYPH_CELL * 4)
    let ink = 0
    for (let i = 0; i < rgba.length; i += 4) {
      if (raw[i + 3] >= INK_THRESHOLD) {
        // 白色 + 阈值化 alpha：颜色留给 tint，形状留成硬边像素
        rgba[i] = 255
        rgba[i + 1] = 255
        rgba[i + 2] = 255
        rgba[i + 3] = 255
        ink++
      }
    }
    if (!ink) continue
    out.set(ch, { width: GLYPH_CELL, height: GLYPH_CELL, rgba })
  }
  return out
}

/** 可打印 ASCII + 几个键名里会用到的字符。 */
export function defaultCharset() {
  const set = []
  for (let c = 33; c <= 126; c++) set.push(String.fromCharCode(c))
  return set
}

/**
 * 浏览器侧的默认光栅化器：离屏 canvas + 系统字体 + 居中 fillText。
 * 首次造 94 个字符约 5~10 ms（plan.md §17.2），结果由调用方缓存。
 */
export function canvasRasterizer(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null)
  if (!d || !d.createElement) return null
  let canvas = null
  let ctx = null
  return function rasterize(ch, cell) {
    if (!canvas) {
      canvas = d.createElement('canvas')
      canvas.width = cell
      canvas.height = cell
      ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
    }
    ctx.clearRect(0, 0, cell, cell)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 粗体 + 20px：MDP 用 20pt bold，这里同量级，24 格刚好装下
    ctx.font = 'bold 20px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.fillText(ch, cell / 2, cell / 2 + 1)
    const data = ctx.getImageData(0, 0, cell, cell).data
    return new Uint8ClampedArray(data)
  }
}
