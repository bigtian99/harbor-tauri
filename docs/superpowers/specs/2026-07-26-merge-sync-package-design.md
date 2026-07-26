# 合并后同步打包设计

**日期**：2026-07-26  
**状态**：已批准并实现  
**范围**：分支合并面板增加「合并后同步打包」；合并成功后按目标分支规则自动走分支打包链路

---

## 1. 背景与目标

运营/发版流程常为：合并 PR 分支 → 目标分支再打包（Maven/npm）→ 视环境决定是否推 Harbor。  
当前合并与分支打包是两条独立链路，合并成功后需手动切到「分支打包」页操作。

**目标**：在合并面板提供默认勾选的「合并后同步打包」；合并成功后自动对**目标分支**执行打包，并按目标分支名决定是否推 Harbor。

---

## 2. 已确认需求

| 项 | 约定 |
|----|------|
| 勾选 | 「合并后同步打包」，**默认勾选** |
| 触发时机 | 仅 `merge_remote_branches` **成功**之后；失败或未勾选不打包 |
| 打包对象 | 合并的**目标分支**（非源分支） |
| 打包参数 | **复用**分支打包页对该仓库的记忆配置（项目类型、profile、端口、npm 脚本等）；无记忆则与进入分支页时的默认一致 |
| 推 Harbor | 目标分支名（字符串）**包含** `rc-master` → 打包并推 Harbor；否则 **只打包不推**（覆盖记忆中的「自动推送镜像」） |
| 进度 UI | 合并成功后切到「分支打包」页，复用现有进度条/日志/镜像结果展示 |

**不在范围**：后端把 merge 与 package 合成单一 Tauri 命令；合并页内嵌完整打包表单；改写 `package_from_branch` 核心算法。

---

## 3. 方案选择

采用 **抽出共享打包入口**（brainstorm 方案 3）：

1. 将分支打包执行逻辑整理为可带覆盖参数的调用入口（例如 `runBranchPackage` / 扩展现有 `handlePackageFromBranch` deps）。
2. 合并成功后由 `App` 接线：把仓库路径、目标分支、以及 `autoPush` 覆盖传入该入口。
3. 入口内切到 `branch` tab 并驱动现有 `package_from_branch` + 可选 Harbor 推送。

不采用「仅后端串联」：前端记忆配置与进度 UI 难复用。

---

## 4. 交互设计

### 4.1 合并工具栏

在现有「合并后推送到远程」「合并后打 tag」「预设分支」旁增加：

- Checkbox 文案：**合并后同步打包**
- 默认：`true`
- 辅助说明（title 或一行 muted 文案）：  
  `目标分支名含 rc-master 时打包并推 Harbor，否则只打包`

### 4.2 确认对话框

用户点「合并」时，若已勾选同步打包，确认文案追加一行，例如：

- 含 `rc-master`：`合并成功后将打包目标分支并推送 Harbor`
- 否则：`合并成功后将打包目标分支（不推送 Harbor）`

### 4.3 成功后流转

1. 合并进度 overlay 显示成功（可短暂停留，与现有 auto-close 行为一致）。  
2. 同步打包已勾选 → `setActiveTab("branch")` → 调用共享打包入口。  
3. 打包失败不影响「合并已成功」结论；错误写在分支页构建日志。

---

## 5. 技术设计

### 5.1 推送判定

```ts
function shouldPushHarborAfterMerge(targetBranch: string): boolean {
  return targetBranch.includes("rc-master");
}
```

- 大小写：按字面包含 `rc-master`（与用户选定的规则 B 一致，不做模糊大小写）。
- 例：`origin/rc-master`、`feature/rc-master-hotfix` 均为 true；`origin/master` 为 false。

### 5.2 共享打包入口

在 `src/hooks/branch/branchPackageAction.ts`（或同级新文件）提供可调用入口，支持至少：

| 覆盖项 | 说明 |
|--------|------|
| `repoPath` | 合并用的已解析仓库路径 |
| `branchName` | 目标分支全名 |
| `autoPushImage` | 由 `shouldPushHarborAfterMerge` 强制写入，不读 UI 勾选 |
| 其余 | 从当前 branch hook 状态 / `config` 记忆恢复（与手动打包相同） |

合并侧不重新实现 Maven/npm/worktree；只编排。

### 5.3 App 接线

- `MergePanel` / `useMergePanel`：增加 `packageAfterMerge` 状态（默认 true）与 UI。  
- `handleMerge` 成功后若勾选，调用 props：`onPackageAfterMerge({ repoPath, targetBranch })`。  
- `App.tsx`：实现回调 → 同步 branch 的 `repoPath`/`branchName`/`autoPushImage` → 调共享入口。

### 5.4 与「合并后推远程」的关系

- 先完成 merge（含可选 git push / tag），再打包。  
- 打包基于合并后的目标分支引用；若用户未勾选推远程，则打包本地已更新的目标分支引用（与现有 merge worktree 写回行为一致）。  
- **不要求**「同步打包」依赖「推送到远程」；两者独立。

### 5.5 诊断日志

- 合并模块：`diag_log("git" 或既有 merge 模块约定)` 记录是否勾选同步打包、目标分支、是否推 Harbor。  
- 打包仍走现有 `build` 模块日志。  
- 若仓库尚无独立 `merge` 模块名：沿用当前 merge 命令所在模块 tag，不在本需求中扩表造词（若现有已是 `git` 则继续用 `git`）。

---

## 6. 验收标准

1. 打开合并页，「合并后同步打包」默认已勾选。  
2. 目标 `origin/rc-master`（或任意含 `rc-master`）：合并成功 → 自动进入分支打包且推 Harbor。  
3. 目标 `origin/master`（不含 `rc-master`）：合并成功 → 自动打包且**不**推 Harbor。  
4. 取消勾选：合并成功后不触发打包。  
5. 合并失败：不触发打包。  
6. 有分支记忆的仓库：同步打包使用的 profile/类型等与手动在分支页对该仓库打包一致（除 autoPush 被规则覆盖外）。

---

## 7. 风险与非目标

| 风险 | 缓解 |
|------|------|
| 合并 overlay 与打包进度抢 UI | 成功后关闭/自动关闭 overlay，再切 branch tab |
| 记忆配置缺失导致类型猜错 | 与手动进分支页相同的默认；不在合并页另造一套 |
| 含 `rc-master` 的误匹配分支名 | 用户已选规则 B，文档与 title 写清楚 |

**非目标**：改 Harbor 登录逻辑；合并冲突自动解决；OPS 裁剪菜单变更。

---

## 8. 实现要点文件（预估）

| 文件 | 变更 |
|------|------|
| `src/components/merge/MergeFormSection.tsx` | 勾选 UI |
| `src/components/merge/useMergePanel.ts` | 状态、确认文案、成功回调 |
| `src/components/MergePanel.tsx` / `merge/types.ts` | props 透传 |
| `src/hooks/branch/branchPackageAction.ts` | 可覆盖参数的入口 |
| `src/hooks/useBranchPack.ts` | 暴露供 App 调用的编排方法 |
| `src/App.tsx` | `onPackageAfterMerge` 接线 |
| `scripts/` 或现有测试 | `shouldPushHarborAfterMerge` 单测 |

---

## 9. 决策记录

- 方案：共享打包入口 + 合并成功后编排（非后端串联）。  
- 默认同步打包：开。  
- Harbor：目标分支名 `includes("rc-master")`。  
- 参数：分支页记忆配置（选项 A）。  
