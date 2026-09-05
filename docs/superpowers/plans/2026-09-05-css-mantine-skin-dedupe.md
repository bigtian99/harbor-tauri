# 构建面板重复控件皮清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Button / TextInput / Paper 的皮只来自 `tokens.css` + `mantine.ts`，删掉 CSS `!important` 和各 Panel 本地 `inputStyles` / `paperStyles` 副本。

**Architecture:** 先把 focus ring 补进 `mantine.ts`，再按文件删 `base.css` / 面板 CSS 里给 `.mantine-*` 上色的规则，并去掉组件上仅用于染色的 class 与 `styles=`。布局 class（拖放区、镜像网格、历史侧栏）不动。KS 发布仍引用 `panelPaperStyles` 等，不改 `KsPublishPanel`。

**Tech Stack:** React 19、Mantine 9、现有 `src/theme/*` 与 `src/styles/*.css`。无新依赖。

## Global Constraints

- 不新增 npm 依赖；不引入 Tailwind / Ant Design / shadcn（OPT-018）
- 不改 `*PanelProps`、不改 Tauri command、不改拖放/镜像网格/历史列表 DOM
- 不改 `KsPublishPanel.tsx`、`KsPublishMapEditor.tsx`、`bt-java.css`、`base.css` 的 `.ks-*`
- 不确定是否布局的 CSS 选择器：**留**；回滚单位是单条选择器
- 验收：`pnpm exec tsc --noEmit` + spec 手工冒烟；本期无新单测
- spec：`docs/superpowers/specs/2026-09-05-css-mantine-skin-dedupe-design.md`

## File Map

| 文件 | 职责 |
|------|------|
| `src/theme/mantine.ts` | 控件默认皮 + 唯一 focus ring |
| `src/theme/panelStyles.ts` | 只留 Segmented / 翠绿复制 / commit hash；其余 export 标废弃供 KS 暂用 |
| `src/styles/base.css` | 外壳、侧栏、`.ks-*`；删全局按钮/输入上色 |
| `src/styles/upload.css` | 拖放区、镜像网格；删 CTA 渐变与 TextInput 上色 |
| `src/styles/progress.css` | 进度动画、日志排版；删 `.log-toggle-btn` 按钮皮 |
| `src/styles/branch.css` | 路径行、卡片间距；删 commit 按钮上色 |
| `src/styles/history.css` | 历史布局；删搜索框 height 覆盖 |
| `UploadPanel` / `PushImagePanel` / `BranchPanel` / `HistoryPanel` | 去染色 class 与本地 styles |
| `MergeFormSection` / `ConfigPanel` / `PackSpeedPanel` | 去本地 field/paper 副本 |
| Landing / Settlement / Privacy 等非 KS | 去掉 `panelFieldStyles` / `panelPaperStyles` / `panelPrimaryButtonStyles` 调用 |

---

### Task 1: Theme 收口 focus ring，删 `base.css` 全局控件皮

**Files:**
- Modify: `src/theme/mantine.ts`（`TextInput` / `PasswordInput` / `Textarea` / `NumberInput` / `Select` 的 `styles.input`）
- Modify: `src/styles/base.css`（约 135–274 行；保留 AppShell、折叠钮、Badge/Tabs/NavLink section 间距、`.ks-*`、红按钮 glow）

**Interfaces:**
- Consumes: 现有 `appTheme` `createTheme({ components: { TextInput, ... } })`
- Produces: 输入框 focus 只有 theme 一圈（`borderColor: var(--color-primary)` + `box-shadow: 0 0 0 3px var(--color-primary-muted)`）；`base.css` 不再用 `!important` 盖 Button/Input

- [ ] **Step 1: 在 `mantine.ts` 抽出共用 field 样式并接到五个组件**

在 `navActiveStyles` 附近增加（只加这一份，五个 components 引用它）：

```ts
const fieldChrome = {
  label: { color: "var(--color-text)", fontWeight: 600 },
  input: {
    backgroundColor: "var(--color-bg-base)",
    borderColor: "var(--color-border-strong)",
    color: "var(--color-text)",
    "&:focus, &:focus-within": {
      borderColor: "var(--color-primary)",
      boxShadow: "0 0 0 3px var(--color-primary-muted)",
    },
  },
} as const;
```

将 `TextInput` / `PasswordInput` / `Textarea` / `NumberInput` 的 `styles` 换成 `fieldChrome`。`Select` 保持 `defaultProps: { radius: "sm" }`，`styles` 只用 `fieldChrome` 的 `input`：

```ts
Select: {
  defaultProps: { radius: "sm" },
  styles: { input: fieldChrome.input },
},
```

不要改 `Button` 的 filled/default（已在 theme 里）。

- [ ] **Step 2: 从 `base.css` 删除与 theme 重复的块**

删除以下整段（从「输入框：恢复聚焦高亮」到 Button inner/section/label 副本结束），**不要**删折叠钮、AppShell、`.ks-*`：

1. `[data-variant="default"]:has(> input)` 的 `--input-bd` 四变量块
2. `[data-mantine-color-scheme] input:focus` 的 `!important` 边框+ring
3. `.mantine-Button-root[data-variant="filled"]` / `gradient` 白字、禁用灰、`.push-image-cta` / `.upload-primary-cta` / `.config-save-btn` / `.about-check-btn` / `.update-btn--primary` 再染色
4. `.mantine-Button-root[data-variant="default"]` 底/边/hover
5. `.mantine-Button-root` / `inner` / `section` / `label` 的间距与 `text-box-trim`（已在 `mantine.ts` Button.styles）

**保留：** `.mantine-Badge-section` / `.mantine-Tabs-tabSection` / `.mantine-NavLink-section` 左边距；`button[data-color="red"]` glow；其后 Badge light 与全部 `.ks-*`。

- [ ] **Step 3: 验收**

Run:

```bash
rg -n "upload-primary-cta|push-image-cta|input:focus" src/styles/base.css
pnpm exec tsc --noEmit
```

Expected: `base.css` 无 CTA class、无 `input:focus`；tsc 退出码 0。

- [ ] **Step 4: Commit**

```bash
git add src/theme/mantine.ts src/styles/base.css
git commit -m "$(cat <<'EOF'
fix(ui): 输入框 focus 收进 theme，去掉 base.css 控件皮

EOF
)"
```

---

### Task 2: 去掉主 CTA 渐变皮（上传 / 推送 / 分支）

**Files:**
- Modify: `src/components/UploadPanel.tsx`（主按钮 `className`）
- Modify: `src/components/PushImagePanel.tsx`（主按钮 `className`）
- Modify: `src/components/BranchPanel.tsx`（主按钮 `className`）
- Modify: `src/styles/upload.css`（`.push-image-cta` / `.upload-primary-cta` / `.build-btn*`）

**Interfaces:**
- Consumes: Task 1 的 theme filled 按钮
- Produces: 三处主按钮仅为 `variant="filled"` `size="md"` `fullWidth`，无染色 class；`upload.css` 不再给 CTA 画渐变

- [ ] **Step 1: 去掉三个主按钮上的染色 class**

`UploadPanel.tsx` 主按钮改为：

```tsx
      <Button
        variant="filled"
        color="cyan"
        size="md"
        fullWidth
        onClick={onBuildAndPush}
        disabled={isBuilding || !artifactPath}
        leftSection={
          isBuilding
            ? <Loader2 size={16} className="spin" />
            : <Rocket size={16} />
        }
      >
```

`PushImagePanel.tsx` 主按钮去掉 `className="push-image-cta"`，其余 props 不动。

`BranchPanel.tsx` 主按钮去掉 `className="build-btn upload-primary-cta"`，保留 `color="cyan"` `variant="filled"` `size="md"` `fullWidth`。

- [ ] **Step 2: 删除 `upload.css` 里已无引用的按钮皮**

删除 `.build-btn` 整块（含 `::before` / hover / active / disabled，约 360–409 行）。

删除 `.push-image-cta, .upload-primary-cta` 及其 hover/disabled（约 424–446 行）。

**留下** `.push-image-panel` / `.push-image-column` / `.push-progress-panel` / `.image-picker*` 布局。

- [ ] **Step 3: 验收**

Run:

```bash
rg -n "upload-primary-cta|push-image-cta|build-btn" src
pnpm exec tsc --noEmit
```

Expected: 无匹配（或仅注释）；tsc 0。打开上传页：主按钮是实心蓝不是紫蓝渐变；禁用仍灰。

- [ ] **Step 4: Commit**

```bash
git add src/components/UploadPanel.tsx src/components/PushImagePanel.tsx src/components/BranchPanel.tsx src/styles/upload.css
git commit -m "$(cat <<'EOF'
fix(ui): 主 CTA 走 theme filled，去掉渐变 class

EOF
)"
```

---

### Task 3: 日志折叠按钮去皮；搜索框不再 CSS 盖高度

**Files:**
- Modify: `src/components/UploadPanel.tsx`、`PushImagePanel.tsx`、`BranchPanel.tsx`、`HistoryPanel.tsx`（`className="log-toggle-btn"`）
- Modify: `src/styles/progress.css`（`.mantine-Button-root.log-toggle-btn*` 与 `.log-toggle-btn`）
- Modify: `src/styles/upload.css`（`.image-picker-search-input .mantine-TextInput-input*` 上色）
- Modify: `src/styles/history.css`（`.history-panel-new .history-sidebar-search .mantine-TextInput-input`）
- Modify: `src/styles/branch.css`（`.branch-commit-history-btn` 的 border/background/color）

**Interfaces:**
- Consumes: theme `Button` `variant="light"`；theme `TextInput` `size="sm"`
- Produces: 日志钮无自定义渐变；搜索框高度走 Mantine；commit 历史钮走 light，无 `!important` 色

- [ ] **Step 1: 四个日志按钮去掉 `className="log-toggle-btn"`**

四处都已是 `variant="light"` `size="sm"`。只删 className。若折叠钮被拉满整行，在该 `Button` 上加 `style={{ alignSelf: "flex-start" }}`（不要为此保留 CSS 皮）。

- [ ] **Step 2: 删 CSS 按钮皮，留布局**

`progress.css`：删除 `.mantine-Button-root.log-toggle-btn`、`:hover`、`.mantine-Button-section`、以及后面单独的 `.log-toggle-btn { display: inline-flex; ... }`。保留 `.log-section`、`.log-panel pre`。

`upload.css`：`.image-picker-search-input .mantine-TextInput-input` 整段（含 hover/focus）删掉。可留：

```css
.image-picker-search-input .mantine-TextInput-input {
  font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
  font-size: 13px;
}
```

保留 `.path-picker-row ... > .mantine-TextInput-root { flex: 1; min-width: 0; }`（布局）。

`history.css`：删除

```css
.history-panel-new .history-sidebar-search .mantine-TextInput-input {
  height: 34px;
  min-height: 34px;
}
```

`HistoryPanel` 搜索框保持 `size="sm"`。

`branch.css`：`.branch-commit-history-btn` 两条规则里**只删** `border` / `background` / `color` 的 `!important`。保留 `flex-shrink`、`font-size`、`height: 28px`、`padding-inline`。对应 TSX 里该按钮若还不是 `variant="light"`，改成 `variant="light"` `color="cyan"` `size="compact-sm"`。`.branch-commit-info .mantine-Button-root.commit-link { flex-shrink: 0; }` 留着。

- [ ] **Step 3: 验收**

Run:

```bash
rg -n "log-toggle-btn" src
rg -n "mantine-TextInput-input" src/styles/upload.css src/styles/history.css
pnpm exec tsc --noEmit
```

Expected: `log-toggle-btn` 无匹配；upload/history 不再给 TextInput 设 height/border/background（upload 最多留 font-family）；tsc 0。

- [ ] **Step 4: Commit**

```bash
git add src/components/UploadPanel.tsx src/components/PushImagePanel.tsx src/components/BranchPanel.tsx src/components/HistoryPanel.tsx src/styles/progress.css src/styles/upload.css src/styles/history.css src/styles/branch.css
git commit -m "$(cat <<'EOF'
fix(ui): 去掉日志钮和搜索框上的 Mantine 盖皮

EOF
)"
```

---

### Task 4: 删构建面板本地 `inputStyles` / `paperStyles`

**Files:**
- Modify: `src/components/PushImagePanel.tsx`（文件顶 `paperStyles`）
- Modify: `src/components/BranchPanel.tsx`（`inputStyles`；`styles={panelPaperStyles}`）
- Modify: `src/components/HistoryPanel.tsx`（`inputStyles`；**保留** `sidebarPaperStyles`）
- Modify: `src/components/merge/MergeFormSection.tsx`（`inputStyles` / `paperStyles`；`panelPrimaryButtonStyles`）

**Interfaces:**
- Consumes: Task 1 theme Paper / TextInput
- Produces: 上述文件无本地 chrome 对象；KS 未改

- [ ] **Step 1: `PushImagePanel`**

删除：

```ts
const paperStyles = {
  root: {
    background: "var(--color-bg-card)",
    border: "1px solid var(--color-border)",
  },
} as const;
```

所有 `styles={paperStyles}` 删掉该 prop（`withBorder` `radius="md"` 留下）。

- [ ] **Step 2: `BranchPanel`**

删除 `inputStyles` 常量。所有 `styles={inputStyles}` 以及 `styles={{ ...inputStyles, description: ... }}` 改成只留非 chrome 的 description（若需要）：

```tsx
styles={{ description: { color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" } }}
```

三处 `Paper` 去掉 `styles={panelPaperStyles}`，保留 `className="branch-card"`（卡片布局在 CSS）。若因此不再使用 `panelPaperStyles`，从 import 删掉，**保留** `panelSegmentedStyles` 与 `commitHashButtonStyles`。

- [ ] **Step 3: `HistoryPanel`**

删除 `inputStyles`。搜索框 `styles={{ ...inputStyles, input: { ...inputStyles.input, textTransform: "none" } }}` 改为：

```tsx
styles={{ input: { textTransform: "none" } }}
```

**不要删** `sidebarPaperStyles`（圆角 0、通栏、右边框是布局）。

- [ ] **Step 4: `MergeFormSection`**

删除 `inputStyles` 与 `paperStyles`。`styles={inputStyles}` 去掉；`Paper` 的 `styles={paperStyles}` 去掉。主合并按钮去掉 `styles={panelPrimaryButtonStyles}`，改为 `variant="filled"`（若尚未 filled）。**保留** `commitHashButtonStyles`。

- [ ] **Step 5: 验收**

Run:

```bash
rg -n "const inputStyles|const paperStyles" src/components/PushImagePanel.tsx src/components/BranchPanel.tsx src/components/HistoryPanel.tsx src/components/merge/MergeFormSection.tsx
pnpm exec tsc --noEmit
```

Expected: 无匹配；tsc 0。

- [ ] **Step 6: Commit**

```bash
git add src/components/PushImagePanel.tsx src/components/BranchPanel.tsx src/components/HistoryPanel.tsx src/components/merge/MergeFormSection.tsx
git commit -m "$(cat <<'EOF'
fix(ui): 去掉构建/合并面板本地 input 与 paper 样式副本

EOF
)"
```

---

### Task 5: Config / PackSpeed / 非 KS 去掉 field 副本

**Files:**
- Modify: `src/components/ConfigPanel.tsx`（`fieldStyles`、`panelPaperProps.style`）
- Modify: `src/components/PackSpeedPanel.tsx`
- Modify: `src/components/PrivacyPanel.tsx`
- Modify: `src/components/SettlementPanel.tsx`
- Modify: `src/components/landing/LandingChannelForm.tsx`、`LandingFtpSection.tsx`、`ChannelPreviewTable.tsx`、`VestPreviewTable.tsx`

**Interfaces:**
- Consumes: Task 1 theme
- Produces: 非 KS 调用方不再传 `panelFieldStyles` / `panelPaperStyles` / `panelPrimaryButtonStyles`；`KsPublishPanel` 仍引用它们

- [ ] **Step 1: `ConfigPanel`**

删除 `fieldStyles` 常量。所有 `styles={fieldStyles}` 删除该 prop。三处 Textarea 只保留等宽：

```tsx
styles={{
  input: { fontFamily: "var(--mantine-font-family-monospace)" },
}}
```

`panelPaperProps` 去掉 `style: { background, borderColor }`，留下 `p` / `radius` / `withBorder`。`sectionCardStyle` 若只是卡片底+边且该节点不是 Mantine Paper，**留**（非 Mantine 块）。

- [ ] **Step 2: `PackSpeedPanel`**

删除 `const fieldStyles = panelFieldStyles`。`styles={fieldStyles}` 去掉。Textarea 只留：

```tsx
styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
```

`Paper` 去掉 `styles={panelPaperStyles}`。主按钮去掉 `styles={panelPrimaryButtonStyles}`，确保 `variant="filled"`。import 只留仍在用的 `panelSegmentedStyles`。

- [ ] **Step 3: Privacy / Settlement / Landing**

- `PrivacyPanel`：去掉 `styles={panelFieldStyles}` 与对应 import。
- `SettlementPanel`：去掉 `panelFieldStyles` / `panelPaperStyles` / `panelPrimaryButtonStyles` 的 `styles=` 与 import；主按钮 `variant="filled"`。
- `LandingChannelForm`：同上。
- `LandingFtpSection` / `ChannelPreviewTable` / `VestPreviewTable`：`Paper` 去掉 `styles={panelPaperStyles}`；表格 `style={{ overflow: "hidden" }}` 可留。

不要打开 `KsPublishPanel.tsx` / `KsPublishMapEditor.tsx`。

- [ ] **Step 4: 验收**

Run:

```bash
rg -n "panelFieldStyles|panelPaperStyles|panelPrimaryButtonStyles" src --glob '!**/KsPublish*'
pnpm exec tsc --noEmit
```

Expected: 非 KS 文件无这三项（`panelStyles.ts` 定义处除外）；`KsPublishPanel.tsx` 仍有；tsc 0。

- [ ] **Step 5: Commit**

```bash
git add src/components/ConfigPanel.tsx src/components/PackSpeedPanel.tsx src/components/PrivacyPanel.tsx src/components/SettlementPanel.tsx src/components/landing
git commit -m "$(cat <<'EOF'
fix(ui): 非 KS 面板改信 theme，去掉重复 field/paper styles

EOF
)"
```

---

### Task 6: 收缩 `panelStyles.ts` 并做最终 grep

**Files:**
- Modify: `src/theme/panelStyles.ts`
- Modify: `docs/superpowers/specs/2026-09-05-css-mantine-skin-dedupe-design.md`（状态 → 已实现）

**Interfaces:**
- Consumes: Task 5 之后仅 KS 使用废弃 export
- Produces: 例外三项仍正式 export；与 theme 重复的三项标 `ponytail` 废弃注释

- [ ] **Step 1: 给重复 export 加废弃说明，不删符号**

`panelPaperStyles` / `panelFieldStyles` / `panelPrimaryButtonStyles` 上方改为：

```ts
/** @deprecated 仅 KsPublishPanel 暂留；新代码走 mantine.ts。KS 三期再删。 */
export const panelPaperStyles = {
```

`panelSegmentedStyles` / `panelAccentButtonStyles` / `commitHashButtonStyles` 保持现有注释，不标废弃。

- [ ] **Step 2: 最终验收**

Run:

```bash
rg -n "upload-primary-cta|push-image-cta|log-toggle-btn" src
rg -n "const inputStyles|const paperStyles|const fieldStyles" src/components
pnpm exec tsc --noEmit
```

Expected: CTA/log-toggle class 为 0；`fieldStyles` 不在 Config/PackSpeed；tsc 0。

手工（桌面暗色，对照 spec）：上传拖放区未崩；推送镜像网格未崩；分支打包钮；历史搜索；设置保存；输入框 focus 一圈。

把 spec 文首 **状态** 改为 `已实现`。

- [ ] **Step 3: Commit**

```bash
git add src/theme/panelStyles.ts docs/superpowers/specs/2026-09-05-css-mantine-skin-dedupe-design.md
git commit -m "$(cat <<'EOF'
docs: 标记控件皮清理规格已实现并废弃 panelStyles 重复项

EOF
)"
```

---

## Self-review（对照 spec）

| Spec 要求 | 任务 |
|-----------|------|
| focus 进 theme，不留 CSS `!important` 第二圈 | Task 1 |
| 删 base.css filled/default/CTA 再染色 | Task 1 |
| 删 upload CTA 渐变 | Task 2 |
| 删 TextInput / log-toggle / commit 钮盖皮 | Task 3 |
| 删 Push/Branch/History/Merge 本地 styles | Task 4 |
| Config / PackSpeed 去 fieldStyles | Task 5 |
| 非 KS 停用 panelField/Paper/Primary | Task 5 |
| KS / 镜像网格 / 历史 DOM 不动 | 各任务约束 |
| panelStyles 只留例外 + 废弃标记 | Task 6 |
| tsc + 手工冒烟 | Task 1–6 验收 |
