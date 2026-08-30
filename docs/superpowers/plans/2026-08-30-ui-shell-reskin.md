# UI 全局外壳换肤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第一期把侧栏、设置页、全局配色统一到 Zinc 暗底 + Cyan `#06b6d4`，其余 Panel 通过 CSS token 被动换肤。

**Architecture:** `tokens.css` 为颜色真相源；`mantine.ts` 从 `main.tsx` 抽出并改 `primaryColor: "cyan"`；侧栏与 ConfigPanel 外壳迁 Mantine；**不引入 AppShell**（保留 `.app` flex，最小 diff）。构建类 Panel 只做 `var(--color-primary)` 替换，不改组件结构。

**Tech Stack:** React 19、Mantine 9.4、Vite、现有 `App.css` 模块、lucide-react

## Global Constraints

- 不新增 npm 依赖；不引入 Tailwind / Ant Design / shadcn（OPT-018）
- 主色 `#06b6d4`、悬停 `#22d3ee`、背景 `#09090b` / `#18181b` / `#27272a`（见 spec）
- `ConfigPanelProps`、`SidebarProps` 接口不变；无新 Tauri command
- 侧栏展开 220px / 收起 56px；OPS `isOpsTab` 裁剪逻辑不变
- `src/` 内 `#64ffda` 与 `rgba(100, 255, 218` 硬编码清零（改 token 或 Mantine cyan）
- 验收：`pnpm exec tsc --noEmit` + spec 手工冒烟清单

## File Map

| 文件 | 职责 |
|------|------|
| `src/theme/tokens.css` | `:root` CSS 变量（spec 全表） |
| `src/theme/mantine.ts` | `export const appTheme = createTheme({...})` |
| `src/main.tsx` | 引 tokens + `appTheme`，删内联 theme |
| `src/components/Sidebar.tsx` | Mantine NavLink / Collapse / Tooltip |
| `src/components/ConfigPanel.tsx` | Mantine Tabs + 各子页表单控件 |
| `src/styles/base.css` | 布局 + content；删旧 `.sidebar*`；背景改 token |
| `src/styles/*.css` + `ConfirmDialog.css` + `Modal.css` | 硬编码色 → `var(--color-*)` |
| `src/styles/base.css` `.ks-*` 分页变量 | `--pagination-active-bg` 等改 cyan |

---

### Task 1: Design Token + Mantine Theme

**Files:**
- Create: `src/theme/tokens.css`
- Create: `src/theme/mantine.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `appTheme`（`MantineTheme`），`tokens.css` 在 `:root` 暴露 `--color-*`

- [ ] **Step 1: 创建 `src/theme/tokens.css`**

```css
:root {
  --color-primary: #06b6d4;
  --color-primary-hover: #22d3ee;
  --color-primary-muted: rgba(6, 182, 212, 0.15);
  --color-bg-base: #09090b;
  --color-bg-surface: #18181b;
  --color-bg-elevated: #27272a;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-text: #fafafa;
  --color-text-muted: #a1a1aa;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --radius-md: 8px;
  --font-size-base: 14px;
  --font-size-sm: 12px;
  --sidebar-width: 220px;
  --sidebar-width-collapsed: 56px;
}
```

- [ ] **Step 2: 创建 `src/theme/mantine.ts`（从 `main.tsx` 迁移并改色）**

```typescript
import { createTheme } from "@mantine/core";

export const appTheme = createTheme({
  primaryColor: "cyan",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
  defaultRadius: "md",
  colors: {
    dark: [
      "#fafafa",
      "#a1a1aa",
      "#71717a",
      "#52525b",
      "#3f3f46",
      "#27272a",
      "#18181b",
      "#09090b",
      "#09090b",
      "#09090b",
    ],
  },
  primaryShade: { light: 6, dark: 5 },
  components: {
    Table: {
      defaultProps: {
        striped: false,
        highlightOnHover: true,
        withTableBorder: false,
        withColumnBorders: false,
      },
    },
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: { backgroundOpacity: 0.7, blur: 4 },
      },
    },
    Button: { defaultProps: { size: "sm" } },
    Tooltip: { defaultProps: { openDelay: 400 } },
    Pagination: {
      defaultProps: { color: "cyan", radius: "sm", size: "sm", autoContrast: true },
      vars: () => ({
        root: {
          "--pagination-active-bg": "var(--color-primary)",
          "--pagination-active-color": "var(--color-bg-base)",
        },
      }),
    },
    Select: {
      defaultProps: { radius: "sm" },
      styles: {
        input: {
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          color: "var(--color-text)",
        },
      },
    },
  },
});
```

- [ ] **Step 3: 精简 `src/main.tsx`**

```typescript
import "./theme/tokens.css";
import { appTheme } from "./theme/mantine";
// ...
<MantineProvider theme={appTheme} defaultColorScheme="dark">
```

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/theme/tokens.css src/theme/mantine.ts src/main.tsx
git commit -m "feat(ui): add design tokens and extract Mantine theme"
```

---

### Task 2: 全局背景与布局 CSS（不动 AppShell）

**Files:**
- Modify: `src/styles/base.css`
- Modify: `src/App.css`（仅当 `:root` 重复时删一行）

**Interfaces:**
- Consumes: `tokens.css` 变量
- Produces: `.app` / `.content` 使用 `var(--color-bg-base)`；删除 `body::before` 动画

- [ ] **Step 1: 改 `base.css` 根样式**

将 `:root` 的 `color`/`background-color` 改为 `var(--color-text)` / `var(--color-bg-base)`。  
`body` 背景改为 `background: var(--color-bg-base)`（删掉 radial-gradient）。  
**删除** `body::before` 整块（浮动光斑）。

- [ ] **Step 2: `.content` 区**

```css
.content {
  background: var(--color-bg-base);
  color: var(--color-text);
}
```

- [ ] **Step 3: 视觉快检**

Run: `pnpm dev`，打开任意 Tab，背景应为纯色深灰、无光斑动画。

- [ ] **Step 4: Commit**

```bash
git add src/styles/base.css
git commit -m "feat(ui): flat zinc background via design tokens"
```

---

### Task 3: 侧栏 Mantine 化

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/styles/base.css`（删除 `.sidebar` ~ `.sidebar-flyout` 等旧规则，保留 `.sidebar-toggle` 或并入组件）

**Interfaces:**
- Consumes: `SidebarProps`（不变）、`TabType`、`isOpsTab`
- Produces: 同 props 的 `Sidebar` 组件；展开宽 `var(--sidebar-width)`，收起 `var(--sidebar-width-collapsed)`

- [ ] **Step 1: 重写 `Sidebar.tsx` 结构**

用 `Box` 作 `<aside>`，宽由 prop `sidebarCollapsed` 切换 CSS 变量宽度：

```tsx
<Box
  component="aside"
  w={sidebarCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)"}
  bg="var(--color-bg-surface)"
  style={{ borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", flexShrink: 0 }}
>
```

导航项用 `Tooltip`（`disabled={!sidebarCollapsed}`）包裹 `NavLink`：

```tsx
<Tooltip label={label} position="right" disabled={!sidebarCollapsed}>
  <NavLink
    label={sidebarCollapsed ? undefined : label}
    leftSection={icon}
    active={activeTab === tab}
    onClick={() => onTabChange(tab)}
    color="cyan"
    variant="subtle"
  />
</Tooltip>
```

宝塔分组：`NavLink` + `Collapse`（展开态）；`sidebarCollapsed` 时用 `Popover` 或现有 flyout 逻辑（`position="right-start"`）展示 Java/PHP 子项。  
底栏：`系统日志`、`设置` 两个 `NavLink`，OPS 时整块不渲染（现有 `!opsMode` 条件保留）。

折叠按钮：保留现有 `.sidebar-toggle` 或 `ActionIcon` 绝对定位，行为 `onToggleCollapse` 不变。

- [ ] **Step 2: 删 `base.css` 中旧侧栏样式**

删除 `.sidebar`、`.sidebar-item`、`.sidebar-group`、`.sidebar-flyout` 等（约 63–250 行区间，以实际 grep `.sidebar` 为准）。保留 `.sidebar-toggle` 若仍用 class。

- [ ] **Step 3: 冒烟**

- 展开/收起宽度正确  
- 各 Tab 切换、激活态 cyan  
- 宝塔展开 + 收起态 flyout  
- `pnpm tauri:build:ops` 不必须；dev 下 OPS 菜单裁剪目测或临时改 `opsMode`

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/styles/base.css
git commit -m "feat(ui): rewrite sidebar with Mantine NavLink"
```

---

### Task 4: ConfigPanel — Tabs 外壳 + Harbor/JAR/前端 子页

**Files:**
- Modify: `src/components/ConfigPanel.tsx`
- Modify: `src/styles/config.css`（删与子 Tab 导航重复的 `.config-tabs` 样式）

**Interfaces:**
- Consumes: `ConfigPanelProps`（不变）、`ConfigTab` 类型（不变）
- Produces: 顶栏 `Tabs` + 三个子面板仍调用原 `onConfigChange` / `onSaveConfig`

- [ ] **Step 1: 引入 Mantine 组件**

```typescript
import {
  Tabs, TextInput, PasswordInput, NumberInput, Checkbox, Button, Stack, Group, Text, Select,
} from "@mantine/core";
```

- [ ] **Step 2: 替换顶栏子 Tab**

原 `TABS.map` 按钮 →：

```tsx
<Tabs value={activeTab} onChange={(v) => v && setActiveTab(v as ConfigTab)}>
  <Tabs.List>
    {TABS.map(({ key, label, icon }) => (
      <Tabs.Tab key={key} value={key} leftSection={icon}>{label}</Tabs.Tab>
    ))}
  </Tabs.List>
  <Tabs.Panel value="connection">...</Tabs.Panel>
  ...
</Tabs>
```

- [ ] **Step 3: 迁移 `connection` / `jar` / `frontend` 表单**

每个 `<input className="config-input">` → `TextInput`；密码 → `PasswordInput` + 右侧 `ActionIcon`（Eye/EyeOff）；  
`onChange` 仍调 `onConfigChange("harbor_url", e.target.value)` 等价写法：

```tsx
<TextInput
  label="Harbor 地址"
  value={config.harbor_url}
  onChange={(e) => onConfigChange("harbor_url", e.currentTarget.value)}
/>
```

**不要**改字段名、校验、`onSaveConfig` 触发时机。Maven 目录选择仍用 `open()` + 按钮。

- [ ] **Step 4: `tsc` + 设置页前三 Tab 冒烟**

保存 Harbor 配置、切换 JAR/前端 Tab、`initialSubTab="jar"` 从分支页跳转仍生效。

- [ ] **Step 5: Commit**

```bash
git add src/components/ConfigPanel.tsx src/styles/config.css
git commit -m "feat(ui): Mantine tabs and forms for config connection/jar/frontend"
```

---

### Task 5: ConfigPanel — 宝塔/输出/KS/关于 子页

**Files:**
- Modify: `src/components/ConfigPanel.tsx`
- Modify: `src/components/KsPublishMapEditor.tsx`（仅当外层 wrapper 需要；内部表格 CSS 可暂留）

**Interfaces:**
- Consumes: Task 4 的 `Tabs` 结构
- Produces: 全部 7 个子 Tab 可切换；`KsPublishMapEditor` 仍嵌入 `ks` panel

- [ ] **Step 1: 迁移 `bt` / `output` 子页**

FTP 字段、checkbox、`bt_auto_deploy_test` 等 → Mantine 控件；宝塔临时登录按钮逻辑不动。

- [ ] **Step 2: 迁移 `ks` 子页**

KS 环境列表（`ks-env-row`）可保留 div 结构但边框色改 `var(--color-border)`，或外层包 `Paper`。  
`KsPublishMapEditor` 不强制 Mantine 化表格（ponytail：二期再动）。

- [ ] **Step 3: 迁移 `about` 子页**

版本号、检查更新、清空 Git 记录按钮 → Mantine `Button` / `Text`。

- [ ] **Step 4: 删 `config.css` 中与已迁移表单重复的 `.config-input`、`.config-tab` 规则**

- [ ] **Step 5: 设置全 Tab 冒烟 + Commit**

```bash
git add src/components/ConfigPanel.tsx src/styles/config.css
git commit -m "feat(ui): Mantine forms for config bt/output/ks/about"
```

---

### Task 6: 遗留 CSS 硬编码色批量替换 + 弹层对齐

**Files:**
- Modify: `src/styles/upload.css`, `branch.css`, `history.css`, `progress.css`, `merge.css`, `packspeed.css`, `config.css`, `config-extras.css`, `bt-java.css`, `utilities.css`, `utilities-end.css`
- Modify: `src/components/ConfirmDialog.css`, `Modal.css`, `UpdateModal.css`, `TemplateCarousel.css`
- Modify: `src/styles/base.css`（`.ks-*` 里 `--pagination-active-bg` 等若 Task 1 未覆盖）

**Interfaces:**
- Consumes: `tokens.css`
- Produces: `src/` 内无 `#64ffda` / `rgba(100, 255, 218`

- [ ] **Step 1: 列出待替换文件**

Run:

```bash
rg -l '#64ffda|rgba\(100,\s*255,\s*218' src/
```

- [ ] **Step 2: 替换映射（逐文件手工，禁止 sed 脚本）**

| 原值 | 新值 |
|------|------|
| `#64ffda` | `var(--color-primary)` |
| `#0a0e27`（作文字 on primary） | `var(--color-bg-base)` |
| `rgba(100, 255, 218, 0.1)` ~ `0.3` | `var(--color-primary-muted)` 或 `var(--color-border)` |
| `#e0e0e0` 正文 | `var(--color-text)` |
| `#0a0e27` / `#1a1f3a` 背景 | `var(--color-bg-base)` / `var(--color-bg-surface)` |

`BtJavaProjectsPanel.tsx` / `BtPhpSitesPanel.tsx` 内联 `color: "#64ffda"` → `var(--color-primary)` 或 Mantine `c="cyan"`。

- [ ] **Step 3: `ConfirmDialog.css` 示例**

```css
.confirm-dialog {
  border: 1px solid var(--color-border);
  background: var(--color-bg-surface);
  border-radius: var(--radius-md);
}
.confirm-dialog-btn--primary {
  background: var(--color-primary);
  color: var(--color-bg-base);
}
```

- [ ] **Step 4: 验证零残留**

Run:

```bash
rg '#64ffda|rgba\(100,\s*255,\s*218' src/ || echo "OK: clean"
```

- [ ] **Step 5: Commit**

```bash
git add src/styles src/components/*.css src/components/BtJavaProjectsPanel.tsx src/components/BtPhpSitesPanel.tsx
git commit -m "feat(ui): replace legacy teal hardcodes with design tokens"
```

---

### Task 7: 验收与文档

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-ui-shell-reskin-design.md`（状态 → 已实现）

- [ ] **Step 1: 类型检查**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 2: 手工冒烟（spec 清单）**

1. 侧栏：展开/收起、宝塔、OPS 裁剪  
2. 设置：7 Tab、保存、KS 环境、发布映射、关于  
3. 上传 + KS 发布：主色一致、无霓虹块  
4. ConfirmDialog、系统日志  

- [ ] **Step 3: 更新 spec 状态**

```markdown
**状态**: 已实现
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-30-ui-shell-reskin-design.md
git commit -m "docs: mark ui shell reskin spec as implemented"
```

---

## Spec Coverage（自检）

| Spec 要求 | Task |
|-----------|------|
| tokens.css + mantine.ts | 1 |
| 侧栏 Mantine + 行为不变量 | 3 |
| ConfigPanel Tabs + 表单 | 4, 5 |
| 不引入 AppShell | 2（明确跳过） |
| ConfirmDialog / 弹层 | 6 |
| 构建 Panel token 换色 | 6 |
| `#64ffda` 清零 | 6 |
| 手工冒烟 | 7 |

## Ponytail 删减说明

- **跳过 AppShell**：`.app` flex 已够用，换皮不必动 `App.tsx` 骨架。  
- **跳过 ConfigPanel 内 KsPublishMapEditor 表格 Mantine 化**：外层 Tabs 统一即可；`.ks-map-*` 留二期。  
- **跳过自动化 UI 测试**：spec 未要求；`tsc` + 手工冒烟足够。  
- **若侧栏 Mantine 重写超时**：可退化为 Task 2 + Task 6 仅 CSS token（视觉 80%），侧栏延到二期——仅在 Task 3 阻塞时启用。
