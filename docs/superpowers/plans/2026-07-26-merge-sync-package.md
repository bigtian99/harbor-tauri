# 合并后同步打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合并面板默认勾选「合并后同步打包」；合并成功后对目标分支自动走分支打包，目标分支名含 `rc-master` 时推 Harbor，否则只打包。

**Architecture:** 抽出纯函数判定推送；合并成功后经 App 回调同步分支页状态并调用可覆盖 `autoPushImage` 的共享打包入口；不改 Rust merge 命令。

**Tech Stack:** React 19 + TypeScript、现有 `branchPackageAction` / `useMergePanel`、Node test scripts。

## Global Constraints

- 默认同步打包：开
- Harbor：`targetBranch.includes("rc-master")`（字面、区分大小写）
- 打包参数：复用分支页记忆；`autoPush` 被规则覆盖
- UI：合并成功后切 `branch` tab
- 诊断：关键决策打 `git` / `build` 模块日志（沿用现有 tag）
- 不新增第三套 UI；合并面板继续现有 CSS（`merge.css`）

---

### Task 1: Harbor 推送判定纯函数 + 单测

**Files:**
- Create: `src/mergeSyncPackage.ts`
- Create: `scripts/mergeSyncPackage.test.ts`

**Interfaces:**
- Produces: `shouldPushHarborAfterMerge(targetBranch: string): boolean`
- Produces: `mergeSyncPackageConfirmHint(targetBranch: string): string`

- [ ] **Step 1: Write failing test**

```ts
// scripts/mergeSyncPackage.test.ts
import assert from "node:assert/strict";
import { shouldPushHarborAfterMerge, mergeSyncPackageConfirmHint } from "../src/mergeSyncPackage.ts";

assert.equal(shouldPushHarborAfterMerge("origin/rc-master"), true);
assert.equal(shouldPushHarborAfterMerge("feature/rc-master-hotfix"), true);
assert.equal(shouldPushHarborAfterMerge("origin/master"), false);
assert.equal(shouldPushHarborAfterMerge("origin/RC-Master"), false);
assert.match(mergeSyncPackageConfirmHint("origin/rc-master"), /Harbor/);
assert.match(mergeSyncPackageConfirmHint("origin/master"), /不推送/);
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `node --experimental-strip-types --test scripts/mergeSyncPackage.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/mergeSyncPackage.ts
export function shouldPushHarborAfterMerge(targetBranch: string): boolean {
  return targetBranch.includes("rc-master");
}

export function mergeSyncPackageConfirmHint(targetBranch: string): string {
  return shouldPushHarborAfterMerge(targetBranch)
    ? "合并成功后将打包目标分支并推送 Harbor"
    : "合并成功后将打包目标分支（不推送 Harbor）";
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `node --experimental-strip-types --test scripts/mergeSyncPackage.test.ts`

- [ ] **Step 5: Commit**（仅当用户要求提交时）

---

### Task 2: 分支打包支持覆盖参数

**Files:**
- Modify: `src/hooks/branch/branchPackageAction.ts`
- Modify: `src/hooks/useBranchPack.ts`

**Interfaces:**
- Consumes: existing `handlePackageFromBranch(deps)`
- Produces: `handlePackageFromBranch(deps, overrides?: { repoPath?: string; branchName?: string; autoPushImage?: boolean })`
- Produces: `useBranchPack` → `packageFromMergeTarget(repoPath: string, targetBranch: string): Promise<void>`

- [ ] **Step 1: 扩展 `handlePackageFromBranch`**

在 `branchPackageAction.ts` 的 `handlePackageFromBranch` 增加第二参数：

```ts
export type BranchPackageOverrides = {
  repoPath?: string;
  branchName?: string;
  autoPushImage?: boolean;
};

export async function handlePackageFromBranch(
  deps: BranchPackageActionDeps,
  overrides?: BranchPackageOverrides,
) {
  const repoPath = overrides?.repoPath ?? deps.repoPath;
  const branchName = overrides?.branchName ?? deps.branchName;
  const autoPushImage = overrides?.autoPushImage ?? deps.autoPushImage;
  // 后续逻辑全部改用上述三个局部变量，勿再读 deps.repoPath/branchName/autoPushImage
  ...
}
```

- [ ] **Step 2: `useBranchPack` 暴露编排方法**

```ts
async function packageFromMergeTarget(repoPath: string, targetBranch: string) {
  const autoPushImage = shouldPushHarborAfterMerge(targetBranch);
  setRepoPath(repoPath);
  setBranchName(targetBranch);
  setAutoPushImage(autoPushImage);
  restoreRememberedBranchAdvancedSettings(config, repoPath);
  // 若 config 记忆有 last_project_type 等且 last_repo 匹配，可同步类型（与 applyRememberedConfig 对齐的最小集）
  await runPackageFromBranch({
    // 现有 deps 绑定…
    repoPath,
    branchName: targetBranch,
    autoPushImage,
    // 其余字段仍来自 hook 当前 state（profile 等已 restore）
  }, { repoPath, branchName: targetBranch, autoPushImage });
}
```

注意：`setState` 异步，必须用 `overrides` 传入路径/分支/推送，不能依赖刚 set 的 state。

- [ ] **Step 3: 从 return 对象导出 `packageFromMergeTarget`**

- [ ] **Step 4: 手动类型检查**

Run: `pnpm exec tsc --noEmit`（或现有等价命令）

---

### Task 3: 合并面板勾选 + 成功回调

**Files:**
- Modify: `src/components/merge/types.ts`
- Modify: `src/components/merge/useMergePanel.ts`
- Modify: `src/components/merge/MergeFormSection.tsx`
- Modify: `src/components/MergePanel.tsx`

**Interfaces:**
- Consumes: `mergeSyncPackageConfirmHint`, `shouldPushHarborAfterMerge`
- Produces: `MergePanelProps.onPackageAfterMerge?: (args: { repoPath: string; targetBranch: string }) => void`
- Produces: state `packageAfterMerge` default `true`

- [ ] **Step 1: types**

```ts
export interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
  onPackageAfterMerge?: (args: { repoPath: string; targetBranch: string }) => void;
}
```

- [ ] **Step 2: useMergePanel**

- `const [packageAfterMerge, setPackageAfterMerge] = useState(true);`
- `handleMerge` 确认文案：若 `packageAfterMerge`，追加 `\n` + `mergeSyncPackageConfirmHint(targetBranch)`
- 成功分支：在 `setMergeOverlayPhase("success")` 之后，若 `packageAfterMerge`，调用  
  `onPackageAfterMerge?.({ repoPath: resolvedRepoPath, targetBranch })`  
  （在 auto-close timer 之前或同时；打包切 tab 后 overlay 可照常关闭）
- return 增加 `packageAfterMerge` / `setPackageAfterMerge`

- [ ] **Step 3: MergeFormSection 工具栏勾选**

与「合并后推送到远程」同风格：

```tsx
<label className="checkbox-label" style={{ marginLeft: 16 }}>
  <input type="checkbox" checked={packageAfterMerge} onChange={(e) => onPackageAfterMergeChange(e.target.checked)} />
  <span className="checkbox-toggle"></span>
  <span title="目标分支名含 rc-master 时打包并推 Harbor，否则只打包">合并后同步打包</span>
</label>
```

- [ ] **Step 4: MergePanel 透传 props**

---

### Task 4: App 接线

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: MergePanel 传入回调**

```tsx
<MergePanel
  config={app.config}
  onOpenDirectory={openArtifactPath}
  onPackageAfterMerge={({ repoPath, targetBranch }) => {
    void branch.packageFromMergeTarget(repoPath, targetBranch);
  }}
/>
```

- [ ] **Step 2: 确认 `branch` hook 已在 App 中创建且在 merge 渲染前可用**

- [ ] **Step 3: Run** `pnpm test` 与 `pnpm exec tsc --noEmit`

---

### Task 5: 冒烟核对（手动）

- [ ] 合并页默认勾选「合并后同步打包」
- [ ] 目标含 `rc-master`：确认框提示推 Harbor；成功后进分支页并推送
- [ ] 目标 `origin/master`：确认框提示不推送；成功后只打包
- [ ] 取消勾选：合并成功不打包

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| 默认勾选 | Task 3 |
| 成功后打包目标分支 | Task 2–4 |
| includes rc-master → Harbor | Task 1–2 |
| 否则只打包 | Task 1–2 |
| 记忆配置 | Task 2 restore |
| 切 branch tab | 现有 `handlePackageFromBranch` 已 `setActiveTab("branch")` |
| 失败不打包 | Task 3 仅 success 路径调用 |

## Placeholder scan

无 TBD / 空步骤。
