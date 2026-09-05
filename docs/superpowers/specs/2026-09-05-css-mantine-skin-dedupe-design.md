# 构建面板：删掉盖在 Mantine 上的重复控件皮

**日期**: 2026-09-05  
**状态**: 待实现  
**范围**: 删除与 `mantine.ts` 重复的控件上色；布局 CSS 与 KS 发布不动  
**前置**: `2026-08-30-ui-shell-reskin-design.md`（token + 外壳；Upload/Push/Branch/History 已用 Mantine 组件）  
**参考**: `src/theme/mantine.ts`、`src/theme/tokens.css`、`src/theme/panelStyles.ts`、`src/styles/base.css`、`upload.css` / `branch.css` / `history.css` / `progress.css`

## 背景

换肤一期后，上传 / 推送 / 分支 / 历史已经是 Mantine 控件，但同一套边框、背景、主按钮色被写了三遍：

1. `tokens.css` + `mantine.ts`（应对控件默认外观负责）
2. `panelStyles.ts` 以及各 Panel 本地 `inputStyles` / `paperStyles` / `fieldStyles`
3. `base.css` 与面板 CSS 里对 `.mantine-*` 的 `!important` 再染色（含 `.upload-primary-cta`、`.push-image-cta`）

用户已确认：

| 维度 | 决策 |
|------|------|
| 优化方向 | 视觉统一（换肤续作），不是拆 KS、不是性能 |
| 深度 | **方案 2**：主题收口 + 删重复 `styles` 对象；不把镜像网格/历史列表改成 Mantine 原语 |
| 不做 | KS 发布三期、整文件删除 `upload.css` 等 |

## 目标

1. **颜色**只认 `tokens.css`。
2. **控件默认外观**只认 `mantine.ts`（输入框底/边框、主按钮实心蓝、Paper 边框、禁用态）。
3. **`panelStyles.ts` 只留 theme 不该全局的例外**：紧凑 Segmented、翠绿复制钮、commit hash 按钮。
4. CSS 只保留布局与非 Mantine 块。交互、props、Tauri 不变。无新依赖（OPT-018）。

## 非目标

- `KsPublishPanel`、`.ks-*`、`KsPublishMapEditor`（三期；其中 `panelPaperStyles` / `panelFieldStyles` 调用本期可暂留，避免越界）
- 镜像卡片网格、历史记录列表改成 `SimpleGrid` / `Table`
- 整文件删除 `upload.css` / `branch.css` / `history.css` / `progress.css`
- 亮色主题、动效库、新 UI 库

## 方案（已选：主题收口）

| 方案 | 说明 | 结论 |
|------|------|------|
| 1. 只删打架 CSS | 本地 `styles` 副本仍在 | 否 |
| 2. 主题收口 + 删重复对象 | 最短且能对齐输入框 | **采用** |
| 3. 清空 CSS 文件 | 卡片/列表会裸奔 | 否 |

## 判定规则（实施时逐条对照）

**删（或去掉 `styles=`，改信 theme）**

- 选择器命中 `.mantine-Button-root` / `.mantine-TextInput-*` / `.mantine-Paper-root`，且属性只有 `border` / `background` / `color` / `box-shadow` / `radius` / 与 token 重复的 `padding`/`height`
- 与 theme 同构的本地 `inputStyles` / `paperStyles` / `fieldStyles`（含 Config / PackSpeed / Merge 表单）
- 主 CTA class（`.upload-primary-cta`、`.push-image-cta`）上再写一遍 filled 色；class 可删，走 `variant="filled"` + theme
- `.log-toggle-btn` 上的自定义按钮皮；改为 Mantine `variant`/`size`，不在 CSS 里上色
- `panelFieldStyles` / `panelPaperStyles` / `panelPrimaryButtonStyles`：若与 `mantine.ts` 同色，本期能删的调用删掉，文件内标废弃；KS 暂留调用

**留**

- `.drop-zone*`、`.image-card*`、`.image-picker*` 网格（不含其中的 TextInput 上色）
- `.history-record*`、`.history-sidebar` 宽高；History 侧栏 Paper 的「圆角 0 / 通栏」layout styles（不是控件皮）
- `.path-picker-row` 的 `flex` / `min-width: 0`
- `base.css`：AppShell 让位、侧栏折叠钮位置、全部 `.ks-*`
- `base.css` 里 Button **inner/section 间距、label `line-height` / `text-box-trim`**（防图标贴字、文字裁切）——仅当 theme 尚未覆盖时留；已在 `mantine.ts` 的删 CSS 副本
- 自定义进度条动画（`.jp-progress-*`、`.progress-track`）
- `.log-panel pre` 等日志排版
- `privacy.css` 表格单元格布局

**不确定则留**：删完对应 Tab 一眼能看出坏了的规则，撤回该条。按文件删，不整仓搜删。

## 架构

```
theme/tokens.css          颜色
theme/mantine.ts          Button / TextInput / Paper / Progress 默认皮
theme/panelStyles.ts      仅 Segmented 紧凑、翠绿复制、commit hash
Upload/Push/Branch/History/Config/PackSpeed/MergeForm
                          不再本地复制 input/paper/field；能去 styles= 则去
styles/*.css              只服务布局 + 非 Mantine 块
base.css                  只留外壳/侧栏/KS；去掉与 theme 对打的 filled !important
```

不改数据流、不改 Tauri command、不改 `*PanelProps`。

## 文件变更清单

| 文件 | 做什么 |
|------|--------|
| `src/theme/mantine.ts` | 不扩 API。确认 filled / TextInput / Paper 已覆盖本期要删的 CSS；缺的 focus ring 补进 theme，不留 `input:focus !important` |
| `src/theme/panelStyles.ts` | 收缩例外集；与 theme 重复的 export 标废弃，KS 以外停止引用 |
| `src/components/UploadPanel.tsx` | 去掉仅用于染色的 CTA class |
| `src/components/PushImagePanel.tsx` | 删本地 `paperStyles`；CTA 同上 |
| `src/components/BranchPanel.tsx` | 删本地 `inputStyles`；已有 `panelPaperStyles` 若与 theme 重复则去掉 |
| `src/components/HistoryPanel.tsx` | 删本地 `inputStyles`；侧栏 Paper 的 layout styles 可留 |
| `src/components/merge/MergeFormSection.tsx` | 删本地 `inputStyles` / `paperStyles` |
| `src/components/ConfigPanel.tsx` | `fieldStyles` 若等于 theme 已覆盖内容 → 去掉 `styles=` |
| `src/components/PackSpeedPanel.tsx` | 同上 |
| `src/styles/base.css` | 删除约 135–260 行量级的全局 input focus / filled·default 按钮 / CTA class 再染色；**保留** AppShell、折叠钮、`.ks-*`、spacing 修复 |
| `src/styles/upload.css` | 删除主 CTA 渐变 `!important`；删除 `.mantine-TextInput-*` 边框/背景/hover |
| `src/styles/progress.css` | 删除 `.mantine-Button-root.log-toggle-btn` 上色；保留布局与进度动画 |
| `src/styles/branch.css` | 删除 commit 按钮/历史按钮的 border/background/color；保留卡片与路径行 |
| `src/styles/history.css` | 删除搜索框 `.mantine-TextInput-input` 高度/边框覆盖，改走 Mantine `size` |

`KsPublishPanel` / `KsPublishMapEditor` / `bt-java.css`：**本期不改。**

## 错误处理

无新失败路径。误删布局 CSS 的回滚单位是「单条选择器」，不是整文件。

## 测试与验收

自动化：`pnpm exec tsc --noEmit`（无新单测；本期无逻辑分支）。

手工（桌面端，暗色）：

1. **上传**：拖放区布局不变；主按钮启用/禁用；构建中进度；日志折叠
2. **推送**：镜像搜索框、镜像卡片网格未崩、主按钮、日志折叠
3. **分支**：仓库/分支输入、打包主按钮、提交 hash 仍可点
4. **历史**：侧栏搜索、记录列表展开、推送进度/日志
5. **设置**：保存钮与主 CTA 同源；子 Tab 表单输入框与构建页同一套边框/底色
6. **对照**：落地页或打包加速任一表单，输入框/主按钮与上面同一套 token（允许密度不同，不允许另一套描边色）
7. **focus**：输入框聚焦只有一圈（theme），不再叠 CSS `!important` 第二圈

成功标准：构建 Tab 的 Button/Input/Paper 不再依赖「class 上再画一遍皮」；拖放区与镜像网格外观与改前一致（允许主按钮更跟 token、去掉渐变叠层）。

## 风险

| 风险 | 缓解 |
|------|------|
| 去掉 `base.css` filled `!important` 后运营页主按钮变样 | 先确认 `mantine.ts` filled 已含白字/禁用；运营页已用 `panelPrimaryButtonStyles` 的，KS 暂留该对象 |
| 日志折叠按钮变普通 variant 后不够显眼 | 可接受；不允许再加渐变/glow 自定义皮 |
| 搜索框高度变了 | 用 Mantine `size="sm"`，不用 CSS 盖 `height: 34` |
| Config 去掉 `fieldStyles` 后个别字段高度不对 | 单字段补 `size`，不把 `fieldStyles` 整份加回来 |

## 分期关系

| 期 | 内容 | 状态 |
|----|------|------|
| 换肤一～二 | token、外壳、构建面板迁 Mantine 组件 | 已做 |
| **本期** | 主题收口，删重复控件皮 | 本文 |
| 之后（未批准） | 镜像网格/历史列表 Mantine 原语；KS 发布拆分 | 不做 |
