// 音符粒子：只在检测到**后台有音频在播放**时出现。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render_effects.rs:14 `Note`,
// render.rs:838-842 的生成条件, :260-280 的渲染曲线
//
// 触发源与 MDP 一致是「系统正在播放音频」，但**浏览器拿不到系统音频会话**：
// 真正的检测在宿主侧（Windows WASAPI `IAudioMeterInformation`，M4 用 Node 子进程实现，
// 750ms 轮询 + 1.5s 衰减窗，与 MDP music.rs 相同）。前端只吃一个 `audioActive` 布尔，
// 传 false 时一个音符都不会生成。
//
// 可选的前端兜底（不推荐）：`getDisplayMedia({ audio: true })` 让用户手动分享系统音频，
// 每次都要授权，体验差；只在原型里做验证用。

import { project, transformPoint, drawSprite } from './skin-render.js'

/** 音符生命周期（秒），MDP `(clock - note.start) / 0.5`。 */
export const NOTE_LIFE = 0.5
/** 同时存在的上限，防止长时间播放时堆积。 */
export const NOTE_MAX = 4
/** 两次生成的最小间隔，MDP `next_note = now + 0.5`。 */
export const NOTE_INTERVAL = 0.5

export class NoteField {
  constructor({ max = NOTE_MAX, life = NOTE_LIFE } = {}) {
    this.max = max
    this.life = life
    this.notes = []
    this.nextSpawn = 0
  }

  /**
   * 推进粒子。
   * @param {number} now 秒
   * @param {boolean} audioActive 宿主侧检测到的「有音频在播放」
   * @returns {number} 当前存活数量
   */
  update(now, audioActive) {
    // 音频一停就停止生成；已存在的按生命周期自然消失（MDP 是 retain 过期，不硬清）。
    if (audioActive && now >= this.nextSpawn) {
      // MDP 用 `phase = now * 2.4`：相位随时间连续变化，颜色才有渐变。
      this.notes.push({ start: now, phase: now * 2.4 })
      if (this.notes.length > this.max) this.notes.shift()
      this.nextSpawn = now + NOTE_INTERVAL
    }
    if (!audioActive) this.nextSpawn = now
    if (this.notes.length) this.notes = this.notes.filter((n) => now - n.start < this.life)
    return this.notes.length
  }

  get active() {
    return this.notes.length > 0
  }

  /**
   * 绘制：位置用头部完整矩阵变换 (0, 头半高 + 0.5, 0)，转头时音符从头顶正确位置飘出。
   * @param {object} tex assets/note.png 的纹理（textureFromImage）
   */
  draw(frame, headPart, tex, now) {
    if (!this.notes.length || !headPart || !tex) return
    const top = transformPoint(headPart.transform, [0, headPart.size[1] / 2 + 0.5, 0])
    const origin = project(top, frame.width, frame.height)
    const scale = frame.width / 44
    const size = Math.max(12, 4.2 * scale)
    for (const note of this.notes) {
      const t = Math.min(1, Math.max(0, (now - note.start) / this.life))
      const x = origin[0] + Math.sin(note.phase) * 1.6 * scale
      const y = origin[1] - 2 * scale - t * 4 * scale
      // 三通道错相上色（120° 相位差），一张白色贴图就出彩虹色。
      const tint = [0, 2.094395, 4.18879].map((offset) =>
        Math.min(1, Math.max(0, Math.sin(note.phase + offset) * 0.65 + 0.35)),
      )
      drawSprite(frame, tex, x, y, size, tint, 1 - t * t)
    }
  }
}
