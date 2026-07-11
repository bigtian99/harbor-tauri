# 合理最细粒度拆分规格

**日期**: 2026-07-11  
**状态**: 已确认结构  
**分支策略**: 仅在 `test` 实施与验证；**不**改动/合入 `dev`  
**提交策略**: 不擅自 commit/push；用户明确要求后再提交  

---

## 1. 背景与目标

上一轮优化 backlog 已完成目录级拆分（build/landing/settlement/utils、App hooks、Landing/CSS、Merge 初拆等）。`test` 上仍有一批 **300–650 行** 文件，继续「为拆而拆」到 ≤200 会文件爆炸；本规格定义 **合理最细** 标准并划定本轮范围。

**目标**: 把仍「多职责 + 难 diff」的编排文件拆到可单文件阅读的粒度，行为与对外契约不变，便于在 `test` 验收。

---

## 2. 粒度标准（已确认）

| 类型 | 目标行数 | 说明 |
|------|----------|------|
| 面板 / hooks / 表单编排 | **≤300** | 优先达标 |
| 职责已单一的领域模块 | **可至 ~450** | 再切收益低则保留 |
| 硬触发 | **>400 且多职责** | 本轮必拆 |

**非目标粒度**: 全仓硬 ≤200（拒绝）。

---

## 3. 范围

### 3.1 本轮会动

| 优先级 | 路径（约行，扫描时） | 方向 |
|--------|----------------------|------|
| P0 | `src/components/BranchPanel.tsx` (~658) | 壳 + `branch/RepoBranchForm`、`PackageResultSection`、`CommitListModal` 等 |
| P0 | `src/hooks/useBranchPack.ts` (~416) + `src/hooks/branch/branchPackageAction.ts` (~392) | 组合壳 ≤300；打包/推送步骤再拆纯函数或子模块 |
| P1 | `src/components/merge/MergeFormSection.tsx` (~403) | 仓库区 / 检查结果 / 操作区分组件 |
| P1 | `src-tauri/src/build/push.rs` (~303) | 步骤进 helpers / `push_flow`，command 变薄 |
| P1 | `src-tauri/src/settlement/write.rs` (~425)、`settlement/mod.rs` (~400) | 写表与编排再分；command 签名不变 |
| P2 | `landing` 侧仍混杂的 preview/template 管理（若仍多职责） | 按表/卡片/管理再切 |
| P2 | 可选：`HistoryPanel` / `ConfigPanel` / `useAppConfig` / `useUploadPush` 仅当仍明显两坨 | 非必须 |

### 3.2 本轮白名单（不动）

- `src-tauri/src/updater.rs`
- `src-tauri/src/git.rs`
- `src-tauri/src/diag.rs`
- `src-tauri/src/landing/ftp.rs`（OPT-001 冻结，凭证策略不改）
- `src-tauri/src/models.rs`
- 已 <250 行且职责清晰的碎文件

### 3.3 全局约束

- 应用根：`jar-to-harbor/`
- **分支**: `test` only；**禁止** merge 进 `dev`、禁止在 `dev` 上改
- **对外契约不变**: `App.tsx` 对 Panel/hook 的 import 路径与主要 props/return shape；Tauri command 名与签名
- Landing 不变量：`landing_temp_root` 单一真相源、预览只读、127.0.0.1
- UI 双轨：不引入第三套 UI 体系
- OPT-001 / OPT-002 仍 frozen
- 验收：`cargo test`、`pnpm test`、`pnpm exec tsc --noEmit` 全绿
- 提交：仅用户要求时 commit；push `origin/test` 仅用户要求时

---

## 4. 前端设计

### 4.1 BranchPanel

- `BranchPanel.tsx`：只编排 props → 子组件
- 建议子模块（名称可微调）：
  - `branch/RepoBranchForm.tsx` — 路径、分支、项目类型
  - `branch/PackageResultSection.tsx` — 产物/镜像结果行
  - `branch/CommitListModal.tsx` — 提交列表弹层（若仍内联）
  - 已有 `SpringProfileSection`、`BranchAdvancedSettings` 保留

### 4.2 useBranchPack

- 保持 `export function useBranchPack` 与 `UseBranchPackDeps` / return 与 App 兼容
- 保留竞态：`branchLoadRequestRef` / `isStaleBranchLoad`
- `branchPackageAction.ts` 过厚时拆为：
  - 设置记忆写入
  - `package_from_branch` 调用与结果处理
  - 自动推送镜像（若内联）

### 4.3 MergeFormSection

- 拆为表单字段区、检查结果展示、主操作按钮区；`MergePanel` 壳与其它 merge/* 不回归

---

## 5. 后端设计

### 5.1 build/push

- `build_and_push` / `push_local_image` 仍由 `build/mod.rs` re-export
- 公共步骤（tag、login、push、rmi、progress）进 `push_helpers` 或 `push_flow`
- `emit_progress(app, percent, message, stage)` 签名保持

### 5.2 settlement

- `generate_settlement_statements` 对外不变
- `write.rs` 可拆 sheet 写入 / 金额格式 / 样式 helper
- `mod.rs` 以 re-export + 薄编排为目标

### 5.3 landing（P2）

- 仅多职责文件再切；**不**动 FTP 常量策略

---

## 6. 实施顺序

1. Wave1：BranchPanel + useBranchPack/packageAction  
2. Wave2：MergeFormSection  
3. Wave3：push + settlement write/mod  
4. Wave4：landing 可选 + 全量回归 + 行数快照写入 notes  

可并行时：Wave1 前端与 Wave3 后端不抢路径可并行 agent。

---

## 7. 验收清单

- [ ] 本轮「会动」列表中 P0/P1 达到 §2 标准或有文档说明「单一职责保留 >300」
- [ ] 白名单文件无业务改动
- [ ] `cargo test` 全绿  
- [ ] `pnpm test` 全绿  
- [ ] `tsc --noEmit` 全绿  
- [ ] 未合入 `dev`  
- [ ] 冒烟建议：分支打包、合并检查、推送、结算（`docs/smoke-checklist.md`）

---

## 8. 非目标

- 全文件 ≤200  
- 拆 `updater`/`git`/`diag`/`ftp`/`models`  
- 密钥迁移（001/002）  
- 产品功能变更  
- 自动 merge/push `dev`

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-11 | 初版：合理最细（编排 ≤300 + 白名单）；用户确认「可以」 |
