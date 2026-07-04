# Branch Image Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分支打包联动推送后，把前端镜像和后端镜像分成独立行展示，并让每行复制按钮只复制对应镜像地址。

**Architecture:** 新增一个轻量的前端纯函数模块 `src/branchImageResults.ts`，统一描述分支镜像展示项和按钮文案。`App.tsx` 负责在推送成功后维护结构化数组，`BranchPanel.tsx` 只负责渲染每一行并把对应 `image` 传给现有 `onCopyImage`。

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, Node 内置 `assert`，项目现有 esbuild 二进制用于临时运行 TypeScript 测试。

---

## File Structure

- Create: `src/branchImageResults.ts`
  - 负责 `BranchImageRole`、`BranchImageResult` 类型，以及根据角色生成展示标签和复制按钮文案。
- Create: `src/branchImageResults.test.ts`
  - 使用 Node 内置 `assert` 验证前端/后端展示项和复制文案生成。
- Modify: `src/App.tsx`
  - 新增 `branchImageResults` 状态。
  - 新一轮分支打包开始时清空该状态。
  - Maven、npm 前端、npm 后端推送成功后分别写入结构化展示项。
  - 向 `BranchPanel` 传入 `branchImageResults`。
- Modify: `src/components/BranchPanel.tsx`
  - 接收 `branchImageResults`。
  - 优先按结构化数组渲染镜像行。
  - 每行复制按钮调用 `onCopyImage(item.image)`。

---

### Task 1: 新增镜像展示纯函数和失败测试

**Files:**
- Create: `src/branchImageResults.test.ts`
- Create: `src/branchImageResults.ts`

- [ ] **Step 1: Write the failing test**

Create `src/branchImageResults.test.ts`:

```ts
import assert from "node:assert/strict";
import { createBranchImageResult, getBranchImageCopyLabel } from "./branchImageResults";

const frontend = createBranchImageResult("frontend", "dockerhub.kubekey.local/proj/app-fe:tag");
const backend = createBranchImageResult("backend", "dockerhub.kubekey.local/proj/app-be:tag");

assert.deepEqual(frontend, {
  role: "frontend",
  label: "前端镜像",
  copyLabel: "复制前端",
  image: "dockerhub.kubekey.local/proj/app-fe:tag",
});

assert.deepEqual(backend, {
  role: "backend",
  label: "后端镜像",
  copyLabel: "复制后端",
  image: "dockerhub.kubekey.local/proj/app-be:tag",
});

assert.equal(getBranchImageCopyLabel("frontend"), "复制前端");
assert.equal(getBranchImageCopyLabel("backend"), "复制后端");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/esbuild src/branchImageResults.test.ts --bundle --platform=node --format=esm --outfile=/tmp/branch-image-results.test.mjs && node /tmp/branch-image-results.test.mjs
```

Expected: FAIL because `src/branchImageResults.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/branchImageResults.ts`:

```ts
export type BranchImageRole = "frontend" | "backend";

export interface BranchImageResult {
  role: BranchImageRole;
  label: string;
  copyLabel: string;
  image: string;
}

export function getBranchImageLabel(role: BranchImageRole) {
  return role === "frontend" ? "前端镜像" : "后端镜像";
}

export function getBranchImageCopyLabel(role: BranchImageRole) {
  return role === "frontend" ? "复制前端" : "复制后端";
}

export function createBranchImageResult(role: BranchImageRole, image: string): BranchImageResult {
  return {
    role,
    label: getBranchImageLabel(role),
    copyLabel: getBranchImageCopyLabel(role),
    image,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
./node_modules/.bin/esbuild src/branchImageResults.test.ts --bundle --platform=node --format=esm --outfile=/tmp/branch-image-results.test.mjs && node /tmp/branch-image-results.test.mjs
```

Expected: PASS with no assertion output.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/branchImageResults.ts src/branchImageResults.test.ts
git commit -m "test: cover branch image result labels"
```

---

### Task 2: 接线分支镜像结构化状态

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/BranchPanel.tsx`

- [ ] **Step 1: Write the failing type-level integration change**

Modify `src/components/BranchPanel.tsx` props to require `branchImageResults`:

```ts
import type { BranchImageResult } from "../branchImageResults";
```

Add to `BranchPanelProps`:

```ts
  branchImageResults: BranchImageResult[];
```

Add to destructuring:

```ts
  branchImageResults,
```

- [ ] **Step 2: Run build to verify it fails**

Run:

```bash
npm run build
```

Expected: FAIL because `App.tsx` does not pass required `branchImageResults`.

- [ ] **Step 3: Write minimal implementation in `App.tsx`**

Add imports:

```ts
import type { BranchImageResult } from "./branchImageResults";
import { createBranchImageResult } from "./branchImageResults";
```

Add state near `branchFullImage`:

```ts
  const [branchImageResults, setBranchImageResults] = useState<BranchImageResult[]>([]);
```

Clear it at the start of `handlePackageFromBranch`:

```ts
    setBranchFullImage("");
    setBranchImageResults([]);
```

After Maven image match:

```ts
                  const image = imgMatch[1].trim();
                  imageList.push(image);
                  setBranchImageResults([createBranchImageResult("backend", image)]);
```

After npm frontend image match:

```ts
                  const image = feMatch[1].trim();
                  imageList.push(`前端: ${image}`);
                  setBranchImageResults([createBranchImageResult("frontend", image)]);
```

After npm backend image match:

```ts
                    const image = beMatch[1].trim();
                    imageList.push(`后端: ${image}`);
                    setBranchImageResults((prev) => [...prev, createBranchImageResult("backend", image)]);
```

Pass prop to `BranchPanel`:

```tsx
            branchImageResults={branchImageResults}
```

- [ ] **Step 4: Run build to verify it passes**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/App.tsx src/components/BranchPanel.tsx
git commit -m "feat: track branch image results separately"
```

---

### Task 3: 渲染独立镜像行和独立复制按钮

**Files:**
- Modify: `src/components/BranchPanel.tsx`

- [ ] **Step 1: Confirm the current covered behavior**

Run:

```bash
./node_modules/.bin/esbuild src/branchImageResults.test.ts --bundle --platform=node --format=esm --outfile=/tmp/branch-image-results.test.mjs && node /tmp/branch-image-results.test.mjs
```

Expected: PASS, confirming the pure data model already covered by Task 1 still produces separate frontend/backend copy labels and pure image values before the UI is rewired.

- [ ] **Step 2: Implement structured rendering**

Replace the `branchFullImage` image row block with:

```tsx
          {branchImageResults.length > 0 && (
            <>
              {branchImageResults.map((item) => (
                <div key={`${item.role}-${item.image}`} className="path-link-item image-url-row">
                  <span className="path-link-label">🐳 {item.label}:</span>
                  <span className="image-url-value">
                    <span style={{ display: 'block' }} title={item.image}>{item.image}</span>
                  </span>
                  <button
                    className={`copy-btn ${copied ? "copied" : ""}`}
                    onClick={() => onCopyImage(item.image)}
                    title={item.copyLabel}
                  >
                    {copied ? (
                      <>
                        <CheckCircle size={14} /> 已复制
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> {item.copyLabel}
                      </>
                    )}
                  </button>
                </div>
              ))}
            </>
          )}
```

- [ ] **Step 3: Run build to verify it passes**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run pure function test again**

Run:

```bash
./node_modules/.bin/esbuild src/branchImageResults.test.ts --bundle --platform=node --format=esm --outfile=/tmp/branch-image-results.test.mjs && node /tmp/branch-image-results.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/BranchPanel.tsx
git commit -m "feat: render branch image copy actions separately"
```

---

### Task 4: Final Verification

**Files:**
- Read: `src/App.tsx`
- Read: `src/components/BranchPanel.tsx`
- Read: `src/branchImageResults.ts`

- [ ] **Step 1: Run final frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run branch image result test**

Run:

```bash
./node_modules/.bin/esbuild src/branchImageResults.test.ts --bundle --platform=node --format=esm --outfile=/tmp/branch-image-results.test.mjs && node /tmp/branch-image-results.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff --stat HEAD
git diff HEAD -- src/App.tsx src/components/BranchPanel.tsx src/branchImageResults.ts src/branchImageResults.test.ts
```

Expected: Diff only covers branch image result state, rendering, and tests.

- [ ] **Step 4: Commit remaining verification changes if any**

Run:

```bash
git status --short
```

Expected: No uncommitted implementation changes after prior commits. If there are intentional changes, commit them with:

```bash
git add src/App.tsx src/components/BranchPanel.tsx src/branchImageResults.ts src/branchImageResults.test.ts
git commit -m "chore: verify branch image copy flow"
```
