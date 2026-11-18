// 盒子骨架：把「姿态 + 皮肤类型」翻译成 drawBox 能吃的 part 列表。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render.rs parts_with_cape():1285
//
// 合成顺序逐条照抄源码，尤其注意三者挂在不同空间上：
//   body part  ← body()          （吃 body_yaw / body_roll 扭动）
//   head / arm ← torso_space()   （只吃上下起伏，不吃身体扭转）
//   leg        ← base_body()     （腿是独立骨骼，连起伏都不吃）

import { translate, scale, multiply, identity, transformPoint } from './skin-render.js'
import * as Q from './quat.js'

/** 外层（hat/jacket/sleeve/pants）的图集起点，plan.md §5.6 表。 */
export const OVERLAY_UV = {
  head: [32, 0],
  body: [16, 32],
  rightArm: [40, 32],
  leftArm: [48, 48],
  rightLeg: [0, 32],
  leftLeg: [0, 48],
}

const IDENTITY_MAT = identity()

/** 坐姿键盘的底色（MDP `keyboard_color` 默认 `#83878A`）。 */
const KEYBOARD_COLOR = [0x83, 0x87, 0x8a]
/** 键帽比键盘底色暗 22%（MDP `key_gray = gray * 0.78`）。 */
const KEYCAP_COLOR = [102, 105, 108]

/** 压缩形变（果冻）：squash=1 时高度压到 78%、横向鼓到 113%。
 *  取值依据：站立 32 单位高、8 px/单位，squash 峰值约 0.42 ⇒ 头顶下沉约 3 单位 ≈ 24 px。 */
const SQUASH_Y = 0.22
const SQUASH_XZ = 0.13

/** 静止姿态：所有字段为 0/identity，渲染结果必须与 M0 基线逐像素一致。 */
export function defaultPose() {
  return {
    sit: 0,
    /** 整体下沉（世界 y，单位）。负值向下；用来表达 error 的「轻微下沉」。 */
    sink: 0,
    /** 模型空间整体平移（伸懒腰的身体抖动），[x, y, z] 或 null。 */
    shake: null,
    /** 压缩量（P2-a v2）：1 = 压到最扁，负值 = 拉长。以脚底 y=0 为支点做非等比缩放。 */
    squash: 0,
    yaw: 0,
    pitch: 0,
    body_yaw: 0,
    body_roll: 0,
    /** 躯干前倾（弧度，绕髋部 y=12）。working 的前倾 5° 用它。 */
    body_pitch: 0,
    body_bob: 0,
    breathing_bob: 0,
    head_roll: 0,
    head_nod: 0,
    head_rotation: null, // Quat；null = identity
    arms: null, // [Quat, Quat]；null = identity
    arm_roll: 0,
    arm_slide: 0,
    arm_bob: 0,
    leg_roll: 0,
    leg_slide: 0,
  }
}

/** 腿与上半身的共同基准：sit 时整体下沉 6 单位。
 *  潜行（crouch）已在 M1 砍掉，不再有对应的下沉/前倾分支——见 HANDOFF 决策。 */
function baseBody(p) {
  return translate(0, 12 - 6 * p.sit - (p.sink || 0), 0)
}

/** 躯干前倾：绕髋部 y=12。body_pitch=0 时精确返回单位矩阵。 */
function leanTorso(p) {  if (!p.body_pitch) return identity()
  return multiply(
    multiply(translate(0, 12, 0), Q.toMatrix(Q.rotX(p.body_pitch))),
    translate(0, -12, 0),
  )
}

/** 对应 Pose::torso_space()：上下起伏 + base_body + 躯干前倾。 */
function torsoSpace(p) {
  return multiply(
    multiply(translate(0, p.body_bob + p.breathing_bob, 0), baseBody(p)),
    leanTorso(p),
  )
}

/** 对应 Pose::body()：torso_space 再叠 body_roll（绕 y=12 的轴）与 body_yaw。 */
function bodySpace(p) {
  return multiply(
    multiply(
      multiply(torsoSpace(p), translate(0, 12, 0)),
      Q.toMatrix(Q.rotZ(p.body_roll)),
    ),
    multiply(translate(0, -12, 0), Q.toMatrix(Q.rotY(p.body_yaw))),
  )
}

/** 供动效层复用的空间矩阵（M3 的头部跟随与打字需要求肩点/脖子位置）。 */
export { baseBody, torsoSpace, bodySpace }

/** 自定义姿态的六个部位（顺序与配置对象一致）。 */
const CUSTOM_ROWS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']

/** 一行 [x,y,z] 度 → 四元数；全零（或缺省）返回 null，让调用方走「零开销」分支。 */
function rowQuat(row) {
  if (!row) return null
  const x = Number(row[0]) || 0
  const y = Number(row[1]) || 0
  const z = Number(row[2]) || 0
  if (!x && !y && !z) return null
  return Q.fromDegrees(x, y, z)
}

/**
 * 把「站姿/坐姿两套自定义角度」折算成一组可复用的矩阵。
 *
 * - 每部位按 `sit` 在站/坐两套之间 slerp，所以进出坐姿是连续过渡，不会硬跳。
 * - 全零 → 返回 **null**（不是单位矩阵）：`buildParts` 见到 null 时完全跳过乘法，
 *   静止帧才能与基线逐像素一致（`c2c43ab4`）。
 * - `rot` 是整体角度：绕 y=15（模型中心）转，与 MDP `model_transform` 一致。
 *
 * @param {object} cfg 配置对象（只读 `cfg.pose` 与 `cfg.rot`）
 * @param {number} sit 0..1 坐姿混合量
 * @returns {null | {body, head, arms, legs, rot, bodyQ, rotQ}}
 */
export function customRig(cfg, sit) {
  if (!cfg || !cfg.pose) return null
  const stand = cfg.pose.stand || {}
  const seated = cfg.pose.sit || {}
  const t = Math.max(0, Math.min(1, Number(sit) || 0))
  const rig = { body: null, head: null, arms: [null, null], legs: [null, null], rot: null, bodyQ: null, rotQ: null }
  let any = false

  const blend = (entry) => {
    const a = rowQuat(stand[entry])
    const b = rowQuat(seated[entry])
    if (!a && !b) return null
    if (!a) return t >= 1 ? b : (t <= 0 ? null : Q.slerp(Q.identity(), b, t))
    if (!b) return t <= 0 ? a : (t >= 1 ? null : Q.slerp(a, Q.identity(), t))
    if (t <= 0) return a
    if (t >= 1) return b
    return Q.slerp(a, b, t)
  }

  for (const entry of CUSTOM_ROWS) {
    const q = blend(entry)
    if (!q) continue
    any = true
    const m = Q.toMatrix(q)
    if (entry === 'body') { rig.body = m; rig.bodyQ = q }
    else if (entry === 'head') rig.head = m
    else if (entry === 'leftArm') rig.arms[0] = m
    else if (entry === 'rightArm') rig.arms[1] = m
    else if (entry === 'leftLeg') rig.legs[0] = m
    else if (entry === 'rightLeg') rig.legs[1] = m
  }

  const rot = cfg.rot
  if (rot) {
    const rx = Number(rot.x) || 0
    const ry = Number(rot.y) || 0
    const rz = Number(rot.z) || 0
    if (rx || ry || rz) {
      const q = Q.fromDegrees(rx, ry, rz)
      rig.rotQ = q
      rig.rot = multiply(multiply(translate(0, 15, 0), Q.toMatrix(q)), translate(0, -15, 0))
      any = true
    }
  }
  if (!any) return null
  if (!rig.bodyQ) rig.bodyQ = Q.identity()
  if (!rig.rotQ) rig.rotQ = Q.identity()
  return rig
}

/** 压缩形变系数：`tools/bench-physics.mjs` 用它把 squash 换算成像素位移。 */
export const SQUASH_SHAPE = { y: SQUASH_Y, xz: SQUASH_XZ, height: 32 }

/**
 * 骨架构建。
 * @param {object} pose 见 defaultPose()
 * @param {{legacy?: boolean, eyes?: object}} skin legacy 标记 + 识别格眼睛
 * @param {{outer?: boolean, armWidth?: number, keyboard?: boolean, keycaps?: boolean,
 *          cape?: object, custom?: object, keyboardColor?: number[]}} opts
 *   armWidth=3 即 slim；keyboard=false 可关掉坐姿键盘；
 *   custom 是 `customRig()` 的返回值（null 时不做任何额外乘法，保证基线逐像素不变）；
 *   keyboardColor 是键盘盒 RGB（null 时用内置常量，键帽自动取 0.78 暗一档）
 */
export function buildParts(
  pose,
  skin,
  { outer = true, armWidth = 4, keyboard: keyboardOn = true, keycaps = true, cape = null, custom = null, keyboardColor = null } = {},
) {
  const p = pose || defaultPose()
  const legacy = !!skin?.legacy
  const parts = []
  // 自定义偏移：off 为 null 时**原样返回**，不引入任何多余乘法（否则末位会漂、基线哈希变）
  const C = custom
  const mul = (m, off) => (off ? multiply(m, off) : m)

  const add = (key, size, uv, transform, mirror = false) => {
    parts.push({ key, size, uv, transform, inflate: 0, mirror })
    // legacy 只有帽子层（旧皮肤没有 jacket/sleeve/pants 的空间）
    if (!outer || (legacy && key !== 'head')) return
    const inflate = key === 'head' ? 1 : 0.5
    parts.push({ key: `${key}Outer`, size, uv: OVERLAY_UV[key], transform, inflate, mirror })
  }

  // 躯干
  add('body', [8, 12, 4], [16, 16], multiply(mul(bodySpace(p), C && C.body), translate(0, 6, 0)))

  // 头：torso_space · [custom body] · T(0,12,0) · [custom head] · headRot · T(0,4,0)
  const headRot = p.head_rotation ? Q.toMatrix(p.head_rotation) : IDENTITY_MAT
  const headBase = mul(mul(torsoSpace(p), C && C.body), translate(0, 12, 0))
  const headTransform = multiply(multiply(mul(headBase, C && C.head), headRot), translate(0, 4, 0))
  add('head', [8, 8, 8], [0, 0], headTransform)

  // 手臂：torso_space · Ry(body_yaw) · [custom body] · T(肩) · armRot · [custom arm] · T(0,-4,0)
  for (const left of [false, true]) {
    const side = left ? 0 : 1
    const sign = left ? 1 : -1
    const armRot = p.arms?.[side] ? Q.toMatrix(p.arms[side]) : IDENTITY_MAT
    const armBase = mul(mul(torsoSpace(p), Q.toMatrix(Q.rotY(p.body_yaw))), C && C.body)
    add(
      left ? 'leftArm' : 'rightArm',
      [armWidth, 12, 4],
      left && !legacy ? [32, 48] : [40, 16],
      multiply(
        multiply(
          multiply(
            armBase,
            translate(sign * (4 + armWidth / 2) + p.arm_slide, 10 + sign * p.arm_bob, 0),
          ),
          mul(armRot, C && C.arms[side]),
        ),
        translate(0, -4, 0),
      ),
      left && legacy,
    )
  }

  // 腿：base_body · T(髋) · Rz(leg_roll) · legRot · T(0,-6,0)
  for (const left of [false, true]) {
    const side = left ? 0 : 1
    const sign = left ? 1 : -1
    const legQ = Q.fromEuler(
      -Math.PI * 0.48 * p.sit,
      sign * 0.16 * p.sit,
      sign * 0.045 * p.sit,
    )
    void side
    add(
      left ? 'leftLeg' : 'rightLeg',
      [4, 12, 4],
      left && !legacy ? [16, 48] : [0, 16],
      multiply(
        multiply(
          multiply(
            multiply(baseBody(p), translate(sign * (2 + 0.25 * p.sit) + p.leg_slide, 0, 0)),
            Q.toMatrix(Q.rotZ(p.leg_roll)),
          ),
          mul(Q.toMatrix(legQ), C && C.legs[side]),
        ),
        translate(0, -6, 0),
      ),
      left && legacy,
    )
  }

  // 披风（M5，plan.md §7.5）：10×16×1 薄板挂在背后。
  // 尺寸/挂载/倾角照抄 MDP render.rs:1438；UV 起点**故意与 MDP 不同**（0 而不是 -11）：
  //   MDP 取 -11 让 -Z 面落在官方图案区 (1,1)，因为它的模型能转身、从背面看；
  //   本项目视角固定在正面（相机永远在 +Z），-Z 面永远背对用户，照抄的话用户永远
  //   看不到自己的披风图案。取 0 后 +Z（朝向相机）落在 (1,1) 图案区、-Z 落在 (12,1)
  //   内衬区、±X 落在两侧边条，与官方贴图布局一一对应。
  // 代价：从背后看会「里外反了」——本项目没有从背后看的机会，可接受。
  if (cape) {
    parts.push({
      key: 'cape',
      cape: true,
      size: [10, 16, 1],
      uv: [0, 0],
      transform: multiply(
        multiply(mul(bodySpace(p), C && C.body), translate(0, 3.6, -2.9)),
        Q.toMatrix(Q.rotX(0.14)),
      ),
      inflate: 0,
      mirror: false,
      texture: cape,
    })
  }

  // 眼皮薄片：只有画过识别格的皮肤才画（render.rs:2010 `eyelid()`）。
  // 皮肤没画识别格时 skin.eyes 为 null —— 那时应当「不眨眼」，这是 P1 的预期行为。
  const eyelid = p.eyelid === undefined ? 1 : p.eyelid
  if (skin?.eyes && eyelid < 0.998) {
    for (const eye of [skin.eyes.left, skin.eyes.right]) {
      const closed = 1 - eyelid
      // 贴在头盒 +Z 面之外 0.02（MDP `sz.z/2 + 0.02`）。不能为了躲开 hat 层往
      // 前推到 4.52：相机是 3/4 视角（FORWARD 的 x 分量非零），正交投影下 z 也会
      // 挪屏幕位置，0.5 单位对应约 1.6px 横移 —— 闭眼时眼睛内侧会漏一条彩线。
      const z = 4 + 0.02
      const x0 = eye.x0 - 4
      const x1 = eye.x1 + 1 - 4
      const top = 4 - eye.y0
      // 从上边缘向下长满眼睛那一行（材质包的 blink.sy 0→1）。
      const bottom = top - eye.rows * closed
      const lx0 = eye.lid[0]
      const lx1 = eye.lid[2] + 1
      const ly = eye.lid[1] + 0.5
      const local = [
        [x0, top, z, lx0, ly],
        [x1, top, z, lx1, ly],
        [x0, bottom, z, lx0, ly],
        [x1, bottom, z, lx1, ly],
      ]
      parts.push({
        kind: 'quad',
        key: 'eyelid',
        face: 4,
        pos: local.map((c) => transformPoint(headTransform, [c[0], c[1], c[2]])),
        uv: local.map((c) => [c[3], c[4]]),
      })
    }
  }

  // 压缩形变（P2-a v2，打字与落地用）：以**脚底 y=0** 为支点的非等比缩放，
  // 高度压扁、横向鼓起，读起来才有「果冻」的体积感；只平移不改轮廓的写法 v1 已经证伪。
  // 放在 shake 之前：抖动是绝对位移，不该被压缩量再缩放一次。
  // 键盘在下面才 push，所以不吃压缩 —— 它是场景物件，不是角色的肉。
  if (p.squash) {
    const sq = Math.max(-0.45, Math.min(1, p.squash))
    const m = scale(1 + SQUASH_XZ * sq, 1 - SQUASH_Y * sq, 1 + SQUASH_XZ * sq)
    for (const part of parts) {
      if (part.kind === 'quad') part.pos = part.pos.map((v) => transformPoint(m, v))
      else part.transform = multiply(m, part.transform)
    }
  }

  // 伸懒腰的身体抖动：MDP 的 `gesture_shake` 是模型空间的世界平移（render.rs:1463），
  // 左乘在每个角色 part 上，所以整个身体（含头）一起抖，而不只是手臂。
  // 键盘不算角色，MDP 也是在 shake 之后才 push 键盘，因此键盘不吃抖动。
  if (p.shake && (p.shake[0] || p.shake[1] || p.shake[2])) {
    const m = translate(p.shake[0], p.shake[1], p.shake[2])
    for (const part of parts) {
      if (part.kind === 'quad') part.pos = part.pos.map((v) => transformPoint(m, v))
      else part.transform = multiply(m, part.transform)
    }
  }

  // 坐姿键盘：MDP `parts_with_cape()` 在 sit > 0.4 时追加一个纯色键盘盒（render.rs:1465）。
  // 尺寸 19.6×0.65×7.8，中心 (0,10.2,9.4)，随 sit 缩放后再下移 0.3。
  // 不占贴图：走 solidSkin 的 1×1 纯色 + 6 面明暗 LUT，与装饰同一条绘制路径。
  if (keyboardOn && p.sit > 0.4) {
    const SX = 19.6
    const SY = 0.65
    const SZ = 7.8
    // 自定义色号：键盘用原色，键帽按 MDP 的 0.78 压暗；没设色号时走内置常量（默认画面不变）
    const kbColor = keyboardColor || KEYBOARD_COLOR
    const capColor = keyboardColor ? keyboardColor.map((v) => Math.round(v * 0.78)) : KEYCAP_COLOR
    const keyboard = multiply(
      multiply(translate(0, 10.2, 9.4), scale(p.sit, p.sit, p.sit)),
      translate(0, -0.3, 0),
    )
    parts.push({
      key: 'keyboard',
      keyboard: true,
      size: [SX, SY, SZ],
      uv: [0, 0],
      transform: keyboard,
      inflate: 0,
      mirror: false,
      solid: kbColor,
    })
    // 键帽：MDP 在顶面按 3 行 × 5 列判定 `is_key`（render.rs:2162-2174）把键位画暗；
    // 这里做成立体小方块，观感一致且完全复用 drawBox。
    if (keycaps) {
      for (let row = 0; row < 3; row++) {
        const stagger = row === 1 ? 0.025 : -0.025
        for (let col = 1; col <= 5; col++) {
          const gx = (col / 6 + stagger - 0.5) * SX
          const gz = (0.2 + row * 0.3 - 0.5) * SZ
          const side = SZ * 0.22
          parts.push({
            key: 'keycap',
            size: [side, 0.06, side],
            uv: [0, 0],
            transform: multiply(keyboard, translate(gx, SY / 2 + 0.03, gz)),
            inflate: 0,
            mirror: false,
            solid: capColor,
          })
        }
      }
    }
  }

  // 整体角度偏移（视线与角度面板）：绕模型中心 y=15 转，**最后**左乘到全部 part，
  // 键盘/键帽也一起吃 —— 否则手（按模型空间键位反解）会脱键、浮现字挂点也会偏。
  // 必须在 squash / shake 之后：压缩轴要跟着身体走，抖动是绝对位移。
  if (C && C.rot) {
    for (const part of parts) {
      if (part.kind === 'quad') part.pos = part.pos.map((v) => transformPoint(C.rot, v))
      else part.transform = multiply(C.rot, part.transform)
    }
  }

  return parts
}

/** 静止站立的快捷入口（M0 基线用）。 */
export function staticParts(skin, opts) {
  return buildParts(defaultPose(), skin, opts)
}
