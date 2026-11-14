// 待机手势（P1）：伸懒腰 / 歪头 / 犯困 + 30~60s 随机调度器。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render_gestures.rs:6-9 时长,
// :215-246 调度器, :247-328 三条动作与回位。
//
// 四条照抄的调度纪律（plan.md §6.8）：
//   ① 只在真空闲时触发（无手势、回位中、无按键、用户 0.6s 内没操作）——
//      副作用是 thinking / working / waiting 期间天然不会伸懒腰，状态本身就是闸门。
//   ② 开关变化即重排；全关则不再排期，进行中的自动手势被取消并回位。
//   ③ 打断必须回位，不能硬切：进入 220ms 淡入、350ms 淡出，退出 160ms 插回。
//   ④ 不新增定时器：deadline 检查复用现有 1s 的 pollWaitState 周期（M4 接入）。

import * as Q from './quat.js'

export const GESTURES = ['stretch', 'tilt', 'sleepy']

/** 手势时长（秒），render_gestures.rs:6-9。 */
export const DURATION = { stretch: 3.0, tilt: 2.4, sleepy: 2.25 }

/** 自动手势的随机间隔 30~60s（render_gestures.rs:232）。 */
export const DELAY_MIN = 30
export const DELAY_MAX = 60
/** 用户操作后至少静默这么久才允许自动手势。 */
export const INPUT_QUIET = 0.6

const FADE_IN = 0.22
const FADE_OUT = 0.35
const RETURN = 0.16

/** 伸懒腰的身体抖动幅度（MDP `render_gestures.rs:302` 的原值是 0.035 单位，
 *  约 0.28 屏幕像素；它靠 60fps 的持续亚像素抖动让整个人「发颤」，
 *  调大会更明显但容易像抖筛子。 */
export const SHAKE_AMPLITUDE = 0.035

const smooth = (t) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

const copyPose = (p) => ({
  ...p,
  head_rotation: Q.normalize(p.head_rotation || Q.identity()),
  arms: [Q.normalize(p.arms?.[0] || Q.identity()), Q.normalize(p.arms?.[1] || Q.identity())],
})

export class GestureScheduler {
  /** @param {{rng?: () => number}} opts rng 供测试注入确定性随机 */
  constructor({ rng = Math.random } = {}) {
    this.rng = rng
    this.enabled = { stretch: true, tilt: true, sleepy: true }
    /** 上一轮的开关掩码；从 0 起步，第一次 update 就会按当前开关排期。 */
    this.mask = 0
    /** 下一次自动手势的截止时间（秒），null = 未排期。 */
    this.next = null
    this.active = null // { kind, start, automatic }
    this.returnFrom = null // { start, head, arms, jump }
    this.lastInput = -Infinity
    this.jump = 0
    /** 模型空间的身体抖动偏移（伸懒腰用），[x, y, z]。 */
    this.shake = [0, 0, 0]
    this.snapshot = null
  }

  _mask() {
    return (this.enabled.stretch ? 1 : 0) | (this.enabled.tilt ? 2 : 0) | (this.enabled.sleepy ? 4 : 0)
  }

  /** 开关变化即重排（§6.8 第 3 条）。 */
  setEnabled(kind, on, now) {
    if (this.enabled[kind] === on) return
    this.enabled[kind] = on
    this.mask = this._mask()
    if (this.active && this.active.automatic) this.cancel(now)
    this.next = this.mask === 0 ? null : now + this._delay()
  }

  /** 只有真空闲才允许自动手势。 */
  get idle() {
    return !this.active && !this.returnFrom
  }

  _quiet(now) {
    return now - this.lastInput >= INPUT_QUIET
  }

  _delay() {
    return DELAY_MIN + this.rng() * (DELAY_MAX - DELAY_MIN)
  }

  /**
   * 调度一步。
   *
   * 与 MDP 一致：**不看 posture / 会话状态**，只看「手势空闲 + 用户 0.6s 内没输入」。
   * 所以 working 里坐着打字时同样会伸懒腰（MDP 的 `gesture_idle()` 也只检查
   * `held.is_empty()` 与静默期，没有姿态判断）。打字动画本身不算用户输入，
   * 真实按键由调用方显式调 `noteInput(now)` 来打断。
   */
  update(now) {
    const mask = this._mask()
    if (mask !== this.mask) {
      this.mask = mask
      if (this.active && this.active.automatic) this.cancel(now)
      this.next = mask === 0 ? null : now + this._delay()
    }
    if (mask === 0 || this.next === null) return
    if (now < this.next) return
    if (!this.idle || !this._quiet(now)) return
    const choices = GESTURES.filter((_, i) => mask & (1 << i))
    const kind = choices[Math.min(choices.length - 1, Math.floor(this.rng() * choices.length))]
    this.active = { kind, start: now, automatic: true }
    this.next = now + this._delay()
  }

  /** 手动触发（右键菜单用；P1 只暴露给测试与原型）。 */
  trigger(kind, now) {
    this.remember(now)
    this.active = { kind, start: now, automatic: false }
    this.lastInput = now
  }

  /** 用户按键 / 点击：立刻取消进行中的手势，走回位而不是跳变。 */
  noteInput(now) {
    this.lastInput = now
    this.cancel(now)
  }

  cancel(now) {
    if (!this.active) return
    this.remember(now)
    this.active = null
  }

  remember(now) {
    const s = this.snapshot
    if (!s) {
      this.returnFrom = null
      return
    }
    this.returnFrom = { start: now, head: s.head, arms: s.arms, jump: s.jump }
  }

  /** 把手势叠到姿态上。返回新对象，不改传入的 pose。 */
  apply(pose, now) {
    const p = copyPose(pose)
    this.jump = 0
    this.shake = [0, 0, 0]
    if (this.active) {
      const t = Math.max(0, now - this.active.start)
      const dur = DURATION[this.active.kind]
      if (t >= dur) {
        this.active = null
      } else {
        this._applyActive(p, this.active.kind, t, dur)
      }
    }
    if (this.returnFrom) {
      const from = this.returnFrom
      const blend = smooth((now - from.start) / RETURN)
      p.head_rotation = Q.slerp(from.head, p.head_rotation, blend)
      for (let i = 0; i < 2; i++) p.arms[i] = Q.slerp(from.arms[i], p.arms[i], blend)
      this.jump = from.jump + (this.jump - from.jump) * blend
      if (blend >= 1) this.returnFrom = null
    }
    // 上跳等价于整体抬起：sink 负值向下，所以向上要减。
    p.sink = (p.sink || 0) - this.jump
    p.shake = this.shake
    this.snapshot = { head: p.head_rotation, arms: [p.arms[0], p.arms[1]], jump: this.jump }
    return p
  }

  _applyActive(p, kind, t, dur) {
    const w = smooth(t / FADE_IN) * (1 - smooth((t - (dur - FADE_OUT)) / FADE_OUT))
    const phase = t * Math.PI * 2

    if (kind === 'stretch') {
      // 双臂举向 (sign*0.5, √3/2, 0)：左右各 60°；11Hz 微颤叠在手臂上。
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1
        const target = Q.fromRotationArc([0, -1, 0], [sign * 0.5, Math.sqrt(3) / 2, 0])
        const tremor = Math.sin(phase * 11) * 0.018 * w
        p.arms[side] = Q.multiply(Q.slerp(p.arms[side], target, w), Q.fromEuler(tremor, 0, sign * tremor))
      }
      p.head_rotation = Q.multiply(p.head_rotation, Q.rotX(-0.12 * w))
      // 全身抖动：MDP 的 gesture_shake，x 用 11Hz、y 用 13Hz（错频才不像机械摆动，
      // y 幅度减半）。它带动整个角色，不只是手臂。
      this.shake = [
        Math.sin(phase * 11) * SHAKE_AMPLITUDE * w,
        Math.sin(phase * 13) * 0.5 * SHAKE_AMPLITUDE * w,
        0,
      ]
      return
    }

    if (kind === 'tilt') {
      // 最大 18°（0.32 rad）的正弦摆动。
      p.head_rotation = Q.multiply(p.head_rotation, Q.rotZ(0.32 * w * Math.sin(phase * 0.25)))
      return
    }

    // sleepy：前 2s 头缓慢下点 24°（0.42 rad），最后 0.25s 惊醒抛物线。
    const nod = t < 2 ? smooth(t / 2) * 0.42 : 0
    p.head_rotation = Q.multiply(p.head_rotation, Q.rotX(nod))
    if (t >= 2) {
      const u = Math.min(1, Math.max(0, (t - 2) / 0.25))
      // 非 Q 版头高 8 单位，跳起 30% 头高。
      this.jump = 4 * u * (1 - u) * (8 * 0.3)
    }
  }
}
