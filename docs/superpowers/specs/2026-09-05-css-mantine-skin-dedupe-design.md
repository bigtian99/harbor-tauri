# 构建面板：删掉盖在 Mantine 上的重复控件皮

**日期**: 2026-09-05  
**状态**: 待实现  
**范围**: Upload / Push / Branch / History 的 CSS 与 `styles` 重复层  
**前置**: `2026-08-30-ui-shell-reskin-design.md`（token + 外壳 + 构建面板已用 Mantine 组件）  
**参考**: `src/theme/panelStyles.ts`、`src/theme/tokens.css`、`src/styles/base.css`、`upload.css` / `branch.css` / `history.css` / `progress.css`

## 背景

换肤一期后，上传 / 推送 / 分支 / 历史已经是 Mantine 控件，但同一套边框、背景、主按钮色被写了三遍：

1. `tokens.css` + `mantine.ts` + `panelStyles.ts`（应作为唯一控件皮）
2. `base.css` 里对 `.mantine-Button-root` / filled 的全局 `!important`
3. 面板 CSS（`.upload-primary-cta`、`.log-toggle-btn`、`.mantine-TextInput-input`）和组件内本地 `inputStyles` / `paperStyles`

结果：按钮/输入框和运营页不完全一套；改 token 也盖不干净。

用户已确认（方案 A）：**只清重复控件皮，不改布局，不迁 KS，不把镜像网格/历史列表改成 Mantine 原语。**

## 目标

1. Mantine `Button` / `TextInput` / `Paper` 的边框、底色、圆角、主 CTA、禁用态只来自 **theme + `panelStyles.ts`**。
2. CSS 只保留布局与非 Mantine 块：拖放区、镜像卡片网格、历史列表、日志 `<pre>`、自定义进度条。
3. 交互与 props 不变。无新依赖、无第三套 UI（OPT-018）。

## 非目标

- `KsPublishPanel` 与 `.ks-*`（仍属换肤三期）
- 镜像卡片网格、历史记录列表改成 `SimpleGrid` / `Table` 等
- 整文件删除 `upload.css` / `branch.css` / `history.css` / `progress.css`
- 再抽新的 style 工厂；Merge / KS 映射编辑器里的本地 `paperStyles` 本期不动
- 亮色主题、动效库

## 方案（已选：删皮留骨）

| 方案 | 说明 | 结论 |
|------|------|------|
| 1. 删重复控件皮，布局 class 留下 | 最短路径，对齐观感 | **采用** |
| 2. 清空 CSS 文件 | 卡片/列表会裸奔 | 否 |
| 3. 再合并一轮 `panelStyles` 抽象 | 维护性，不是这一期观感瓶颈 | 否（仅把已有 `panelFieldStyles` / `panelPaperStyles` 接到重复处） |

## 判定规则（实施时逐条对照）

**删（或改接到 `panelStyles`）** — 只改 chrome：

- 选择器命中 `.mantine-Button-root` / `.mantine-TextInput-*` / `.mantine-Paper-root`，且属性只有 `border` / `background` / `color` / `box-shadow` / `radius` / 与 token 重复的 `padding`/`height`
- 组件内与 `panelFieldStyles` / `panelPaperStyles` 同构的本地 `inputStyles` / `paperStyles`
- 主 CTA class（`.upload-primary-cta`、`.push-image-cta`）上再写一遍 filled 色；改为 `styles={panelPrimaryButtonStyles}`，class 可删
- `.log-toggle-btn` 上的渐变描边按钮皮；改为 Mantine `variant="light"` `color="blue"`，去掉自定义渐变/glow

**留** — 布局或 Mantine 修过的 bug：

- `.drop-zone*`、`.image-card*`、`.image-picker*` 网格、`.history-record*`、`.history-sidebar` 宽高
- `.path-picker-row` 的 `flex` / `min-width: 0`（不是皮，是撑开）
- `base.css` 里 Button **inner/section 间距、label `line-height` / `text-box-trim`**（防图标贴字、文字裁切）
- 自定义进度条（`.jp-progress-*`、`.progress-track`）— 不是 Mantine Progress 的重复皮就留
- `.log-panel pre` 等日志排版

**不确定则留**：删完对应 Tab 一眼能看出坏了的规则，撤回该条，不在本期「顺手重构」。

## 架构

```
theme/tokens.css + theme/mantine.ts     颜色与默认控件
theme/panelStyles.ts                    Paper / Field / PrimaryButton 唯一覆盖
Upload/Push/Branch/History              引用 panelStyles；不再本地复制一份
styles/*.css                            只服务布局 + 非 Mantine 块
base.css                                只留间距/裁切修复；去掉与 panelPrimaryButtonStyles 对打的 filled !important
```

不改数据流、不改 Tauri command、不改 `*PanelProps`。

## 文件变更清单

| 文件 | 做什么 |
|------|--------|
| `src/theme/panelStyles.ts` | 不扩 API。若 Primary 与 theme 已一致，保持原样 |
| `src/components/UploadPanel.tsx` | CTA 改 `panelPrimaryButtonStyles`；去掉仅用于染色的 class |
| `src/components/PushImagePanel.tsx` | 本地 `paperStyles` → `panelPaperStyles`；CTA 同上 |
| `src/components/BranchPanel.tsx` | 本地 `inputStyles` → `panelFieldStyles`；CTA 同上 |
| `src/components/HistoryPanel.tsx` | 本地 `inputStyles` → `panelFieldStyles`；侧栏 `Paper` 的 layout styles 可留（那是宽高/圆角 0，不是控件皮） |
| `src/styles/base.css` | 删除/收窄对 filled Button 的全局 `color: #fff !important` 与 CTA class 再染色；**保留** inner/section/label 修复 |
| `src/styles/upload.css` | 删除 `.upload-primary-cta` / `.push-image-cta` 色块；删除 `.image-picker-search-input .mantine-TextInput-input` 的 border/background（字体可用 `styles` 或留下 `font-family` 一条） |
| `src/styles/progress.css` | 删除 `.mantine-Button-root.log-toggle-btn` 的按钮皮；保留 `.log-section` / `.log-panel` 布局 |
| `src/styles/branch.css` | 删除 `.commit-link` / `.branch-commit-history-btn` 上的 border/background/color；保留卡片与路径行布局 |
| `src/styles/history.css` | 删除搜索框 `.mantine-TextInput-input` 高度/边框覆盖（高度改走 Mantine `size` 或 `panelFieldStyles`） |

`MergeFormSection` / `KsPublishMapEditor` 的本地 `paperStyles`：**本期不改。**

## 错误处理

无新失败路径。误删布局 CSS 的回滚单位是「单条选择器」，不是整文件。

## 测试与验收

自动化：`pnpm exec tsc --noEmit`（无新单测；本期无逻辑分支）。

手工（桌面端，暗色）：

1. **上传**：拖放区、主按钮启用/禁用、构建中进度、日志折叠按钮
2. **推送**：镜像搜索框、镜像卡片（布局未崩）、主按钮、日志折叠
3. **分支**：仓库/分支输入、打包主按钮、提交 hash 按钮仍可点
4. **历史**：侧栏搜索、记录列表展开、推送进度/日志
5. **对照**：打开落地页或打包加速任一 Mantine 表单，输入框/主按钮应与上面四页同一套 token（允许密度不同，不允许另一套描边色）

成功标准：四处构建 Tab 的 Button/Input/Paper 不再依赖「class 上再画一遍皮」；镜像网格与历史列表外观可与改前一致（允许主按钮更跟 token）。

## 风险

| 风险 | 缓解 |
|------|------|
| `base.css` filled `!important` 一删，运营页主按钮变样 | 先核对 `panelPrimaryButtonStyles` 与 Mantine `filled`；运营页 CTA 已用 `panelPrimaryButtonStyles` 的保持不动 |
| 日志折叠按钮变「普通 light」后不够显眼 | 可接受；不允许再加渐变/glow 自定义皮 |
| 搜索框高度变了 | 用 Mantine `size="sm"`，不用 CSS 盖 `height: 34` |

## 分期关系

| 期 | 内容 | 状态 |
|----|------|------|
| 换肤一～二 | token、外壳、构建面板迁 Mantine 组件 | 已做 |
| **本期** | 删重复控件皮 | 本文 |
| 之后（未批准） | 镜像网格/历史列表 Mantine 原语；KS 发布拆分 | 不做 |
