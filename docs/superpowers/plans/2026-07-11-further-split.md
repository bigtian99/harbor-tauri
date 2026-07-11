# 继续细拆 Implementation Plan

> **For agentic workers:** 按 Task 顺序实施；可 SDD 每任务一 agent。  
> **分支：** 仅在 `test` 上工作，**禁止**改 `dev` / 合入 `dev`。  
> **提交：** 在 `test` 上可小步 commit；**禁止** push 到 `dev`；push `test` 仅用户明确要求时。

**Goal:** 把仍过大的前后端模块再拆到「单文件可读」（目标线：UI/hook ≤400 行优先，命令文件 ≤350 行优先），行为与 Tauri/面板对外契约不变。

**Architecture:** 按域独立拆分，互不抢文件。前端对齐现有 `components/landing/*`、`hooks/useLanding` 模式；Rust 对齐 `build/`、`settlement/` 子模块 + re-export。

**Tech Stack:** React 19 + TS + Tauri 2 + Rust

## Global Constraints

- 工作分支：`test`（当前应已在 test）
- `dev` 保持稳定，不 merge、不在 dev 上改
- 对外：`App.tsx` import 路径、`BranchPanel`/`MergePanel` props、Tauri command 名与签名不变
- OPT-001/002 冻结（FTP/Harbor 密钥策略不改）
- Landing 不变量：`landing_temp_root` 单一真相源、预览只读
- 验收每任务：相关 `cargo test` / `pnpm test` / `tsc --noEmit` 绿
- 不引入新 UI 框架；不无故改业务逻辑

## 目标行数（方向性，非硬 KPI）

| 区域 | 目标 |
|------|------|
| `MergePanel.tsx` | 编排壳 ≤250；逻辑/UI 进 `components/merge/*` |
| `useBranchPack.ts` | 主 hook ≤350；加载/打包拆子 hook 或 `hooks/branch/*` |
| `BranchPanel.tsx` | ≤400；表单/结果/commit 弹层再拆 |
| `build/package.rs` | 步骤函数拆文件，command 文件变薄 |
| `build/push.rs` | login/push/cleanup helpers |
| `settlement/mod.rs` | 编排薄，重逻辑已在 parse/write/parallel |
| `landing/generate|templates` | 再分若仍 >450 |
| `LandingPreview.tsx` | 表/卡片子组件 |

---

### Task 1: 拆 MergePanel

**Files:**
- Create: `src/components/merge/*`（按实际结构：表单、diff/commit 列表、冲突详情、进度 overlay、纯函数可进 `merge/utils.ts`）
- Modify: `src/components/MergePanel.tsx` 变为薄壳
- 保持：App 仍 `import { MergePanel } from "./components/MergePanel"`

**验收：**
- [ ] `pnpm exec tsc --noEmit` 绿
- [ ] `pnpm test` 中 merge 相关脚本仍绿（`mergeBranchSelection`、`commitDiffModal` 等）
- [ ] MergePanel.tsx 明显变短

---

### Task 2: 拆 useBranchPack

**Files:**
- Create: 如 `src/hooks/branch/useBranchGitLoad.ts`、`useBranchPackageAction.ts`、`useBranchCommits.ts` 或单文件内多模块再 export；或 `src/hooks/branchPack/*`
- Modify: `src/hooks/useBranchPack.ts` 组合子模块；**UseBranchPackDeps 与 return shape 保持 App 兼容**

**验收：**
- [ ] tsc 绿
- [ ] `scripts/branchRepoSwitch.test.ts`、`branchSettings.test.ts` 绿
- [ ] 主文件 ≤400 行优先

---

### Task 3: 继续拆 BranchPanel UI

**Files:**
- Create: `src/components/branch/*` 增补（CommitListModal、PackageResult、RepoBranchForm 等）
- Modify: `BranchPanel.tsx`

**验收：** tsc + 相关 scripts 绿

---

### Task 4: 拆 build/package.rs 与 push.rs

**Files:**
- Create: e.g. `build/package_maven.rs` / 或 `package/steps.rs` — 以最小改动为原则
- 保持：`package_from_branch`、`build_and_push` 等仍从 `build/mod.rs` re-export

**验收：** `cargo test`、`cargo check` 绿

---

### Task 5: 拆 settlement/mod.rs 编排

**Files:** 将过长编排/类型移入子模块；`generate_settlement_statements` 对外不变

**验收：** `cargo test settlement` 绿

---

### Task 6: Landing 二次拆（generate/templates/LandingPreview）

**Files:** 按职责再切；FTP 常量仍冻结不改策略

**验收：** tsc + cargo check 绿

---

### Task 7: 全量回归 + backlog 备注

- [ ] `cargo test`、`pnpm test`、`tsc`
- [ ] 更新 `docs/superpowers/specs/2026-07-11-optimization-backlog-design.md` 备注「二次细拆」或新 notes
- [ ] 在 test 分支 commit（若用户未禁止）；**不 push 除非用户要求**

---

## 非目标

- 不改 Maven 参数/profile 产品能力
- 不统一 Mantine
- 不 merge 进 dev
