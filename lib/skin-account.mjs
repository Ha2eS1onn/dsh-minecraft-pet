// 账号绑定：把「Java 版用户名 / UUID」变成 { name, uuid, model, skinBytes, capeBytes }。
//
// 全部在宿主侧完成，前端不直连 Mojang（plan.md §7.1）。六条安全要求逐条对应 §7.2：
//   ① URL 白名单：只认 https://textures.minecraft.net/texture/<hex>
//   ② hash 校验：非空、≤128、全 hex
//   ③ 每跳限大小：profile 128 KB / 皮肤 8 MB / 披风 2 MB
//   ④ 不跟随重定向：redirect:'manual'，见到 3xx 一律拒绝
//   ⑤ 披风失败不算失败：皮肤照常返回，披风置空
//   ⑥ 输入校验：用户名 [A-Za-z0-9_]{1,16}，UUID 32 位 hex
//
// 不轮询：只在用户点「绑定 / 重新拉取」时走一次（§7.2 补充）。
// fetch 可注入：自测不需要联网（tools/test-cape.mjs / test-host.mjs）。

import fs from 'node:fs'

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** 官方纹理服务前缀。下载**只用 https**；profile 里的 http 写法只在解析时认（见 textureHash）。 */
export const TEXTURE_PREFIX = 'https://textures.minecraft.net/texture/'
/** Mojang 真实返回里皮肤/披风地址常常是 http://（历史遗留）。 */
const TEXTURE_PREFIX_HTTP = 'http://textures.minecraft.net/texture/'

export const LIMITS = {
  profile: 128 * 1024,
  skin: 8 * 1024 * 1024,
  cape: 2 * 1024 * 1024,
}

const TIMEOUT_MS = 8000
const UA = `dsh-minecraft-pet/${PKG.version}`

function fail(message, code) {
  const err = new Error(message)
  err.code = code || 'ACCOUNT'
  return err
}

/** ⑥ 用户名 / UUID。返回 { id, isUuid }；UUID 统一去连字符小写。 */
export function parseIdentity(input) {
  const s = String(input == null ? '' : input).trim()
  const compact = s.replace(/-/g, '')
  const dashedOk = s.length === 36 && [8, 13, 18, 23].every((i) => s[i] === '-')
  if (compact.length === 32 && /^[0-9a-fA-F]{32}$/.test(compact) && (s.length === 32 || dashedOk)) {
    return { id: compact.toLowerCase(), isUuid: true }
  }
  if (/^[A-Za-z0-9_]{1,16}$/.test(s)) return { id: s, isUuid: false }
  throw fail('请输入 Java 版用户名（字母、数字、下划线，最多 16 位）或 UUID。', 'IDENTITY')
}

/**
 * ① ② 白名单 + hash 校验。不合格一律返回 null（调用方据此判断「没有披风」）。
 *
 * 只认 `textures.minecraft.net/texture/<hex>` 这一种形状，http / https 都收——
 * 实测 Mojang 给真实账号的地址就是 `http://`（jeb_、Dinnerbone 都是），
 * 只认 https 会把所有真实账号挡在门外。
 * 安全性不变：这里只取 hex，不把 profile 给的 URL 拿去请求；
 * 真正下载一律走 `TEXTURE_PREFIX`（https），见 bindAccount。
 */
export function textureHash(url) {
  if (typeof url !== 'string') return null
  let hash = ''
  if (url.indexOf(TEXTURE_PREFIX) === 0) hash = url.slice(TEXTURE_PREFIX.length)
  else if (url.indexOf(TEXTURE_PREFIX_HTTP) === 0) hash = url.slice(TEXTURE_PREFIX_HTTP.length)
  else return null
  if (!hash || hash.length > 128 || !/^[0-9a-fA-F]+$/.test(hash)) return null
  return hash
}

function decodeBase64(s) {
  if (typeof s !== 'string' || !s) throw fail('该账号没有可用的皮肤资料。', 'TEXTURES')
  // Buffer 对非法 base64 很宽容（会静默丢字符），先自己卡一遍格式
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw fail('皮肤资料编码不完整。', 'TEXTURES')
  return Buffer.from(s, 'base64')
}

/** textures 属性 → { skin, cape, model }。 */
export function decodeTextures(b64) {
  let json
  try {
    json = JSON.parse(decodeBase64(b64).toString('utf8'))
  } catch (err) {
    if (err && err.code) throw err
    throw fail('皮肤资料无法解析。', 'TEXTURES')
  }
  const textures = (json && json.textures) || {}
  const skin = textures.SKIN || {}
  const hash = textureHash(skin.url)
  if (!hash) throw fail('该账号未设置自定义皮肤，可以继续使用内置皮肤或本地导入。', 'SKIN')
  return {
    skin: { hash },
    cape: textureHash(textures.CAPE && textures.CAPE.url) ? { hash: textureHash(textures.CAPE.url) } : null,
    model: skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic',
  }
}

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]

/** 只读 IHDR 拿尺寸，不解码整张图（宿主不需要像素）。 */
export function pngInfo(bytes) {
  const b = bytes
  if (!b || b.length < 24) return null
  for (let i = 0; i < 8; i++) if (b[i] !== PNG_MAGIC[i]) return null
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null
  const width = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0
  const height = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0
  if (!width || !height) return null
  return { width, height }
}

/** 皮肤尺寸：宽 ≥64、64 的倍数、≤1024；高 = 宽（现代）或 宽/2（legacy 64×32）。 */
export function validateSkin(bytes) {
  if (!bytes || bytes.length > LIMITS.skin) throw fail('皮肤文件超过 8 MB。', 'SIZE')
  const info = pngInfo(bytes)
  if (!info) throw fail('皮肤不是有效的 PNG。', 'PNG')
  const { width, height } = info
  if (width < 64 || width % 64 !== 0 || width > 1024) throw fail('皮肤纹理尺寸异常。', 'PNG')
  if (height !== width && height * 2 !== width) throw fail('皮肤纹理尺寸异常。', 'PNG')
  return { width, height, legacy: height * 2 === width }
}

/** 披风尺寸：宽 ≥64、64 的倍数、高 = 宽/2（MDP `Cape::load()` 同一条判定）。 */
export function validateCape(bytes) {
  if (!bytes || bytes.length > LIMITS.cape) throw fail('披风文件超过 2 MB。', 'SIZE')
  const info = pngInfo(bytes)
  if (!info) throw fail('披风不是有效的 PNG。', 'PNG')
  if (info.width < 64 || info.width % 64 !== 0 || info.height * 2 !== info.width) {
    throw fail('披风纹理尺寸异常。', 'PNG')
  }
  return info
}

function bytesOf(chunk) {
  if (chunk instanceof Uint8Array) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8')
  return new Uint8Array(chunk || 0)
}

/** ④ 限大小 + 不跟随重定向的单次 GET。失败抛 Error（带 code）。 */
export async function request(url, { fetchImpl, limit, timeoutMs = TIMEOUT_MS } = {}) {
  const f = fetchImpl || globalThis.fetch
  if (typeof f !== 'function') throw fail('当前环境没有 fetch，无法访问官方服务。', 'FETCH')
  let signal
  try {
    signal = AbortSignal.timeout(timeoutMs)
  } catch (err) {
    signal = undefined
  }
  let res
  try {
    res = await f(url, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': UA, Accept: '*/*' },
    })
  } catch (err) {
    const name = err && err.name
    if (name === 'TimeoutError' || name === 'AbortError') throw fail('连接官方服务超时，请重试。', 'TIMEOUT')
    throw fail('无法连接官方服务，请检查网络。', 'NETWORK')
  }
  const status = Number(res && res.status) || 0
  // 浏览器语义下 manual 会给出 opaque 响应（status 0 + type opaqueredirect）
  if ((res && res.type === 'opaqueredirect') || (status >= 300 && status < 400)) {
    throw fail('官方服务要求重定向，已拒绝。', 'REDIRECT')
  }
  if (status === 204 || status === 404) throw fail('没有找到这个正版 Java 版 ID，请检查用户名或 UUID。', 'NOT_FOUND')
  if (status === 429) throw fail('官方服务请求过于频繁，请稍后重试。', 'RATE')
  if (status !== 200) throw fail(`官方服务暂时不可用（HTTP ${status || '?'}），请稍后重试。`, 'HTTP')

  const declared = Number((res.headers && res.headers.get && res.headers.get('content-length')) || 0)
  if (declared && declared > limit) throw fail('官方服务返回的文件过大，已停止下载。', 'SIZE')

  const body = res.body
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = []
    let total = 0
    for await (const raw of body) {
      const chunk = bytesOf(raw)
      total += chunk.length
      if (total > limit) throw fail('官方服务返回的文件过大，已停止下载。', 'SIZE')
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks, total)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > limit) throw fail('官方服务返回的文件过大，已停止下载。', 'SIZE')
  return buf
}

function parseJson(bytes, what) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (err) {
    throw fail(`${what}无法识别。`, 'JSON')
  }
}

/**
 * 完整链路：用户名 → UUID → profile → textures → 皮肤字节（+ 披风字节）。
 * 皮肤拿不到就是失败；披风拿不到只记在 capeError 里（⑤）。
 */
export async function bindAccount(input, options = {}) {
  const { fetchImpl, timeoutMs } = options
  const { id, isUuid } = parseIdentity(input)
  const opts = { fetchImpl, timeoutMs }

  let uuid = isUuid ? id : ''
  if (!uuid) {
    const bytes = await request(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(id)}`,
      { ...opts, limit: LIMITS.profile },
    )
    const p = parseJson(bytes, '官方资料')
    const parsed = parseIdentity(p && p.id)
    if (!parsed.isUuid) throw fail('官方 UUID 无效。', 'UUID')
    uuid = parsed.id
  }

  const profileBytes = await request(
    `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
    { ...opts, limit: LIMITS.profile },
  )
  const profile = parseJson(profileBytes, '官方资料')
  const props = Array.isArray(profile.properties) ? profile.properties : []
  const textures = props.find((p) => p && p.name === 'textures')
  if (!textures || typeof textures.value !== 'string') throw fail('该账号没有可用的皮肤资料。', 'TEXTURES')

  const t = decodeTextures(textures.value)
  const skinBytes = await request(TEXTURE_PREFIX + t.skin.hash, { ...opts, limit: LIMITS.skin })
  const skinInfo = validateSkin(skinBytes)

  let capeBytes = null
  let capeError = ''
  if (t.cape) {
    try {
      const bytes = await request(TEXTURE_PREFIX + t.cape.hash, { ...opts, limit: LIMITS.cape })
      validateCape(bytes)
      capeBytes = bytes
    } catch (err) {
      capeError = String((err && err.message) || err).slice(0, 120)
    }
  }

  const name = typeof profile.name === 'string' && profile.name.length <= 16 ? profile.name : id
  return { name, uuid, model: t.model, skinBytes, skinInfo, capeBytes, capeError }
}
