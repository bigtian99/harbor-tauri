# UI 全局外壳换肤与 Mantine 统一（第一期）

**日期**: 2026-08-30  
**状态**: 已实现（含二期 Panel Mantine 化、DiagnosticLogModal、ksPublish 模块拆分）  
**范围**: 侧栏、设置页、全局 Design Token、Mantine Theme、ConfirmDialog 视觉对齐  
**参考**: `main.tsx`、`Sidebar.tsx`、`ConfigPanel.tsx`、`App.css` / `styles/base.css`、`styles/config.css`、OPT-018 双轨约定

## 背景

JarPorter（ShipForge）前端存在 **Mantine 9 + 手写 CSS** 双轨：运营/KubeSphere 面板用 Mantine，构建推送类面板用 `App.css` 体系。视觉为霓虹 teal（`#64ffda`）+ 玻璃拟态侧栏 + 径向渐变背景，各 Tab 风格分裂；`ConfigPanel`（952 行）与 `Sidebar` 仍为纯 CSS，与 `KsPublishPanel` 等 Mantine 面板不协调。

用户目标（已确认）：

| 维度 | 决策 |
|------|------|
| 总体目标 | **D**：视觉统一 + 好维护 + 体验升级，分多期 |
| 第一期范围 | **D**：全局外壳（侧栏、设置、换肤） |
| 视觉力度 | **C**：明显换肤，仍暗色，不引入新 UI 库 |
| 主色 | 由设计方定：**Zinc 暗底 + Cyan 强调**（见下） |

## 配色规范（单一真相源）

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-primary` | `#06b6d4` | 主按钮、激活态、链接、进度条 |
| `--color-primary-hover` | `#22d3ee` | hover / focus ring |
| `--color-primary-muted` | `rgba(6, 182, 212, 0.15)` | 激活背景、选中行浅底 |
| `--color-bg-base` | `#09090b` | 页面底、Mantine `dark[7]` |
| `--color-bg-surface` | `#18181b` | 侧栏、卡片、Modal |
| `--color-bg-elevated` | `#27272a` | hover、输入框底、表格斑马可选 |
| `--color-border` | `rgba(255, 255, 255, 0.08)` | 分割线、输入框边框 |
| `--color-text` | `#fafafa` | 主文字 |
| `--color-text-muted` | `#a1a1aa` | 辅助说明 |
| `--color-success` | `#10b981` | 构建成功、保存成功 |
| `--color-warning` | `#f59e0b` | 警告通知 |
| `--color-error` | `#ef4444` | 错误、校验失败 |
| `--radius-md` | `8px` | 按钮、卡片、输入框（Mantine `radius="md"`） |
| `--font-size-base` | `14px` | 正文 |
| `--font-size-sm` | `12px` | 辅助、表格 meta |

**移除或弱化**：

- `body::before` 浮动光斑动画（可删或改为静态极弱纹理）
- 径向渐变大面积背景 → 纯色 `--color-bg-base`
- 侧栏 `backdrop-filter: blur` → 实色 `--color-bg-surface`
- 全局霓虹 teal 硬编码（`#64ffda`、`rgba(100, 255, 218, …)`）→ 改为 token / Mantine `cyan` 色阶

## 目标（第一期）

1. **Design Token 中枢**：`src/theme/tokens.css` 定义 CSS 变量；`src/theme/mantine.ts` 的 `createTheme` 与 token 对齐（`primaryColor: "cyan"`，自定义 `dark` 色阶映射 zinc）。
2. **侧栏 Mantine 化**：`Sidebar.tsx` 使用 Mantine 组件（`NavLink`、`Collapse`、`Tooltip`、`ActionIcon`），保留：折叠、宝塔子菜单（展开/收起 + 收起态 flyout）、OPS 菜单裁剪、`系统日志` + `设置` 底栏。
3. **设置页外壳统一**：`ConfigPanel` 顶栏子 Tab 改为 Mantine `Tabs`；各子页表单控件（`TextInput`、`PasswordInput`、`Select`、`Checkbox`、`Button` 等）换 Mantine，**props 接口与保存逻辑不变**。
4. **布局骨架**：`App.tsx` 的 `.app` / `.content` 可改为 Mantine `AppShell`（`Navbar` + `Main`），或保留 flex 结构但 class 消费 token——以实现时改动最小为准。
5. **连带对齐**：`ConfirmDialog`、`UpdateModal` 等全局弹层颜色/圆角跟 token；`main.tsx` 仅引用 `theme/mantine.ts`。
6. **构建类 Panel 被动受益**：`upload.css`、`branch.css` 等中硬编码 teal 改为 `var(--color-primary*)`，**本期不迁 Mantine 组件、不改 Panel 结构**。

## 非目标（第一期）

- `KsPublishPanel` 拆分或大规模重构（2685 行，二期）
- Upload / Push / Branch / History 迁 Mantine 组件（二期，仅吃 token）
- 引入 Tailwind、Ant Design、shadcn 等第三套 UI（违反 OPT-018）
- 亮色主题、响应式移动端布局
- 改应用名 ShipForge / 换 Logo 资产
- 动效系统（页面过渡、微交互库）

## 方案（已选：Design Token 中枢）

| 方案 | 说明 | 结论 |
|------|------|------|
| 1. Token 中枢 + 侧栏/设置 Mantine 化 | token 同源；外壳迁 Mantine；业务 Panel 暂不动 | **采用** |
| 2. 仅 CSS 换皮 | 保留 HTML，改 `base.css` | 否，维护性不足 |
| 3. AppShell 全量重写 | 所有布局一次 Mantine 化 | 否，风险与工期过高 |

## 架构

```
main.tsx
  ├── import "./theme/tokens.css"
  ├── import theme from "./theme/mantine.ts"
  └── MantineProvider(theme)

App.tsx
  └── AppShell | .app（flex）
        ├── Sidebar（Mantine NavLink + Collapse）
        └── main.content
              ├── ConfigPanel（Mantine Tabs + 表单）
              └── 其他 Panel（CSS，引用 token）

theme/
  ├── tokens.css      # :root CSS 变量
  └── mantine.ts      # createTheme，primaryColor cyan，dark 映射 zinc
```

### Sidebar 行为不变量

| 行为 | 要求 |
|------|------|
| `sidebarCollapsed` | 继续由 `App` state 控制；宽度展开 220px / 收起 56px |
| OPS 模式 | `isOpsTab` 过滤菜单项；隐藏宝塔分组、设置等逻辑不变 |
| 宝塔分组 | 展开子项 Java/PHP；收起态点击弹出 flyout |
| 激活态 | `activeTab` 高亮；宝塔父项在子项激活时高亮 |
| 系统日志 | `onOpenLog` 回调不变 |
| Tooltip | 收起态显示 `data-label` 等价文案 |

### ConfigPanel 不变量

| 项 | 要求 |
|----|------|
| `ConfigPanelProps` | 不增删必填字段 |
| 子 Tab | `connection` / `jar` / `frontend` / `bt` / `output` / `ks` / `about` 保留 |
| `initialSubTab` | 外部跳转（如 Maven 配置）仍生效 |
| `KsPublishMapEditor` | 嵌入 `ks` 子页，本期可仅套 Mantine 外层，内部表格 CSS 可渐进 |
| Tauri `open` 选目录、密码显隐、`save_config` | 逻辑不变 |

## 文件变更清单（预估）

| 文件 | 变更 |
|------|------|
| `src/theme/tokens.css` | 新建 |
| `src/theme/mantine.ts` | 新建（从 `main.tsx` 抽出 theme） |
| `src/main.tsx` | 引用 theme 模块 + tokens |
| `src/components/Sidebar.tsx` | Mantine 重写 UI |
| `src/components/ConfigPanel.tsx` | Tabs + 表单 Mantine 化 |
| `src/styles/base.css` | 删侧栏重复样式；`:root` 改引 token；弱化背景动画 |
| `src/styles/config.css` | 能删则删，与 Mantine 重复部分收敛 |
| `src/components/ConfirmDialog.css` | token 对齐 |
| `src/App.tsx` | 可选 AppShell；`content` 区样式微调 |
| `src/styles/upload.css` 等 | 硬编码 `#64ffda` → `var(--color-primary)` |

## 数据流

无后端变更。无新增 Tauri command。`HarborConfig` 结构不变。

## 错误处理

- Mantine 表单校验：沿用现有「保存时校验」逻辑，不新增阻塞式校验框架
- 非 Tauri 环境：`isTauriRuntime()` 守卫不变

## 测试与验收

### 手工冒烟（发版前）

1. **侧栏**：展开/收起；各 Tab 切换；宝塔展开与 flyout；OPS 构建下菜单裁剪正确
2. **设置**：七个子 Tab 可切换；Harbor 保存；密码显隐；KS 环境增删改；发布映射编辑；关于页检查更新
3. **视觉**：侧栏、设置、任意 Mantine Panel（如 KS 发布）、任意 CSS Panel（如上传）主色一致，无残留霓虹 teal 块
4. **回归**：从分支页跳转到配置 Maven 子 Tab；系统日志打开；ConfirmDialog 二次确认样式正常

### 自动化（可选，本期不强制）

- 无新增单元测试要求；若改 `activeTabStorage` 等 util 则跑现有 `pnpm test`

## 分期路线图

| 期 | 内容 |
|----|------|
| **一（本期）** | Token + 侧栏 + ConfigPanel + 全局弹层 + CSS 硬编码替换 |
| 二 | Upload / Push / Branch / History 迁 Mantine 组件 |
| 三 | `KsPublishPanel` 拆分子组件 + 减 `.ks-*` CSS |
| 四 | 批量操作 UX、表格密度、可选微动效 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| ConfigPanel  diff 大、易漏字段 | 按子 Tab 逐段替换；每段冒烟保存 |
| Mantine 与遗留 CSS 特异性冲突 | token 优先；Panel 专用 class 保留但改色值 |
| KS `.ks-*` 覆盖失效 | `base.css` 中 `.ks-publish-panel` 选择器改引 token，不删布局规则 |
| AppShell 改动牵动全局 | 若 flex 已够用，仅换 Sidebar 内部实现，App 骨架最小 diff |

## 成功标准

- 用户切换任意 Tab，感知为同一套暗色 Cyan 工具，而非两套产品拼接
- 侧栏与设置页无功能回归
- `CLAUDE.md` OPT-018 仍成立：仅 Mantine + CSS 双轨，无第三库
- 硬编码 `#64ffda` 在 `src/` 中降至 0（或仅注释/文档提及）
