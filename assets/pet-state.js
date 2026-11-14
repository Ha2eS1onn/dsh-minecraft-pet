// 状态机与姿态过渡（M2）。
// 六态、优先级、最短停留、终结态 3s 回 idle、30s 兜底，全部照 plan.md §1.1；
// 状态 → 姿态的映射照 plan.md §6.3，时间驱动的动效（呼吸/眨眼/跟随/打字）留给 M3。

import { defaultPose } from './skin-model.js'
import * as Q from './quat.js'

const D = Math.PI / 180

export const PET_STATES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error']

/** 数值越大越"强"，高优先级可以打断低优先级。 */
export const PET_PRIORITY = {
  idle: 10,
  thinking: 30,
  working: 40,
  done: 50,
  error: 60,
  waiting: 70,
}

export const MIN_STAY_MS = 300
export const TERMINAL_MS = 3000
export const IDLE_TIMEOUT_MS = 30000
export const TRANSITION_MS = 180

/** 参与线性插值的数值字段。 */
const SCALARS = [
  'sit',
  'sink',
  'yaw',
  'pitch',
  'body_yaw',
  'body_roll',
  'body_pitch',
  'body_bob',
  'breathing_bob',
  'head_roll',
  'head_nod',
  'arm_roll',
  'arm_slide',
  'arm_bob',
  'leg_roll',
  'leg_slide',
]

const asQuat = (v) => (v ? v : Q.identity())

/** 两个姿态之间插值：数值线性、四元数 slerp。 */
export function blendPose(a, b, t) {
  const p = {}
  for (const k of SCALARS) p[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t
  p.head_rotation = Q.slerp(asQuat(a.head_rotation), asQuat(b.head_rotation), t)
  p.arms = [0, 1].map((i) => Q.slerp(asQuat(a.arms?.[i]), asQuat(b.arms?.[i]), t))
  return p
}

/**
 * 状态 → 目标姿态（静态部分）。
 * 时间驱动的效果不在这里：waiting 的左右张望、done 的跳跃、error 的摇头都留给 M3。
 */
export function targetPose(state) {
  switch (state) {
    case 'thinking': {
      const p = defaultPose()
      p.head_rotation = Q.fromEuler(-12 * D, 0, 0) // 头微仰
      p.arms = [Q.identity(), Q.rotX(-115 * D)] // 右臂抬至下巴附近
      return p
    }
    case 'working': {
      const p = defaultPose()
      p.sit = 1
      p.body_pitch = 5 * D // 身体前倾 5°
      p.arms = [Q.rotX(-70 * D), Q.rotX(-70 * D)] // 双臂前伸敲键盘
      return p
    }
    case 'waiting': {
      const p = defaultPose()
      p.head_rotation = Q.rotY(18 * D) // 头转向一侧（M3 换成正弦摆动）
      p.arms = [Q.identity(), Q.rotX(-160 * D)] // 右手举起
      return p
    }
    case 'done': {
      const p = defaultPose()
      // 必须用 -π：slerp(identity → rotX(+π)) 的中点是 rotX(+90°)，那是把手臂
      // 向后平举再翻上去；-π 的路径才经过身前。规划里没写，实测发现。
      p.arms = [Q.rotX(-Math.PI), Q.rotX(-Math.PI)]
      return p
    }
    case 'error': {
      const p = defaultPose()
      p.sink = -0.8 // 身体轻微下沉
      p.head_rotation = Q.rotX(22 * D) // 低头
      return p
    }
    case 'idle':
    default:
      return defaultPose()
  }
}

/** smoothstep，与 MDP 的 `fn smooth(t)` 一致。 */
const smooth = (t) => t * t * (3 - 2 * t)

/** 180ms 的姿态过渡；中途改目标时从"当前插值结果"接着走，不会跳变。 */
export class PoseTransition {
  constructor(pose, now = 0) {
    this.from = pose
    this.to = pose
    this.start = now
    this.duration = 0
  }

  setTarget(pose, now) {
    this.from = this.sample(now)
    this.to = pose
    this.start = now
    this.duration = TRANSITION_MS
  }

  /** 是否还在过渡中（用于帧需求判定）。 */
  isAnimating(now) {
    return this.duration > 0 && now - this.start < this.duration
  }

  sample(now) {
    if (this.duration === 0) return this.to
    const t = (now - this.start) / this.duration
    if (t >= 1) {
      this.duration = 0
      return this.to
    }
    return blendPose(this.from, this.to, smooth(Math.max(0, t)))
  }
}

/**
 * 六态状态机。
 * - 只能被更高优先级打断，且当前状态至少停留 MIN_STAY_MS
 * - done / error 进入后锁定 TERMINAL_MS，到点自动回 idle
 * - 除 working / waiting 外，IDLE_TIMEOUT_MS 无事件回 idle
 */
export class PetStateMachine {
  constructor(now = 0) {
    this.now = now
    this.state = 'idle'
    this.since = now
    this.holdUntil = 0
    this.lastEvent = now
    this.transition = new PoseTransition(targetPose('idle'), now)
  }

  /** 请求切态。返回 true 表示真的切了。 */
  request(state, now = this.now) {
    this.lastEvent = now
    if (!PET_STATES.includes(state)) return false
    if (this.holdUntil > now) return false // 终结态锁定中
    if (PET_PRIORITY[state] <= PET_PRIORITY[this.state]) return false // 不降级、不重复
    if (now - this.since < MIN_STAY_MS) return false // 最短停留未满
    this._set(state, now)
    return true
  }

  /** 无视优先级与最短停留直接设态（演示、初始化用）。 */
  force(state, now = this.now) {
    if (!PET_STATES.includes(state)) return false
    this.lastEvent = now
    this._set(state, now)
    return true
  }

  /** 每帧推进：结算终结态与兜底，返回当前状态。 */
  tick(now = this.now) {
    this.now = now
    if (this.holdUntil) {
      if (now >= this.holdUntil) {
        this.holdUntil = 0
        this._set('idle', now)
      }
      return this.state
    }
    const exempt = this.state === 'working' || this.state === 'waiting'
    if (!exempt && this.state !== 'idle' && now - this.lastEvent > IDLE_TIMEOUT_MS) {
      this._set('idle', now)
    }
    return this.state
  }

  /** 当前帧应渲染的姿态。 */
  pose(now = this.now) {
    return this.transition.sample(now)
  }

  _set(state, now) {
    this.state = state
    this.since = now
    this.holdUntil = state === 'done' || state === 'error' ? now + TERMINAL_MS : 0
    this.transition.setTarget(targetPose(state), now)
  }
}
