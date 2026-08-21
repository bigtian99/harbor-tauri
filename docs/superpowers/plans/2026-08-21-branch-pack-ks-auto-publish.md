# 分支打包后按 Git 地址自动发布到 KubeSphere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分支打包推送 Harbor 成功后，按「Git 远程地址 + 镜像角色」映射表自动调用 `ks_update_image`，并写入打包日志与系统诊断日志。

**Architecture:** 纯函数做 URL 规范化与查表；新增轻量 `get_git_remote_url` 读 origin；推送成功后由前端 `branchPackageAction` 编排 `ks_connect` → 解析容器 → `ks_update_image`。映射存 `HarborConfig.ks_publish_maps`，设置页 CRUD。发布失败不否掉推送成功。

**Tech Stack:** React / TypeScript / Tauri 2 invoke / 现有 `ks_*` commands / `node:test` scripts / `diag` via `write_diagnostic_log`

**Spec:** `docs/superpowers/specs/2026-08-21-branch-pack-ks-auto-publish-design.md`

## Global Constraints

- 匹配键：规范化 Git remote URL + 角色 `frontend` | `backend` | `any`（精确角色优先于 `any`）
- 未映射 / 发布失败：**不阻断**推送成功
- 日志：`write_diagnostic_log` 模块 `build` 与 `kubesphere`；打包页 `setLog` 追加人读摘要
- 不写 password；不新增「推送+发布」巨型 Rust API
- `container` 为空时取部署 `containers[0]`，拿不到则 skip
- Maven 单 JAR 产物角色视为 `backend`

## File map

| File | Role |
|------|------|
| `src/utils/ksPublishMap.ts` | `normalizeGitUrl` / `lookupKsPublishMap` / 类型辅助 |
| `scripts/ksPublishMap.test.ts` | 规范化与查表单测 |
| `src/types.ts` | `KsPublishMap` + `HarborConfig.ks_publish_maps` + `last_auto_publish_ks` |
| `src-tauri/src/models.rs` | 同名字段 Default / serde |
| `src-tauri/src/git.rs` + `lib.rs` | `get_git_remote_url(repo_path, remote?)` |
| `src/utils/ksAutoPublish.ts` | 推送后发布循环（connect / container / update / 日志） |
| `src/hooks/branch/branchPackageAction.ts` | Maven/npm 推送成功后调用 |
| `src/hooks/useBranchPack.ts` / `BranchPanel.tsx` / `App.tsx` | 开关状态与记忆 |
| `src/hooks/useAppConfig.ts` | 默认配置 |
| `src/components/ConfigPanel.tsx` | 映射 CRUD UI |
| `docs/kubesphere-publish.md` | 一小节文档 |

---

### Task 1: Git URL 规范化 + 查表纯函数（TDD）

**Files:**
- Create: `src/utils/ksPublishMap.ts`
- Create: `scripts/ksPublishMap.test.ts`
- Modify: `src/types.ts`（仅加 `KsPublishMap` / `KsPublishMapRole` 类型，供测试 import）

**Interfaces:**
- Produces:
  - `export type KsPublishMapRole = "frontend" | "backend" | "any"`
  - `export interface KsPublishMap { id: string; git_url: string; git_url_key: string; role: KsPublishMapRole; env_id: string; namespace: string; deployment: string; container?: string }`
  - `normalizeGitUrl(url: string): string`
  - `lookupKsPublishMap(maps: KsPublishMap[], gitUrlKey: string, imageRole: "frontend" | "backend"): KsPublishMap | null`
  - `createKsPublishMap(partial: Omit<KsPublishMap, "id" | "git_url_key"> & { id?: string }): KsPublishMap`（内部算 `git_url_key`）

- [ ] **Step 1: Write the failing test**

```ts
// scripts/ksPublishMap.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGitUrl,
  lookupKsPublishMap,
  createKsPublishMap,
} from "../src/utils/ksPublishMap.ts";
import type { KsPublishMap } from "../src/types.ts";

test("normalizeGitUrl unifies ssh/https and strips .git", () => {
  assert.equal(
    normalizeGitUrl("git@gitlab.example.com:group/app.git"),
    "gitlab.example.com/group/app",
  );
  assert.equal(
    normalizeGitUrl("https://gitlab.example.com/group/app"),
    "gitlab.example.com/group/app",
  );
  assert.equal(
    normalizeGitUrl("https://user@gitlab.example.com/group/app.git/"),
    "gitlab.example.com/group/app",
  );
});

test("lookup prefers exact role over any", () => {
  const maps: KsPublishMap[] = [
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "any",
      env_id: "e1",
      namespace: "ns",
      deployment: "any-dep",
    }),
    createKsPublishMap({
      git_url: "git@h:g/a.git",
      role: "backend",
      env_id: "e1",
      namespace: "ns",
      deployment: "api",
    }),
  ];
  const key = normalizeGitUrl("https://h/g/a");
  assert.equal(lookupKsPublishMap(maps, key, "backend")?.deployment, "api");
  assert.equal(lookupKsPublishMap(maps, key, "frontend")?.deployment, "any-dep");
  assert.equal(lookupKsPublishMap(maps, "other", "backend"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test scripts/ksPublishMap.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

在 `src/types.ts` 增加：

```ts
export type KsPublishMapRole = "frontend" | "backend" | "any";

export interface KsPublishMap {
  id: string;
  git_url: string;
  git_url_key: string;
  role: KsPublishMapRole;
  env_id: string;
  namespace: string;
  deployment: string;
  container?: string;
}
```

在 `src/utils/ksPublishMap.ts` 实现 `normalizeGitUrl`（按 spec 五步）、`createKsPublishMap`（`id` 默认 `ks-map-${Date.now().toString(36)}-...`，`git_url_key = normalizeGitUrl(git_url)`）、`lookupKsPublishMap`（先筛 `git_url_key`，再精确 role，再 `any`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test scripts/ksPublishMap.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/utils/ksPublishMap.ts scripts/ksPublishMap.test.ts
git commit -m "feat(ks): Git URL 规范化与发布映射查表"
```

---

### Task 2: 配置字段（TS + Rust）

**Files:**
- Modify: `src/types.ts` — `HarborConfig.ks_publish_maps?`、`last_auto_publish_ks?: boolean`
- Modify: `src/hooks/useAppConfig.ts` — `createDefaultHarborConfig`
- Modify: `src-tauri/src/models.rs` — `HarborConfig` 字段 + `Default` + `KsPublishMap` struct

**Interfaces:**
- Consumes: `KsPublishMap` from Task 1
- Produces: 配置读写兼容缺省（`#[serde(default)]` / TS optional → 默认 `[]` / `false`）

- [ ] **Step 1: Extend HarborConfig in TS**

```ts
// HarborConfig 内追加
ks_publish_maps?: KsPublishMap[];
last_auto_publish_ks?: boolean;
```

`createDefaultHarborConfig`：

```ts
ks_publish_maps: [],
last_auto_publish_ks: false,
```

- [ ] **Step 2: Mirror in Rust models.rs**

```rust
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct KsPublishMap {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub git_url: String,
    #[serde(default)]
    pub git_url_key: String,
    #[serde(default)]
    pub role: String, // frontend | backend | any
    #[serde(default)]
    pub env_id: String,
    #[serde(default)]
    pub namespace: String,
    #[serde(default)]
    pub deployment: String,
    #[serde(default)]
    pub container: String,
}

// HarborConfig:
#[serde(default)]
pub ks_publish_maps: Vec<KsPublishMap>,
#[serde(default)]
pub last_auto_publish_ks: bool,
```

Default 实现里 `ks_publish_maps: Vec::new()`, `last_auto_publish_ks: false`。

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` 与 `cd src-tauri && cargo check`  
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/hooks/useAppConfig.ts src-tauri/src/models.rs
git commit -m "feat(config): ks_publish_maps 与自动发布开关字段"
```

---

### Task 3: `get_git_remote_url` 命令

**Files:**
- Modify: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/lib.rs`（注册 command）

**Interfaces:**
- Produces: `#[tauri::command] pub async fn get_git_remote_url(repo_path: String, remote: Option<String>) -> Result<String, String>`
- 行为：`git remote get-url {remote.unwrap_or("origin")}`，trim，空则 Err

- [ ] **Step 1: Implement command in git.rs**

```rust
#[tauri::command]
pub async fn get_git_remote_url(
    repo_path: String,
    remote: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = resolve_repo_root(&repo_path)?;
        let name = remote.unwrap_or_else(|| "origin".to_string());
        let name = name.trim();
        if name.is_empty() {
            return Err("remote 名为空".to_string());
        }
        let url = crate::utils::git_output(&repo_root, &["remote", "get-url", name])?;
        let url = url.trim().to_string();
        if url.is_empty() {
            return Err(format!("remote `{name}` URL 为空"));
        }
        crate::diag::diag_log(
            "git",
            &format!("get_git_remote_url repo={} remote={} ok", repo_root.display(), name),
        );
        Ok(url)
    })
    .await
    .map_err(|e| format!("读取 remote 线程异常: {e}"))?
}
```

- [ ] **Step 2: Register in lib.rs**

`use` 与 `invoke_handler` 增加 `get_git_remote_url`。

- [ ] **Step 3: cargo check**

Run: `cd src-tauri && cargo check`  
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/lib.rs
git commit -m "feat(git): get_git_remote_url 供 KS 自动发布匹配"
```

---

### Task 4: 自动发布编排 `ksAutoPublish.ts`

**Files:**
- Create: `src/utils/ksAutoPublish.ts`

**Interfaces:**
- Consumes: `normalizeGitUrl`, `lookupKsPublishMap`, `KsPublishMap`, `BranchImageResult`, `resolveKsEnvironments` / `pickKsEnvironment`, `invoke`
- Produces:

```ts
export interface KsAutoPublishDeps {
  repoPath: string;
  images: Array<{ role: "frontend" | "backend"; image: string }>;
  maps: KsPublishMap[];
  config: HarborConfig;
  appendLog: (line: string) => void; // 同步追加到打包进度
}

export interface KsAutoPublishSummary {
  attempted: number;
  success: number;
  skipped: number;
  failed: number;
  lines: string[];
}

export async function runKsAutoPublish(deps: KsAutoPublishDeps): Promise<KsAutoPublishSummary>
```

- [ ] **Step 1: Implement diag helper + runKsAutoPublish**

逻辑要点：

1. `invoke("write_diagnostic_log", { module: "build", message })` 与 `kubesphere`（失败吞掉）
2. `const remote = await invoke<string>("get_git_remote_url", { repoPath, remote: null })`；失败 → 全部 skip，summary 写明原因
3. `key = normalizeGitUrl(remote)`
4. 对每个 image：`lookupKsPublishMap`；null → skipped++
5. `pickKsEnvironment`；缺密码等 → failed/skipped + log
6. `invoke("ks_connect", { envId, console, username, password })`
7. container：映射有则用；否则 `ks_list_deployments({ namespace })` 找 `deployment` 的 `containers[0]`；没有 → skip
8. `invoke<UpdateResult>("ks_update_image", { namespace, deployment, container, image })`
9. 每步 `appendLog` + diag；互不影响

`UpdateResult` 形状与面板一致：`{ ok, oldImage, newImage, revision }`。

- [ ] **Step 2: tsc**

Run: `pnpm exec tsc --noEmit`  
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add src/utils/ksAutoPublish.ts
git commit -m "feat(ks): 打包后按映射自动 ks_update_image 编排"
```

---

### Task 5: 挂到分支打包推送成功路径

**Files:**
- Modify: `src/hooks/branch/branchPackageAction.ts`
- Modify: `src/hooks/useBranchPack.ts`
- Modify: `src/components/BranchPanel.tsx`
- Modify: `src/App.tsx`（若需透传 props）

**Interfaces:**
- Consumes: `runKsAutoPublish`
- 新增状态：`autoPublishKs: boolean`（记忆 `config.last_auto_publish_ks`）；仅当 `autoPushImage` 为 true 时可开

- [ ] **Step 1: Wire UI checkbox**

在 `BranchPanel`「打包后联动推送镜像」旁增加：

```tsx
<label className="checkbox-label">
  <input
    type="checkbox"
    checked={autoPublishKs}
    disabled={!autoPushImage || isBuilding}
    onChange={(e) => onAutoPublishKsChange(e.target.checked)}
  />
  <span className="checkbox-toggle"></span>
  <span>推送后自动发布到 KubeSphere</span>
</label>
<p className="template-hint">
  按系统设置中的 Git 地址映射发布；未配置映射则跳过，不影响推送成功
</p>
```

`useBranchPack`：state + `applyRememberedConfig` 读 `last_auto_publish_ks`；`rememberBranchRepoSettings` / 全局记忆写入 `last_auto_publish_ks`（与 `last_auto_push_image` 同路径）。

- [ ] **Step 2: Call after successful push**

抽取局部 async 函数，在 **Maven** 推送成功拿到 `imageList` 后、`return` 前调用；在 **npm** `successResults` 汇总后、`showSystemAlert` 前调用：

```ts
if (autoPublishKs && imageResults.length > 0) {
  setProgressMessage("🚀 自动发布到 KubeSphere...");
  const summary = await runKsAutoPublish({
    repoPath,
    images: imageResults.map((r) => ({ role: r.role, image: r.image })),
    maps: config.ks_publish_maps ?? [],
    config,
    appendLog: (line) => { /* 拼到当前 log 缓冲或多次 setLog */ },
  });
  // 把 summary.lines 追加进 setLog 文案
}
```

注意：Maven 路径当前在推送成功后 `return` 较早，必须在 `return` **之前**调用，且仍不因发布失败改成功态。

`PackageActionDeps` / overrides 增加 `autoPublishKs`。

- [ ] **Step 3: tsc**

Run: `pnpm exec tsc --noEmit`  
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/hooks/branch/branchPackageAction.ts src/hooks/useBranchPack.ts src/components/BranchPanel.tsx src/App.tsx
git commit -m "feat(branch): 推送成功后按 Git 映射自动发布 KS"
```

---

### Task 6: Config 面板映射 CRUD

**Files:**
- Modify: `src/components/ConfigPanel.tsx`
- Modify: `src/styles/config.css`（若需简单列表样式，可复用 `.ks-env-*`）

**Interfaces:**
- Consumes: `createKsPublishMap`, `normalizeGitUrl`, `resolveKsEnvironments`, `get_git_remote_url`（可选「填入当前仓库」用 `config.last_repo_path`）

- [ ] **Step 1: UI under KubeSphere tab**

在环境列表下方增加「发布映射」区块：

- 表格/列表列：Git 地址、角色（select）、环境（select env id→name）、命名空间、部署、容器（可选）、删除
- 「添加映射」：空 draft；保存时 `createKsPublishMap` 写入 `onConfigChange("ks_publish_maps", next)`
- 禁止提交空 `git_url` / `env_id` / `namespace` / `deployment`
- 可选按钮「填入上次仓库 origin」：`invoke("get_git_remote_url", { repoPath: config.last_repo_path })`

- [ ] **Step 2: Manual smoke notes in comment or docs**（下一步文档）

- [ ] **Step 3: tsc**

Run: `pnpm exec tsc --noEmit`  
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfigPanel.tsx src/styles/config.css
git commit -m "feat(config): KubeSphere 发布映射表 CRUD"
```

---

### Task 7: 文档 + 总验证

**Files:**
- Modify: `docs/kubesphere-publish.md`（增加「分支打包自动发布」小节）

- [ ] **Step 1: Doc blurb**

说明：设置映射（Git + 角色）→ 分支打包勾选推送与自动发布 → 日志位置。

- [ ] **Step 2: Run all checks**

```bash
node --experimental-strip-types --test scripts/ksPublishMap.test.ts
pnpm exec tsc --noEmit
cd src-tauri && cargo check
```

Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add docs/kubesphere-publish.md docs/superpowers/specs/2026-08-21-branch-pack-ks-auto-publish-design.md
git commit -m "docs: 分支打包按 Git 映射自动发布 KS"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| `ks_publish_maps` + git_url/role | 1–2, 6 |
| normalize + 查表（精确优先 any） | 1 |
| 读 origin remote | 3–4 |
| 推送后自动发布、失败不阻断 | 4–5 |
| Branch 开关依赖自动推送 | 5 |
| Config CRUD | 6 |
| build/kubesphere 日志 | 4 |
| 多镜像按角色 | 1, 4–5 |
| 验收命令 | 7 |

无 TBD / 无「类似 Task N」占位。类型名 `KsPublishMap` / `runKsAutoPublish` 前后一致。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-branch-pack-ks-auto-publish.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每任务新开子代理，任务间审查，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

Which approach?
