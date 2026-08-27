# 分支打包复用 `_pack` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在产物输出目录下按仓库复用固定 `{repo}/_pack/`，切分支并只 fetch 目标分支后全量编译，不再每次新建/删除带时间戳的临时 worktree。

**Architecture:** 仍用主仓 `git worktree` 挂载到 `{output_base}/{repo_name}/_pack`；首次 `worktree add --detach`，之后在 `_pack` 内 `checkout --detach` + `reset --hard` 到目标 ref。收尾不再 `cleanup_worktree`。同 `repo_name` 进程内互斥（`PackRepoGuard` 放进 `WorktreeContext`，全流程结束后 Drop）。Maven/npm 命令不变（继续 `clean package`）。

**Tech Stack:** Rust / Tauri 2 / 现有 `git_output` / `silent_command` / `diag_log` / `cargo test`

**Spec:** `docs/superpowers/specs/2026-08-27-branch-pack-reuse-design.md`

## Global Constraints

- 路径：`{artifact_output_dir|Desktop}/{repo_name}/_pack/`（固定名，无时间戳）
- 只 fetch 目标分支：禁止 `git fetch --all`（打包路径）
- 不在用户日常 `repo_path` 主工作树上 `checkout`
- 构建保持全量：`mvn clean package -DskipTests`（及现有 npm）；不靠复用 `target` 提速
- 产物目录仍为 `{repo}/{branchSlug}_{timestamp}/`
- 打完**不删除** `_pack`；构建/校验失败也默认保留
- 同 `repo_name` 并行打包：互斥，抢锁失败则返回明确中文错误
- 诊断：`[build]` `pack_reuse` / `pack_create` / `pack_reset`；`[git]` `fetch_target_branch`
- 前端本轮不改、无新配置项、不用 `~/.cache/jarporter/pack/`

## File map

| File | Role |
|------|------|
| `src-tauri/src/build/package_worktree.rs` | `pack_dir` 路径、`ensure_pack_worktree`、复用/重置、互斥、已有 `fetch_target_branch` |
| `src-tauri/src/build/package_finish.rs` | 无 Dockerfile 时**跳过**删除 `_pack`，改日志「保留 _pack」 |
| `src-tauri/src/build/push.rs`（及清理调用点） | Docker 构建后若会删上下文，跳过名为 `_pack` 的目录 |
| `src-tauri/src/git.rs` | 仅在重建前复用 `cleanup_worktree` |
| `docs/superpowers/specs/2026-08-27-branch-pack-reuse-design.md` | 状态改为已实现 |

**不改：** `package_build.rs` Maven/npm 参数；前端 Panel；`cleanup_old_temp_dirs`（只清 `jarporter-worktree-*`，不碰 `_pack`）。

---

### Task 1: `_pack` 路径纯函数 + 单测

**Files:**
- Modify: `src-tauri/src/build/package_worktree.rs`
- Test: 同文件 `#[cfg(test)]`

**Interfaces:**
- Produces: `pub(crate) fn pack_worktree_dir(output_base: &Path, repo_name: &str) -> PathBuf`

- [ ] **Step 1: Write the failing test**

```rust
use super::pack_worktree_dir;
use std::path::Path;

#[test]
fn pack_worktree_dir_joins_repo_and_pack() {
    let p = pack_worktree_dir(Path::new("/out"), "my-service");
    assert_eq!(p, Path::new("/out/my-service/_pack"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib build::package_worktree::tests::pack_worktree_dir_joins_repo_and_pack -- --nocapture`

Expected: FAIL（`pack_worktree_dir` 未定义）

- [ ] **Step 3: Write minimal implementation**

```rust
use std::path::{Path, PathBuf};

/// 持久打包 worktree 路径：`{output_base}/{repo_name}/_pack`
pub(crate) fn pack_worktree_dir(output_base: &Path, repo_name: &str) -> PathBuf {
    output_base.join(repo_name).join("_pack")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib build::package_worktree::tests::pack_worktree_dir_joins_repo_and_pack -- --nocapture`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/build/package_worktree.rs
git commit -m "$(cat <<'EOF'
feat(build): 增加 _pack 路径拼接 helper

为分支打包持久 worktree 约定 {output}/{repo}/_pack。
EOF
)"
```

---

### Task 2: 识别可复用 worktree + 重置到目标 ref

**Files:**
- Modify: `src-tauri/src/build/package_worktree.rs`

**Interfaces:**
- Consumes: `git_output`, `silent_command`, `cleanup_worktree`, `command_output_text`
- Produces:
  - `fn is_git_worktree_dir(path: &Path) -> bool`
  - `fn reset_pack_to_ref(pack_dir: &Path, branch_ref: &str) -> Result<(), String>`
  - `fn create_pack_worktree(repo_root: &Path, pack_dir: &Path, branch_ref: &str) -> Result<(), String>`
  - `fn ensure_pack_worktree(...) -> Result<&'static str, String>` 返回 `"reuse"` | `"create"`

- [ ] **Step 1: Write failing test**

```rust
#[test]
fn is_git_worktree_dir_false_for_missing() {
    assert!(!is_git_worktree_dir(Path::new("/tmp/jarporter-no-such-pack-dir")));
}
```

- [ ] **Step 2: Implement helpers**

```rust
fn is_git_worktree_dir(path: &Path) -> bool {
    path.join(".git").exists()
}

fn reset_pack_to_ref(pack_dir: &Path, branch_ref: &str) -> Result<(), String> {
    crate::diag::diag_log(
        "build",
        &format!("pack_reset path={} ref={}", pack_dir.display(), branch_ref),
    );
    crate::utils::git_output(pack_dir, &["checkout", "--detach", branch_ref])
        .map_err(|e| format!("切换打包目录到 {branch_ref} 失败: {e}"))?;
    crate::utils::git_output(pack_dir, &["reset", "--hard", branch_ref])
        .map_err(|e| format!("重置打包目录到 {branch_ref} 失败: {e}"))?;
    Ok(())
}

fn create_pack_worktree(
    repo_root: &Path,
    pack_dir: &Path,
    branch_ref: &str,
) -> Result<(), String> {
    if pack_dir.exists() {
        cleanup_worktree(repo_root, pack_dir);
        let _ = fs::remove_dir_all(pack_dir);
    }
    if let Some(parent) = pack_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 _pack 父目录失败: {e}"))?;
    }
    let output = silent_command("git")
        .args(["worktree", "add", "--detach"])
        .arg(pack_dir)
        .arg(branch_ref)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("创建 _pack worktree 失败: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_dir_all(pack_dir);
        return Err(format!(
            "创建 _pack worktree 失败:\n{}",
            command_output_text(&output)
        ));
    }
    Ok(())
}

fn ensure_pack_worktree(
    repo_root: &Path,
    pack_dir: &Path,
    branch_ref: &str,
) -> Result<&'static str, String> {
    if is_git_worktree_dir(pack_dir) {
        match reset_pack_to_ref(pack_dir, branch_ref) {
            Ok(()) => {
                crate::diag::diag_log(
                    "build",
                    &format!(
                        "pack_reuse path={} branch={}",
                        pack_dir.display(),
                        branch_ref
                    ),
                );
                return Ok("reuse");
            }
            Err(e) => {
                crate::diag::diag_log(
                    "build",
                    &format!("pack_reuse failed, recreate: {e}"),
                );
                cleanup_worktree(repo_root, pack_dir);
                let _ = fs::remove_dir_all(pack_dir);
            }
        }
    } else if pack_dir.exists() {
        let _ = fs::remove_dir_all(pack_dir);
    }

    create_pack_worktree(repo_root, pack_dir, branch_ref)?;
    crate::diag::diag_log(
        "build",
        &format!(
            "pack_create path={} branch={}",
            pack_dir.display(),
            branch_ref
        ),
    );
    Ok("create")
}
```

- [ ] **Step 3: Run unit tests**

Run: `cd src-tauri && cargo test --lib build::package_worktree::tests -- --nocapture`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/build/package_worktree.rs
git commit -m "$(cat <<'EOF'
feat(build): _pack 复用与 reset 到目标分支

首次 worktree add，之后 checkout --detach + reset --hard；失败则重建。
EOF
)"
```

---

### Task 3: 同仓库互斥锁

**Files:**
- Modify: `src-tauri/src/build/package_worktree.rs`

**Interfaces:**
- Produces: `PackRepoGuard::try_acquire(repo_name) -> Result<PackRepoGuard, String>`；`Drop` 时释放

- [ ] **Step 1: Implement busy-map lock**

```rust
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static PACK_BUSY: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

pub(crate) struct PackRepoGuard {
    repo_name: String,
}

impl PackRepoGuard {
    pub(crate) fn try_acquire(repo_name: &str) -> Result<Self, String> {
        let map_lock = PACK_BUSY.get_or_init(|| Mutex::new(HashMap::new()));
        let mut map = map_lock
            .lock()
            .map_err(|_| "打包目录锁异常".to_string())?;
        let busy = map.entry(repo_name.to_string()).or_insert(false);
        if *busy {
            return Err(format!(
                "仓库「{repo_name}」的 _pack 正在被其他打包任务使用，请稍后再试（同仓库请串行）"
            ));
        }
        *busy = true;
        Ok(Self {
            repo_name: repo_name.to_string(),
        })
    }
}

impl Drop for PackRepoGuard {
    fn drop(&mut self) {
        if let Some(map_lock) = PACK_BUSY.get() {
            if let Ok(mut map) = map_lock.lock() {
                if let Some(busy) = map.get_mut(&self.repo_name) {
                    *busy = false;
                }
            }
        }
    }
}
```

- [ ] **Step 2: 单测**

```rust
#[test]
fn pack_repo_guard_rejects_second_acquire() {
    let g1 = PackRepoGuard::try_acquire("ut-repo-lock").unwrap();
    assert!(PackRepoGuard::try_acquire("ut-repo-lock").is_err());
    drop(g1);
    assert!(PackRepoGuard::try_acquire("ut-repo-lock").is_ok());
}
```

- [ ] **Step 3: Run + Commit**

Run: `cd src-tauri && cargo test --lib build::package_worktree::tests::pack_repo_guard_rejects_second_acquire -- --nocapture`

```bash
git add src-tauri/src/build/package_worktree.rs
git commit -m "$(cat <<'EOF'
feat(build): 同仓库 _pack 打包互斥

避免批量并行打同一仓库时抢用同一 _pack 目录。
EOF
)"
```

---

### Task 4: 接入 `prepare_worktree`（替换时间戳目录）

**Files:**
- Modify: `src-tauri/src/build/package_worktree.rs` — `prepare_worktree`、`WorktreeContext`、`validate_project_in_worktree`

**Interfaces:**
- Consumes: `pack_worktree_dir`, `ensure_pack_worktree`, `PackRepoGuard::try_acquire`, `fetch_target_branch`
- Produces: `WorktreeContext { worktree_path: .../_pack, pack_guard: PackRepoGuard, ... }`

- [ ] **Step 1: 扩展结构体**

```rust
pub(crate) struct WorktreeContext {
    pub repo_path: PathBuf,
    pub repo_root: PathBuf,
    pub worktree_path: PathBuf,
    pub actual_build_path: PathBuf,
    pub output_base: PathBuf,
    pub repo_name: String,
    pub branch_slug: String,
    pub build_timestamp: String,
    pub pack_guard: PackRepoGuard,
}
```

- [ ] **Step 2: 在解析出 `repo_name` 后立刻 `PackRepoGuard::try_acquire(&repo_name)?`**

- [ ] **Step 3: 路径改为 `_pack`**

```rust
let worktree_path = pack_worktree_dir(&output_base, &repo_name);
```

删除 `format!("_{}_{}", &branch_slug, &build_timestamp)` 作为源码目录的逻辑。

- [ ] **Step 4: fetch + rev-parse 后调用 `ensure_pack_worktree`，更新 progress**

```rust
emit_progress(app, 20, "🌿 准备打包目录 (_pack)...", "worktree");
let mode = ensure_pack_worktree(&repo_root, &worktree_path, branch)?;
let msg = if mode == "reuse" {
    "🌿 已复用 _pack 并更新到目标分支"
} else {
    "🌿 已创建 _pack 打包目录"
};
emit_progress(app, 22, msg, "worktree");
```

- [ ] **Step 5: `validate_project_in_worktree` 去掉 `cleanup_worktree`；错误文案改为保留 `_pack`**

- [ ] **Step 6: 测试**

Run: `cd src-tauri && cargo test --lib build::package_worktree -- --nocapture`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/build/package_worktree.rs
git commit -m "$(cat <<'EOF'
feat(build): prepare_worktree 复用输出目录 _pack

取消每次 _{branch}_{timestamp} 临时 worktree；校验失败不再删除 _pack。
EOF
)"
```

---

### Task 5: 收尾与 Docker 后不再删除 `_pack`

**Files:**
- Modify: `src-tauri/src/build/package_finish.rs`
- Modify: `src-tauri/src/build/push.rs`（若存在对 `cleanup_dir` 的 `remove_dir_all`）

- [ ] **Step 1: `detect_dockerfile_and_maybe_cleanup` 无 Dockerfile 时改为保留**

```rust
emit_progress(app, 88, "📦 保留 _pack 供下次复用...", "cleanup");
crate::diag::diag_log(
    "build",
    &format!("保留 _pack（不删除）: {}", ctx.worktree_path.display()),
);
emit_progress(app, 89, "✅ _pack 已保留", "cleanup");
```

有 Dockerfile：日志写「_pack 作为 Docker 上下文」，同样不删。

- [ ] **Step 2: Docker 推送清理跳过 `_pack`**

```rust
if path.file_name().and_then(|s| s.to_str()) == Some("_pack") {
    crate::diag::diag_log(
        "docker",
        &format!("skip cleanup persistent _pack: {}", path.display()),
    );
} else {
    let _ = fs::remove_dir_all(&path);
}
```

- [ ] **Step 3: `cargo check` + Commit**

Run: `cd src-tauri && cargo check -q`

```bash
git add src-tauri/src/build/package_finish.rs src-tauri/src/build/push.rs
git commit -m "$(cat <<'EOF'
fix(build): 打包收尾与 Docker 后不再删除 _pack

持久打包目录需跨次复用；仅跳过名为 _pack 的清理。
EOF
)"
```

---

### Task 6: 规格状态 + 冒烟

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-branch-pack-reuse-design.md`
- Modify: `docs/smoke-checklist.md`（若已有分支打包项则补一句 `_pack` 复用）

- [ ] **Step 1: 规格状态改为「已实现」**

- [ ] **Step 2: 手工冒烟**

1. `pnpm tauri`，Maven 仓分支 A 打包 → 出现 `{output}/{repo}/_pack/`，产物在 `{branch}_{ts}/`  
2. 同仓同分支再打 → 日志 `pack_reuse`；无新的 `_{branch}_{ts}` 源码目录  
3. 换分支 B → `_pack` 对应该分支；有 `pack_reset` / `pack_reuse`  
4. 开发仓当前分支未被切换  
5. 无 `fetch --all`

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-08-27-branch-pack-reuse-design.md docs/smoke-checklist.md
git commit -m "$(cat <<'EOF'
docs: 标记 _pack 复用规格已落地并补充冒烟项
EOF
)"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| `{output}/{repo}/_pack` | 1, 4 |
| 首次创建 / 之后 reuse+reset | 2, 4 |
| 只 fetch 目标分支 | 现有 `fetch_target_branch` + Task 4 |
| 不碰日常仓库 checkout | 4 |
| 全量 clean package | 不改 `package_build.rs` |
| 产物时间戳目录不变 | 4 |
| 不删 `_pack` | 4 validate、5 finish/push |
| 同仓互斥 | 3 + Context 持有 guard |
| 诊断日志 | 2, 4, 5 |
| 无 UI / 无 `~/.cache` | 全局约束 |
