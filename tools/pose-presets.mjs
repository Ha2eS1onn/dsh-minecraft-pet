// M1 的静态摆位预设。M2 起由状态机产出 pose，这里保留作为回归与摆位核对用。

import { defaultPose } from '../assets/skin-model.js'
import * as Q from '../assets/quat.js'

/** 已登记的摆位名。潜行（crouch）已在 M1 砍掉。 */
export const POSES = ['stand', 'sit', 'arm', 'arms-up', 'tilt']

export function makePose(name) {
  const p = defaultPose()
  switch (name) {
    case 'sit':
      p.sit = 1
      break
    case 'arm':
      // 右臂向前平举（肩点绕 X 轴 -90°）
      p.arms = [null, Q.rotX(-Math.PI / 2)]
      break
    case 'arms-up':
      // 手臂默认朝下 (-Y)，绕 X 转 180° 才是竖直向上
      p.arms = [Q.rotX(Math.PI), Q.rotX(Math.PI)]
      break
    case 'tilt':
      // 只歪头，身体保持不动（plan §6.8 的 Tilt 手势只作用于 head）
      p.head_rotation = Q.rotZ(0.32)
      break
    case 'stand':
    default:
      break
  }
  return p
}
