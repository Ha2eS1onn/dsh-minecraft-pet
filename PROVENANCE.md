# 素材来源与许可范围（PROVENANCE）

本仓库的**代码**按 MIT 许可（见 [`LICENSE`](LICENSE)）。少数**美术素材**按下面的说明
「原样提供」，不纳入 MIT。第三方代码与内嵌 Mojang 小贴图的逐条清单见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 一、许可范围

| 范围 | 许可 |
|---|---|
| `lib/*.js`、`lib/pet-data.mjs`、`assets/*.js`、`tools/**`、`prototype/**`、`cordis.patch.yml`、`package.json`、文档 | **MIT** |
| `assets/note.png`、`assets/heart.png`（各 8×8，合计 271 B） | **不属于 MIT**：belongs to Mojang/Microsoft，按"小到可以忽略 + 不构成替代游戏内容"的规则内嵌，逐条标注 |
| `assets/default-skin.png`、`prototype/da-skin.png` | **用户自备**的 64×64 皮肤，仅用于本地渲染与自检；本项目不主张权利，不随 npm 包分发 |
| `assets/decoration-duck.geo.json`、`decoration-duck.png` | **本项目自造**（MIT）：由 `tools/make-geo-duck.mjs` 生成的 Bedrock 模型与 64×32 贴图，不含 Mojang 素材 |
| `icon.png` | 由 `tools/make-icon.mjs` 用本项目的渲染器从皮肤实时渲染生成（512×512 透明 PNG），随 MIT 一并授权 |

`assets/` 目录自 2026-11-14 的独立化重写（R4）起只保留自写模块、挂件本体、默认皮肤、
两张 Mojang 小贴图，以及 M5/P2 新增的账号无关素材（P2 的自造小鸭模型与贴图）。
旧版沿用的鲸鱼立绘、GIF、MP3/WAV 音效已全部移除（见第四节）。

## 二、逐项来源

| 文件 | 来源 / 说明 |
|---|---|
| `assets/quat.js`、`skin-render.js`、`skin-model.js`、`pet-state.js`、`pet-anim.js`、`effects.js`、`decorations.js`、`gestures.js`、`status-effects.js`、`spring.js`、`geo-model.js`、`type-letters.js`、`letters.js` | 本项目自写（MIT）；渲染、动效、geo 解析与浮现字的**数学/数据结构**移植自 Minecraft-Desktop-Pet（MIT，commit `63c96a8`），逐文件表见 `THIRD_PARTY_NOTICES.md`。`spring.js` 例外：MDP 无物理，纯本项目新写 |
| `assets/widget.js` | 本项目自写（MIT）。顶部 BUNDLE 段由 `tools/build-widget.mjs` 生成，内含上面 13 个模块 |
| `assets/note.png`（132 B） | Minecraft Java 的粒子贴图，belongs to Mojang/Microsoft |
| `assets/heart.png`（139 B） | 爱心装饰形状，belongs to Mojang/Microsoft |
| `assets/default-skin.png`（1354 B） | 用户自备皮肤 |
| `assets/decoration-duck.geo.json` + `decoration-duck.png` | 本项目自造（MIT），`tools/make-geo-duck.mjs` 生成 |
| `lib/audio-meter.ps1` | 本项目自写（MIT）：WASAPI 峰值轮询，750ms 打印一行 `peak=` |

## 三、元数据清理

随包的 PNG（含 `icon.png`）一律只保留渲染必需的块：`IHDR` / `sRGB` / `gAMA` / `pHYs` / `IDAT` / `IEND`，
不带 `eXIf` / `iTXt` / `tEXt` / `zTXt` 等文本或归属信息块。

## 四、已移除的旧素材（2026-11-14，R4）

独立化重写把宿主与前端都换成自写实现后，下面这些来自 dsh-whale-states 的素材已**从仓库删除**
（仍可从基线 commit `f7d6516` 追溯）：

`DSniang1.png`、`DSniang02.png`、`DSH2.png`、`rua.gif`、`bubble-petpet.gif`、`bubble-money1.gif`、
`Ya1.mp3`、`Ya2.mp3`、`D1.mp3`、`D2.mp3`、`approve-default.wav`、`ask-default.wav`、`cost-default.wav`、
`minecraft-exp-orb.wav`、`task-end-a.wav`，以及旧挂件 `assets/whale-widget.js`、旧宿主 `lib/index.dws.js`、
`lib/accounting.mjs`（后两者亦为派生自 dsh-whale-states 的 MIT 代码，已由自写实现取代）。

## 五、权利主张 / Takedown

如果你认为本仓库中有素材侵犯了你的权利，请开一条 issue 说明**文件名**与**依据**，
我们会在核实后**立即替换或移除**，不附加其它条件。
