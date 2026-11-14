// M3.5 视觉验收图：眨眼 / 音符 / 装饰 / 待机手势。
// 用法：node tools/compare-m35.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import {
  createFrame,
  clearFrame,
  skinFromImage,
  textureFromImage,
  drawParts,
  toImageData,
} from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'
import { PetAnimator } from '../assets/pet-anim.js'
import { NoteField } from '../assets/effects.js'
import { StatusEffects } from '../assets/status-effects.js'
import { decorationParts } from '../assets/decorations.js'
import { GestureScheduler } from '../assets/gestures.js'
import * as Q from '../assets/quat.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = (p) => decodePng(fs.readFileSync(path.join(root, p)))
const userSkin = skinFromImage(read('assets/default-skin.png'))
const noteTex = textureFromImage(read('assets/note.png'))
const heartTex = textureFromImage(read('assets/heart.png'))

const W = 352
const H = 416
const BG = [26, 26, 30]

function shot(parts, skin = userSkin) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, skin)
  return toImageData(f)
}

const headOf = (parts) => parts.find((p) => p.key === 'head' && !p.inflate)

/** 把若干 RGBA 帧按网格拼成一张图，每格可各自裁剪/放大。 */
function grid(cells, { cols = cells.length, bg = BG } = {}) {
  const cellW = Math.max(...cells.map((c) => c.w * (c.zoom || 1)))
  const cellH = Math.max(...cells.map((c) => c.h * (c.zoom || 1)))
  const rows = Math.ceil(cells.length / cols)
  const outW = cellW * cols + (cols + 1) * 6
  const outH = cellH * rows + (rows + 1) * 6
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg[0]
    out[i + 1] = bg[1]
    out[i + 2] = bg[2]
    out[i + 3] = 255
  }
  cells.forEach((cell, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const ox = 6 + col * (cellW + 6)
    const oy = 6 + row * (cellH + 6)
    for (let y = 0; y < cell.h; y++) {
      for (let x = 0; x < cell.w; x++) {
        const s = ((cell.y0 + y) * cell.srcW + cell.x0 + x) * 4
        const a = cell.rgba[s + 3]
        if (a === 0) continue
        const zoom = cell.zoom || 1
        for (let ry = 0; ry < zoom; ry++) {
          for (let rx = 0; rx < zoom; rx++) {
            const o = ((oy + y * zoom + ry) * outW + ox + x * zoom + rx) * 4
            const inv = 255 - a
            out[o] = (cell.rgba[s] * a + bg[0] * inv) / 255
            out[o + 1] = (cell.rgba[s + 1] * a + bg[1] * inv) / 255
            out[o + 2] = (cell.rgba[s + 2] * a + bg[2] * inv) / 255
            out[o + 3] = 255
          }
        }
      }
    }
  })
  return { outW, outH, out }
}

function write(outPath, g) {
  fs.writeFileSync(path.join(root, outPath), encodePng(g.outW, g.outH, g.out))
  console.log(`wrote ${outPath} (${g.outW}×${g.outH})`)
}

// ---------------------------------------------------------------- 1) 眨眼
{
  const img = read('assets/default-skin.png')
  const data = new Uint8ClampedArray(img.data)
  const put = (x, y, r, g, b) => {
    const i = (y * img.width + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  put(4, 6, 240, 60, 60)
  put(5, 6, 240, 60, 60)
  put(4, 7, 240, 240, 240)
  put(5, 7, 20, 20, 20)
  const blinkSkin = skinFromImage({ width: img.width, height: img.height, data })

  const frames = [1, 0.55, 0].map((eyelid) =>
    shot(buildParts({ ...defaultPose(), eyelid }, blinkSkin, { outer: true })),
  )
  // 睁眼 vs 闭眼的差异包围盒 → 裁剪脸部
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d =
        Math.abs(frames[0][i] - frames[2][i]) +
        Math.abs(frames[0][i + 1] - frames[2][i + 1]) +
        Math.abs(frames[0][i + 2] - frames[2][i + 2]) +
        Math.abs(frames[0][i + 3] - frames[2][i + 3])
      if (d > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const pad = 10
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad)
  maxY = Math.min(H - 1, maxY + pad)
  const cells = frames.map((rgba) => ({
    rgba,
    srcW: W,
    x0: minX,
    y0: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    zoom: 4,
  }))
  console.log(`blink crop x=${minX}..${maxX} y=${minY}..${maxY}`)
  write('prototype/m35-blink.png', grid(cells))
}

// ---------------------------------------------------------------- 2) 音符
{
  const parts = buildParts(targetPose('thinking'), userSkin, { outer: true })
  const head = headOf(parts)
  const field = new NoteField()
  field.notes = [
    { start: 0.18, phase: 0.9 },
    { start: 0.36, phase: 3.6 },
  ]
  const plain = shot(parts)
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, userSkin)
  field.draw(f, head, noteTex, 0.45)
  const withNotes = toImageData(f)

  // 裁头顶上方：人物包围盒顶部再往上 120px
  const top = Math.max(0, f.bounds[1] - 120)
  const cells = [plain, withNotes].map((rgba) => ({
    rgba,
    srcW: W,
    x0: 40,
    y0: top,
    w: W - 80,
    h: Math.min(H - top, 260),
    zoom: 2,
  }))
  write('prototype/m35-notes.png', grid(cells))
}

// ---------------------------------------------------------------- 3) 装饰
{
  const cells = ['none', 'rabbit', 'cat', 'heart', 'lollipop'].map((kind) => {
    const parts = buildParts(defaultPose(), userSkin, { outer: true })
    if (kind !== 'none') parts.push(...decorationParts(headOf(parts), kind, { heart: heartTex }))
    return { rgba: shot(parts), srcW: W, x0: 0, y0: 0, w: W, h: H, zoom: 1 }
  })
  write('prototype/m35-decorations.png', grid(cells, { cols: 5 }))
}

// ---------------------------------------------------------------- 4) 待机手势
{
  const rows = []
  for (const kind of ['stretch', 'tilt', 'sleepy']) {
    const sched = new GestureScheduler({ rng: () => 0.5 })
    sched.update(0, true)
    sched.trigger(kind, 1)
    const dur = { stretch: 3.0, tilt: 2.4, sleepy: 2.25 }[kind]
    for (const f of [0.35, 0.55, 0.8]) {
      const pose = sched.apply(defaultPose(), 1 + dur * f)
      rows.push({ rgba: shot(buildParts(pose, userSkin, { outer: true })), srcW: W, x0: 0, y0: 0, w: W, h: H, zoom: 1 })
    }
  }
  write('prototype/m35-gestures.png', grid(rows, { cols: 3 }))
}

// ---------------------------------------------------------------- 6) 坐姿键盘
{
  const cells = [0.45, 0.7, 1].map((sit) => {
    const parts = buildParts({ ...targetPose('working'), sit }, userSkin, { outer: true })
    return { rgba: shot(parts), srcW: W, x0: 0, y0: 0, w: W, h: H, zoom: 1 }
  })
  write('prototype/m35-keyboard.png', grid(cells, { cols: 3 }))
}

// ---------------------------------------------------------------- 7) 打字手 vs 键帽
{
  const anim = new PetAnimator(0)
  const sit = targetPose('working')
  const ctx = {
    width: W,
    height: H,
    armWidth: 4,
    state: 'working',
    settings: { breath: false, track: false, typing: true, gesture: false, blink: false },
  }
  const step = 1 / 60
  let t = 0
  let pose = sit
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      t += step
      pose = anim.update(sit, ctx, t, step)
    }
  }
  run(30)
  const hover = shot(buildParts(pose, userSkin, { outer: true }))
  anim.press(t)
  run(8)
  const right = shot(buildParts(pose, userSkin, { outer: true }))
  run(40)
  anim.press(t)
  run(8)
  const left = shot(buildParts(pose, userSkin, { outer: true }))

  // 裁剪：悬停 vs 按下的差异包围盒
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = Math.abs(hover[i] - right[i]) + Math.abs(hover[i + 1] - right[i + 1]) + Math.abs(hover[i + 2] - right[i + 2])
      if (d > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const pad = 26
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad)
  maxY = Math.min(H - 1, maxY + pad)
  const cells = [hover, right, left].map((rgba) => ({
    rgba,
    srcW: W,
    x0: minX,
    y0: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    zoom: 3,
  }))
  write('prototype/m35-typing-hands.png', grid(cells, { cols: 3 }))
}

// ---------------------------------------------------------------- 8) 伸懒腰细节
{
  const g = new GestureScheduler({ rng: () => 0.5 })
  g.update(0, true)
  g.trigger('stretch', 1)
  const cells = [0.25, 0.6, 1.0, 1.4, 1.8].map((t) => {
    const pose = g.apply(defaultPose(), 1 + t)
    return { rgba: shot(buildParts(pose, userSkin, { outer: true })), srcW: W, x0: 70, y0: 55, w: 220, h: 310, zoom: 2 }
  })
  write('prototype/m35-stretch.png', grid(cells, { cols: 5 }))
}

// ---------------------------------------------------------------- 9) 状态粒子
{
  const cells = []
  const shoot = (state, now, step = 0) => {
    const fx = new StatusEffects({ rng: () => 0.37 })
    if (step > 0) {
      // 按 step 逐帧推进，让 done 的连爆波次在图上体现出来
      for (let t = 0; t <= now + 1e-9; t += step) fx.update(t, state)
    } else {
      fx.update(0, state)
    }
    const parts = buildParts(targetPose(state), userSkin, { outer: true })
    const f = createFrame(W, H)
    clearFrame(f)
    drawParts(f, parts, userSkin)
    fx.draw(f, headOf(parts), now)
    cells.push({ rgba: toImageData(f), srcW: W, x0: 40, y0: 0, w: 272, h: 300, zoom: 2 })
  }
  shoot('waiting', 0.15)
  shoot('thinking', 0.15)
  shoot('error', 0.15)
  shoot('done', 1.3, 0.1)
  write('prototype/m35-status-effects.png', grid(cells, { cols: 4 }))
}

// ---------------------------------------------------------------- 10) working 里的伸懒腰
{
  const working = targetPose('working')
  const ctx = {
    width: W,
    height: H,
    armWidth: 4,
    state: 'working',
    settings: { breath: false, track: false, typing: true, blink: false, gesture: true },
  }
  const anim = new PetAnimator(0, { seed: 0.2 })
  anim.gestures.trigger('stretch', 0)
  const marks = [0.5, 1.5, 2.5]
  const cells = []
  for (let i = 0; i <= 150; i++) {
    const t = i / 60
    if (i % 9 === 0) anim.press(t) // 模拟打字，验证不会打断手势
    const pose = anim.update(working, ctx, t, 1 / 60)
    if (marks.some((m) => Math.abs(t - m) < 1e-6)) {
      cells.push({ rgba: shot(buildParts(pose, userSkin, { outer: true })), srcW: W, x0: 55, y0: 55, w: 250, h: 330, zoom: 2 })
    }
  }
  write('prototype/m35-stretch-working.png', grid(cells, { cols: 3 }))
}

// ---------------------------------------------------------------- 11) 状态专属动作
{
  const ctxOf = (state) => ({
    width: W,
    height: H,
    armWidth: 4,
    state,
    settings: { breath: false, track: false, typing: false, blink: false, gesture: false },
  })
  const add = (cells, state, mark) => {
    const anim = new PetAnimator(0, { seed: 0.2 })
    const ctx = ctxOf(state)
    const base = targetPose(state)
    let pose = base
    const steps = Math.round(mark * 60)
    for (let i = 0; i <= steps; i++) pose = anim.update(base, ctx, i / 60, 1 / 60)
    cells.push({
      rgba: shot(buildParts(pose, userSkin, { outer: true })),
      srcW: W,
      x0: 60,
      y0: 20,
      w: 240,
      h: 350,
      zoom: 2,
    })
  }
  const cells = []
  add(cells, 'thinking', 0.3) // 挠头：手在后
  add(cells, 'thinking', 0.65) // 挠头：手在前
  add(cells, 'waiting', 0.39) // 第一跳最高点
  add(cells, 'waiting', 1.0) // 两跳之间落地
  add(cells, 'done', 0.5) // 双手举高
  add(cells, 'done', 1.5) // 放下鼓掌
  write('prototype/m35-state-anims.png', grid(cells, { cols: 3 }))
}

// ---------------------------------------------------------------- 5) 全开一帧（集成）
{
  const anim = new PetAnimator(0, { seed: 0.4 })
  const field = new NoteField({ rng: () => 0.3 })
  const ctx = {
    width: W,
    height: H,
    armWidth: 4,
    state: 'working',
    settings: { breath: true, track: false, typing: true, blink: false, gesture: false, decoration: 'cat' },
  }
  let pose = targetPose('working')
  for (let i = 0; i < 30; i++) pose = anim.update(pose, ctx, i / 60, 1 / 60)
  field.update(0.5, 'working')
  const parts = buildParts(pose, userSkin, { outer: true })
  parts.push(...decorationParts(headOf(parts), 'cat', { heart: heartTex }))
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, userSkin)
  field.draw(f, headOf(parts), noteTex, 0.62)
  write('prototype/m35-scene.png', grid([{ rgba: toImageData(f), srcW: W, x0: 0, y0: 0, w: W, h: H, zoom: 1 }]))
}
