// M3 动效四件套：呼吸 / 眨眼 / 头部跟随鼠标 / 打字手臂。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render.rs:21, 506, 826-1054
//
// 所有动效都是「时间的纯函数 + 少量积分状态」，与 MDP 一致：
// 没有速度/加速度，只有 breathing_weight 那一个指数衰减量。

import { project, transformPoint } from './skin-render.js'
import { torsoSpace, bodySpace } from './skin-model.js'
import { GestureScheduler } from './gestures.js'
import * as Q from './quat.js'

const DEG = Math.PI / 180
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v) => clamp(v, 0, 1)
/** 与 MDP `front_yaw()` 一致：atan2(30, 70)。 */
const FRONT_YAW = Math.atan2(30, 70)
/** 摄像机俯角：-(23 / |(30,70)|) 的反正切，约 -16.8°。 */
const CAM_PITCH = -Math.atan(23 / Math.hypot(30, 70))
/** 摄像机朝向修正，MDP 的 `Quat::from_rotation_y(front_yaw()) * from_rotation_x(...)`。 */
const VIEW = Q.multiply(Q.rotY(FRONT_YAW), Q.rotX(CAM_PITCH))

/** 眨眼相位推进速度（MDP 的 BLINK_RATE）。 */
export const BLINK_RATE = 2.5

/** 闭眼程度 0..1；参数是相位 u = now*BLINK_RATE + 随机相位。 */
export function blinkClosure(u) {
  const lid = clamp01(1.5 - Math.abs(Math.sin(u) * 6))
  const gate = clamp01(-32 + Math.cos(u / 1.5) * 40 + Math.cos(u / 4) * 40)
  return lid * gate
}

/** 刚体矩阵（旋转+平移）的逆旋转，用于把世界方向转到部件局部空间。 */
function inverseRotate(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ]
}

const normalizeVec = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

export const DEFAULT_ANIM = {
  breath: true,
  track: true,
  typing: true,
  /** 待机手势（伸懒腰 / 歪头 / 犯困）。只在 idle 且无输入时触发。 */
  gesture: true,
  /** 装饰物：'none' | 'rabbit' | 'cat' | 'heart' | 'lollipop'（渲染层读取）。 */
  decoration: 'none',
  /** 眨眼默认关：M3 只算出 eyelid，眼皮薄片要等 M3.5 的识别格检测。 */
  blink: false,
  /** MDP 的 head_sensitivity_x/y = 100%（系数即源码里的 0.3 / 0.95）。 */
  sensX: 1,
  sensY: 1,
  rangeX: 45,
  rangeY: 30,
}

/** 一次按键把该手压在键位上多久。MDP 是 0.15s，但那在快速打字（每秒 6~8 键）时
 *  会让手一直压着起不来——两三次连打就只看到一手按死。缩短到 0.08s，敲击节奏能看出来。 */
export const PRESS_SECONDS = 0.08

/** 按压行程的时间常数（秒）：按下快、抬起略慢，两端都补过渡。
 *  按下 τ=0.03：0.08s 的窗口 ≈2.7τ，采样到窗口 85% 处行程约 89%。 */
export const PRESS_TAU_IN = 0.03
export const PRESS_TAU_OUT = 0.045
/** 权重距目标小于该值时直接吸附，保证无按键时严格回到悬停位（哈希回归需要逐位相同）。 */
const SNAP = 1e-3
/** 打字时手臂目标点的两端，照 MDP `render.rs:1031-1039`。 */
const HOVER_Y = 11.85
const PRESS_Y = 10.35
const HOVER_Z = 8.8
/** waiting 的跳跃高度（模型单位）。MDP 的 Bounce 用 3.6，这里取 3.0。 */
const HOP_HEIGHT = 3.0

/**
 * 动效层：吃状态机产出的姿态，叠加时间驱动的动效后交给渲染器。
 * 用法：每帧 `anim.update(sm.pose(now), ctx, now, dt)`。
 */
export class PetAnimator {
  constructor(now = 0, { seed = Math.random() } = {}) {
    this.breath = 0
    this.blinkPhase = seed * Math.PI * 2
    /** 头部跟随权重：只有 idle 且无待机手势时趋向 1，其余情况平滑收回 0。 */
    this.trackW = 0
    /** 打字按压状态，照 MDP 的 `Hand { until, key }`：until 之前该手压在键位上。 */
    this.hands = [
      { until: 0, key: null },
      { until: 0, key: null },
    ]
    /** MDP 的 counter：alternating 模式下每次按键换一只手。 */
    this.counter = 0
    /** 每手的按压权重 0..1（0 = 悬停，1 = 按到底），替代 MDP 的布尔切换。 */
    this.pressW = [0, 0]
    /** 每手的水平落点（悬停位的 x，会平滑到最近按过的键列）。 */
    this.handX = [4.2, -4.2]
    /** 待机手势调度器（M3.5）。 */
    this.gestures = new GestureScheduler()
    /** 当前会话语义状态与它开始的时刻，供状态专属动画算相位。 */
    this.state = null
    this.stateStart = 0
    this.eyelid = 1
  }

  /**
   * 模拟一次按键（M4 接宿主后由真实键盘事件调用）。
   * MDP 的 `typing_mode == "alternating"` 分支：counter 奇偶决定左右手，
   * 非 precise 模式下 `key = None`，所以落点用默认的 `sign * 4.2`。
   * @param {number} now 秒
   * @param {[number, number]|null} key 键位偏移 [x, y]（y 用于 z 方向），null 即交替模式
   * @param {number} [side] 指定手；不传则按 MDP 的 counter 交替
   */
  press(now, key = null, side) {
    const hand =
      side ?? (this.counter % 2 === 0 ? 1 : 0)
    if (side === undefined) this.counter += 1
    this.hands[hand] = { until: now + PRESS_SECONDS, key }
  }

  /**
   * @param {object} pose 状态机给出的姿态
   * @param {{cursor?:{x:number,y:number}, width:number, height:number, armWidth?:number, settings?:object}} ctx
   * @param {number} now 秒
   * @param {number} dt 秒
   */
  update(pose, ctx, now, dt) {
    const s = { ...DEFAULT_ANIM, ...(ctx.settings || {}) }
    let p = { ...pose }
    p.head_rotation = Q.normalize(p.head_rotation || Q.identity())
    p.arms = [0, 1].map((i) => Q.normalize(p.arms?.[i] || Q.identity()))
    p.head_roll = p.head_roll || 0
    p.head_nod = p.head_nod || 0
    p.body_pitch = p.body_pitch || 0
    p.sit = p.sit || 0

    this._breath(p, s, now, dt)
    this.eyelid = this._blink(s, now)
    p.eyelid = this.eyelid
    this._trackHead(p, ctx, s, now, dt)
    if (p.sit > 0.001) this._typing(p, ctx, s, now, dt)
    else this._resetTyping()
    // 状态专属动画（thinking 挠头 / waiting 跳两下 / done 举手后鼓掌）。
    const state = ctx.state || null
    if (state !== this.state) {
      this.state = state
      this.stateStart = now
    }
    if (state) this._stateAnim(p, state, now - this.stateStart)
    // 待机手势最后叠加（MDP 的 apply_gesture 也在 update 末尾）。
    // 不看会话状态：坐着打字时也会伸懒腰，真实按键由调用方 gestureInput() 打断。
    if (s.gesture) {
      this.gestures.update(now)
      p = this.gestures.apply(p, now)
    }
    return p
  }

  /** 用户按键 / 点击：打断进行中的手势，走 160ms 回位（render_gestures.rs:200）。
   *  注意：**打字动画（press）不算用户输入**，只有真实键盘/鼠标事件才调这里，
   *  否则 working 时每 0.15s 一次的按压会把刚起来的手势一直取消掉。 */
  gestureInput(now) {
    this.gestures.noteInput(now)
  }

  /** 待机手势是否正在播放或回位（M4 的帧需求分级要问这个）。 */
  get gestureBusy() {
    return !!(this.gestures.active || this.gestures.returnFrom)
  }

  /** 呼吸：指数逼近的权重 + 0.10 单位的上下起伏 + 头/臂的细微跟随。 */
  _breath(p, s, now, dt) {
    const want = s.breath ? 1 : 0
    this.breath += (want - this.breath) * (1 - Math.exp(-dt * (want > 0 ? 2.5 : 20)))
    if (this.breath < 0.001) this.breath = 0
    const wave = Math.sin(now * 1.7) * this.breath
    p.breathing_bob = 0.1 * wave
    if (this.breath > 0) {
      p.head_rotation = Q.multiply(p.head_rotation, Q.fromEuler(wave * 0.012, 0, 0))
      p.arms = [0, 1].map((i) =>
        Q.multiply(p.arms[i], Q.fromEuler(wave * 0.014, 0, wave * 0.008 * (i === 0 ? 1 : -1))),
      )
    }
  }

  /** 眨眼：返回 eyelid（1 = 全睁）。M3 只算数值，M3.5 才画眼皮薄片。 */
  _blink(s, now) {
    if (!s.blink) return 1
    return 1 - blinkClosure(now * BLINK_RATE + this.blinkPhase)
  }

  /** 头部跟随：把光标位置反算成朝向，再乘父级逆矩阵进头部局部空间。
   *
   *  跟随是**有条件的**：只有 `idle` 且没有待机手势时才发生（plan.md §6.3 里
   *  thinking 的「弱跟随」也不要——状态姿态要稳定可辨）。进入手势或别的状态时
   *  用 `trackW` 把角度平滑收回到中立，手势 / 状态结束后再平滑恢复，
   *  所以不是「一进手势就瞬跳回正」。 */
  _trackHead(p, ctx, s, now, dt) {
    const d = Math.max(dt || 0, 0)
    // 光标不在画布上：直接回中立（这条不需要过渡，否则指针一离开就残留偏角）
    if (!ctx.cursor) { this.trackW = 0; return }
    // ctx.state 缺省时按 idle 处理（老调用点不传状态，语义上就是"默认状态"）
    const idle = ctx.state == null || ctx.state === 'idle'
    const want = (s.track && idle && !this.gestureBusy) ? 1 : 0
    this.trackW += (want - this.trackW) * (1 - Math.exp(-d / 0.12))
    if (this.trackW < 1e-3) this.trackW = 0
    if (this.trackW === 0) return

    const W = ctx.width
    const H = ctx.height
    // 光标离开画布时按画面中上区域算目标，保证 trackW 衰减期间角度是「收回中立」而不是乱指
    const cur = ctx.cursor || { x: W / 2, y: H * 0.36 }
    const neck = transformPoint(torsoSpace(p), [0, 12, 0])
    const ahead = Q.rotate(VIEW, [0, 3, 0])
    const pt = project([neck[0] + ahead[0], neck[1] + ahead[1], neck[2] + ahead[2]], W, H)

    const dx = (cur.x - pt[0]) / Math.max(W * 0.8, 200)
    const dy = (cur.y - pt[1]) / Math.max(H * 0.65, 180)
    const x = clamp(
      Math.atan(dx * 0.3 * s.sensX),
      -s.rangeX * DEG,
      s.rangeX * DEG,
    )
    const y = clamp(
      Math.atan(dy * 0.95 * s.sensY),
      -s.rangeY * DEG,
      s.rangeY * DEG,
    )
    // 权重乘在角度上：trackW=0 时目标是严格中立，与状态姿态的 head_rotation 一致
    const horizontal = clamp(x, -Math.PI / 2, Math.PI / 2) * this.trackW
    const vertical = clamp(y, -85 * DEG, 85 * DEG) * this.trackW

    const desired = Q.multiply(
      Q.multiply(
        Q.multiply(Q.multiply(VIEW, Q.rotY(horizontal)), Q.rotX(vertical)),
        Q.rotZ(p.head_roll),
      ),
      Q.rotX(p.head_nod),
    )
    // parent 只取躯干自身的旋转；MDP 里是 model_rotation × crouch 倾斜 × 自定义姿态。
    // 我们的 torsoSpace 只叠了 body_pitch，其余都是平移。
    const parent = Q.rotX(p.body_pitch)
    p.head_rotation = Q.multiply(Q.conjugate(parent), desired)
    p.yaw = FRONT_YAW + horizontal
    p.pitch = vertical
  }

  /** 打字：照 MDP `render.rs:1011-1069`。手是否按下由 `hands[side].until` 决定，由 `press()`
   *  触发；没有按键时双手悬停在键盘上方（idle_y / idle_z）。
   *
   *  与 MDP 的唯一差别是**两端补过渡**：MDP 在 pressed / hover 两个位置之间做布尔切换，
   *  60fps 下就是一帧到位，观感是「瞬移」。这里把手的落点写成按权重 w 的连续插值，
   *  w 走指数逼近（按下 τ=PRESS_TAU_IN，抬起 τ=PRESS_TAU_OUT），而指向仍由 fromRotationArc
   *  逐帧重新求，所以手臂不是被「拖」过去的，没有迟滞。w 吸附到 0 时落点与 MDP 悬停位
   *  逐位相同，静止帧哈希仍是 c2c43ab4。 */
  _typing(p, ctx, s, now, dt) {
    if (!s.typing) {
      this._resetTyping()
      return
    }
    const body = bodySpace(p)
    const aw = ctx.armWidth || 4
    const d = Math.max(dt, 0)

    for (const side of [0, 1]) {
      const sign = side === 0 ? 1 : -1
      const hand = this.hands[side]
      const active = now < hand.until

      // 按压权重：悬停 0 → 键位 1。
      const want = active ? 1 : 0
      const tau = want > this.pressW[side] ? PRESS_TAU_IN : PRESS_TAU_OUT
      let w = this.pressW[side] + (want - this.pressW[side]) * (1 - Math.exp(-d / tau))
      if (Math.abs(want - w) < SNAP) w = want
      this.pressW[side] = w

      // 水平位置沿用 MDP「手停在最后按过的键列上方」，换键时同样走过渡。
      const keyX = hand.key ? hand.key[0] : sign * 4.2
      let hx = this.handX[side] + (keyX - this.handX[side]) * (1 - Math.exp(-d / PRESS_TAU_OUT))
      if (Math.abs(keyX - hx) < SNAP) hx = keyX
      this.handX[side] = hx

      const shoulder = transformPoint(body, [sign * (4 + aw / 2), 10, 0])
      // 逐条对应 render.rs:1031-1039：
      //   x = key.x ?? sign*4.2；y = active ? 10.35 : 11.85；z = active ? 9.4 + (key.y ?? -0.65) : 8.8
      const pressZ = hand.key ? 9.4 + hand.key[1] : 8.75
      const target = [hx, HOVER_Y + (PRESS_Y - HOVER_Y) * w, HOVER_Z + (pressZ - HOVER_Z) * w]
      const dirWorld = normalizeVec([
        target[0] - shoulder[0],
        target[1] - shoulder[1],
        target[2] - shoulder[2],
      ])
      const dirLocal = normalizeVec(inverseRotate(body, dirWorld))
      const typing = Q.fromRotationArc([0, -1, 0], dirLocal)
      const rest = Q.fromEuler(-0.035, 0, sign * 0.105)
      p.arms[side] = Q.slerp(rest, typing, p.sit)
    }
  }

  /** 离开坐姿或关掉打字动效时清掉按压状态，避免下次进 working 带着半个按下。 */
  _resetTyping() {
    this.pressW[0] = 0
    this.pressW[1] = 0
    this.handX[0] = 4.2
    this.handX[1] = -4.2
  }

  /** 状态专属的时间动画。t = 进入该状态后的秒数。 */
  _stateAnim(p, state, t) {
    if (state === 'thinking') this._thinkingAnim(p, t)
    else if (state === 'waiting') this._waitingAnim(p, t)
    else if (state === 'done') this._doneAnim(p, t)
  }

  /** thinking：右手举到与 waiting 相同的位置，叠前后小幅摆动（挠头），同时歪头。 */
  _thinkingAnim(p, t) {
    // 摆动 0.64Hz、±5°：第一版是 1.4Hz、±8°，像在快速抓挠，放慢收小后更像「思考时摸头」。
    // 手臂位置 = waiting 的单手举起再向外撇 0.22 rad：不撇会与歪过去的头穿模（见 HANDOFF 坑 #25）。
    // 用 rotX 构造而不是 fromRotationArc：手臂接近竖直时后者在 180° 附近会算飞。
    const sway = Math.sin(t * 4) * 5 * DEG
    p.arms[1] = Q.multiply(Q.rotZ(0.22), Q.rotX(-160 * DEG + sway))
    // 歪头：9° 基准 + 每 3.7s 一次的轻轻摆动。
    p.head_rotation = Q.multiply(p.head_rotation, Q.rotZ(0.16 + Math.sin(t * 1.7) * 0.03))
  }

  /** waiting：进入状态后跳两下（不循环），之后保持单手举高站着。 */
  _waitingAnim(p, t) {
    // 两跳各 0.75s，中间回落：0.1~0.85、1.05~1.8，之后不再跳。
    const hop = (a, b) =>
      t < a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)) * HOP_HEIGHT
    p.sink = (p.sink || 0) - (hop(0.1, 0.85) + hop(1.05, 1.8))
  }

  /** done：先举手（0~0.9s 沿用静态上举），再放下双手鼓掌到状态结束。 */
  _doneAnim(p, t) {
    const RAISE = 0.9
    if (t < RAISE) return
    const x = Math.min(1, (t - RAISE) / 0.35)
    const u = x * x * (3 - 2 * x)
    // 照 MDP render_gestures.rs:277 Clap：双手在身前合拢，gap 正弦开合；
    // 手末端 x = ±gap、y = -2.8，gap ≈ 2 时两只手刚好碰上。
    const clap = (t - RAISE) * Math.PI * 2 * 2.4
    const gap = 2 + 1.95 * Math.abs(Math.sin(clap))
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1
      const dx = sign * (gap - 6)
      const dy = -2.8
      const dz = Math.sqrt(Math.max(0.1, 100 - dx * dx - dy * dy))
      const target = Q.fromRotationArc([0, -1, 0], normalizeVec([dx, dy, dz]))
      p.arms[side] = Q.slerp(p.arms[side], target, u)
    }
  }
}
