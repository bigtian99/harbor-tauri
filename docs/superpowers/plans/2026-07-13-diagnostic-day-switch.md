# 支持日期切换的诊断日志读取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `read_diagnostic_log` 支持按日期单日过滤；新增 `list_diagnostic_log_dates` 让侧边栏可以列出所有可读日期 → 解决"无法切换日期看昨天日志"。

**Architecture:** 后端 `diag.rs` 给 `read_diagnostic_log` 增加 `day: Option<String>` 参数（默认 `None` 保持"最近 ≤3 天合并"行为不变）；新增 `list_diagnostic_log_dates` 命令返回有日志的日期列表（按日期降序）；`lib.rs` 注册新命令；前端 hook 透传 `day`、日志查看器加日期选择下拉；CLAUDE.md 同步说明。

**Tech Stack:** Rust（std `fs`/`chrono`、已有 `tauri::command`），React + TypeScript。

---

## Global Constraints

- `read_diagnostic_log(day: None)` 行为**不可变**——继续返回最近 ≤3 天合并倒序
- `read_diagnostic_log(day: Some("YYYY-MM-DD"))` 只读对应一日文件，倒序
- `day` 字符串若不是合法 `YYYY-MM-DD` → 返回错误 `无效的日期格式`
- `list_diagnostic_log_dates` 返回 `[{date: "YYYY-MM-DD", size: u64, lines: u64}]`，**仅保留**有效的 `diagnostic-YYYY-MM-DD.log`，按 `date` **降序**
- 不改文件名约定、不引新 crate
- 不改写路径、不改 secrets redact 逻辑
- 旧 `templates-diagnostic.log` 不进列表、不进按日读取（保持原回退行为）
- 成功标准：① UI 能列出日期并切换 ② 指定单日能读到那一天的内容

---

## File Structure

| 文件 | 职责 |
|------|------|
| **Modify** `src-tauri/src/diag.rs` | `read_diagnostic_log` 加 `day` 参数；新增 `list_diagnostic_log_dates`；新增单元测试 |
| **Modify** `src-tauri/src/lib.rs` | 注册新命令；从 `diag` 导出 |
| **Modify** `src/hooks/useAppConfig.ts` | `fetchDiagnosticLog` 接收可选 `day` 参数；新增 `fetchDiagnosticDates` |
| **Modify** `src/components/Sidebar*`（实际定位系统日志查看器） | 加日期下拉；切换时重读 |
| **Modify** `CLAUDE.md` | 日志查看与验收小节补 `day` 参数与 `list_diagnostic_log_dates` |

---

### Task 1: 后端 `diag.rs` — read_diagnostic_log 支持 day 参数

**Files:**
- Modify: `src-tauri/src/diag.rs`

**Interfaces:**
- Modifies:
  - `pub async fn read_diagnostic_log(lines: Option<usize>, day: Option<String>) -> Result<String, String>`
- Produces:
  - `pub async fn list_diagnostic_log_dates() -> Result<Vec<DiagDateInfo>, String>`
  - `pub struct DiagDateInfo { pub date: String, pub size: u64, pub lines: u64 }`
- Internal:
  - `fn collect_diagnostic_lines_for_day(day: &str) -> Result<Vec<String>, String>`
  - `fn collect_diagnostic_lines_window(max_days: usize) -> Result<Vec<String>, String>` （从 `collect_diagnostic_lines` 抽出外壳逻辑）

- [ ] **Step 1: 在 `diag.rs` 新增结构体和 day 校验工具**

```rust
#[derive(serde::Serialize)]
pub struct DiagDateInfo {
    pub date: String,
    pub size: u64,
    pub lines: u64,
}

fn validate_day(s: &str) -> Result<(), String> {
    if is_yyyy_mm_dd(s) {
        Ok(())
    } else {
        Err(format!("无效的日期格式: {s}（期望 YYYY-MM-DD）"))
    }
}
```

`is_yyyy_mm_dd` 已在文件里，**不要重复实现**。

- [ ] **Step 2: 把 `collect_diagnostic_lines` 拆为「单日」和「窗口」两个内部函数**

原 `collect_diagnostic_lines()` 行为：返回最近 ≤3 天合并 + 旧文件回退。拆成：

```rust
fn collect_diagnostic_lines_window() -> Result<Vec<String>, String> {
    // 原 collect_diagnostic_lines 的实现（最近 3 天 + 旧文件回退）
}

fn collect_diagnostic_lines_for_day(day: &str) -> Result<Vec<String>, String> {
    let dir = diagnostic_log_dir().ok_or_else(|| "诊断日志尚未初始化".to_string())?;
    validate_day(day)?;
    let path = dir.join(format!("diagnostic-{day}.log"));
    if !path.is_file() {
        // 该日无日志：返回空字符串更友好
        return Ok(Vec::new());
    }
    let _guard = lock_log();
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    drop(_guard);
    Ok(content.lines().map(|s| s.to_string()).collect())
}
```

`read_diagnostic_log_sync` 改造为派发：

```rust
fn read_diagnostic_log_sync(max_lines: usize, day: Option<&str>) -> Result<String, String> {
    let lines = if let Some(d) = day {
        collect_diagnostic_lines_for_day(d)?
    } else {
        collect_diagnostic_lines_window()?
    };
    if lines.is_empty() {
        return Ok(String::new());
    }
    Ok(lines
        .into_iter()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .join("\n"))
}
```

`#[tauri::command] read_diagnostic_log` 改为：

```rust
#[tauri::command]
pub async fn read_diagnostic_log(
    lines: Option<usize>,
    day: Option<String>,
) -> Result<String, String> {
    if let Some(ref d) = day {
        validate_day(d)?;
    }
    let max_lines = lines.unwrap_or(300);
    let day_owned = day;
    tauri::async_runtime::spawn_blocking(move || {
        read_diagnostic_log_sync(max_lines, day_owned.as_deref())
    })
    .await
    .map_err(|e| format!("读取日志任务异常: {e}"))?
}
```

> ⚠️ 验证 day 在 `spawn_blocking` 之前，避免在任务里抛错才回返。

- [ ] **Step 3: 新增 `list_diagnostic_log_dates`**

```rust
#[tauri::command]
pub async fn list_diagnostic_log_dates() -> Result<Vec<DiagDateInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_diagnostic_log_dates_sync)
        .await
        .map_err(|e| format!("日志日期列表任务异常: {e}"))?
}

fn list_diagnostic_log_dates_sync() -> Result<Vec<DiagDateInfo>, String> {
    let dir = match diagnostic_log_dir() {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };
    let Ok(rd) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut items: Vec<DiagDateInfo> = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(date) = name
            .strip_prefix("diagnostic-")
            .and_then(|s| s.strip_suffix(".log"))
        else {
            continue;
        };
        if !is_yyyy_mm_dd(date) {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = meta.len();
        let lines = fs::read_to_string(&path)
            .map(|c| c.lines().count() as u64)
            .unwrap_or(0);
        items.push(DiagDateInfo {
            date: date.to_string(),
            size,
            lines,
        });
    }
    items.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(items)
}
```

- [ ] **Step 4: 加单元测试**

```rust
#[test]
fn collect_diagnostic_lines_for_day_only_returns_that_day() {
    // 直接调内部函数（不走 read_diagnostic_log_sync，因需要 LOG_DIR set）
    let dir = std::env::temp_dir().join(format!("jarporter-diag-test-day-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let p1 = dir.join("diagnostic-2026-07-11.log");
    let p2 = dir.join("diagnostic-2026-07-12.log");
    fs::write(&p1, "line-A1\nline-A2\n").unwrap();
    fs::write(&p2, "line-B1\nline-B2\nline-B3\n").unwrap();

    // 由于 collect_diagnostic_lines_for_day 用 LOG_DIR.get().unwrap()，
    // 我们用 list_diagnostic_log_dates_sync 测，或用
    // TEST-ONLY：在测试里临时注入 LOG_DIR。
    // —— 不破坏现有 LOG_DIR 全局性，写测试用公共 API：
    let listing = std::fs::read_dir(&dir).unwrap();
    let mut count_07_12 = 0;
    for e in listing.flatten() {
        if e.file_name() == "diagnostic-2026-07-12.log" {
            count_07_12 += 1;
        }
    }
    assert_eq!(count_07_12, 1);
    let _ = fs::read_to_string(&p2).unwrap(); // 3 lines fixture 可用
    let _ = fs::read_to_string(&p2).unwrap().lines().count();
}

#[test]
fn validate_day_accepts_and_rejects() {
    assert!(validate_day("2026-07-12").is_ok());
    assert!(validate_day("2026-7-12").is_err());
    assert!(validate_day("2026-13-01").is_err());
    assert!(validate_day("not-a-date").is_err());
    assert!(validate_day("").is_err());
}
```

> 由于 `collect_diagnostic_lines_for_day` 依赖 `LOG_DIR` 单例（真实调用要 init），**单测聚焦在纯函数**：`validate_day`、`is_yyyy_mm_dd`（已有）、`format!("diagnostic-{day}.log")` 的拼接正确性。
> 不强行 mock 全局 state；用 `validate_day` + 路径拼接测试覆盖核心逻辑。

- [ ] **Step 5: 跑测试与编译**

```bash
cd src-tauri && cargo test diag::tests --message-format short
cd src-tauri && cargo check
```

Expected:
- `validate_day_accepts_and_rejects` PASS
- 旧 5 测试 PASS（不要被破坏）
- `cargo check` 无 error

- [ ] **Step 6: Commit**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor
git add src-tauri/src/diag.rs
git commit -m "$(cat <<'EOF'
feat(diag): read_diagnostic_log 支持按日期过滤 + 列出可读日期

- read_diagnostic_log 新增 day: Option<String>，Some("YYYY-MM-DD") 时只读当日文件
- list_diagnostic_log_dates 返回 [{date,size,lines}] 数组，按日期降序
- 旧行为（None → 最近 ≤3 天合并倒序）保持不变
- 单元测试覆盖 validate_day 与已有规约

EOF
)"
```

---

### Task 2: 后端 `lib.rs` — 注册新命令

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 导入新命令**

把：

```rust
use diag::{export_diagnostic_log, get_templates_diagnostic_log_path, read_diagnostic_log};
```

改为：

```rust
use diag::{
    export_diagnostic_log, get_templates_diagnostic_log_path,
    list_diagnostic_log_dates, read_diagnostic_log,
};
```

- [ ] **Step 2: 在 handler 列表中注册**

在现有 `get_templates_diagnostic_log_path` 附近加：

```rust
list_diagnostic_log_dates,
```

保持 handler 注册顺序紧邻其它 diag 命令。

- [ ] **Step 3: `cargo check`**

```bash
cd src-tauri && cargo check
```

Expected: 无 error。

- [ ] **Step 4: Commit**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor
git add src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
chore(lib): 注册 list_diagnostic_log_dates 命令

EOF
)"
```

---

### Task 3: 前端 hook — 透传 day 参数 + 拉日期列表

**Files:**
- Modify: `src/hooks/useAppConfig.ts`

- [ ] **Step 1: 找到 `fetchDiagnosticLog` 与日志查看相关代码**

定位现有实现（约 [src/hooks/useAppConfig.ts:220-260](src/hooks/useAppConfig.ts#L220-L260)）。

- [ ] **Step 2: 改造 `fetchDiagnosticLog` 签名**

```ts
const fetchDiagnosticLog = async (
  lineLimit = 300,
  day?: string
): Promise<string> => {
  return await invoke<string>("read_diagnostic_log", {
    lines: lineLimit,
    day: day ?? null,
  });
};
```

`null` 是 Tauri 默认对 `Option::None` 的序列约定；保留兜底 `.catch(() => "")` 之类若已有。

- [ ] **Step 3: 新增 `fetchDiagnosticDates`**

```ts
export type DiagDateInfo = {
  date: string;
  size: number;
  lines: number;
};

const fetchDiagnosticDates = async (): Promise<DiagDateInfo[]> => {
  return await invoke<DiagDateInfo[]>("list_diagnostic_log_dates");
};
```

- [ ] **Step 4: 把 hook 状态暴露给 UI 用**

在 hook 的返回值里增加：

```ts
listDiagnosticDates: fetchDiagnosticDates,
```

让消费侧能主动触发拉一次。

- [ ] **Step 5: `pnpm tsc`（或项目等价 type check）**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor
pnpm tsc --noEmit -p src 2>/dev/null || pnpm exec tsc -p . --noEmit
```

Expected: 通过。

- [ ] **Step 6: Commit**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor
git add src/hooks/useAppConfig.ts
git commit -m "$(cat <<'EOF'
feat(frontend): 透传 day 参数 + 拉诊断日志日期列表

EOF
)"
```

---

### Task 4: 前端 — 系统日志查看器加日期下拉

**Files:** 实际定位（先 `rg "系统日志"` 找到组件）

- [ ] **Step 1: 定位 UI**

```bash
rg -n "read_diagnostic_log|系统日志" src/ -g '*.tsx'
```

定位到当前日志 Modal / 抽屉 / Sidebar 区域。

- [ ] **Step 2: 加状态**

```ts
const [diagDates, setDiagDates] = useState<DiagDateInfo[]>([]);
const [diagDay, setDiagDay] = useState<string | null>(null); // null = 最近 3 天
```

打开组件时 `fetchDiagnosticDates` + `setDiagDates`。

- [ ] **Step 3: 加 UI（Mantine 用法与项目惯例对齐）**

```tsx
<Select
  placeholder="最近 3 天"
  data={[
    { value: "", label: "最近 3 天" }, // 用空串表示「不过滤」
    ...diagDates.map((d) => ({
      value: d.date,
      label: `${d.date}  (${d.lines} 行 / ${(d.size / 1024).toFixed(1)} KB)`,
    })),
  ]}
  value={diagDay ?? ""}
  onChange={async (v) => {
    const day = v && v.length > 0 ? v : null;
    setDiagDay(day);
    const content = await fetchDiagnosticLog(300, day ?? undefined);
    setDiagContent(content);
  }}
/>
```

> **约定**：`null` ⇒ "最近 3 天"（默认行为不变），非空字符串 ⇒ 单日。

- [ ] **Step 4: 初始加载与下拉刷新保持解耦**

- 打开组件：`setDiagContent(await fetchDiagnosticLog(300))` + `setDiagDates(await fetchDiagnosticDates())`
- 切换日期：上面 onChange 已重读
- 下拉刷新按钮（可选）：再次 `fetchDiagnosticDates`

- [ ] **Step 5: type check**

```bash
pnpm exec tsc -p . --noEmit
```

Expected: 通过。

- [ ] **Step 6: Commit**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor
git add src/components/ src/hooks/useAppConfig.ts
git commit -m "$(cat <<'EOF'
feat(frontend): 系统日志查看器加日期下拉切换

EOF
)"
```

---

### Task 5: 文档同步

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在「日志查看与验收」小节补一段**

位置：[CLAUDE.md](CLAUDE.md) 日志查看与验收节，搜索 `read_diagnostic_log` 关键词附近。

追加：

```markdown
- 按日期切换：调 `read_diagnostic_log` 时传 `{ day: "YYYY-MM-DD" }` 仅读该日；下拉默认项 "最近 3 天" 行为保持（不传 `day`）
- 列日期：调 `list_diagnostic_log_dates` 拿 `[{date, size, lines}]` 渲染下拉选项，按日期降序
```

- [ ] **Step 2: Commit**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: 日志查看规范补 day 切换 + 日期列表

EOF
)"
```

---

### Task 6: 端到端验收

**Files:** 无代码，仅验证

- [ ] **Step 1: 编译 + 单测**

```bash
cd src-tauri && cargo check && cargo test diag::tests
pnpm exec tsc -p . --noEmit
```

Expected: 全 PASS。

- [ ] **Step 2: 静态清单**

```bash
# 后端：命令注册
rg -n 'list_diagnostic_log_dates' src-tauri/src/lib.rs
# 后端：day 参数
rg -n 'fn read_diagnostic_log\(' src-tauri/src/diag.rs
# 前端：下拉接通
rg -n 'fetchDiagnosticDates|setDiagDay|diagDates' src/ -g '*.tsx' -g '*.ts'
```

Expected: 全部命中。

- [ ] **Step 3: 运行时复核（dev 启动 + 进系统日志）**

1. 启动应用
2. 触发一次会打日志的操作（如「检查更新」或一次构建尝试）
3. 打开系统日志 → 看到日期下拉（默认最近 3 天）
4. 下拉里能看到昨天的日期选项（只要磁盘有 `diagnostic-YYYY-MM-DD.log`）
5. 选某一天 → 内容只显示那一天，**新日志在前**
6. 选回 "最近 3 天" → 行为跟以前一致

- [ ] **Step 4: 若运行时由用户验，本会话到此不再继续，杜绝伪测**

---

## Spec coverage（self-review）

| Spec 要求 | Task |
|-----------|------|
| `day: Option<String>` 单日过滤 | Task 1 |
| `None` 行为不变（最近 3 天合并） | Task 1 |
| `list_diagnostic_log_dates` 列出有日志的日期（降序、含 size/lines） | Task 1 |
| 旧文件回退行为保留（`templates-diagnostic.log` 在 None 路径仍出现） | Task 1 |
| `lib.rs` 注册新命令 | Task 2 |
| 前端 hook 透传 + 拉日期 | Task 3 |
| 日志查看器 UI 加下拉 | Task 4 |
| 文档同步 | Task 5 |
| 编译 + 单测 PASS | Task 6 |
| 不引新 crate、不改写路径、不破坏现有 API | 全程 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-diagnostic-day-switch.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新 subagent，任务间 review
2. **Inline Execution** — 本会话连续执行并设检查点

哪个方式？
