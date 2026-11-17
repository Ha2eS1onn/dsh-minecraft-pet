# dsh-minecraft-pet

DSH（DeepSeek Harness）界面右下角的 **Minecraft 方块小人挂件**。

把一张 64×64 皮肤用 Canvas 2D 实时光栅化成盒子模型，跟着会话状态做动作；
右侧气泡显示账号余额、今日已用与峰谷时段，每轮结束提示这一轮花了多少。

> 独立粉丝作品，与 Mojang Studios / Microsoft 无关联，未获授权或官方认可。
> `Minecraft` 仅用于描述所渲染的皮肤格式。详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 功能

- **六态**：`idle` / `thinking` / `working` / `waiting` / `done` / `error`，优先级与最短停留沿用 DSH 会话语义
- **动效**：呼吸、眨眼（需皮肤画了 DA 识别格）、头部跟随鼠标、打字手臂交替、待机手势（伸懒腰 / 歪头 / 犯困）、音符、状态粒子、装饰（兔耳 / 猫耳 / 爱心 / 棒棒糖 / **小鸭**）
- **敲字浮现字**：坐姿打字时，字符从对应按键上方升起，糖果色带阴影，0.8 秒淡出；中文输入法只显示键名。按规格**只在坐姿出现**（宿主 `idle` 时打字会切到坐姿；宿主正在 `thinking` / `waiting` 时不抢状态，也就不会出字）
  - 没出字时读 `window.__dshPetState().letterStat`：`keys` 有没有涨、`noSit` / `noLabel` / `noPos` 哪个在涨、`glyphs` 是否为 0、`error` 有没有内容，一次即可定位
- **Bedrock 装饰**：可挂 `.geo.json` 骨骼盒子模型（内置一只自造小鸭），跟随头部旋转
- **物理模拟**：第一版效果不达标（落地回弹峰值仅 2.8 px）已回退，当前为无物理的 P1 行为；重做中，设计说明在源码内 `docs/physics-redesign.md`（该目录不入库）
- **正版披风**：右键菜单 →「正版账号」，输入 Java 版用户名或 UUID，拉取该账号的皮肤、模型类型（classic/slim）与披风；解绑自动还原本地皮肤
- **余额**：账号余额、今日已用、峰谷时段标记；拿不到数据时显示 `--`，不挡其他功能
- **每轮消耗**：一轮结束后弹出「本轮 ¥0.00xx · N tok」
- **交互**：拖动（松手落在屏幕底部 15% 内会落地回弹）、5 档缩放、水平翻转、鼠标穿透（留一个 ⟲ 恢复点）、**右键在光标处打开菜单**
- **余额气泡**：可直接拖动到任意位置，菜单里「气泡大小」按 10% 档调（60%~160%）、「气泡位置」点一下在四角间循环；位置按比例保存，改缩放后仍贴在原来的角

## 安装

```bash
# 本地目录（link 安装，改 assets/ 后 Ctrl+F5 生效）
dsh plugin --profile desktop add link:D:/path/to/dsh-minecraft-pet
```

> 目前只发 GitHub Release，**npm 上未发布**，所以 `dsh plugin add dsh-minecraft-pet` 不可用。
> 需要分发包时在本仓库 `npm pack` 出 tgz 自行安装。

宿主代码（`lib/`）改动需要**重启 DSH 客户端**才生效；`assets/` 下的挂件与渲染模块按 mtime 热读，刷新页面即可。

## 数据与文件

| 位置 | 用途 |
|---|---|
| `$DSH_HOME/pet-role/skin.png` + `meta.json` | 角色皮肤与模型类型（`classic` / `slim`）。首次启动时若为空，会从旧版 `whale-roles/default/` 复制一份 |
| `$DSH_HOME/pet-role/cape.png` | 绑定账号后拉到的披风（仅本机缓存，不随包分发）；解绑即删除 |
| `$DSH_HOME/pet-role/skin.local.png` | 绑定前的本地皮肤备份，解绑时还原 |
| `$DSH_HOME/.dsh-pet-state.json` | 今日已用与轮次序号（按北京日切） |
| 浏览器 `localStorage` `dshmp-*` | 位置、缩放、翻转、穿透、气泡开关、装饰、披风开关 |

接口（除账号绑定外全部只读，走 DSH 既有鉴权）：

```
GET /pet/state.json         { ok, state, since, pending, turnCost }
GET /pet/balance.json       { ok, balance, currency, todayUsed, period, peak, valley, nextChangeAt, at, error }
GET /pet/role.json          { ok, name, model, hasCape, account }
GET /pet/skin.png           皮肤字节（缺则回内置默认）
GET /pet/cape.png           披风字节（没有就 404）
GET /pet/audio-active.json  { ok, active, peak }
GET /pet/widget.js          挂件本体

GET    /pet/account.json    { ok, bound, name, uuid, model, hasCape, cape, boundAt, error }
POST   /pet/account.json    { account: "用户名或 UUID" } → 绑定拉取；account 为空串等同解绑
DELETE /pet/account.json    解绑并还原本地皮肤
```

账号绑定只在用户点「绑定」时向官方服务请求一次，不轮询；失败不写盘，人物不受影响。

## 开发

```bash
node tools/build-widget.mjs     # 把 assets/*.js 拼进 assets/widget.js（挂件是单文件，不能动态 import）
node tools/harness-server.mjs   # 假宿主：http://127.0.0.1:8788/prototype/pet-harness.html?state=idle

node tools/test-quat.mjs        # 四元数
node tools/test-state.mjs       # 状态机
node tools/test-anim.mjs        # 动效（P1 版）
node tools/test-m35.mjs         # 眨眼 / 音符 / 装饰 / 手势 / 粒子
node tools/test-cape.mjs        # 披风几何 / UV / 无披风时基线不变
node tools/test-geo.mjs         # Bedrock geo 解析 / pivot / 底部对齐 / 贴图校验
node tools/test-letters.mjs     # 键名 / 键位 / 字模 / Letter 场 / 渲染集成
node tools/test-keydown.mjs     # DOM stub 真实派发 keydown，验证浮现字整条链路
node tools/test-host.mjs        # 宿主：路由 + 状态机 + 计费 + 栅栏 + 账号绑定（假 fetch）
node tools/test-widget.mjs      # 挂件：语法 / 产物求值 / 接线 / 未定义函数扫描

node tools/render-m0.mjs        # 静止帧基线（25928 px / c2c43ab4，改渲染前后对比）
node tools/compare-cape.mjs     # 披风三联对照图 → prototype/m5-cape.png
node tools/make-geo-duck.mjs    # 重造内置小鸭的 geo + 贴图
```

设计取舍与踩过的坑记在源码内 `docs/HANDOFF.md`，施工说明书是 `docs/plan.md`（`docs/` 只在本机保留，不随仓库分发）。

## 许可

代码 MIT（见 [`LICENSE`](LICENSE)）。渲染与动效数学移植自 [Minecraft-Desktop-Pet](https://github.com/DLmember/Minecraft-Desktop-Pet)（MIT），
逐文件标注见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。`assets/note.png`、`heart.png` 属于 Mojang/Microsoft，不在 MIT 范围内；`assets/decoration-duck.*` 与 `default-skin.png` 为本项目自造/默认素材。
素材划界与 takedown 方式见 [`PROVENANCE.md`](PROVENANCE.md)。
