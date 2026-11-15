# Changelog

## 0.3.0 — 2026-11-15

**M5 正版账号披风**：输入 Java 版用户名或 UUID，拉取该账号的皮肤 + 模型类型 + 披风，全在本机。

### 新增

- `lib/skin-account.mjs`（233 行）：`parseIdentity` / `textureHash` / `decodeTextures` / `pngInfo` / `validateSkin` / `validateCape` / `request` / `bindAccount`。六条安全要求逐条落地——官方纹理域名白名单（只认 `textures.minecraft.net/texture/<hex>`，**http 与 https 写法都接受**，因为 Mojang 真实返回是 `http://`；下载一律重写成 https）、hash 全 hex 且 ≤128、每跳限大小（128 KB / 8 MB / 2 MB）、`redirect: 'manual'` 不跟随重定向、披风失败不算失败、输入只认 `[A-Za-z0-9_]{1,16}` 或 32 位 hex
- `GET/POST/DELETE /pet/account.json`：读绑定状态 / 绑定（空串或 DELETE 为解绑）
- `GET /pet/cape.png`：披风字节，没有就 404；`role.json` 的 `hasCape` 改为真实值，并新增 `account` 字段
- 披风渲染：`skin-model.js` 追加 10×16×1 薄板（挂在躯干空间），`drawParts` 支持 `part.texture` 换采样，几何与 UV 规格见 `docs/plan.md` §7.5
- 挂件菜单：「披风」开关 + 「正版账号」内联面板（输入框 / 绑定 / 解绑 / 状态提示）
- `tools/test-cape.mjs`（32 项）：披风几何/UV、六个状态下的可见性、HD 披风、以及「不传披风时基线一像素不变」
- `tools/compare-cape.mjs`：三联对照图 `prototype/m5-cape.png`（自造披风贴图，不含任何 Mojang 素材）

### 变更

- 绑定会覆盖本机 `skin.png`，但先把原皮肤备份成 `skin.local.png`；解绑时还原，名字与模型类型一起回到绑定前
- 绑定失败不写盘：断网 / 404 / 超限 / 重定向被拒都只返回 `ok:false` + 人话原因，人物照常显示
- `package.json` `files` 补上 `lib/skin-account.mjs`

### 已知限制

- 披风是从正面视角渲染的：项目没有模型旋转，相机永远在 +Z，因此披风只在腰侧露出一条（站姿约 248 px、坐姿约 685 px），图案区落在朝向相机的那一面（`uv = [0,0]`，与 MDP 的 `-11` 不同，理由见 `plan.md` §7.5）
- DSH 客户端菜单里的绑定面板还没人点过（宿主改动需重启客户端）；底层链路已用 `jeb_` / `Dinnerbone` / `Grumm` 三个真实账号验过：皮肤与披风均能拉取、落盘、渲染，解绑能逐字节还原原皮肤

## 0.2.0 — 2026-11-15

**独立化重写**：宿主与前端全部自写，不再复制 `dsh-whale-states` 的代码。

### 破坏性变更

- 路由前缀从 `/dsh-whale/*` 改为 `/pet/*`：`state.json` / `balance.json` / `role.json` / `skin.png` / `audio-active.json` / `widget.js`
- 删除的功能（`docs/plan.md` §16.1 明确砍掉）：记账面板与使用记录、泡泡点击序列编辑器、音效组与内嵌音效、资源管理面板、Codex 统计与 API 模型列表、自动更新检查、多角色轮换
- 配置不迁移：`localStorage` 键从 `dshw-*` 换成 `dshmp-*`（位置/缩放/翻转重置为默认）
- 角色数据迁到 `$DSH_HOME/pet-role/`；首次启动自动从旧版 `whale-roles/default/` 复制一份

### 新增

- 新宿主 `lib/index.js`（约 500 行）+ 纯数据层 `lib/pet-data.mjs`：六态状态机、每轮计费（`[谷,峰]` 双价）、峰谷判定、四道信任栅栏
- 新挂件 `assets/widget.js`（约 780 行 + 内联产物）：拖动/吸附、5 档缩放、水平翻转、鼠标穿透（留 ⟲ 恢复点）、菜单、余额气泡、每轮消耗 toast、打字联动
- `/pet/balance.json` 带峰谷时段与下次切换时刻；`/pet/state.json` 带 `turnCost`
- `tools/make-icon.mjs`：用渲染器自绘 `icon.png`（512×512 方块小人），替换原来的鲸鱼图标

### 修复

- 眨眼：眼皮薄片 z 从 4.52 改回 4.02 —— 3/4 视角下正交投影也吃 z，多推 0.5 单位会横移约 1.6px，闭眼时眼睛内侧漏一条彩线
- 帧率：`eyelid < 0.999` 判断几乎恒真（`blinkClosure` 尾巴长），且 rAF 跟随显示器刷新率（144Hz 屏跑出 144 次/秒）；改为 `< 0.95` + 按目标间隔门控（idle 30fps / 动效 60fps）
- 挂件初始化被未定义函数 `startFrameLoop()` 打断，整块静默失效（画布全透明、控制台无报错）；`init()` 改为分步 try/catch 并留痕到 `window.__dshPetError`

### 清理

- 删除 16 个 DWS 素材（鲸鱼立绘 / gif / mp3 / wav）、旧挂件（1.26 MB）、旧宿主（300 KB）、`accounting.mjs`
- `assets/` 7.0 MB → 218 KB，`lib/` 355 KB → 40 KB；发布包 94.5 kB / 23 个文件

## 0.1.0 — 2026-11-14

首个可用版本（DWS 修改版）：在 `dsh-whale-states` 0.4.2 基础上加 `skin` 渲染后端（Canvas 2D 光栅化盒子模型）、六态姿态、动效、音符、装饰、待机手势、状态粒子。
