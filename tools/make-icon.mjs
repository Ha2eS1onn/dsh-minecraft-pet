// 生成插件图标：把一个方块小人渲染成 512×512 透明 PNG（`icon.png`）。
// 用渲染器自己画，图标和挂件里的小人永远一致；不再沿用 DWS 的鲸鱼图。
// 用法：node tools/make-icon.mjs [皮肤路径] [输出路径]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'
import { createFrame, clearFrame, skinFromImage, drawParts, toImageData } from '../assets/skin-render.js'
import { buildParts, defaultPose } from '../assets/skin-model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const skinPath = process.argv[2] || path.join(root, 'assets', 'default-skin.png')
const outPath = process.argv[3] || path.join(root, 'icon.png')

const S = 512
const skin = skinFromImage(decodePng(fs.readFileSync(skinPath)))
const frame = createFrame(S, S)
clearFrame(frame)

// 稍微转头，比正脸更有立体感（和挂件默认视角一致：yaw 23.2° / pitch 16.8° 是 project() 自带的）
const pose = { ...defaultPose(), head_roll: 0.04 }
drawParts(frame, buildParts(pose, skin, { outer: true, armWidth: 4 }), skin)

const rgba = toImageData(frame)
fs.writeFileSync(outPath, encodePng(S, S, rgba))

let opaque = 0
for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) opaque++
console.log(
  JSON.stringify(
    {
      skin: path.relative(root, skinPath),
      out: path.relative(root, outPath),
      size: `${S}x${S}`,
      opaquePixels: opaque,
      bounds: frame.bounds,
    },
    null,
    2,
  ),
)
