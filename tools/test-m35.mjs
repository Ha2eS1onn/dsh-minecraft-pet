// M3.5 自检：DA 眨眼 / 音符 / 装饰四种 / 待机手势。
// 用法：node tools/test-m35.mjs

import fs from 'node:fs'
import { decodePng } from './png.mjs'
import {
  createFrame,
  clearFrame,
  skinFromImage,
  textureFromImage,
  detectEyes,
  drawParts,
  toImageData,
} from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'
import { targetPose } from '../assets/pet-state.js'
import { PetAnimator } from '../assets/pet-anim.js'
import { NoteField, NOTE_MAX, NOTE_LIFE } from '../assets/effects.js'
import { StatusEffects } from '../assets/status-effects.js'
import { decorationParts } from '../assets/decorations.js'
import { GestureScheduler, DURATION } from '../assets/gestures.js'
import * as Q from '../assets/quat.js'

let failed = 0
const check = (name, ok, detail = '') => {
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

const read = (p) => decodePng(fs.readFileSync(p))
const userSkin = skinFromImage(read('assets/default-skin.png'))
const noteTex = textureFromImage(read('assets/note.png'))
const heartTex = textureFromImage(read('assets/heart.png'))

// 一张没有任何识别格的纯色皮肤：所有格子对比为 0 → 必须不眨眼。
function flatSkin() {
  const w = 64
  const h = 64
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 80
    data[i + 1] = 120
    data[i + 2] = 160
    data[i + 3] = 255
  }
  return skinFromImage({ width: w, height: h, data })
}

// 在识别格 (4,6) 画眼睛：第一行亮/暗两像素（对比 700），第二行瞳孔。
function blinkableSkin() {
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
  return skinFromImage({ width: img.width, height: img.height, data })
}

const partsOf = (pose, skin = userSkin, deco = 'none') => {
  const parts = buildParts(pose, skin, { outer: true, armWidth: 4 })
  if (deco !== 'none') {
    const head = parts.find((p) => p.key === 'head' && !p.inflate)
    parts.push(...decorationParts(head, deco, { heart: heartTex }))
  }
  return parts
}

function render(parts, skin = userSkin) {
  const f = createFrame(W, H)
  clearFrame(f)
  drawParts(f, parts, skin)
  const rgba = toImageData(f)
  return { hash: fnv(rgba), rgba, frame: f }
}

const headOf = (parts) => parts.find((p) => p.key === 'head' && !p.inflate)
const quatDist = (a, b) => a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0)

// ---------------------------------------------------------------- 1) DA 眨眼（⏸ 冻结：代码与自检保留，等识别格素材）
{
  const flat = flatSkin()
  check('纯色皮肤没有识别格（不眨眼）', flat.eyes === null)
  check('用户皮肤也没有识别格', userSkin.eyes === null, userSkin.eyes ? '意外检测到眼睛' : '')

  const blink = blinkableSkin()
  check('画了识别格的皮肤能检出眼睛', blink.eyes !== null)
  if (blink.eyes) {
    const e = blink.eyes.right
    check('识别格 → 脸部坐标正确', e.x0 === 5 && e.x1 === 6 && e.y0 === 6 && e.rows === 1, JSON.stringify(e))
    check('眼皮 UV 指向识别格第一行', e.lid[0] === 4 && e.lid[1] === 6 && e.lid[2] === 5 && e.lid[3] === 6, JSON.stringify(e.lid))
    check('左眼几何是右眼的镜像', blink.eyes.left.x0 === 7 - e.x1 && blink.eyes.left.x1 === 7 - e.x0)
    check(
      '双眼眼皮 UV 宽度都非零（MDP 左眼退化，已修）',
      blink.eyes.right.lid[0] < blink.eyes.right.lid[2] + 1 && blink.eyes.left.lid[0] < blink.eyes.left.lid[2] + 1,
    )
  }

  // 没识别格：eyelid=0 也绝不能画薄片
  const noLid = buildParts({ ...defaultPose(), eyelid: 0 }, flat, { outer: true })
  check('无识别格时 eyelid=0 也不画眼皮', !noLid.some((p) => p.kind === 'quad'))

  const open = buildParts({ ...defaultPose(), eyelid: 1 }, blink, { outer: true })
  check('睁眼时不画眼皮', !open.some((p) => p.kind === 'quad'))
  const shut = buildParts({ ...defaultPose(), eyelid: 0 }, blink, { outer: true })
  const quads = shut.filter((p) => p.kind === 'quad')
  check('闭眼时画出两只眼皮薄片', quads.length === 2, `${quads.length} 片`)

  const openHash = render(open, blink).hash
  const shutShot = render(shut, blink)
  check('闭眼改变画面', shutShot.hash !== openHash)
  // 眼皮取的是识别格第一行（240,60,60）/（40,10,10），应能看到明显的红色像素
  let reddish = 0
  for (let i = 0; i < shutShot.rgba.length; i += 4) {
    if (shutShot.rgba[i] > 150 && shutShot.rgba[i + 1] < 110 && shutShot.rgba[i + 2] < 110) reddish++
  }
  check('闭眼后脸上出现识别格的眼皮色', reddish > 20, `${reddish} px`)

  // 识别格在 2 倍图上仍能检出
  const hd = (() => {
    const img = read('assets/default-skin.png')
    const k = 2
    const w = img.width * k
    const h = img.height * k
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y / k | 0) * img.width + (x / k | 0)) * 4
        const ti = (y * w + x) * 4
        data[ti] = img.data[si]
        data[ti + 1] = img.data[si + 1]
        data[ti + 2] = img.data[si + 2]
        data[ti + 3] = img.data[si + 3]
      }
    }
    // 识别格放大后仍画眼睛
    for (let y = 6 * k; y < 8 * k; y++) {
      for (let x = 4 * k; x < 6 * k; x++) {
        const i = (y * w + x) * 4
        const dark = y < 7 * k && x < 5 * k
        data[i] = dark ? 240 : 40
        data[i + 1] = 60
        data[i + 2] = 60
        data[i + 3] = 255
      }
    }
    return skinFromImage({ width: w, height: h, data })
  })()
  check('HD 皮肤（2×）也能检出识别格', hd.eyes !== null)
}

// ---------------------------------------------------------------- 2) 音符（音频驱动）
{
  const field = new NoteField()
  check('初始没有音符', field.notes.length === 0)

  for (let i = 0; i <= 180; i++) field.update(i / 60, false)
  check('没有音频时一个音符都不出（不再常驻）', field.notes.length === 0)

  let peak = 0
  for (let i = 0; i <= 240; i++) {
    field.update(3 + i / 60, true)
    peak = Math.max(peak, field.notes.length)
  }
  check('检测到音频后开始出音符', peak > 0, `${peak} 个`)
  check('音符数量不超上限', peak <= NOTE_MAX, `${peak} > ${NOTE_MAX}`)

  // 长时间播放不堆积
  const long = new NoteField()
  let maxLong = 0
  for (let i = 0; i < 60 * 40; i++) {
    long.update(i / 60, true)
    maxLong = Math.max(maxLong, long.notes.length)
  }
  check('40 秒播放不堆积', maxLong <= NOTE_MAX, `${maxLong}`)

  for (let i = 0; i < 60; i++) long.update(40 + i / 60, false)
  check('音频停止后音符全部消失', long.notes.length === 0)

  // 绘制
  const idleParts = partsOf(targetPose('idle'))
  const head = headOf(idleParts)
  const base = render(idleParts).hash
  const f = createFrame(W, H)
  clearFrame(f)
  const field2 = new NoteField()
  field2.update(0, true)
  drawParts(f, idleParts, userSkin)
  const before = fnv(toImageData(f))
  field2.draw(f, head, noteTex, 0.2)
  check('音符画上去改变画面', fnv(toImageData(f)) !== before)
  check('（对照）两条渲染路径一致', base === before, `${base} vs ${before}`)

  // 转头后音符起点跟着动
  const turned = partsOf({ ...targetPose('idle'), head_rotation: Q.rotZ(0.5) })
  const f2 = createFrame(W, H)
  clearFrame(f2)
  drawParts(f2, turned, userSkin)
  const t0 = fnv(toImageData(f2))
  field2.draw(f2, headOf(turned), noteTex, 0.2)
  check('转头后音符从头顶新位置飘出', fnv(toImageData(f2)) !== t0)

  check('NOTE_LIFE 是 MDP 的 0.5s', NOTE_LIFE === 0.5)
}

// ---------------------------------------------------------------- 2.5) 状态粒子
{
  const mk = () => new StatusEffects({ rng: () => 0.37 })
  const pose = targetPose('idle')

  const renderWith = (p, fx, now) => {
    const parts = buildParts(p, userSkin, { outer: true })
    const f = createFrame(W, H)
    clearFrame(f)
    drawParts(f, parts, userSkin)
    const plain = toImageData(f)
    fx.draw(f, headOf(parts), now)
    return { plain, fx: toImageData(f) }
  }
  /** 取「有图标帧」与「无图标帧」的差异像素颜色。 */
  const diffColors = (a, b) => {
    const out = []
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
        out.push([a[i], a[i + 1], a[i + 2]])
      }
    }
    return out
  }

  const blank = mk()
  blank.update(0, 'idle')
  const idleShot = renderWith(pose, blank, 0)
  check('idle 不出任何图标', fnv(idleShot.fx) === fnv(idleShot.plain))
  check('idle 时 active = false', blank.active === false)

  const q = mk()
  q.update(0, 'waiting')
  const qs = renderWith(pose, q, 0.15)
  const qColors = diffColors(qs.fx, qs.plain)
  check('waiting 头顶出问号', qColors.length > 20, `${qColors.length} px`)
  check('问号是粉色', qColors.some(([r, g, b]) => r > 200 && g > 90 && g < 190 && b > 140))
  check('waiting 时 active = true', q.active)

  const th = mk()
  th.update(0, 'thinking')
  const ts = renderWith(pose, th, 0.15)
  const tColors = diffColors(ts.fx, ts.plain)
  check('thinking 头顶出灯泡', tColors.length > 20, `${tColors.length} px`)
  check('灯泡有黄色', tColors.some(([r, g, b]) => r > 200 && g > 160 && b < 160))

  const er = mk()
  er.update(0, 'error')
  const es = renderWith(pose, er, 0.15)
  const eColors = diffColors(es.fx, es.plain)
  check('error 头顶出感叹号', eColors.length > 20, `${eColors.length} px`)
  check('感叹号是红色', eColors.some(([r, g, b]) => r > 180 && g < 130 && b < 130))

  check('三种图标画面互不相同', fnv(qs.fx) !== fnv(ts.fx) && fnv(ts.fx) !== fnv(es.fx) && fnv(qs.fx) !== fnv(es.fx))

  // done：分段持续的烟花
  const d = mk()
  check('初始没有粒子', d.particles.length === 0)
  d.update(10, 'done')
  check('done 第一波烟花', d.particles.length === 18, String(d.particles.length))
  d.update(10.1, 'done')
  check('间隔未到不补波', d.particles.length === 18)
  d.update(10.7, 'done')
  check('done 期间持续补波（总时长更长）', d.particles.length > 18, String(d.particles.length))
  const ds = renderWith(pose, d, 11)
  check('烟花改变画面', fnv(ds.fx) !== fnv(ds.plain))
  check('烟花有多种颜色', new Set(diffColors(ds.fx, ds.plain).map((c) => c.join(','))).size > 3)
  d.update(13, 'idle')
  check('状态结束后烟花全部过期', d.particles.length === 0)
  check('过期后 active = false', d.active === false)

  // 图标挂头部矩阵：转头后位置跟着变
  const turned = { ...pose, head_rotation: Q.rotZ(0.5) }
  const qTurn = mk()
  qTurn.update(0, 'waiting')
  const tsTurn = renderWith(turned, qTurn, 0.15)
  check('问号跟着头部转动', fnv(tsTurn.fx) !== fnv(qs.fx))
}

// ---------------------------------------------------------------- 3) 装饰
{
  const baseHash = render(partsOf(defaultPose())).hash
  for (const kind of ['rabbit', 'cat', 'heart', 'lollipop']) {
    const parts = partsOf(defaultPose(), userSkin, kind)
    const extra = parts.filter((p) => p.key === 'decoration')
    const shot = render(parts)
    check(`装饰 ${kind}：改变画面`, shot.hash !== baseHash, `${extra.length} 个 cube`)
    check(`装饰 ${kind}：几何都在`, extra.length > 0 && extra.every((p) => p.size.every((v) => v > 0)))
  }

  // 爱心：cube 数 = heart.png 不透明像素数
  let heartPx = 0
  for (let i = 3; i < heartTex.rgba.length; i += 4) if (heartTex.rgba[i] > 0) heartPx++
  const heartCubes = decorationParts(headOf(partsOf(defaultPose())), 'heart', { heart: heartTex }).length
  check('爱心 = 每个不透明像素一个 cube', heartCubes === heartPx, `${heartCubes} vs ${heartPx}`)

  // 跟着头转
  const turned = { ...defaultPose(), head_rotation: Q.rotZ(0.4) }
  check(
    '装饰跟着头部旋转',
    render(partsOf(turned, userSkin, 'rabbit')).hash !== render(partsOf(defaultPose(), userSkin, 'rabbit')).hash,
  )

  // 关闭时零额外几何
  check('装饰关闭时没有额外 part', partsOf(defaultPose(), userSkin, 'none').length === partsOf(defaultPose()).length)

  // 比例：装饰挂载随头高归一化 → 改变头的 size 时装饰跟着缩放（用 1×1 纯色材质验证不崩）
  check('装饰材质是 1×1 纯色（solid 标记）', decorationParts(headOf(partsOf(defaultPose())), 'cat').every((p) => Array.isArray(p.solid)))
}

// ---------------------------------------------------------------- 3.5) 坐姿键盘
{
  const working = targetPose('working')
  const withKb = buildParts(working, userSkin, { outer: true })
  const kb = withKb.filter((p) => p.key === 'keyboard')
  const caps = withKb.filter((p) => p.key === 'keycap')
  check('坐姿时生成键盘', kb.length === 1)
  check('键帽 3 行 × 5 列', caps.length === 15, `${caps.length}`)
  check('键盘走纯色材质（solid）', !!kb[0]?.solid)

  check('站立时没有键盘', !buildParts(defaultPose(), userSkin).some((p) => p.key.startsWith('keyboard') || p.key === 'keycap'))
  check(
    'keyboard:false 可关掉键盘',
    !buildParts(working, userSkin, { outer: true, keyboard: false }).some((p) => p.key === 'keyboard'),
  )

  // 位置：中心 (0, 9.9, 9.4)，顶面 10.225 略低于手的按下高度 10.35
  const t = kb[0].transform
  check('键盘在身前 z≈9.4', Math.abs(t[11] - 9.4) < 1e-6, t[11].toFixed(3))
  check('键盘中心 y≈9.9', Math.abs(t[7] - 9.9) < 1e-6, t[7].toFixed(3))
  check('键盘顶面低于手按下高度', t[7] + 0.325 < 10.35, (t[7] + 0.325).toFixed(3))
  check('键帽都在顶面之上', caps.every((c) => c.transform[7] > t[7] + 0.325))

  const noKb = render(buildParts(working, userSkin, { outer: true, keyboard: false })).hash
  check('键盘改变坐姿画面', render(withKb).hash !== noKb)
}

// ---------------------------------------------------------------- 3.8) 状态专属动作
{
  const ctxOf = (state) => ({
    width: W,
    height: H,
    armWidth: 4,
    state,
    settings: { breath: false, track: false, typing: false, blink: false, gesture: false },
  })
  const framesOf = (state, n) => {
    const anim = new PetAnimator(0, { seed: 0.2 })
    const base = targetPose(state)
    const ctx = ctxOf(state)
    const out = []
    for (let i = 0; i <= n; i++) out.push(anim.update(base, ctx, i / 60, 1 / 60))
    return out
  }

  // waiting：进入时跳两下（不循环），头不摆动
  {
    const frames = framesOf('waiting', 360) // 6 秒
    const minSink = Math.min(...frames.map((p) => p.sink))
    const yaws = frames.map((p) => p.head_rotation[1])
    check('waiting 会跳起来', minSink < -2, minSink.toFixed(2))
    let hops = 0
    let inHop = false
    for (const p of frames) {
      const air = p.sink < -0.3
      if (air && !inHop) {
        inHop = true
        hops++
      } else if (!air && inHop) inHop = false
    }
    check('waiting 只跳两次（不循环）', hops === 2, `${hops} 次 / 6s`)
    check('waiting 2 秒后完全落地', frames.slice(120).every((p) => p.sink >= -0.01))
    check('waiting 头不左右摆动', Math.max(...yaws) - Math.min(...yaws) < 0.01)
  }

  // thinking：右手举到与 waiting 相同的位置 + 前后小幅摆动 + 歪头
  {
    const frames = framesOf('thinking', 120)
    const a = frames[18] // 0.3s
    const b = frames[39] // 0.65s
    const waitArm = targetPose('waiting').arms[1]
    check('thinking 手臂贴近 waiting 的举起位（略微外撇）', quatDist(a.arms[1], waitArm) < 0.4, quatDist(a.arms[1], waitArm).toFixed(3))
    check('thinking 手在前后摆动', quatDist(a.arms[1], b.arms[1]) > 1e-3)
    check('thinking 头会歪', Math.abs(a.head_rotation[2]) > 0.05, a.head_rotation[2].toFixed(3))
  }

  // done：先双手举高，再放下鼓掌
  {
    const frames = framesOf('done', 120)
    const up = frames[30] // 0.5s
    const clapA = frames[90] // 1.5s
    const clapB = frames[96] // 1.6s（相差约半拍）
    check('done 前段保持双手举高', quatDist(up.arms[0], Q.rotX(-Math.PI)) < 0.25)
    check('done 后段已放下（不同于上举）', quatDist(clapA.arms[0], up.arms[0]) > 0.2)
    check('done 后段双手开合（鼓掌）', quatDist(clapA.arms[0], clapB.arms[0]) > 1e-3)
  }
}

// ---------------------------------------------------------------- 4) 待机手势
{
  const base = defaultPose()
  const s = new GestureScheduler({ rng: () => 0.5 })
  check('初始未排期', s.next === null)
  s.update(0)
  check('第一次 update 就排期', s.next !== null)
  check('deadline 落在 30~60s', s.next > 30 && s.next < 60, String(s.next))

  const due = s.next
  s.update(due - 0.01)
  check('未到 deadline 不触发', s.active === null)
  s.update(due + 0.01)
  check('到点直接触发（不再看会话状态）', s.active !== null)
  check('触发后重排下一次', s.next > due + 30, String(s.next))

  const kind = s.active.kind
  check('选中三种之一', ['stretch', 'tilt', 'sleepy'].includes(kind), kind)

  const mid = s.apply(base, due + 0.02 + DURATION[kind] * 0.5)
  check('手势改变姿态', quatDist(mid.head_rotation, Q.identity()) > 1e-3 || quatDist(mid.arms[0], Q.identity()) > 1e-3)

  // 用固定 kind 逐一验证三条动作都在动
  for (const k of ['stretch', 'tilt', 'sleepy']) {
    const g = new GestureScheduler({ rng: () => 0.5 })
    g.update(0)
    g.trigger(k, 10)
    const p = g.apply(base, 11)
    const headMoved = quatDist(p.head_rotation, Q.identity()) > 1e-4
    const armsMoved = quatDist(p.arms[0], Q.identity()) > 1e-4
    check(`${k}：动作有输出`, headMoved || armsMoved || Math.abs(p.sink) > 1e-4)
  }

  // 伸懒腰：手臂举起 + 头后仰 + 全身抖动（MDP 的 gesture_shake）
  {
    const g = new GestureScheduler({ rng: () => 0.5 })
    g.update(0)
    g.trigger('stretch', 10)
    const p = g.apply(base, 10.7)
    check('伸懒腰：双臂举起', quatDist(p.arms[0], Q.identity()) > 1e-3)
    check('伸懒腰：头部后仰', p.head_rotation[0] < -0.005, p.head_rotation[0].toFixed(4))
    check(
      '伸懒腰：全身有抖动偏移',
      Math.abs(p.shake[0]) + Math.abs(p.shake[1]) > 1e-5,
      p.shake.map((v) => v.toFixed(4)).join(','),
    )
    check('抖动幅度不超过 MDP 的 0.035', Math.abs(p.shake[0]) <= 0.035 + 1e-9 && Math.abs(p.shake[1]) <= 0.0175 + 1e-9)

    // 抖动是模型空间平移，必须作用到每一个角色 part，而不只是手臂
    const shifted = buildParts({ ...defaultPose(), shake: [0.5, 0.25, -0.4] }, userSkin, { outer: true })
    const plainParts = buildParts(defaultPose(), userSkin, { outer: true })
    const at = (arr, key) => arr.find((x) => x.key === key)
    for (const key of ['body', 'head', 'leftArm', 'rightLeg']) {
      const d = at(shifted, key).transform
      const o = at(plainParts, key).transform
      check(
        `抖动作用到 ${key}`,
        Math.abs(d[3] - o[3] - 0.5) < 1e-9 && Math.abs(d[7] - o[7] - 0.25) < 1e-9 && Math.abs(d[11] - o[11] + 0.4) < 1e-9,
      )
    }
    // 键盘不是角色，不吃抖动
    const kbShift = buildParts({ ...targetPose('working'), shake: [0.5, 0.25, -0.4] }, userSkin, { outer: true }).find(
      (x) => x.key === 'keyboard',
    )
    check('键盘不吃身体抖动', Math.abs(kbShift.transform[3]) < 1e-9 && Math.abs(kbShift.transform[7] - 9.9) < 1e-9)
  }

  // 打断回位：160ms 内回到触发前的姿态，且不是跳变
  {
    const g = new GestureScheduler({ rng: () => 0.5 })
    g.update(0)
    g.trigger('stretch', 10)
    const during = g.apply(base, 10.6)
    g.noteInput(10.7)
    const stopping = g.apply(base, 10.701)
    check('打断瞬间保持在当前姿态（不跳回）', quatDist(stopping.arms[0], during.arms[0]) < 0.06, quatDist(stopping.arms[0], during.arms[0]).toFixed(4))
    const settled = g.apply(base, 11)
    check('160ms 后回位到原姿态', quatDist(settled.arms[0], Q.identity()) < 1e-6 && quatDist(settled.head_rotation, Q.identity()) < 1e-6)
    check('回位结束后清空', g.returnFrom === null && g.active === null)
  }

  // 用户操作后的静默期：0.6s 内不触发
  {
    const g = new GestureScheduler({ rng: () => 0.5 })
    g.update(0)
    const d = g.next
    g.noteInput(d - 0.1)
    g.update(d + 0.05)
    check('输入后 0.6s 内不触发', g.active === null)
    g.update(d + 0.6)
    check('静默期满后可以触发', g.active !== null)
  }

  // 开关全关 → 不再排期，进行中的自动手势被取消
  {
    const g = new GestureScheduler({ rng: () => 0.5 })
    g.update(0)
    g.update(g.next + 0.01)
    check('（前置）自动手势已开始', g.active && g.active.automatic)
    g.setEnabled('stretch', false, 100)
    g.setEnabled('tilt', false, 100)
    g.setEnabled('sleepy', false, 100)
    check('全关后不再排期', g.next === null)
    check('全关后取消进行中的自动手势', g.active === null)
    g.update(200)
    check('全关后空闲也不触发', g.active === null)
  }

  // sleepy 的惊醒上跳：t=2.125 时 4u(1-u)*2.4 = 2.4
  {
    const g = new GestureScheduler({ rng: () => 0.999 })
    g.update(0)
    const d = g.next
    g.update(d + 0.01)
    check('rng 高位选中 sleepy', g.active && g.active.kind === 'sleepy', g.active?.kind)
    const p = g.apply(base, d + 0.01 + 2.125)
    check('犯困最后 0.25s 有上跳', Math.abs(p.sink + 2.4) < 1e-6, p.sink.toFixed(4))
  }

  // 与 MDP 一致：自动手势不看会话状态，只看「手势空闲 + 0.6s 无输入」
  {
    const g = new GestureScheduler({ rng: () => 0.5 })
    let busyFrames = 0
    for (let i = 0; i < 4000; i++) {
      const now = i * 0.05
      g.update(now)
      g.apply(base, now)
      if (g.active) busyFrames++
    }
    check('200 秒内能多次自动触发', busyFrames > 100, `${busyFrames} 帧处于手势中`)
  }
}

// ---------------------------------------------------------------- 5) 集成
{
  const anim = new PetAnimator(0, { seed: 0.2 })
  const ctx = (extra) => ({
    width: W,
    height: H,
    armWidth: 4,
    settings: { breath: false, track: false, typing: false, blink: false, gesture: true },
    state: 'idle',
    ...extra,
  })
  const a = anim.update(targetPose('idle'), ctx(), 0, 1 / 60)
  check('集成：手势关/未触发时不动姿态', quatDist(a.head_rotation, Q.normalize(Q.identity())) < 1e-9)
  anim.gestures.trigger('tilt', 0)
  const b = anim.update(targetPose('idle'), ctx(), 0.5, 1 / 60)
  check('集成：PetAnimator 能播放手动手势', quatDist(b.head_rotation, a.head_rotation) > 1e-3)
  check('集成：gestureBusy 反映手势中', anim.gestureBusy)
}

// ------------------------------------------- 6) working 打字的待机手势（回归）
// 曾经的 bug：press() 里调了 noteInput，working 时每 0.15s 一次的模拟打字
// 会把刚起来的手势不停取消，观感是「双手向外抽一下又复位」。
{
  const working = targetPose('working')
  const ctx = {
    width: W,
    height: H,
    armWidth: 4,
    settings: { breath: false, track: false, typing: true, blink: false, gesture: true },
    state: 'working',
  }
  /** 每 9 帧（0.15s）按一次键，模拟打字。 */
  const run = (anim, frames) => {
    const out = []
    for (let i = 0; i < frames; i++) {
      const now = i / 60
      if (i % 9 === 0) anim.press(now)
      out.push(anim.update(working, ctx, now, 1 / 60))
    }
    return out
  }

  const withGesture = new PetAnimator(0, { seed: 0.2 })
  const withoutGesture = new PetAnimator(0, { seed: 0.2 })
  withGesture.gestures.trigger('stretch', 0)
  const A = run(withGesture, 120) // 2 秒（stretch 总长 3 秒）
  const B = run(withoutGesture, 120)

  let peak = 0
  for (let i = 0; i < A.length; i++) {
    peak = Math.max(peak, quatDist(A[i].arms[0], B[i].arms[0]), quatDist(A[i].arms[1], B[i].arms[1]))
  }
  check('working 打字中伸懒腰能真正举起手臂', peak > 0.2, peak.toFixed(3))
  check('手势没有被打字打断（仍在进行）', withGesture.gestureBusy)

  // 真实用户输入仍然会打断（gestureInput 是显式入口）
  withGesture.gestureInput(2.0)
  check('显式 gestureInput 仍能打断手势', withGesture.gestures.active === null)
  const after = withGesture.update(working, ctx, 2.05, 1 / 60)
  check('打断后走回位而不是硬切', withGesture.gestures.returnFrom !== null)
  check('回位期间姿态仍连续', Number.isFinite(after.arms[0][0]))
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
