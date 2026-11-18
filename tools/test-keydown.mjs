// 真实执行 keydown 链路的冒烟测试（补静态断言的盲区）。
//
// 背景：第一版 keydown handler 写成 `function () {}` 却在体内用 `e`，抛
// ReferenceError 被空 catch 吞掉 —— 打字动画正常、浮现字永远不出现，而
// test-widget 的 grep 断言全绿。这里把挂件的启动块换成测试钩子，注入最小
// DOM stub 后真的调用 bindGlobal() 并派发一个 keydown，验证整条链路。
//
// 用法：node tools/test-keydown.mjs

import fs from 'node:fs'
import { decodePng } from './png.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

const src = fs.readFileSync('assets/widget.js', 'utf8')
const START = '  // ---------------------------------------------------------------- 启动'
const cut = src.indexOf(START)
check('找到挂件启动块', cut > 0, String(cut))
if (cut < 0) process.exit(1)

// 把启动块（自动 init / MutationObserver / 轮询）换成测试钩子，IIFE 仍在此闭合。
const hook = `
  window.__test = {
    load: load,
    glyphs: glyphs,
    setEng: function (v) { eng = v; return eng },
    setPose: function (v) { lastPose = v },
    bindGlobal: bindGlobal,
    stat: function () { return letterStat },
    probe: function () { return window.__dshPetState() },
  }
})()
`
const code = src.slice(0, cut) + hook

// ---------------------------------------------------------------- 最小 DOM stub
const handlers = {}
const raf = []
const el = () => ({
  style: {}, className: '', textContent: '', innerHTML: '', value: '', disabled: false,
  addEventListener() {}, appendChild() {}, removeChild() {}, contains() { return false },
  setAttribute() {}, getAttribute() { return null },
  querySelector() { return el() }, querySelectorAll() { return [] },
  getBoundingClientRect() { return { left: 0, top: 0, width: 352, height: 416, right: 352, bottom: 416 } },
  setPointerCapture() {}, releasePointerCapture() {}, focus() {}, click() {},
})
const canvas = () => ({
  ...el(),
  width: 0,
  height: 0,
  getContext() {
    return {
      clearRect() {}, fillText() {}, drawImage() {},
      // 中心 8×8 当「墨」：模拟系统字体，让 buildGlyphs 造得出字模
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            if (Math.abs(xx - w / 2) < 4 && Math.abs(yy - h / 2) < 4) {
              const i = (yy * w + xx) * 4
              data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255
            }
          }
        }
        return { data, width: w, height: h }
      },
    }
  },
})
const doc = {
  addEventListener(type, fn) { handlers[type] = fn },
  createElement(tag) { return tag === 'canvas' ? canvas() : el() },
  getElementById() { return null },
  querySelector() { return el() },
  querySelectorAll() { return [] },
  head: { appendChild() {} },
  body: { appendChild() {} },
  documentElement: { appendChild() {}, addEventListener() {} },
}
const win = {
  addEventListener(type, fn) { handlers['win:' + type] = fn },
  innerWidth: 1200,
  innerHeight: 800,
}
const perf = { now: () => 1000 }
const ls = { getItem() { return null }, setItem() {} }
const noop = () => {}
const rAF = (fn) => { raf.push(fn); return raf.length }
const ImageStub = class {
  set src(v) { this._src = v; this.naturalWidth = 64; this.naturalHeight = 64; if (this.onload) this.onload() }
  get src() { return this._src }
}
const fetchStub = () => Promise.reject(new Error('no network in this test'))

let out = null
try {
  const fn = new Function(
    'window', 'document', 'performance', 'localStorage', 'requestAnimationFrame',
    'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'MutationObserver', 'Image', 'fetch', 'console', 'location',
    code + '\nreturn { test: window.__test, PET: DSH_PET }'
  )
  out = fn(win, doc, perf, ls, rAF, noop, noop, noop, noop, noop,
    function () { return { observe() {}, disconnect() {} } }, ImageStub, fetchStub, console,
    { search: '' })
  win.DSH_PET = out.PET
} catch (err) {
  check('挂件脚本能在受控环境里求值', false, err.message)
}
check('挂件脚本能在受控环境里求值', !!out && !!out.test && !!out.PET)

if (out && out.test && out.PET) {
  const P = out.PET
  const skin = P.render.skinFromImage(decodePng(fs.readFileSync('assets/default-skin.png')))
  const kbPart = P.model.buildParts(P.state.targetPose('working'), skin, { outer: true, armWidth: 4 })
    .find((p) => p.key === 'keyboard')
  check('坐姿有键盘矩阵（浮现字的挂点）', !!kbPart)

  const eng = {
    skin,
    armWidth: 4,
    frame: P.render.createFrame(352, 416),
    machine: new P.state.PetStateMachine(0),
    anim: new P.anim.PetAnimator(0),
    notes: new P.effects.NoteField(),
    status: new P.status.StatusEffects(),
    letters: new P.letters.LetterField(),
    kb: kbPart ? kbPart.transform : null,
    lastMs: 0,
  }
  out.test.setEng(eng)
  out.test.setPose({ sit: 1 })
  out.test.bindGlobal()
  check('bindGlobal 注册了 document keydown', typeof handlers.keydown === 'function')

  // ---- 正常按键：整条链路必须走通
  handlers.keydown({ key: 'a', code: 'KeyA', isComposing: false, keyCode: 65, shiftKey: false })
  const st = out.test.stat()
  check('keydown 计数 +1', st.keys === 1, String(st.keys))
  check('没有异常（第一版就是在这里静默抛 ReferenceError）', st.error === '', st.error)
  check('pushLetter 真的 push 了一枚字', st.pushed === 1, String(st.pushed))
  check('LetterField 里有一枚字', eng.letters.count === 1, String(eng.letters.count))
  const probe = out.test.probe()
  check('探针能读到 letters 与 letterStat', probe.letters === 1 && probe.letterStat.pushed === 1, JSON.stringify(probe.letterStat))
  check('探针里没有物理字段（已回退 P1）', !('physicsBusy' in probe))

  // ---- 中文输入法组合期：跳过，不出假字符
  handlers.keydown({ key: 'Process', code: 'KeyA', isComposing: true, keyCode: 229 })
  check('IME 组合期算 noLabel', out.test.stat().noLabel === 1, String(out.test.stat().noLabel))

  // ---- 站姿：按规格不显示
  out.test.setPose({ sit: 0 })
  handlers.keydown({ key: 'b', code: 'KeyB', isComposing: false })
  check('站姿算 noSit', out.test.stat().noSit === 1, String(out.test.stat().noSit))

  // ---- 未知物理键：不瞎猜位置
  out.test.setPose({ sit: 1 })
  handlers.keydown({ key: 'a', code: 'MediaPlayPause', isComposing: false })
  check('未知 code 算 noPos', out.test.stat().noPos === 1, String(out.test.stat().noPos))

  // ---- 字模能造出来（canvas 可用时）
  const gs = out.test.glyphs()
  check('canvasRasterizer 造出了字模', gs && gs.size > 80, String(gs && gs.size))
  check('多字符键名需要的字母都有字模', ['S', 'p', 'a', 'c', 'e', 'E', 'n', 't', 'r'].every((c) => gs.has(c)))

  // ---- 连打 30 个键不堆积
  for (let i = 0; i < 30; i++) handlers.keydown({ key: 'x', code: 'KeyX', isComposing: false })
  check('连打 30 键仍受上限保护', eng.letters.count <= 64 && out.test.stat().pushed >= 30, `${eng.letters.count} / ${out.test.stat().pushed}`)
  check('帧需求因有字升到 60fps（rAF 被调度）', raf.length > 0, String(raf.length))
}

console.log(`\n${fail === 0 ? '全部通过' : fail + ' 项失败'}  (${pass} ok / ${fail} fail)`)
process.exit(fail === 0 ? 0 : 1)
