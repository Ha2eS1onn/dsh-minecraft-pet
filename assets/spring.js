// 阻尼弹簧（P2-a 物理模拟，plan.md §6.6）。
//
// MDP 里没有物理（全项目 spring/damping/velocity 零命中），这块是新写的。
// 三条硬纪律（plan §6.6）：
//   ① 固定步长 1/60，用累加器跑 N 次，**不按实际帧间隔积分** —— 否则 30fps 与 60fps 行为不同
//   ② 支持瞬间重置：状态切换时归零，避免「从 done 回 idle 后带着残留速度歪着」
//   ③ 不参与状态判定：物理只做次级运动，状态仍由事件驱动
//
// 用法：
//   const s = new Spring({ k: 140, zeta: 0.5 })
//   s.impulse(9)          // 给一次初速度（落地/被推）
//   s.step(0, dt)         // 每帧推进，返回当前值
//   s.settled             // 帧需求分级用：还在动就要 60fps

export const SPRING_DT = 1 / 60
/** 单帧最多补算几步：卡顿后不要一次补 100 步把主线程堵住。 */
const MAX_SUBSTEPS = 8

export class Spring {
  /**
   * @param {{k?:number, zeta?:number, value?:number, eps?:number}} [opts]
   *   k 刚度（越大越快）、zeta 阻尼比（1 = 临界阻尼不振荡，0.5~0.8 有回弹）
   */
  constructor({ k = 120, zeta = 1, value = 0, eps = 1e-3 } = {}) {
    this.k = k
    this.zeta = zeta
    this.c = 2 * Math.sqrt(k) * zeta
    this.value = value
    this.velocity = 0
    this.target = value
    this.eps = eps
    this.acc = 0
  }

  /** 直接给速度（模型单位/秒）。落地回弹就是一次 impulse。 */
  impulse(v) {
    this.velocity += v
    return this
  }

  /** 瞬间归零（状态切换时调；plan §6.6 纪律 ②）。 */
  reset(value = 0) {
    this.value = value
    this.target = value
    this.velocity = 0
    this.acc = 0
    return this
  }

  get settled() {
    return Math.abs(this.value - this.target) < this.eps && Math.abs(this.velocity) < this.eps
  }

  /**
   * 推进一帧。
   * @param {number} target 目标值
   * @param {number} dt 真实帧间隔（秒）；内部按固定步长积分
   * @returns {number} 当前值
   */
  step(target, dt) {
    this.target = target
    const d = Math.max(0, Math.min(0.25, dt || 0))
    this.acc += d
    let n = 0
    while (this.acc >= SPRING_DT && n < MAX_SUBSTEPS) {
      const a = -this.k * (this.value - target) - this.c * this.velocity
      this.velocity += a * SPRING_DT
      this.value += this.velocity * SPRING_DT
      this.acc -= SPRING_DT
      n++
    }
    if (n === MAX_SUBSTEPS) this.acc = 0
    // 收敛后吸附：不吸附的话 settled 永远为假，帧需求会一直卡在 60fps
    if (Math.abs(this.value - target) < this.eps && Math.abs(this.velocity) < this.eps) {
      this.value = target
      this.velocity = 0
    }
    return this.value
  }
}
