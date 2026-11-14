# dsh-minecraft-pet

DSH（DeepSeek Harness）界面右下角的 **Minecraft 方块小人挂件**。

把一张 64×64 皮肤用 Canvas 2D 实时光栅化成盒子模型，跟着会话状态做动作；
右侧气泡显示账号余额、今日已用与峰谷时段，每轮结束提示这一轮花了多少。

> 独立粉丝作品，与 Mojang Studios / Microsoft 无关联，未获授权或官方认可。
> `Minecraft` 仅用于描述所渲染的皮肤格式。详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 功能

- **六态**：`idle` / `thinking` / `working` / `waiting` / `done` / `error`，优先级与最短停留沿用 DSH 会话语义
- **动效**：呼吸、眨眼（需皮肤画了 DA 识别格）、头部跟随鼠标、打字手臂交替、待机手势（伸懒腰 / 歪头 / 犯困）、音符、状态粒子、装饰（兔耳 / 猫耳 / 爱心 / 棒棒糖）
- **余额**：账号余额、今日已用、峰谷时段标记；拿不到数据时显示 `--`，不挡其他功能
- **每轮消耗**：一轮结束后弹出「本轮 ¥0.00xx · N tok」
- **交互**：拖动 + 吸附、5 档缩放、水平翻转、鼠标穿透（留一个 ⟲ 恢复点）、右键菜单

## 安装

```bash
# 从 npm（发布后）
dsh plugin --profile desktop add dsh-minecraft-pet

# 本地开发（link 安装，改 assets/ 后 Ctrl+F5 生效）
dsh plugin --profile desktop add link:D:/path/to/dsh-minecraft-pet
```

宿主代码（`lib/`）改动需要**重启 DSH 客户端**才生效；`assets/` 下的挂件与渲染模块按 mtime 热读，刷新页面即可。

## 数据与文件

| 位置 | 用途 |
|---|---|
| `$DSH_HOME/pet-role/skin.png` + `meta.json` | 角色皮肤与模型类型（`classic` / `slim`）。首次启动时若为空，会从旧版 `whale-roles/default/` 复制一份 |
| `$DSH_HOME/.dsh-pet-state.json` | 今日已用与轮次序号（按北京日切） |
| 浏览器 `localStorage` `dshmp-*` | 位置、缩放、翻转、穿透、气泡开关、装饰 |

接口（全部只读，走 DSH 既有鉴权）：

```
GET /pet/state.json         { ok, state, since, pending, turnCost }
GET /pet/balance.json       { ok, balance, currency, todayUsed, period, peak, valley, nextChangeAt, at, error }
GET /pet/role.json          { ok, name, model, hasCape }
GET /pet/skin.png           皮肤字节（缺则回内置默认）
GET /pet/audio-active.json  { ok, active, peak }
GET /pet/widget.js          挂件本体
```

## 开发

```bash
node tools/build-widget.mjs     # 把 assets/*.js 拼进 assets/widget.js（挂件是单文件，不能动态 import）
node tools/harness-server.mjs   # 假宿主：http://127.0.0.1:8788/prototype/pet-harness.html?state=idle

node tools/test-quat.mjs        # 四元数
node tools/test-state.mjs       # 状态机
node tools/test-anim.mjs        # 动效
node tools/test-m35.mjs         # 眨眼 / 音符 / 装饰 / 手势 / 粒子
node tools/test-host.mjs        # 宿主：六条路由 + 状态机 + 计费 + 栅栏
node tools/test-widget.mjs      # 挂件：语法 / 产物求值 / 接线 / 未定义函数扫描
```

设计取舍与踩过的坑都在 [`docs/HANDOFF.md`](docs/HANDOFF.md)，施工说明书是 [`docs/plan.md`](docs/plan.md)。

## 许可

代码 MIT（见 [`LICENSE`](LICENSE)）。渲染与动效数学移植自 [Minecraft-Desktop-Pet](https://github.com/DLmember/Minecraft-Desktop-Pet)（MIT），
逐文件标注见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。`assets/note.png`、`heart.png` 属于 Mojang/Microsoft，不在 MIT 范围内。
素材划界与 takedown 方式见 [`PROVENANCE.md`](PROVENANCE.md)。
