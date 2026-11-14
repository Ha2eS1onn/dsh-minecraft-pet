// quat.js 自检：矩阵乘法一致性、欧拉顺序、slerp、fromRotationArc。
// 用法：node tools/test-quat.mjs

import * as Q from '../assets/quat.js'
import { multiply as m4mul, transformPoint } from '../assets/skin-render.js'

let failed = 0
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const vecClose = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => close(v, b[i], eps))
const matClose = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => close(v, b[i], eps))

function check(name, ok, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
}

// 1) toMatrix(multiply(a,b)) === toMatrix(a) · toMatrix(b)
{
  const a = Q.normalize([0.3, -0.5, 0.2, 0.8])
  const b = Q.normalize([-0.1, 0.4, 0.6, 0.7])
  const lhs = Q.toMatrix(Q.multiply(a, b))
  const rhs = m4mul(Q.toMatrix(a), Q.toMatrix(b))
  check('四元数乘法 ≡ 矩阵乘法', matClose(lhs, rhs), `max diff ${Math.max(...lhs.map((v, i) => Math.abs(v - rhs[i])))}`)
}

// 2) fromEuler(XYZ) === Rx·Ry·Rz（glam 文档给的恒等式）
{
  const i = 0.31
  const j = -0.72
  const k = 0.19
  const lhs = Q.toMatrix(Q.fromEuler(i, j, k))
  const rhs = m4mul(m4mul(Q.toMatrix(Q.rotX(i)), Q.toMatrix(Q.rotY(j))), Q.toMatrix(Q.rotZ(k)))
  check('fromEuler(XYZ) ≡ Rx·Ry·Rz', matClose(lhs, rhs))
}

// 3) rotY(90°) 把 +Z 转到 +X（右手系、Y 向上）
{
  const v = Q.rotate(Q.rotY(Math.PI / 2), [0, 0, 1])
  check('rotY(90°): +Z → +X', vecClose(v, [1, 0, 0]), JSON.stringify(v))
  const m = transformPoint(Q.toMatrix(Q.rotY(Math.PI / 2)), [0, 0, 1])
  check('rotY(90°) 矩阵路径一致', vecClose(m, [1, 0, 0]), JSON.stringify(m))
}

// 4) rotX(90°) 把 +Y 转到 +Z
{
  const v = Q.rotate(Q.rotX(Math.PI / 2), [0, 1, 0])
  check('rotX(90°): +Y → +Z', vecClose(v, [0, 0, 1]), JSON.stringify(v))
}

// 5) slerp 端点与中点
{
  const a = Q.rotX(0.2)
  const b = Q.rotY(-0.9)
  check('slerp t=0 返回 a', vecClose(Q.slerp(a, b, 0), a, 1e-9))
  check('slerp t=1 返回 b', vecClose(Q.slerp(a, b, 1), b, 1e-9))
  const mid = Q.slerp(a, b, 0.5)
  const viaMatrix = transformPoint(Q.toMatrix(mid), [1, 0, 0])
  // 用两段各半的矩阵乘起来对照（不严格相等，但方向应落在中间）
  const end = transformPoint(m4mul(Q.toMatrix(a), Q.toMatrix(b)), [1, 0, 0])
  check('slerp 中点长度归一', close(Math.hypot(...mid), 1, 1e-6))
  check('slerp 中点方向介于两端', Math.abs(viaMatrix[1]) < Math.abs(end[1]) + 1e-6)
}

// 6) fromRotationArc: -Y → 某方向
{
  const target = [0.6, -0.4, 0.69]
  const n = Math.hypot(...target)
  const dir = target.map((v) => v / n)
  const q = Q.fromRotationArc([0, -1, 0], dir)
  const got = Q.rotate(q, [0, -1, 0])
  check('fromRotationArc(-Y → dir)', vecClose(got, dir, 1e-6), JSON.stringify(got))
}

// 7) fromRotationArc 退化情况
{
  check('fromRotationArc 同向 = 单位', vecClose(Q.fromRotationArc([0, -1, 0], [0, -1, 0]), [0, 0, 0, 1]))
  const q = Q.fromRotationArc([0, -1, 0], [0, 1, 0])
  check('fromRotationArc 反向仍可旋转', vecClose(Q.rotate(q, [0, -1, 0]), [0, 1, 0], 1e-5))
}

// 8) fromDegrees 与 fromEuler 一致
{
  const a = Q.fromDegrees(90, 0, 0)
  const b = Q.fromEuler(Math.PI / 2, 0, 0)
  check('fromDegrees ≡ fromEuler', vecClose(a, b, 1e-9))
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
