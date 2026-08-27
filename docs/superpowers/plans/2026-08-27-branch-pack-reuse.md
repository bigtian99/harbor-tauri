# 分支打包复用 `_pack` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在产物输出目录下按仓库复用固定 `{repo}/_pack/`，切分支并只 fetch 目标分支后全量编译，不再每次新建/删除带时间戳的临时 worktree。

**Architecture:** 仍用主仓 `git worktree` 挂载到 `{output_base}/{repo_name}/_pack`；首次 `worktree add --detach`，之后在 `_pack` 内 `checkout --detach` + `reset --hard` 到目标 ref。收尾不再 `cleanup_worktree`。同 `repo_name` 进程内互斥。Maven/npm 命令不变（继续 `clean package`）。

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
| `src-tauri/src/git.rs` | 仅在需要时复用 `cleanup_worktree`（重建前清理损坏目录） |
| `docs/superpowers/specs/2026-08-27-branch-pack-reuse-design.md` | 状态改为已批准（实现后） |

**不改：** `package_build.rs` Maven/npm 参数；前端 Panel；`cleanup_old_temp_dirs`（只清 `jarporter-worktree-*`，不碰 `_pack`）。

---

### Task 1: `_pack` 路径纯函数 + 单测

**Files:**
- Modify: `src-tauri/src/build/package_worktree.rs`
- Test: 同文件 `#[cfg(test)]`

**Interfaces:**
- Produces: `pub(crate) fn pack_worktree_dir(output_base: &Path, repo_name: &str) -> PathBuf`

- [ ] **Step 1: Write the failing test**

在 `package_worktree.rs` 的 `tests` 模块追加：

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
- Test: 同文件（字符串/逻辑可测部分）；Git 命令用真实 repo 过重，本任务对「判定」与「命令参数拼装」做单测，集成靠手工冒烟

**Interfaces:**
- Consumes: `pack_worktree_dir`, `fetch_target_branch`, `split_remote_tracking_ref`, `git_output`, `silent_command`, `cleanup_worktree`
- Produces:
  - `fn is_git_worktree_dir(path: &Path) -> bool` — 存在且含 `.git` 文件或目录
  - `fn reset_pack_to_ref(pack_dir: &Path, branch_ref: &str) -> Result<(), String>`
  - `fn create_pack_worktree(repo_root: &Path, pack_dir: &Path, branch_ref: &str) -> Result<(), String>`
  - `fn ensure_pack_worktree(repo_root: &Path, pack_dir: &Path, branch_ref: &str) -> Result<&'static str, String>`  
    返回 `"reuse"` | `"create"`（供日志）

- [ ] **Step 1: Write failing tests for worktree marker**

```rust
#[test]
fn is_git_worktree_dir_false_for_missing() {
    assert!(!is_git_worktree_dir(Path::new("/tmp/jarporter-no-such-pack-dir")));
}
```

- [ ] **Step 2: Run to verify fail, then implement helpers**

```rust
fn is_git_worktree_dir(path: &Path) -> bool {
    path.join(".git").exists()
}

fn reset_pack_to_ref(pack_dir: &Path, branch_ref: &str) -> Result<(), String> {
    crate::diag::diag_log(
        "build",
        &format!("pack_reset path={} ref={}", pack_dir.display(), branch_ref),
    );
    // detach 到目标提交，避免占用分支名
    crate::utils::git_output(
        pack_dir,
        &["checkout", "--detach", branch_ref],
    )
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
        // 损坏残留：先按 worktree 强力摘除再删目录
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

/// 复用或创建 `_pack`。成功返回 `"reuse"` 或 `"create"`。
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

Expected: 全部 PASS（含既有 `split_*` 与新路径/判定测试）

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
- Produces: `fn lock_pack_repo(repo_name: &str) -> Result<PackRepoGuard, String>`  
  `PackRepoGuard` 在 drop 时释放；内部 `OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>>` 或等价

- [ ] **Step 1: Implement lock (参考 `privacy.rs` 的 `Mutex` 风格，按 repo_name 粒度)**

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

struct PackRepoGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}

fn pack_repo_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_pack_repo(repo_name: &str) -> Result<PackRepoGuard, String> {
    let key = repo_name.to_string();
    let arc = {
        let mut map = pack_repo_locks()
            .lock()
            .map_err(|_| "打包目录锁异常".to_string())?;
        map.entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let guard = arc.try_lock().map_err(|_| {
        format!(
            "仓库「{repo_name}」的 _pack 正在被其他打包任务使用，请稍后再试（同仓库请串行）"
        )
    })?;
    // MutexGuard 生命周期：需要把 Arc 保存在 Guard 里延长锁生命
    // 实现时用自管结构：持有 Arc<Mutex<()>> + MutexGuard<'static> 不可行；
    // 改用：
    // struct PackRepoGuard { lock: Arc<Mutex<()>>, guard: MutexGuard<'static, ()> } 也不行
    // 正确写法：持有 std::sync::MutexGuard 通过 owning_ref 或简单：
    // struct PackRepoGuard { _lock: Arc<Mutex<()>>, _guard: MutexGuard<'a, ()> } 用 lifetime
    // ponytail 推荐：
    Ok(PackRepoGuard { /* see note */ })
}
```

**实现注意（必须按此落地，勿留 TBD）：** 使用拥有所有权的 guard：

```rust
struct PackRepoGuard {
    _lock: Arc<Mutex<()>>,
    _guard: std::sync::MutexGuard<'static, ()>, // 不可直接写
}
```

用下面可编译的写法（`parking_lot` 未引入则坚持 std）：

```rust
struct PackRepoGuard {
    _lock: Arc<Mutex<()>>,
    // 用 ManuallyDrop + 裸指针不可取；改为：
}

fn lock_pack_repo(repo_name: &str) -> Result<impl Drop, String> {
    // 最简可编译方案：
    let lock = { /* get Arc<Mutex<()>> */ };
    match lock.clone().try_lock() {
        Ok(guard) => Ok(PackRepoGuardOwned { lock, guard: Some(guard) }),
        Err(_) => Err(format!(...)),
    }
}

struct PackRepoGuardOwned {
    lock: Arc<Mutex<()>>,
    guard: Option<std::sync::MutexGuard<'static, ()>>, // 仍有 lifetime 问题
}
```

**最终采用（写进代码的版本）：**

```rust
struct PackRepoGuard {
    lock: Arc<Mutex<()>>,
}

impl PackRepoGuard {
    fn try_acquire(repo_name: &str) -> Result<Self, String> {
        let lock = {
            let mut map = pack_repo_locks()
                .lock()
                .map_err(|_| "打包目录锁异常".to_string())?;
            map.entry(repo_name.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        // try_lock 成功后用 std::mem::forget 不行；改为持有 MutexGuard 在结构内：
        let guard = lock.try_lock().map_err(|_| {
            format!(
                "仓库「{repo_name}」的 _pack 正在被其他打包任务使用，请稍后再试（同仓库请串行）"
            )
        })?;
        // 把 guard 泄漏到堆上并在 Drop 里释放：
        let boxed = Box::new(guard);
        let leaked: &'static mut std::sync::MutexGuard<'_, ()> =
            Box::leak(boxed);
        // 过复杂。改用 parking_lot 未引入。

        // === 采用此简化：持有 Option 通过扩展 lifetime ===
        std::mem::forget(guard); // 禁止

        unreachable!()
    }
}
```

**STOP — 计划内定稿的可编译实现（执行者照抄）：**

```rust
use std::sync::{Arc, Mutex, OnceLock, MutexGuard};
use std::collections::HashMap;

struct PackRepoGuard {
    _guard: MutexGuard<'static, ()>,
    // 上面 'static 来自：每个 repo 一把 'static Mutex 存在 OnceLock 的 map 的 Arc 里，
    // 但 MutexGuard 的 lifetime 绑在 Mutex 上而非 'static。
}

// 实用方案：用 std::sync::Mutex<()> 存「是否占用」的 bool，而不是嵌套 Mutex：
static PACK_BUSY: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

struct PackRepoGuard {
    repo_name: String,
}

impl PackRepoGuard {
    fn try_acquire(repo_name: &str) -> Result<Self, String> {
        let map_lock = PACK_BUSY.get_or_init(|| Mutex::new(HashMap::new()));
        let mut map = map_lock.lock().map_err(|_| "打包目录锁异常".to_string())?;
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

- [ ] **Step 2: 单测「二次 try_acquire 失败」**

```rust
#[test]
fn pack_repo_guard_rejects_second_acquire() {
    let g1 = PackRepoGuard::try_acquire("ut-repo-lock").unwrap();
    assert!(PackRepoGuard::try_acquire("ut-repo-lock").is_err());
    drop(g1);
    assert!(PackRepoGuard::try_acquire("ut-repo-lock").is_ok());
}
```

- [ ] **Step 3: Run tests + Commit**

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
- Modify: `src-tauri/src/build/package_worktree.rs` — `prepare_worktree`
- Modify: `validate_project_in_worktree` — **失败时不要 `cleanup_worktree` 删掉 `_pack`**（改为只记日志；文案改为「未清理 _pack」）

**Interfaces:**
- Consumes: `pack_worktree_dir`, `ensure_pack_worktree`, `PackRepoGuard::try_acquire`, `fetch_target_branch`
- Produces: `WorktreeContext.worktree_path` 恒为 `_pack`；`PackRepoGuard` 必须活到 `prepare_worktree` 返回之后——**问题**：async 函数返回后 guard 会 drop，但构建仍在进行。

**关键修正：** 把 `PackRepoGuard` 放进 `WorktreeContext`，在 `finish_package` 结束（或 `package_from_branch` 全流程末尾）再 drop。

```rust
pub(crate) struct WorktreeContext {
    // ...existing fields...
    pub pack_guard: PackRepoGuard, // 新字段；Drop 时释放互斥
}
```

- [ ] **Step 1: 扩展 `WorktreeContext`，在 `prepare_worktree` 开头 `try_acquire(&repo_name)`**

- [ ] **Step 2: 将**

```rust
let worktree_path = output_base.join(&repo_name).join(format!("_{}_{}", &branch_slug, &build_timestamp));
```

**改为**

```rust
let worktree_path = pack_worktree_dir(&output_base, &repo_name);
```

- [ ] **Step 3: 在 fetch + rev-parse 成功后，调用 `ensure_pack_worktree`，按返回值改 progress 文案**

```rust
emit_progress(app, 20, "🌿 准备打包目录 (_pack)...", "worktree");
let mode = ensure_pack_worktree(&repo_root, &worktree_path, &branch)?;
let msg = if mode == "reuse" {
    "🌿 已复用 _pack 并更新到目标分支"
} else {
    "🌿 已创建 _pack 打包目录"
};
emit_progress(app, 22, msg, "worktree");
```

删除旧的「每次 `worktree add` 到时间戳路径」代码块。

- [ ] **Step 4: `validate_project_in_worktree` 去掉 `cleanup_worktree` 调用**（保留 `_pack`）

- [ ] **Step 5: Compile check**

Run: `cd src-tauri && cargo test --lib build::package_worktree -- --nocapture`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/build/package_worktree.rs
git commit -m "$(cat <<'EOF'
feat(build): prepare_worktree 复用输出目录 _pack

取消每次 _{branch}_{timestamp} 临时 worktree；校验失败不再删除 _pack。
EOF
)"
```

---

### Task 5: 收尾不再删除 `_pack`

**Files:**
- Modify: `src-tauri/src/build/package_finish.rs` — `detect_dockerfile_and_maybe_cleanup`

- [ ] **Step 1: 无自定义 Dockerfile 分支改为保留 `_pack`**

把：

```rust
emit_progress(app, 88, "🧹 清理 worktree 源码...", "cleanup");
cleanup_worktree(&ctx.repo_root, &ctx.worktree_path);
```

改为：

```rust
emit_progress(app, 88, "📦 保留 _pack 供下次复用...", "cleanup");
crate::diag::diag_log(
    "build",
    &format!("保留 _pack（不删除）: {}", ctx.worktree_path.display()),
);
emit_progress(app, 89, "✅ _pack 已保留", "cleanup");
```

有自定义 Dockerfile 的分支：保持「保留」语义，日志可写「_pack 作为 Docker 上下文」。

- [ ] **Step 2: 确认 `push.rs` 若在推送后 `cleanup_dir` 指向 worktree，不得再删 `_pack`**

检查：`src-tauri/src/build/push.rs` 中 `cleanup_dir: Some(ctx)` — 若 Docker 构建后会 `remove_dir_all`，改为**不清理** `_pack`（或清理前判断路径文件名是否为 `_pack` 则跳过）。

执行者必须打开 `push.rs` / `push_helpers` 确认；若会删上下文目录，改为：

```rust
if path.file_name().and_then(|s| s.to_str()) == Some("_pack") {
    crate::diag::diag_log("docker", &format!("skip cleanup persistent _pack: {}", path.display()));
} else {
    let _ = fs::remove_dir_all(path);
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

### Task 6: 规格状态 + 冒烟清单

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-branch-pack-reuse-design.md` — 状态改为 `已批准并实现中/已实现`
- 可选一行写入 `docs/smoke-checklist.md`（若文件已有分支打包项则改一句）

- [ ] **Step 1: 更新规格状态行**

- [ ] **Step 2: 手工冒烟（执行者在有 Git 仓库的机器上）**

1. `pnpm tauri`，选本地 Maven 仓，分支 A 打包一次 → 确认出现 `{output}/{repo}/_pack/`，产物在 `{branch}_{ts}/`。  
2. 同仓同分支再打包 → 系统日志含 `pack_reuse`；**没有**新的 `_{branch}_{ts}` 源码目录。  
3. 换分支 B 再打包 → `_pack` 内容对应该分支；日志含 `pack_reset` 或 `pack_reuse`。  
4. 开发仓 `git status` / 当前分支未被改到打包分支。  
5. 日志无 `fetch --all`。

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
| 只 fetch 目标分支 | 已有 `fetch_target_branch`；Task 4 继续调用 |
| 不碰日常仓库 checkout | 4（只操作 pack_dir） |
| 全量 clean package | 不改 `package_build.rs` |
| 产物时间戳目录不变 | 4 只改 worktree_path |
| 不删 _pack | 5；validate 失败不删 — 4 |
| 同仓互斥 | 3 + Context 持有 guard |
| 诊断日志 | 2, 4, 5 |
| 无 UI / 无 ~/.cache | 全局约束 |

无 TBD 占位；互斥采用 `HashMap<String,bool>` 方案避免 lifetime 陷阱。
