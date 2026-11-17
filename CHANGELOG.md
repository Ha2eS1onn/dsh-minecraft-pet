# Changelog

## 0.4.0 — 2026-11-15

> **本版未发布**：`v0.4.0` 不打 tag、不发 Release，内容与 0.3.0 一起并入 `1.0.0`（2026-11-17 决定）。
> 真机验收通过（2026-11-17）：敲字浮现字与 Bedrock geo 装饰均已在宿主里实测正常。

**P2-c 敲字浮现字 + P2-b Bedrock `.geo.json` 装饰完成；P2-a 物理第一版按用户要求回退到 P1**（重做设计见 `docs/physics-redesign.md`）。纯前端，宿主 `lib/` 一行未改，无需重启客户端（Ctrl+F5 即可）。

### 新增

- **P2-c 敲字浮现字**
  - `assets/type-letters.js`：`keyLabelFromEvent`（中文输入法组合期 / `keyCode 229` / `Unidentified` 一律跳过）、6 行 74 键的物理键位表（`event.code` 索引，归一化到 19.6×7.8 键盘盒）、`buildGlyphs` + `canvasRasterizer`（离屏 canvas `bold 20px` → alpha ≥128 阈值化，24×24 白字模，首次约 5~10 ms 后缓存）
  - `assets/letters.js`：`LetterField`，0.8 s 生命、上限 64、糖果色 9 选 1、`alpha = 1 - t²`、上飘 10.8 单位、两遍绘制（暗色阴影 + 正色）。**多字符键名逐字符排版**（照 MDP `label()` 的墨迹宽度步进），所以 `Space` / `Enter` / `F12` 也能显示
  - 挂件：`keydown` → `pushLetter`，只在坐姿（`pose.sit > 0.4`）显示；字画在对应按键的键盘顶面坐标，顺序为 人物 → 状态粒子 → **浮现字** → 音符；有字时帧需求升到 60 fps
- **P2-b Bedrock `.geo.json` 装饰**
  - `assets/geo-model.js`：`parseGeo` / `pivotRotation` / `checkTextureSize` / `geoParts`。父骨骼可后定义（递归 + 缓存）、pivot 旋转 `T(p)·Rz·Ry·Rx·T(-p)`、Bedrock 前后轴 `rotY(π)` 双套转换、按摆姿后几何最低点对齐头顶、贴图尺寸与 `description.texture_*` 校验
  - `assets/decoration-duck.geo.json` + `decoration-duck.png`：自造的小鸭模型与贴图（无 Mojang 素材），菜单「装饰」多一档「小鸭」；模型或贴图加载失败只丢该装饰，不白屏
- **验具**：`tools/test-geo.mjs`（22 项）、`tools/test-letters.mjs`（49 项）、`tools/make-geo-duck.mjs`（生成小鸭素材）、**`tools/test-keydown.mjs`（17 项，真实派发 keydown 的 DOM stub 冒烟测试）**；`test-widget` **53 → 78 项**（含「物理已回退」的反向断言）
- **对照图**：`prototype/p2-duck.png`（头顶小鸭）、`prototype/p2-letters.png`（坐姿 A / F / K / SPACE 四枚浮现字，2× 放大）

### 回退：P2-a 物理模拟

用户真机试用后要求「物理先回退到 P1」。第一版不是 bug，而是**效果设计没有目标**：实测 `done` 落地回弹峰值只有 **0.345 单位（2.8 px）**、转头 ζ=0.85 **过冲 0°**，肉眼几乎无变化，却让 `physicsBusy` 把 idle 拉到 60 fps 长达 1.23 s；呼吸相位漂移还无条件开启，关掉开关也不是 P1 行为。

- `assets/pet-anim.js` 恢复成 **356 行 P1 版本**，`tools/test-anim.mjs` 同步恢复（47 → 37 项）
- `tools/build-widget.mjs` 摘掉 `spring.js`（`MODULES` 13 → 12）；`assets/widget.js` 去掉 `demand()` 的 `physicsBusy` 分支与探针字段，重建后 BUNDLE 2795 行 / 104142 B
- `assets/spring.js` 保留源码但**未接线、未内联**，文件头标注「不要直接使用」
- 新增 **`docs/physics-redesign.md`**：可见度门槛（12~24 px / 0.25~0.6s）、E1 落地压缩 / E2 起坐 / E3 转头惯性 / E4 error 抖动四个效果清单、`enabled` 默认关 + 基线逐像素守门、分阶段 A/B 验收。`plan.md` §6.6 已改为指向它

### 修复（真机反馈 + 本轮自测）

- **打字没有浮现字（用户实测）**：`document.addEventListener('keydown', function () {...})` 漏写了 `e` 形参，体内却调用 `pushLetter(e, ...)` → 抛 `ReferenceError` 被空 `catch` 吞掉。前四行打字动画照常执行，只有浮现字永远不出现、控制台还没线索。已补 `function (e)`、把异常写进 `window.__dshPetError`、新增 `letterStat` 诊断计数（`keys` / `noSit` / `noLabel` / `noPos` / `pushed` / `glyphs` / `error`）接进 `__dshPetState()`，并新增 `tools/test-keydown.mjs` 真实派发事件防回归
- **`drawSprite` 的 tint 是 0..1 乘数**，第一版糖果色与阴影写成了 0..255，`Math.min(255, ...)` 后全部饱和成白色 —— 字和阴影都是白的。统一按 `rgb/255` 换算
- **多字符键名永远画不出来**：`Space` / `Enter` 这类 label 在 94 个单字模里查不到整串。改成逐字符横排（与 MDP 一致）
- **静止首帧白造 94 个字模**：`draw` 里改成只在 `letters.active` 时调 `glyphs()`
- 演示字模改为居中留白（铺满 24 格会让逐字步进小于字宽、字母互相压住）；演示间隔拉开到 0.14 s 并 2× 放大

### 已知限制

- **P2-c / P2-b 只在 node 自测、静态对照图与 DOM stub 里验过，真机人眼验收未做**（挂件按 mtime 热读，Ctrl+F5 即可看）。若不出字，读 `window.__dshPetState().letterStat` 定位
- 浮现字是**页面级**键盘：只响应 DSH 页面内的 `keydown`，切到别的应用不显示；中文输入法只出键名不出汉字（与 MDP 一致）。按规格**只在坐姿显示**：宿主处于 `thinking` / `waiting` 等状态时打字不抢状态、不会出字
- **物理已回退**：本版不含物理效果，动画与 0.3.0 / P1 一致；重做前先按 `docs/physics-redesign.md` 确认「多大动静算看得见」
- `.geo.json` 只支持 box UV（`cube.uv` 为 `[u,v]`）；per-face UV 对象形式直接报错。目前只带了一个自造小鸭模型
- 24 px 的字宽略大于 60% 键盘的键距，快速连打时相邻字会部分重叠 —— 靠 0.8 s 内的上升时间与糖果色区分，与 MDP 行为一致

## 0.3.0 — 2026-11-15

> **本版未发布**：`v0.3.0` tag 已推但从未建网页 Release，内容并入 `1.0.0`（2026-11-17 决定）。

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

### 修复

- **菜单里的按钮点了没反应**：`root` 上的 `pointerdown`（画布拖动）注册在**捕获阶段**，它只看画布像素、不知道菜单浮在上面；命中不透明像素时 `preventDefault()` 会连带取消 click。账号面板展开后菜单变高，「绑定」按钮正好压在小人腿上——点中腿像素就失效、点中两腿间的缝隙就正常，所以表现为「时灵时不灵」。加 `inUi()` 守卫，落在菜单/菜单按钮/穿透恢复点上的 pointerdown 一律交给 DOM 正常处理
- 绑定失败不再是「静默无反应」：面板文案（红色）+ toast + `console.warn` 三条一起给；请求 25 秒超时（`AbortController`），不会再让按钮永久灰掉
- 按钮解锁不再等「重拉角色完成」：`loadRole()` 改为不阻塞，换皮失败也不会卡在「进行中」
- 宿主记录上一次绑定的失败原因（`account.json` 的 `lastError`），面板重开后仍能看到
- 菜单加了 `max-height` + 滚动，账号面板展开后不会顶出画布上沿

### 已知限制

- 披风是从正面视角渲染的：项目没有模型旋转，相机永远在 +Z，因此披风只在腰侧露出一条（站姿约 248 px、坐姿约 685 px），图案区落在朝向相机的那一面（`uv = [0,0]`，与 MDP 的 `-11` 不同，理由见 `plan.md` §7.5）
- DSH 客户端菜单里的绑定面板已于 2026-11-15 14:47 由用户真机验收通过：绑定、换另一个正版账号、披风显示、解绑全部正常；底层链路另用 `jeb_` / `Dinnerbone` / `Grumm` 三个真实账号验过拉取、落盘、渲染与逐字节还原

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
