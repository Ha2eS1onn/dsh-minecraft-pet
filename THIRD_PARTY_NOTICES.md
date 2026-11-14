# Third-party notices

本插件（`dsh-minecraft-pet`）是独立粉丝作品，与 Mojang Studios 或 Microsoft 无关联，
未获其授权、赞助或官方认可。`Minecraft` 仅用于描述本插件所渲染的皮肤格式。

## 代码

方块模型渲染、姿态动画数学移植自 **Minecraft Desktop Pet**
<https://github.com/DLmember/Minecraft-Desktop-Pet> （MIT License，© 2026 contributors），
锚定 commit `63c96a8`（v2.6），fork 锚点 <https://github.com/Ha2eS1onn/Minecraft-Desktop-Pet>。

移植源文件：

| 上游文件 | 用途 |
|---|---|
| `native/src/render.rs` | 正交投影、盒子 UV 展开、三角形光栅化、面明暗、皮肤加载、骨架合成、眼皮/瞳孔 |
| `native/src/render_decorations.rs` | 装饰物四种的挂载与纯色材质技巧 |
| `native/src/render_effects.rs` | 音符粒子的数据结构与渲染曲线 |
| `native/src/render_gestures.rs` | 待机手势的调度器与三条动作 |
| `native/src/online.rs` | 官方纹理服务的资料查询与下载校验（M5 用） |

移植改动：Rust → JavaScript（Canvas 2D）；移除 Win32 窗口/钩子/托盘层、披风库、
音效与采集窗口；音符触发源从系统音频检测改为会话状态驱动；
新增会话状态 → 姿态映射。

宿主侧与前端代码基于 **dsh-whale-states**（MIT，© MeteorNOX），
锚定 commit `f7d6516`（0.4.2），fork 锚点 <https://github.com/Ha2eS1onn/dsh-whale-states>。
派生改动：包名 `dsh-whale-widget` → `dsh-minecraft-pet`、patch id 同步改名、
版本号 0.4.2 → 0.1.0；M4 起新增双渲染后端（`img` / `skin`）与四条皮肤路由。

## 资产

### 内嵌小贴图（Mojang/Microsoft 资产，**不在 MIT 覆盖范围内**）

| 文件 | 用途 | 来源 | 权利 |
|---|---|---|---|
| `assets/note.png` | 音符粒子（8×8，132 B） | Minecraft Java 1.21.4，`assets/minecraft/textures/particle/note.png` | belongs to Mojang/Microsoft |
| `assets/heart.png` | 爱心装饰形状（8×8，139 B） | Minecraft Java 贴图资源 | belongs to Mojang/Microsoft |

以上文件按原样引用，本项目**不主张其所有权、不纳入 MIT 许可、不声称原创**。
权利人如有异议，核实后移除或替换，不附加其他条件。

内嵌贴图合计 **271 B**（`plan.md` §2.2 的上限是 5 KB）。

### 其他

- `assets/default-skin.png`：用户自备的 64×64 皮肤，不随插件分发、不由本项目主张权利，
  仅用于本地渲染与自检。
- 角色皮肤与披风：由用户自行提供；或用户主动绑定账号后，通过 Mojang 官方服务
  （`api.mojang.com` / `sessionserver.mojang.com` / `textures.minecraft.net`）拉取该账号
  自身的数据，仅在本机缓存用于渲染，不再分发。
- **披风贴图库（90+ 张）不包含在本插件内。**

## 商标

本插件是独立粉丝作品，与 Mojang Studios 或 Microsoft 无关联，未获其授权、赞助或官方认可。
Minecraft 名称及相关商标归其权利人所有。
