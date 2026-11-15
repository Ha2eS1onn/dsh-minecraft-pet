// P2-c 自检：键名映射 / 键位表 / 字模 / Letter 场 / 与渲染器的集成。
// 用法：node tools/test-letters.mjs

import fs from 'node:fs'
import { decodePng, encodePng } from './png.mjs'
import {
  createFrame,
  clearFrame,
  skinFromImage,
  drawParts,
  drawSprite,
  toImageData,
  project,
  transformPoint,
} from '../assets/skin-render.js'
import { buildParts } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'
import {
  keyLabelFromEvent,
  keyPositionFromCode,
  buildGlyphs,
  defaultCharset,
  GLYPH_CELL,
  KEY_POSITION_COUNT,
} from '../assets/type-letters.js'
import { LetterField, LETTER_LIFE, LETTER_MAX, LETTER_RISE, LETTER_SIZE, LETTER_COLORS } from '../assets/letters.js'

let failed = 0
let total = 0
const check = (name, ok, detail = '') => {
  total++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

const W = 352
const H = 416
const ev = (key, extra = {}) => ({ key, code: '', isComposing: false, ...extra })

// ---------------------------------------------------------------- 1) 键名映射
{
  check('普通字母', keyLabelFromEvent(ev('a')) === 'a')
  check('大写字母', keyLabelFromEvent(ev('A', { shiftKey: true })) === 'A')
  check('数字', keyLabelFromEvent(ev('7')) === '7')
  check('空格显示成 Space', keyLabelFromEvent(ev(' ')) === 'Space')
  check('回车', keyLabelFromEvent(ev('Enter')) === 'Enter')
  check('修饰键', keyLabelFromEvent(ev('Shift')) === 'Shift' && keyLabelFromEvent(ev('Control')) === 'Ctrl')
  check('功能键', keyLabelFromEvent(ev('F5')) === 'F5' && keyLabelFromEvent(ev('F12')) === 'F12')
  check('方向键', keyLabelFromEvent(ev('ArrowUp')) === 'Up')
  check('中文输入法组合期跳过', keyLabelFromEvent(ev('Process', { isComposing: true })) === null)
  check('keyCode 229 跳过', keyLabelFromEvent(ev('a', { keyCode: 229 })) === null)
  check('Unidentified 跳过', keyLabelFromEvent(ev('Unidentified')) === null)
  check('空事件不炸', keyLabelFromEvent(null) === null && keyLabelFromEvent({}) === null)
}

// ---------------------------------------------------------------- 2) 键位表
{
  const a = keyPositionFromCode('KeyA')
  const p = keyPositionFromCode('KeyP')
  const space = keyPositionFromCode('Space')
  const one = keyPositionFromCode('Digit1')
  const zero = keyPositionFromCode('Digit0')
  const bs = keyPositionFromCode('Backspace')
  check('键位表覆盖六行主键盘（70+ 个键）', KEY_POSITION_COUNT >= 70, String(KEY_POSITION_COUNT))
  check('常用键都有位置', ['Escape', 'F1', 'KeyQ', 'KeyP', 'KeyA', 'KeyL', 'KeyZ', 'KeyM', 'Space', 'Enter', 'ShiftLeft', 'ControlRight'].every((c) => !!keyPositionFromCode(c)))
  check('六行都被填到（6 个不同的 z）', new Set(['Escape', 'Digit1', 'KeyQ', 'KeyA', 'KeyZ', 'Space'].map((c) => keyPositionFromCode(c)[1].toFixed(2))).size === 6)
  check('A 在 P 左边', a[0] < p[0], `${a[0].toFixed(2)} vs ${p[0].toFixed(2)}`)
  // 60% 键盘空格行左边 3 个修饰键、右边 4 个（多一个 ContextMenu），
  // 空格本来就不严格居中；偏 0.82 单位是物理布局的真实结果。
  check('空格基本居中', Math.abs(space[0]) < 1.0, space[0].toFixed(2))
  check('空格在最下面一行', space[1] > 3, space[1].toFixed(2))
  check('数字行 1 在 0 左边', one[0] < zero[0])
  check('退格在数字行最右', bs[0] > zero[0], `${bs[0].toFixed(2)} vs ${zero[0].toFixed(2)}`)
  check('所有键都在键盘盒内（±9.8 / ±3.9）', ['Escape', 'Backspace', 'Space', 'ControlRight', 'KeyQ'].every((c) => {
    const q = keyPositionFromCode(c)
    return Math.abs(q[0]) <= 9.81 && Math.abs(q[1]) <= 3.91
  }))
  check('未知键返回 null', keyPositionFromCode('MediaPlayPause') === null && keyPositionFromCode(undefined) === null)
}

// ---------------------------------------------------------------- 3) 字模
{
  // 假的「光栅化」：只有中心 8×8 是墨（alpha 255），其余 alpha 100（低于阈值）
  const fake = (ch, cell) => {
    const out = new Uint8ClampedArray(cell * cell * 4)
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = (y * cell + x) * 4
        const ink = x >= cell / 2 - 4 && x < cell / 2 + 4 && y >= cell / 2 - 4 && y < cell / 2 + 4
        out[i] = 200
        out[i + 1] = 200
        out[i + 2] = 200
        out[i + 3] = ink ? 255 : 100
      }
    }
    return out
  }
  const g = buildGlyphs(fake, ['A', 'B'])
  check('造出两个字模', g.size === 2)
  const tex = g.get('A')
  check('字模尺寸 = 24×24', tex.width === GLYPH_CELL && tex.height === GLYPH_CELL)
  let ink = 0
  let white = 0
  for (let i = 0; i < tex.rgba.length; i += 4) {
    if (tex.rgba[i + 3] === 255) ink++
    if (tex.rgba[i] === 255 && tex.rgba[i + 1] === 255 && tex.rgba[i + 2] === 255) white++
  }
  check('阈值化：只留 alpha>=128 的像素', ink === 64, String(ink))
  check('墨色统一成白色（颜色交给 tint）', white === ink)
  check('默认字符集是 94 个可打印 ASCII', defaultCharset().length === 94)
  check('光栅化失败时不产出空字模', buildGlyphs(() => null, ['A']).size === 0)
}

// ---------------------------------------------------------------- 4) Letter 场
{
  const blitCalls = []
  const blit = (frame, tex, cx, cy, size, tint, alpha) => blitCalls.push({ cx, cy, size, tint, alpha })
  const f = new LetterField()
  const field = new LetterField()
  const mk = (n) => {
    for (let i = 0; i < n; i++) field.push([0, 10, 9], 'A', 0)
  }
  void f
  mk(3)
  check('push 累加', field.count === 3)
  mk(LETTER_MAX + 10)
  check('上限 64 条（丢最老的）', field.count === LETTER_MAX, String(field.count))

  const one = new LetterField()
  one.push([0, 10, 9], 'A', 0)
  check('未过期时 active', one.active === true)
  one.update(LETTER_LIFE * 0.5)
  check('半程仍在', one.count === 1)
  one.update(LETTER_LIFE + 0.01)
  check('过期后被清掉', one.count === 0 && one.active === false)

  // 绘制：假的 glyphs + 假的 blit，检查升起与淡出
  const stubGlyph = () => ({ width: 24, height: 24, rgba: new Uint8ClampedArray(24 * 24 * 4) })
  const glyphs = new Map([['A', stubGlyph()], ['B', stubGlyph()]])
  const frame = { width: W, height: H }
  const early = new LetterField()
  early.push([0, 10, 9], 'A', 0)
  blitCalls.length = 0
  early.draw(frame, glyphs, 0, blit)
  // 一次 draw 画两遍：[0] 是阴影（+1px）、[1] 是正字。比较升起量要取同一遍。
  const y0 = blitCalls[1].cy
  const a0 = blitCalls[1].alpha
  void a0
  check('一枚字画两遍（阴影 + 正字）', blitCalls.length === 2, String(blitCalls.length))
  check('阴影先画、且在右下偏移 1px', blitCalls[0].cx === blitCalls[1].cx + 1 && blitCalls[0].cy === blitCalls[1].cy + 1)
  check('字的尺寸 = LETTER_SIZE', blitCalls[1].size === LETTER_SIZE)
  check('糖果色是 0..1 乘数（drawSprite 会乘在白字模上）', LETTER_COLORS.length === 9 && LETTER_COLORS.every((c) => c.length === 3 && c.every((v) => v >= 0 && v <= 1)))
  check('正字带糖果色（不是白色）', blitCalls[1].tint.every((v, i) => Math.abs(v - LETTER_COLORS[0][i]) < 1e-9))

  blitCalls.length = 0
  early.draw(frame, glyphs, LETTER_LIFE * 0.5, blit)
  const y1 = blitCalls[1].cy
  const a1 = blitCalls[1].alpha
  check('随时间向上飘', y1 < y0, `${y0.toFixed(1)} → ${y1.toFixed(1)}`)
  check('上升量符合 rise·t·scale', Math.abs(y0 - y1 - LETTER_RISE * 0.5 * (W / 44)) < 0.01, (y0 - y1).toFixed(2))
  check('透明度二次方衰减', Math.abs(a1 - 0.75) < 1e-6, a1.toFixed(3))

  // 多字符键名（Space / Enter / F12）在字模表里没有整串，必须逐字符横排
  const multi = new LetterField()
  multi.push([0, 10, 9], 'AB', 0)
  blitCalls.length = 0
  multi.draw(frame, glyphs, 0, blit)
  check('多字符键名逐字符画（AB → 4 次 blit）', blitCalls.length === 4, String(blitCalls.length))
  check('多字符左右排开（不是叠在一起）', blitCalls[1].cx < blitCalls[3].cx, `${blitCalls[1].cx} vs ${blitCalls[3].cx}`)

  const missing = new LetterField()
  missing.push([0, 10, 9], 'unknown', 0)
  blitCalls.length = 0
  check('没有字模时不画（不崩）', missing.draw(frame, glyphs, 0, blit) === 0 && blitCalls.length === 0)
}

// ---------------------------------------------------------------- 5) 与渲染器集成
{
  const skin = skinFromImage(decodePng(fs.readFileSync('assets/default-skin.png')))
  const working = targetPose('working')
  const parts = buildParts(working, skin, { outer: true, armWidth: 4 })
  const kb = parts.find((p) => p.key === 'keyboard')
  check('坐姿有键盘（浮现字的挂点）', !!kb)

  const pos = transformPoint(kb.transform, keyPositionFromCode('KeyG')[0] !== undefined ? [keyPositionFromCode('KeyG')[0], 0.3, keyPositionFromCode('KeyG')[1]] : [0, 0.3, 0])
  const screen = project(pos, W, H)

  // 字模：中心 10×10 的实心块，画出来一定能看见
  const solid = (ch, cell) => {
    const out = new Uint8ClampedArray(cell * cell * 4)
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = (y * cell + x) * 4
        const ink = Math.abs(x - cell / 2) < 5 && Math.abs(y - cell / 2) < 5
        out[i] = 255
        out[i + 1] = 255
        out[i + 2] = 255
        out[i + 3] = ink ? 255 : 0
      }
    }
    return out
  }
  const glyphs = buildGlyphs(solid)

  const field = new LetterField()
  field.push(pos, 'G', 0)
  const bare = createFrame(W, H)
  clearFrame(bare)
  drawParts(bare, parts, skin)
  const withLetter = createFrame(W, H)
  clearFrame(withLetter)
  drawParts(withLetter, parts, skin)
  field.draw(withLetter, glyphs, 0, drawSprite)

  const a = toImageData(bare)
  const b = toImageData(withLetter)
  // 字画在键盘**上方不透明区域**里，不会新增不透明像素；要比较颜色变化量。
  // （第一版断言用「新增 alpha 像素」，结果 0 px 假失败——见 HANDOFF §4）
  let changed = 0
  let minx = W
  let miny = H
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3])
      if (diff <= 8) continue
      changed++
      if (x < minx) minx = x
      if (y < miny) miny = y
    }
  }
  check('浮现字真的画上去了', changed > 40, `${changed} px changed`)
  check('画在键盘位置附近（不是画面别处）', Math.abs(minx - screen[0]) < 40 && Math.abs(miny - screen[1]) < 40, `${minx},${miny} vs ${screen[0].toFixed(0)},${screen[1].toFixed(0)}`)
  check('字在键盘上方（屏幕 y 更小）', miny < screen[1] + 20)

  // 站立姿态：没有键盘，也不该有字
  const stand = buildParts({ ...working, sit: 0 }, skin, { outer: true, armWidth: 4 })
  check('站立没有键盘部件', !stand.find((p) => p.key === 'keyboard'))
}

// ---------------------------------------------------------------- 6) 演示图（人眼复看用）
{
  const skin = skinFromImage(decodePng(fs.readFileSync('assets/default-skin.png')))
  const parts = buildParts(targetPose('working'), skin, { outer: true, armWidth: 4 })
  const kb = parts.find((p) => p.key === 'keyboard')
  const field = new LetterField()
  const seq = ['A', 'F', 'K', 'Space']
  const codes = ['KeyA', 'KeyF', 'KeyK', 'Space']
  for (let i = 0; i < seq.length; i++) {
    const off = keyPositionFromCode(codes[i])
    field.push(transformPoint(kb.transform, [off[0], 0.3, off[1]]), seq[i], i * 0.14)
  }
  // Node 里没有系统字体，用一份 5×7 点阵字模当替身（浏览器走 canvasRasterizer）。
  // 横条字模看不出「是不是字」，出验收图会误导，所以这里给真字形。
  const FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  }
  const bitmap = (ch, cell) => {
    const rows = FONT[ch.toUpperCase()]
    if (!rows) return null
    const out = new Uint8ClampedArray(cell * cell * 4)
    // 和浏览器 canvasRasterizer 一样：字形居中、两侧留白。
    // 铺满 24 格会让逐字符排版的步进小于字宽，字母互相压住（第一版演示图就是这样）。
    const dot = 3
    const ox = Math.floor((cell - 5 * dot) / 2)
    const oy = Math.floor((cell - 7 * dot) / 2)
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (rows[r][c] !== '1') continue
        for (let dy = 0; dy < dot; dy++) {
          for (let dx = 0; dx < dot; dx++) {
            const i = ((oy + r * dot + dy) * cell + ox + c * dot + dx) * 4
            out[i] = 255
            out[i + 1] = 255
            out[i + 2] = 255
            out[i + 3] = 255
          }
        }
      }
    }
    return out
  }
  const glyphs = buildGlyphs(bitmap)
  const frame = createFrame(W, H)
  clearFrame(frame)
  drawParts(frame, parts, skin)
  // 0.45s：越早按的飘得越高，四个字在垂直方向错开，不会挤成一团
  field.update(0.45)
  field.draw(frame, glyphs, 0.45, drawSprite)
  // 2× 最近邻放大：验收图里 24px 的点阵字太小，放大后一眼能看出字形
  const src = toImageData(frame)
  const Z = 2
  const zoom = new Uint8ClampedArray(W * Z * H * Z * 4)
  for (let y = 0; y < H * Z; y++) {
    const sy = Math.floor(y / Z)
    for (let x = 0; x < W * Z; x++) {
      zoom.set(src.subarray((sy * W + Math.floor(x / Z)) * 4, (sy * W + Math.floor(x / Z)) * 4 + 4), (y * W * Z + x) * 4)
    }
  }
  fs.writeFileSync('prototype/p2-letters.png', encodePng(W * Z, H * Z, zoom))
  console.log('      → prototype/p2-letters.png')
}

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}  (${total - failed} ok / ${failed} fail)`)
process.exit(failed === 0 ? 0 : 1)
