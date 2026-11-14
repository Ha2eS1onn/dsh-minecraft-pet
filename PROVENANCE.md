# 素材来源与许可范围（PROVENANCE）

本仓库的**代码**按 MIT 许可（见 [`LICENSE`](LICENSE)）。`assets/` 目录下的**美术素材**
（图片 / 动图 / 音效）**不在 MIT 覆盖范围内**，按下面的说明「原样提供」。

本文件沿用基线仓库 **dsh-whale-states**（MIT，© MeteorNOX，commit `f7d6516`）的划法，
并在第五节追加本项目新增的内容。第三方代码与内嵌 Mojang 小贴图的逐条清单见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 一、许可范围

| 范围 | 许可 |
|---|---|
| `lib/`、`assets/*.js`（本项目渲染模块）、`cordis.patch.yml`、`package.json`、文档与维护脚本 | **MIT**（见 `LICENSE`） |
| `icon.png`（插件列表图标） | **不适用 MIT**：与 `assets/` 下的美术素材同属"原样提供"，仅用于标识本插件；不授予再许可，也不声明为原创作品。 |
| `assets/**`（图片 / 动图 / 音效，来自 dsh-whale-states） | **不适用 MIT**：由维护者提供或使用 AI 工具生成，按 **as-is** 随插件分发，仅用于运行本插件；不授予再许可，也不声明为原创作品。 |

这样划分的原因：代码可以明确授权，而美术素材的来源与权利状态往往无法百分之百举证 ——
与其给一个站不住的授权，不如如实标注范围，并承诺收到权利主张就处理（见第四节）。

## 二、逐项来源

| 文件 | 来源 / 说明 |
|---|---|
| `DSniang1.png`（鲸鱼本体，气泡由代码绘制） | **AI 工具生成**的图像，经人工挑选与裁切。生成工具与原始出处**已不可考**（文件内元数据已被剥离，见第三节）。 |
| `icon.png`（插件列表图标，256×256 PNG 含透明） | 由现有素材裁切 / 缩放而来（源头同 `DSniang1.png` 系列，AI 工具生成、出处不可考）。已剥离全部内嵌元数据，块序列仅 `IHDR / IDAT / IEND`。**本项目沿用未改，M4 起应换成方块小人图标** |
| `DSniang02.png` | 同上（备用整图，兼容旧版手动安装路径）。 |
| `DSH2.png`（README 顶部展示图） | 由维护者自行设计与排版（使用在线设计工具），2026-09 替换为清理版（已剥离全部内嵌元数据）。本项目暂未使用。 |
| `rua.gif`、`bubble-petpet.gif` | 内置动图素材。 |
| `bubble-money1.gif` | 内置泡泡图（余额预警默认内容的配图）。 |
| `Ya1.mp3` / `Ya2.mp3`、`D1.mp3` / `D2.mp3` | 内置音效（按压 / 松开）。 |
| `minecraft-exp-orb.wav`、`task-end-a.wav` | 内置任务结束音（Minecraft·经验球 / 预设 A）。 |

## 三、元数据清理

图片素材曾内嵌过设计工具的 XMP 归属信息（工具名、模板名、账号 id，甚至第三方品牌名）。
自基线 **0.3.1** 起，随包 PNG **一律剥离** `eXIf` / `iTXt` / `tEXt` / `zTXt` 元数据块，
只保留渲染必需的 `IHDR` / `sRGB` / `gAMA` / `pHYs` / `IDAT` / `IEND`。

- 复核：解析每个 PNG 的块序列，确认不再有文本 / EXIF 块；
- 剥离：逐块重写，不触碰像素数据（IHDR/IDAT/IEND 原样保留），因此画面完全不变。

## 四、权利主张 / Takedown

如果你认为 `assets/` 中有素材侵犯了你的权利，请在本仓库开一条 issue，说明**文件名**与**依据**，
我们会在核实后**立即替换或移除**，不附加其它条件。我们也欢迎直接提供可自由再分发的替代素材。

## 五、本项目（dsh-minecraft-pet）新增

| 文件 | 来源 / 许可 |
|---|---|
| `assets/skin-render.js`、`skin-model.js`、`quat.js`、`pet-state.js`、`pet-anim.js`、`effects.js`、`decorations.js`、`gestures.js`、`status-effects.js` | **MIT**，本项目自写；渲染与动效数学移植自 Minecraft-Desktop-Pet（MIT，commit `63c96a8`），逐文件在 `THIRD_PARTY_NOTICES.md` 标注 |
| `assets/default-skin.png`（64×64 默认皮肤） | **用户自备**，不随插件分发、不由本项目主张权利，仅用于本地渲染与自检 |
| `assets/note.png`（8×8，132 B）、`heart.png`（8×8，139 B） | **belongs to Mojang/Microsoft**，不在 MIT 范围内，按 `plan.md` §2.2 的小资产规则内嵌并逐条标注 |
| `lib/index.js`、`lib/accounting.mjs`、`assets/whale-widget.js` | MIT 代码，派生自 dsh-whale-states `f7d6516`，仅做包名 / patch id / 版本号替换与（后续 M4 的）渲染后端改造 |
| `tools/**`、`prototype/**` | **MIT**，本项目自写的验具与原型；`prototype/*.png` 是渲染回归的基线证据 |
