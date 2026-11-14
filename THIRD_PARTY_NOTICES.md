# Third-party notices

本插件（`dsh-minecraft-pet`）是独立粉丝作品，与 Mojang Studios 或 Microsoft 无关联，
未获其授权、赞助或官方认可。`Minecraft` 仅用于描述本插件所渲染的皮肤格式。

## 代码

方块模型渲染、姿态动画数学移植自 **Minecraft Desktop Pet**
<https://github.com/DLmember/Minecraft-Desktop-Pet> （MIT License，© 2026 contributors），
锚定 commit `63c96a8`（v2.6），fork 锚点 <https://github.com/Ha2eS1onn/Minecraft-Desktop-Pet>。

| 上游文件 | 用途 | 本项目落点 |
|---|---|---|
| `native/src/render.rs` | 正交投影、盒子 UV 展开、三角形光栅化、面明暗、皮肤加载、骨架合成、识别格与眼皮 | `assets/skin-render.js`、`assets/skin-model.js` |
| `native/src/render_decorations.rs` | 装饰物四种的挂载与纯色材质技巧 | `assets/decorations.js` |
| `native/src/render_effects.rs` | 音符粒子的数据结构与渲染曲线 | `assets/effects.js` |
| `native/src/render_gestures.rs` | 待机手势的调度器与三条动作 | `assets/gestures.js` |
| `native/src/render.rs`（状态与姿态表） | 六态姿态、呼吸/跟随/打字的曲线参数 | `assets/pet-state.js`、`assets/pet-anim.js` |

移植改动：Rust → JavaScript（Canvas 2D）；移除 Win32 窗口/钩子/托盘层、披风库、
系统级音频采集与音效；音符改为「宿主报告有音频才生成」；新增 DSH 会话六态 → 姿态映射。

`lib/audio-meter.ps1` 借鉴 **dsh-whale-states** <https://github.com/MeteorNOX/dsh-whale-states>
（MIT，© MeteorNOX，commit `f7d6516`）的 WASAPI 峰值轮询做法，本项目重写为独立脚本。

其余代码（`lib/index.js`、`lib/pet-data.mjs`、`assets/widget.js`、`tools/**`）为本项目自写，
MIT 授权，见 `LICENSE`。旧版派生自 dsh-whale-states 的宿主与挂件已在 R4 移除。

## 资产

### 内嵌小贴图（Mojang/Microsoft 资产，**不在 MIT 覆盖范围内**）

| 文件 | 用途 | 来源 | 权利 |
|---|---|---|---|
| `assets/note.png` | 音符粒子（8×8，132 B） | Minecraft Java，`assets/minecraft/textures/particle/note.png` | belongs to Mojang/Microsoft |
| `assets/heart.png` | 爱心装饰形状（8×8，139 B） | Minecraft Java 贴图资源 | belongs to Mojang/Microsoft |

以上文件按原样引用，本项目**不主张其所有权、不纳入 MIT 许可、不声称原创**。
权利人如有异议，核实后移除或替换，不附加其他条件。内嵌贴图合计 **271 B**（上限 5 KB）。

### 其他

- `assets/default-skin.png`、`prototype/da-skin.png`：用户自备的 64×64 皮肤，仅用于本地渲染与自检，
  不随 npm 包分发，本项目不主张权利。
- `icon.png`：由 `tools/make-icon.mjs` 用本项目渲染器从皮肤实时生成。
- 角色皮肤与披风：由用户自行提供；或用户主动绑定账号后，通过 Mojang 官方服务
  （`api.mojang.com` / `sessionserver.mojang.com` / `textures.minecraft.net`）拉取该账号
  自身的数据，仅在本机缓存用于渲染，不再分发（披风为 M5 计划，当前版本 `hasCape` 恒 `false`）。
- **披风贴图库（90+ 张）不包含在本插件内。**

## 商标

本插件是独立粉丝作品，与 Mojang Studios 或 Microsoft 无关联，未获其授权、赞助或官方认可。
Minecraft 名称及相关商标归其权利人所有。
