// 无依赖 PNG 编解码，仅用于 M0 命令行自检（浏览器路径走 canvas 的 ImageData）。
// 支持 8bit 灰度/RGB/调色板/灰度+alpha/RGBA，非隔行；输出固定 RGBA8 非预乘。

import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let pos = 8
  let ihdr = null
  let plte = null
  let trns = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    pos += 12 + len
    if (type === 'IEND') break
  }
  if (!ihdr) throw new Error('缺 IHDR')
  if (ihdr.bitDepth !== 8) throw new Error(`暂不支持 bitDepth=${ihdr.bitDepth}`)
  if (ihdr.interlace !== 0) throw new Error('暂不支持隔行 PNG')

  const { width, height, colorType } = ihdr
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`暂不支持 colorType=${colorType}`)
  const bpp = channels
  const stride = width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = new Uint8ClampedArray(width * height * 4)
  let prev = Buffer.alloc(stride)
  let off = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[off++]
    const line = Buffer.from(raw.subarray(off, off + stride))
    off += stride
    unfilter(filter, line, prev, bpp)
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 255
      if (colorType === 6) {
        r = line[x * 4]
        g = line[x * 4 + 1]
        b = line[x * 4 + 2]
        a = line[x * 4 + 3]
      } else if (colorType === 2) {
        r = line[x * 3]
        g = line[x * 3 + 1]
        b = line[x * 3 + 2]
      } else if (colorType === 0) {
        r = g = b = line[x]
      } else if (colorType === 4) {
        r = g = b = line[x * 2]
        a = line[x * 2 + 1]
      } else {
        const i = line[x]
        r = plte[i * 3]
        g = plte[i * 3 + 1]
        b = plte[i * 3 + 2]
        a = trns && i < trns.length ? trns[i] : 255
      }
      const o = (y * width + x) * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = a
    }
    prev = line
  }
  return { width, height, data: out }
}

function unfilter(f, line, prev, bpp) {
  const n = line.length
  if (f === 0) return
  if (f === 1) {
    for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255
    return
  }
  if (f === 2) {
    for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255
    return
  }
  if (f === 3) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
    }
    return
  }
  if (f === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      line[i] = (line[i] + pr) & 255
    }
    return
  }
  throw new Error(`未知行滤波 ${f}`)
}

export function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
