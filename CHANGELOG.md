# Changelog

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
