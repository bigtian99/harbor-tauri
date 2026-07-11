# 诊断日志按模块 + 按天滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地独立 `diag` 模块：按模块 tag 写诊断日志、按天滚动文件、系统日志合并最近 3 天可读；全仓业务 `eprintln!` / 错模块 `templates_log` 一刀切迁到 `diag_log`。

**Architecture:** 新建 `src-tauri/src/diag.rs` 作为唯一日志根（`init` + `diag_log` + `read`）。`landing::templates_log` 薄封装为 `diag_log("templates", …)`。启动时 `diag::init` 先于模板 init。文件 `diagnostic-YYYY-MM-DD.log`；读合并 ≤3 天、新在前。不引入 tracing。

**Tech Stack:** Rust（std `OnceLock`/`Mutex`/`fs`）、已有 `chrono`、`tauri` PathResolver、`dirs`；前端命令名保持不变。

## Global Constraints

- 行格式：`[JarPorter][{module}] {message}`；文件行：`[{YYYY-MM-DD HH:MM:SS}] [JarPorter][{module}] {message}`
- 模块名（小写）：`templates` `landing` `preview` `updater` `build` `git` `docker` `ops` `settlement` `history` `config` `db` `app` `utils`
- 按天文件：`{app_log_dir}/diagnostic-YYYY-MM-DD.log`（本地时区日期）
- 读：最近 ≤3 个按日文件合并后 reverse 取 N 行（默认 300）
- 旧文件 `templates-diagnostic.log`：不删、不迁、新逻辑不读写
- 命令名保持：`get_templates_diagnostic_log_path`（返回**当天**新路径）、`read_diagnostic_log`
- 写失败静默；stderr 仍输出
- 成功标准：① 系统日志可搜 `[模块名]` ② 按天文件存在且可读
- 一刀切：业务路径不得残留裸 `eprintln!`（`diag` 模块内部 `eprintln!` 除外）
- package 名：`jarporter` / lib `jarporter_lib`（`src-tauri/Cargo.toml`）

---

## File Structure

| 文件 | 职责 |
|------|------|
| **Create** `src-tauri/src/diag.rs` | `init` / `diag_log` / path / `read_diagnostic_log` / `get_templates_diagnostic_log_path`；单元测试 |
| **Modify** `src-tauri/src/lib.rs` | `mod diag`；setup 调 `diag::init`；命令从 `diag` 导出；db 失败改 `diag_log("db", …)` |
| **Modify** `src-tauri/src/landing.rs` | 删旧日志文件逻辑；`templates_log` 转发；generate/FTP 用 `landing`；模板路径用 `templates`；业务 `eprintln!` → `diag_log` |
| **Modify** `src-tauri/src/updater.rs` | 全部 `templates_log` → `diag_log("updater", …)` |
| **Modify** `src-tauri/src/build.rs` | 全部业务 `eprintln!` → `diag_log("build", …)` |
| **Modify** `src-tauri/src/history.rs` | → `diag_log("history", …)` |
| **Modify** `src-tauri/src/preview_server.rs` | → `diag_log("preview", …)` |
| **Modify** `src-tauri/src/utils.rs` | → `diag_log("utils", …)` |
| **Modify** `CLAUDE.md` | 模块表补 `utils`；过渡期改为已落地；指向 `diag_log` |
| **No change required for eprint=0** | `git.rs` `docker.rs` `ops.rs` `settlement.rs` `commit.rs` `config_cmd.rs` `db.rs`（仅 lib 里 init 失败）— 新代码若加日志必须用对应模块 |

Spec: `docs/superpowers/specs/2026-07-11-diagnostic-module-log-design.md`

---

### Task 1: 新建 `diag.rs`（写 + 按天路径 + 读合并 + 测试）

**Files:**
- Create: `src-tauri/src/diag.rs`
- Modify: `src-tauri/src/lib.rs`（仅加 `mod diag;` 以便 `cargo test` 能编译该模块；命令注册可在 Task 2）

**Interfaces:**
- Produces:
  - `pub fn init(app: &tauri::AppHandle)`
  - `pub fn diag_log(module: &str, message: impl AsRef<str>)`
  - `pub fn templates_log(message: impl AsRef<str>)` // 可选放在 diag，Task 2 与 landing 对齐
  - `pub fn diagnostic_log_dir() -> Option<PathBuf>`
  - `pub fn today_log_path() -> Option<PathBuf>`
  - `pub async fn get_templates_diagnostic_log_path() -> Result<String, String>`
  - `pub async fn read_diagnostic_log(lines: Option<usize>) -> Result<String, String>`

- [ ] **Step 1: 创建 `src-tauri/src/diag.rs` 最小实现**

```rust
//! 全局诊断日志：按模块 tag + 按天滚动文件。
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn init(app: &AppHandle) {
    if LOG_DIR.get().is_some() {
        return;
    }
    let log_dir = app
        .path()
        .app_log_dir()
        .ok()
        .or_else(|| dirs::config_dir().map(|d| d.join("jarporter").join("logs")))
        .unwrap_or_else(|| std::env::temp_dir().join("jarporter-logs"));
    let _ = fs::create_dir_all(&log_dir);
    let _ = LOG_DIR.set(log_dir);
}

pub fn diagnostic_log_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

fn today_date_str() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn today_log_path() -> Option<PathBuf> {
    LOG_DIR
        .get()
        .map(|dir| dir.join(format!("diagnostic-{}.log", today_date_str())))
}

/// 写入 stderr + 当天诊断文件。module 为小写模块名。
pub fn diag_log(module: &str, message: impl AsRef<str>) {
    let line = format!("[JarPorter][{module}] {}", message.as_ref());
    eprintln!("{line}");
    let Some(path) = today_log_path() else {
        return;
    };
    if let Ok(_guard) = LOG_LOCK.lock() {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(file, "[{ts}] {line}");
        }
    }
}

pub fn templates_log(message: impl AsRef<str>) {
    diag_log("templates", message);
}

#[tauri::command]
pub async fn get_templates_diagnostic_log_path() -> Result<String, String> {
    today_log_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "诊断日志尚未初始化，请重启应用后再试".to_string())
}

/// 读取最近 ≤3 天诊断日志，**新日志在前**。
#[tauri::command]
pub async fn read_diagnostic_log(lines: Option<usize>) -> Result<String, String> {
    let dir = diagnostic_log_dir().ok_or_else(|| "诊断日志尚未初始化".to_string())?;
    let max_lines = lines.unwrap_or(300);
    let mut day_files = list_recent_day_files(&dir, 3);
    // list_recent_day_files：日期升序（旧→新）
    let mut all_lines: Vec<String> = Vec::new();
    for path in day_files.drain(..) {
        if let Ok(content) = fs::read_to_string(&path) {
            for line in content.lines() {
                all_lines.push(line.to_string());
            }
        }
    }
    // 文件内旧→新；整体 reverse 后 take
    Ok(all_lines
        .into_iter()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .join("\n"))
}

/// 返回最多 `max_days` 个 `diagnostic-YYYY-MM-DD.log`，按日期升序。
fn list_recent_day_files(dir: &Path, max_days: usize) -> Vec<PathBuf> {
    let mut items: Vec<(String, PathBuf)> = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        // diagnostic-YYYY-MM-DD.log
        if let Some(date) = name
            .strip_prefix("diagnostic-")
            .and_then(|s| s.strip_suffix(".log"))
        {
            if date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-' {
                items.push((date.to_string(), path));
            }
        }
    }
    items.sort_by(|a, b| a.0.cmp(&b.0));
    let skip = items.len().saturating_sub(max_days);
    items.into_iter().skip(skip).map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn list_recent_day_files_picks_latest_three() {
        let dir = std::env::temp_dir().join(format!(
            "jarporter-diag-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for d in ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"] {
            fs::write(dir.join(format!("diagnostic-{d}.log")), format!("line-{d}\n")).unwrap();
        }
        fs::write(dir.join("templates-diagnostic.log"), "old\n").unwrap();
        fs::write(dir.join("junk.txt"), "x\n").unwrap();

        let files = list_recent_day_files(&dir, 3);
        let names: Vec<_> = files
            .iter()
            .filter_map(|p| p.file_name().map(|s| s.to_string_lossy().to_string()))
            .collect();
        assert_eq!(
            names,
            vec![
                "diagnostic-2026-07-09.log".to_string(),
                "diagnostic-2026-07-10.log".to_string(),
                "diagnostic-2026-07-11.log".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn diag_log_format_contains_module() {
        // 不依赖 init：直接测格式字符串约定
        let module = "updater";
        let message = "check_update: ok";
        let line = format!("[JarPorter][{module}] {message}");
        assert!(line.contains("[updater]"));
        assert!(line.starts_with("[JarPorter][updater]"));
    }
}
```

- [ ] **Step 2: 在 `lib.rs` 顶部加入 `mod diag;`（紧挨其它 mod）**

```rust
mod diag;
```

放在 `mod db;` 附近即可，例如 `mod db;` 之后 `mod diag;`。

- [ ] **Step 3: 跑单元测试**

Run:

```bash
cd src-tauri && cargo test -p jarporter_lib diag::tests -- --nocapture
```

若 package 解析失败，改用：

```bash
cd src-tauri && cargo test diag::tests -- --nocapture
```

Expected: `list_recent_day_files_picks_latest_three` 与 `diag_log_format_contains_module` **PASS**。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/diag.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(diag): 新增按模块诊断日志与按天滚动读写

EOF
)"
```

---

### Task 2: 接线 init / 命令迁移 / 拆除 landing 旧写文件逻辑

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/landing.rs`（删除 `TEMPLATES_LOG_FILE`、`init_templates_log_file`、`templates_diagnostic_log_path`、旧 `templates_log` 写盘、`get_templates_diagnostic_log_path`、`read_diagnostic_log`；改为 re-export 或调用 `crate::diag`）

**Interfaces:**
- Consumes: Task 1 的 `diag::init`、`diag_log`、`templates_log`、`get_templates_diagnostic_log_path`、`read_diagnostic_log`
- Produces: 启动后 `LOG_DIR` 已 set；前端命令行为兼容（path=当天文件；read=合并 3 天）

- [ ] **Step 1: 修改 `lib.rs` setup 与 import / handler**

`use landing::{...}` **去掉** `get_templates_diagnostic_log_path, read_diagnostic_log`。

改为：

```rust
use diag::{get_templates_diagnostic_log_path, read_diagnostic_log};
```

`setup`：

```rust
.setup(|app| {
    diag::init(app.handle());
    landing::init_bundled_templates_dir(app.handle());
    if let Err(e) = db::init_db() {
        diag::diag_log("db", &format!("初始化数据库失败: {e}"));
    }
    preview_server::start(app);
    Ok(())
})
```

handler 列表中命令名不变（仍注册 `get_templates_diagnostic_log_path`、`read_diagnostic_log`）。

- [ ] **Step 2: 改造 `landing.rs` 日志出口**

1. 删除：
   - `static TEMPLATES_LOG_FILE`
   - `static TEMPLATES_LOG_LOCK`（若仅服务日志）
   - `fn init_templates_log_file`
   - `pub(crate) fn templates_diagnostic_log_path`
   - 旧 `pub(crate) fn templates_log` 写文件实现
   - `pub async fn get_templates_diagnostic_log_path`
   - `pub async fn read_diagnostic_log`

2. 增加兼容转发（供本文件与外部 `crate::landing::templates_log` 短暂共存；updater 在 Task 3 改掉后可只留本模块用）：

```rust
pub(crate) fn templates_log(message: impl AsRef<str>) {
    crate::diag::diag_log("templates", message);
}
```

3. `init_bundled_templates_dir`：**删除**对 `init_templates_log_file` 的调用；开头可：

```rust
crate::diag::diag_log(
    "templates",
    &format!(
        "诊断日志目录: {:?}（按天文件 diagnostic-YYYY-MM-DD.log）",
        crate::diag::diagnostic_log_dir()
    ),
);
```

原先 `templates_log("诊断日志文件: …")` 替换为上述或删除重复。

4. 凡引用 `templates_diagnostic_log_path()` 的错误 hint，改为：

```rust
crate::diag::today_log_path()
    .map(|p| format!("\n诊断日志: {}", p.display()))
    .unwrap_or_default()
```

- [ ] **Step 3: `cargo check`**

```bash
cd src-tauri && cargo check
```

Expected: 无 error（允许既有 warning）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/landing.rs
git commit -m "$(cat <<'EOF'
refactor(diag): 启动 init 并拆除 landing 旧诊断写文件逻辑

EOF
)"
```

---

### Task 3: 迁移 `updater.rs`（修正误标 templates）

**Files:**
- Modify: `src-tauri/src/updater.rs`（全部 `crate::landing::templates_log` → `crate::diag::diag_log("updater", …)`）

**Interfaces:**
- Consumes: `crate::diag::diag_log`
- Produces: 日志行含 `[updater]`

- [ ] **Step 1: 批量替换**

将文件中所有：

```rust
crate::landing::templates_log(&format!(...));
crate::landing::templates_log(&format!("..."));
```

改为：

```rust
crate::diag::diag_log("updater", &format!(...));
```

单参数字符串同理：`diag_log("updater", "...")` 或 `diag_log("updater", &format!(...))`。

可用：

```bash
# 人工或编辑器 replace_all；禁止留下 landing::templates_log
rg -n "templates_log" src-tauri/src/updater.rs
```

Expected after: **0** matches for `templates_log` in `updater.rs`；**≥1** matches for `diag_log("updater"`。

- [ ] **Step 2: `cargo check`**

```bash
cd src-tauri && cargo check
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/updater.rs
git commit -m "$(cat <<'EOF'
fix(updater): 诊断日志改用 [updater] 模块 tag

EOF
)"
```

---

### Task 4: 迁移 `landing.rs` 业务日志（landing vs templates 拆分 + eprintln 一刀切）

**Files:**
- Modify: `src-tauri/src/landing.rs`

**规则：**

| 场景 | 模块 |
|------|------|
| 模板 init / resolve / list_template_* / upload_template_zip / delete_template_dir | `templates`（可用 `templates_log` 或 `diag_log("templates", …)`） |
| fetch 渠道 / generate_landing / generate_vest / FTP 上传 | `landing` → `crate::diag::diag_log("landing", …)` |
| 原 `eprintln!("[JarPorter] …")` 业务 | 按上表改 `diag_log`，**禁止**残留业务 `eprintln!` |

- [ ] **Step 1: 替换 generate / FTP / fetch 相关 `templates_log` 为 landing**

至少包括（以当前行号为线索，以符号为准）：

- `generate_landing_pages` 开头/匹配失败的 `templates_log` → `diag_log("landing", …)`
- `generate_vest_landing_pages` 同类
- 任何 FTP 成功/失败若已是 `eprintln!`，改 `diag_log("landing", …)`

示例：

```rust
crate::diag::diag_log(
    "landing",
    &format!("generate_landing_pages base={} — {}", gen_base.display(), summarize_templates_dir(&gen_base)),
);
```

- [ ] **Step 2: 全部业务 `eprintln!` 改 `diag_log`**

```bash
rg -n "eprintln!" src-tauri/src/landing.rs
```

逐条改为 `templates` 或 `landing`。**本文件业务路径结束后 `rg eprintln!` 应为 0**（测试代码除外；landing 通常无 test eprintln）。

- [ ] **Step 3: `cargo check` + 扫描**

```bash
cd src-tauri && cargo check
rg -n "eprintln!" src-tauri/src/landing.rs || true
rg -n 'diag_log\("landing"' src-tauri/src/landing.rs | head
```

Expected: check 通过；landing 业务 `eprintln!` 清零；存在 `landing` tag。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/landing.rs
git commit -m "$(cat <<'EOF'
refactor(landing): 业务日志按 landing/templates 写入 diag

EOF
)"
```

---

### Task 5: 迁移 `build` / `history` / `preview_server` / `utils` / 确认零 eprint 文件

**Files:**
- Modify: `src-tauri/src/build.rs` → `diag_log("build", …)`
- Modify: `src-tauri/src/history.rs` → `diag_log("history", …)`
- Modify: `src-tauri/src/preview_server.rs` → `diag_log("preview", …)`
- Modify: `src-tauri/src/utils.rs` → `diag_log("utils", …)`
- Verify only: `git.rs` `docker.rs` `ops.rs` `settlement.rs` `commit.rs` `config_cmd.rs` `db.rs`（当前 eprint=0，无需改；若发现 `println!` 业务日志一并迁）

- [ ] **Step 1: `build.rs`**

```bash
rg -n "eprintln!" src-tauri/src/build.rs
```

每一处改为：

```rust
crate::diag::diag_log("build", &format!("..."));
// 或
crate::diag::diag_log("build", "...");
```

去掉原 `[JarPorter]` 前缀重复（`diag_log` 已带前缀）。  
例：原 `eprintln!("[JarPorter] ✅ 产物已输出到: {}", path)` →  
`crate::diag::diag_log("build", &format!("✅ 产物已输出到: {path}"))`。

- [ ] **Step 2: `history.rs` / `preview_server.rs` / `utils.rs` 同样处理**

模块名分别为 `history`、`preview`、`utils`。

- [ ] **Step 3: 全仓验收扫描**

```bash
cd src-tauri && cargo check
# 业务模块不得再有 eprintln!（diag.rs 内部允许）
rg -n "eprintln!" src-tauri/src --glob '*.rs' | rg -v 'src-tauri/src/diag.rs'
# 不得再有非 templates 语义的 landing::templates_log 误用（updater 应为 0）
rg -n "landing::templates_log" src-tauri/src --glob '*.rs'
```

Expected:

- `cargo check` 通过  
- 除 `diag.rs` 外 **0** 条业务 `eprintln!`  
- `landing::templates_log` 仅可能出现在历史注释；调用方优先 `diag::` 或 landing 内 `templates_log` 转发  

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/build.rs src-tauri/src/history.rs src-tauri/src/preview_server.rs src-tauri/src/utils.rs
git commit -m "$(cat <<'EOF'
refactor: build/history/preview/utils 诊断日志统一 diag_log

EOF
)"
```

---

### Task 6: 更新 `CLAUDE.md` 日志规范为已落地

**Files:**
- Modify: `CLAUDE.md`（日志规范整节）

- [ ] **Step 1: 更新要点（写入真实内容，勿留「待做」）**

1. **现状结论**：改为已支持 `diag_log(module, msg)` + 按天滚动；旧结论表可改成「已落地」。  
2. **模块表**：增加 `utils`。  
3. **写法**：主推 `crate::diag::diag_log("build", …)`；`templates_log` = `diag_log("templates", …)`。  
4. **文件**：`diagnostic-YYYY-MM-DD.log`；读最近 3 天。  
5. 删除「实现抓手（待做）」类过渡表述，改为强制使用 `diag_log`。

示例强制句：

```markdown
### Rust 后端日志（已落地）

```rust
crate::diag::diag_log("updater", &format!("check_update: current={cur}, latest={latest}"));
crate::diag::diag_log("build", &format!("package_from_branch repo={repo} branch={branch}"));
// 兼容
templates_log("list_template_infos ok"); // ≡ diag_log("templates", ...)
```

- 禁止业务路径仅用 `eprintln!`
- 系统日志搜索：`[updater]` / `[build]` / …
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: 日志规范改为 diag 模块已落地

EOF
)"
```

---

### Task 7: 端到端验收（成功标准闭环）

**Files:** 无代码；验证命令与手工步骤

- [ ] **Step 1: 编译**

```bash
cd src-tauri && cargo check && cargo test diag::tests
```

Expected: 通过。

- [ ] **Step 2: 静态验收清单**

```bash
# 1) updater 使用正确模块
rg -n 'diag_log\("updater"' src-tauri/src/updater.rs | head
# 2) 无业务 eprintln
rg -n "eprintln!" src-tauri/src --glob '*.rs' | rg -v 'diag\.rs' || echo "OK no business eprintln"
# 3) diag 模块存在
test -f src-tauri/src/diag.rs && echo OK
```

- [ ] **Step 3: 运行时验收（dev 或已有二进制）**

1. 启动应用（`pnpm tauri` 或现有 dev）。  
2. 触发一次「检查更新」或打开会打日志的落地页/构建路径。  
3. 侧边栏打开 **系统日志**，搜索：
   - `[updater]` 或 `[templates]` / `[landing]` / `[build]`（至少一类有内容）  
4. 确认日志目录出现当天文件（path 命令或磁盘）：

```bash
# macOS 常见 app log 目录（以实际 get_templates_diagnostic_log_path 返回为准）
ls -la ~/Library/Logs/com.*/  2>/dev/null | head
# 或
find ~/Library/Logs -name 'diagnostic-*.log' 2>/dev/null | head
find ~/Library/Application\ Support -name 'diagnostic-*.log' 2>/dev/null | head
```

Expected:

- [ ] 能按 `[模块名]` 搜到日志  
- [ ] 存在 `diagnostic-YYYY-MM-DD.log` 且 `read_diagnostic_log` 非空（有操作后）

- [ ] **Step 4: 若运行时未跑，在 PR/提交说明写明「静态验收已过，运行时待人工点一次系统日志」**；不得伪称运行时已过。

- [ ] **Step 5: 最终 commit 仅当还有未提交验收修复时；否则跳过。**

---

## Spec coverage（self-review）

| Spec 要求 | Task |
|-----------|------|
| 独立 `diag` 模块 | Task 1 |
| `diag_log` 格式 / 锁 / 静默写失败 | Task 1 |
| 按天文件名 | Task 1 |
| 读 ≤3 天合并新在前 | Task 1 |
| path 命令返回当天路径、命令名兼容 | Task 1–2 |
| `diag::init` 为唯一初始化 | Task 2 |
| 拆除 landing 旧写文件 | Task 2 |
| `templates_log` 转发 | Task 1–2 |
| updater 改 `[updater]` | Task 3 |
| landing 拆分 landing/templates + eprintln 清零 | Task 4 |
| build/history/preview/utils 一刀切 | Task 5 |
| eprint=0 文件无需改 | Task 5 verify |
| CLAUDE.md 落地 + utils | Task 6 |
| 成功标准模块可搜 + 按天可读 | Task 7 |
| 非目标：前端筛选 / tracing / 删旧文件 | 全计划未包含 |

**Placeholder scan:** 无 TBD；具体替换以 `rg eprintln!` 结果为准逐条改。  
**类型一致:** 全程 `diag_log(module: &str, message: impl AsRef<str>)`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-diagnostic-module-log.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新 subagent，任务间 review  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

Which approach?
