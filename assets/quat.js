// 四元数与矩阵。约定与 glam 对齐，便于对照 MDP 源码。
// Ported from Minecraft-Desktop-Pet (MIT) — native/src/render.rs:514 `rotation()`
//
// 关键约定（glam 文档原话）：
//   Mat3::from_euler(EulerRot::XYZ, i, j, k) == Rx(i) * Ry(j) * Rz(k)
// 即 `rotation(x, y, z)` 的复合顺序是 Rx·Ry·Rz，四元数对应 `qx ⊗ qy ⊗ qz`。

/** 四元数用 [x, y, z, w] 表示，与 glam 的存储顺序一致。 */

export function identity() {
  return [0, 0, 0, 1]
}

export function axisAngle(x, y, z, angle) {
  const half = angle * 0.5
  const s = Math.sin(half)
  return [x * s, y * s, z * s, Math.cos(half)]
}

export const rotX = (a) => axisAngle(1, 0, 0, a)
export const rotY = (a) => axisAngle(0, 1, 0, a)
export const rotZ = (a) => axisAngle(0, 0, 1, a)

/** a ⊗ b：等价于矩阵 Ra·Rb（先作用 b，再作用 a）。 */
export function multiply(a, b) {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** 对应 glam 的 Quat::from_euler(EulerRot::XYZ, x, y, z) = Rx·Ry·Rz。 */
export function fromEuler(x, y, z) {
  return multiply(multiply(rotX(x), rotY(y)), rotZ(z))
}

/** 对应 MDP 的 `degrees(&[f32])`：把角度制三元组转成四元数。 */
export function fromDegrees(x, y, z) {
  const D = Math.PI / 180
  return fromEuler(x * D, y * D, z * D)
}

/** 共轭即单位四元数的逆。 */
export function conjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function normalize(q) {  const [x, y, z, w] = q
  const n = Math.hypot(x, y, z, w)
  if (n < 1e-12) return identity()
  return [x / n, y / n, z / n, w / n]
}

export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b
  const [ax, ay, az, aw] = a
  let dot = ax * bx + ay * by + az * bz + aw * bw
  // 走最短路径
  if (dot < 0) {
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
    dot = -dot
  }
  if (dot > 0.9995) {
    return normalize([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, aw + (bw - aw) * t])
  }
  const theta0 = Math.acos(Math.min(1, dot))
  const theta = theta0 * t
  const sin0 = Math.sin(theta0)
  const s0 = Math.sin(theta0 - theta) / sin0
  const s1 = Math.sin(theta) / sin0
  return [ax * s0 + bx * s1, ay * s0 + by * s1, az * s0 + bz * s1, aw * s0 + bw * s1]
}

/** 把 from 方向转到 to 方向的最短弧旋转（对应 Quat::from_rotation_arc）。 */
export function fromRotationArc(from, to) {
  const fl = Math.hypot(from[0], from[1], from[2])
  const tl = Math.hypot(to[0], to[1], to[2])
  if (fl < 1e-8 || tl < 1e-8) return identity()
  const fx = from[0] / fl
  const fy = from[1] / fl
  const fz = from[2] / fl
  const tx = to[0] / tl
  const ty = to[1] / tl
  const tz = to[2] / tl
  const d = fx * tx + fy * ty + fz * tz
  if (d >= 1 - 1e-6) return identity()
  if (d <= -1 + 1e-6) {
    // 反向：绕任一垂直轴转 180°
    let axis = Math.abs(fx) < 0.9 ? [0, fx, -fy] : [-fz, 0, fx]
    const n = Math.hypot(...axis) || 1
    return [axis[0] / n, axis[1] / n, axis[2] / n, 0]
  }
  const cx = fy * tz - fz * ty
  const cy = fz * tx - fx * tz
  const cz = fx * ty - fy * tx
  return normalize([cx, cy, cz, 1 + d])
}

/**
 * 四元数 → 4×4 旋转矩阵，行主序（与 skin-render.js 的 mat4 一致）。
 */
export function toMatrix(q) {
  const [x, y, z, w] = q
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0,
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0,
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ]
}

/** 旋转 vec3（不含平移）。 */
export function rotate(q, v) {
  const [x, y, z, w] = q
  const ix = w * v[0] + y * v[2] - z * v[1]
  const iy = w * v[1] + z * v[0] - x * v[2]
  const iz = w * v[2] + x * v[1] - y * v[0]
  const iw = -x * v[0] - y * v[1] - z * v[2]
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ]
}
