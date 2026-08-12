# 隐私协议覆盖上传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 隐私协议页支持粘贴访问 URL → 解析 `host/path` 为远端目录 → 预览 → 覆盖上传；不填 URL 则新增到 `common.tiankongshuyu.cn/{unix}{word}/`。

**Architecture:** 在 `privacy.rs` 增加纯函数 URL 解析与可选 `target_url` 上传分支；FTP 仍走 `run_ftp_upload_with`，远端路径改为完整 `host/path`（`ensure_dir` 已支持 `/` 分段）；`PrivacyPanel` 增加目标输入、模式徽章、预览与覆盖确认。

**Tech Stack:** Tauri 2 / Rust / React 19 / Mantine / `url` crate（若 Cargo 已有则复用，否则用 `Url::parse` 自 `url` 或手写轻量解析）

**Spec:** `docs/superpowers/specs/2026-08-12-privacy-overwrite-upload-design.md`

## Global Constraints

- 模块日志：`diag_log("ops", …)`，禁止业务路径仅用 `eprintln!`
- UI：Mantine，只改 `PrivacyPanel`，不新菜单
- 落地页 FTP（`landing/ftp.rs` 默认 host/base）行为不变
- 覆盖模式仅 1 个 HTML；新增可多选
- `remote_dir` / 历史 `id`：完整 `host[/path…]` 字符串

## File Map

| 文件 | 职责 |
|------|------|
| `src-tauri/src/privacy.rs` | 解析、`pick_remote_dir` 前缀、`upload_privacy_html` 覆盖分支、命令 `parse_privacy_target_url` |
| `src-tauri/src/lib.rs` | 注册 `parse_privacy_target_url`；更新 `upload_privacy_html` 签名导出 |
| `src/components/PrivacyPanel.tsx` | 目标 URL 输入、预览、模式切换、确认、invoke 传 `targetUrl` |
| （可选）不新增前端独立模块；解析以后端为准，前端可做 trim 空判 |

---

### Task 1: URL 解析纯函数 + 单测

**Files:**
- Modify: `src-tauri/src/privacy.rs`
- Test: 同文件 `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `struct PrivacyTarget { remote_dir: String, preview_url: String }`
  - `fn parse_privacy_target_url_inner(raw: &str) -> Result<PrivacyTarget, String>`

- [ ] **Step 1: 写失败单测（函数尚不存在）**

在 `privacy.rs` 的 `tests` 模块追加：

```rust
use super::parse_privacy_target_url_inner;

#[test]
fn parse_common_with_dir() {
    let t = parse_privacy_target_url_inner("http://common.tiankongshuyu.cn/1785467601raven/")
        .expect("ok");
    assert_eq!(t.remote_dir, "common.tiankongshuyu.cn/1785467601raven");
    assert_eq!(t.preview_url, "http://common.tiankongshuyu.cn/1785467601raven/");
}

#[test]
fn parse_subdomain_root() {
    let t = parse_privacy_target_url_inner("https://ythtpictorial.tiankongshuyu.cn/")
        .expect("ok");
    assert_eq!(t.remote_dir, "ythtpictorial.tiankongshuyu.cn");
    assert_eq!(t.preview_url, "https://ythtpictorial.tiankongshuyu.cn/");
}

#[test]
fn parse_subdomain_nested() {
    let t = parse_privacy_target_url_inner("https://ythtpictorial.tiankongshuyu.cn/foo/bar/")
        .expect("ok");
    assert_eq!(t.remote_dir, "ythtpictorial.tiankongshuyu.cn/foo/bar");
    assert_eq!(t.preview_url, "https://ythtpictorial.tiankongshuyu.cn/foo/bar/");
}

#[test]
fn parse_rejects_empty_and_garbage() {
    assert!(parse_privacy_target_url_inner("").is_err());
    assert!(parse_privacy_target_url_inner("   ").is_err());
    assert!(parse_privacy_target_url_inner("not a url").is_err());
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `cargo test -p jarporter parse_privacy_target -- --nocapture`  
（若 package 名不同，用 `cargo test parse_privacy_target`）  
Expected: 编译失败，找不到 `parse_privacy_target_url_inner`

- [ ] **Step 3: 实现解析**

规则：
1. `trim`；空 → Err  
2. 若无 `://`，自动加 `http://` 再解析（可选；非法仍 Err）  
3. 用 `url::Url`（检查 `Cargo.toml` 是否已有 `url`；没有则 `cargo add url` 于 `src-tauri`）取 `host_str` + `path`  
4. `remote_dir` = `host` +（path 去掉首尾 `/` 后非空则 `/{path}`）  
5. `preview_url` = `{scheme}://{host}/{path...}/`（path 段原样，保证尾 `/`；根路径即 `https://host/`）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyTarget {
    pub remote_dir: String,
    pub preview_url: String,
}

pub fn parse_privacy_target_url_inner(raw: &str) -> Result<PrivacyTarget, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("请输入访问地址".into());
    }
    let with_scheme = if s.contains("://") {
        s.to_string()
    } else {
        format!("http://{s}")
    };
    let u = url::Url::parse(&with_scheme).map_err(|e| format!("无效地址: {e}"))?;
    let host = u
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "地址缺少域名".to_string())?
        .to_string();
    let path_trim = u.path().trim_matches('/');
    let remote_dir = if path_trim.is_empty() {
        host.clone()
    } else {
        format!("{host}/{path_trim}")
    };
    let preview_url = if path_trim.is_empty() {
        format!("{}://{}/", u.scheme(), host)
    } else {
        format!("{}://{}/{}/", u.scheme(), host, path_trim)
    };
    Ok(PrivacyTarget {
        remote_dir,
        preview_url,
    })
}
```

- [ ] **Step 4: 跑测通过**

Run: `cargo test -p jarporter parse_ -- --nocapture`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/privacy.rs
git commit -m "feat(privacy): 解析覆盖目标 URL 为 host/path 目录"
```

---

### Task 2: 新增目录带 common 前缀 + 上传支持 target_url

**Files:**
- Modify: `src-tauri/src/privacy.rs`（`pick_remote_dir`、`upload_privacy_html`）
- Modify: `src-tauri/src/lib.rs`（注册命令）

**Interfaces:**
- Consumes: `parse_privacy_target_url_inner`
- Produces:
  - `pick_remote_dir() -> String` 形如 `common.tiankongshuyu.cn/{unix}{word}`
  - `upload_privacy_html(paths, target_url: Option<String>)`
  - `parse_privacy_target_url(url: String) -> PrivacyTarget` Tauri command

- [ ] **Step 1: 改 `pick_remote_dir`**

```rust
fn pick_remote_dir() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let word = WORDS[(nanos as usize) % WORDS.len()];
    format!("common.tiankongshuyu.cn/{}{}", unix_secs(), word)
}
```

临时目录名勿直接用含 `/` 的 `remote_dir`：

```rust
let tmp_key = remote_dir.replace('/', "_");
let tmp_root = std::env::temp_dir().join(format!("jarporter-privacy-{tmp_key}"));
```

- [ ] **Step 2: 扩展 `upload_privacy_html`**

签名改为：

```rust
#[tauri::command]
pub async fn upload_privacy_html(
    paths: Vec<String>,
    target_url: Option<String>,
) -> Result<Vec<PrivacyUploadResult>, String>
```

逻辑要点：

```rust
let overwrite = target_url
    .as_ref()
    .map(|s| !s.trim().is_empty())
    .unwrap_or(false);

let overwrite_target = if overwrite {
    Some(parse_privacy_target_url_inner(target_url.as_ref().unwrap())?)
} else {
    None
};

if let Some(t) = &overwrite_target {
    if paths.len() != 1 {
        return Err("覆盖模式仅支持单个 HTML 文件".into());
    }
    crate::diag::diag_log(
        "ops",
        &format!(
            "upload_privacy_html mode=overwrite remote_dir={} count=1",
            t.remote_dir
        ),
    );
} else {
    crate::diag::diag_log(
        "ops",
        &format!("upload_privacy_html mode=create count={}", paths.len()),
    );
}
```

循环内：

```rust
let (remote_dir, public_url) = if let Some(t) = &overwrite_target {
    (t.remote_dir.clone(), t.preview_url.clone())
} else {
    let dir = pick_remote_dir();
    // 新增公开 URL：host 固定 common，路径为 unix+word 段
    let leaf = dir.rsplit('/').next().unwrap_or(dir.as_str());
    let url = format!("{PRIVACY_PUBLIC_BASE}/{leaf}/");
    (dir, url)
};
```

注意：新增时 `remote_dir` 是 `common.tiankongshuyu.cn/{leaf}`，公开 URL 仍为 `http://common.tiankongshuyu.cn/{leaf}/`（与现网一致）。

FTP 调用保持：

```rust
run_ftp_upload_with(&tmp_root, &remote_dir, PRIVACY_FTP_HOST, None, "ops")?;
```

成功日志带 mode：

```rust
crate::diag::diag_log(
    "ops",
    &format!(
        "✅ 隐私协议上传成功 mode={} url={}",
        if overwrite_target.is_some() { "overwrite" } else { "create" },
        url
    ),
);
```

- [ ] **Step 3: 暴露 parse 命令并注册**

```rust
#[tauri::command]
pub async fn parse_privacy_target_url(url: String) -> Result<PrivacyTarget, String> {
    let t = parse_privacy_target_url_inner(&url)?;
    crate::diag::diag_log(
        "ops",
        &format!(
            "parse_privacy_target_url remote_dir={} preview_url={}",
            t.remote_dir, t.preview_url
        ),
    );
    Ok(t)
}
```

`lib.rs`：

```rust
use privacy::{
    clear_privacy_uploads, delete_privacy_uploads, list_privacy_uploads,
    parse_privacy_target_url, upload_privacy_html,
};
// invoke_handler 增加 parse_privacy_target_url
```

- [ ] **Step 4: 单测 pick 前缀（轻量）**

```rust
#[test]
fn pick_remote_dir_has_common_prefix() {
    let d = super::pick_remote_dir();
    assert!(
        d.starts_with("common.tiankongshuyu.cn/"),
        "got {d}"
    );
    assert!(!d.ends_with('/'));
}
```

需将 `pick_remote_dir` 对测试可见（同模块即可）。

Run: `cargo test -p jarporter pick_remote_dir -- --nocapture`  
Expected: PASS

- [ ] **Step 5: `cargo check` + Commit**

```bash
cargo check
git add src-tauri/src/privacy.rs src-tauri/src/lib.rs
git commit -m "feat(privacy): 上传支持覆盖目标与 common 前缀目录"
```

---

### Task 3: PrivacyPanel 覆盖 UI

**Files:**
- Modify: `src/components/PrivacyPanel.tsx`

**Interfaces:**
- Consumes:
  - `invoke("parse_privacy_target_url", { url }) -> { remote_dir, preview_url }`
  - `invoke("upload_privacy_html", { paths, targetUrl?: string | null })`

- [ ] **Step 1: 增加状态与解析展示**

```tsx
const [targetUrl, setTargetUrl] = useState("");
const [parsed, setParsed] = useState<{ remote_dir: string; preview_url: string } | null>(null);
const [parseError, setParseError] = useState<string | null>(null);

const isOverwrite = targetUrl.trim().length > 0;
```

在目标输入 `onBlur` 或「解析」按钮时：

```tsx
const refreshParse = async () => {
  const raw = targetUrl.trim();
  if (!raw) {
    setParsed(null);
    setParseError(null);
    return;
  }
  if (!isTauriRuntime()) return;
  try {
    const t = await invoke<{ remote_dir: string; preview_url: string }>(
      "parse_privacy_target_url",
      { url: raw },
    );
    setParsed(t);
    setParseError(null);
  } catch (e) {
    setParsed(null);
    setParseError(String(e));
  }
};
```

- [ ] **Step 2: 上传区 UI**

在原上传 Paper 内、主按钮上方增加：

- `TextInput` label「覆盖目标 URL（可空=新增）」placeholder 例：`http://common.tiankongshuyu.cn/1785467601raven/`
- `Badge`：覆盖 / 新增
- 若 `parsed`：展示 `remote_dir` 文本
- 若 `parseError`：红色提示
- `Button`「预览」：`disabled={!parsed}` → `openUrl(parsed.preview_url)`
- 主按钮文案：`isOverwrite ? "覆盖上传" : "新增上传"`

- [ ] **Step 3: 改 `handleUpload`**

```tsx
const handleUpload = useCallback(async () => {
  if (!isTauriRuntime()) {
    notifications.show({ message: "请在桌面端操作", color: "yellow" });
    return;
  }
  const raw = targetUrl.trim();
  if (raw) {
    let target = parsed;
    if (!target || target.preview_url === "") {
      try {
        target = await invoke("parse_privacy_target_url", { url: raw });
        setParsed(target);
      } catch (e) {
        notifications.show({ title: "目标地址无效", message: String(e), color: "red" });
        return;
      }
    }
    if (
      !window.confirm(
        `确认覆盖远端目录？\n${target!.remote_dir}\n此操作会替换该目录下的 index.html。`,
      )
    ) {
      return;
    }
  }

  const selected = await open({
    multiple: !raw,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  if (paths.length === 0) return;
  if (raw && paths.length !== 1) {
    notifications.show({ message: "覆盖模式仅支持单个 HTML", color: "orange" });
    return;
  }

  setIsUploading(true);
  try {
    const results = await invoke<PrivacyUploadResult[]>("upload_privacy_html", {
      paths,
      targetUrl: raw ? raw : null,
    });
    // …原有结果提示与 loadHistory
  } finally {
    setIsUploading(false);
  }
}, [loadHistory, targetUrl, parsed]);
```

更新页头说明文案：支持新增与覆盖。

- [ ] **Step 4: 桌面端冒烟（手工）**

1. 不填 URL，上传 1 个 HTML → URL 为 `http://common.tiankongshuyu.cn/{leaf}/`  
2. 填已有 common URL → 预览可开 → 覆盖后刷新浏览器内容变  
3. 填 `https://ythtpictorial.tiankongshuyu.cn/` → 解析目录为该主机名（若 FTP 根不对，日志应有清晰错误）  
4. 系统日志搜 `[ops]`：`mode=create` / `mode=overwrite`

- [ ] **Step 5: Commit**

```bash
git add src/components/PrivacyPanel.tsx
git commit -m "feat(privacy): 面板支持覆盖目标解析、预览与确认上传"
```

---

### Task 4: FTP 工作根验证与文档回写

**Files:**
- Modify: `src-tauri/src/privacy.rs`（连接后打 PWD 日志，必要时调整）
- Modify: `docs/superpowers/specs/2026-08-12-privacy-overwrite-upload-design.md`（状态改为已实现，记录实测 PWD）

- [ ] **Step 1: 上传前打诊断**

在 `upload_privacy_html` 成功路径或 `run_ftp_upload_with` 调用前，若不便改 FTP 客户端，则在失败 message 中已有错误即可；优先在 `privacy` 侧 log：

```rust
crate::diag::diag_log(
    "ops",
    &format!("privacy FTP host={} remote_dir={}", PRIVACY_FTP_HOST, remote_dir),
);
```

若实测登录根已是站点上级：无需改 `base_dir`。  
若登录根是 common 站点内：与产品确认后二选一（本任务落地其一并写进 spec）：
- A. 账号改为登录 `/www/wwwroot`（推荐，不改代码结构）  
- B. 代码对 `common.tiankongshuyu.cn/...` 剥掉主机前缀再上传（子域名覆盖仍不可用，需在 UI 提示）

默认实现假设 **A（登录根可写 host 目录）**；若 Task 3 冒烟子域名失败，在本任务按实测选 A 运维或临时 B 并在面板提示。

- [ ] **Step 2: 更新 spec 状态为「已实现」+ 实测备注一行**

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/privacy.rs docs/superpowers/specs/2026-08-12-privacy-overwrite-upload-design.md
git commit -m "chore(privacy): 记录覆盖上传 FTP 工作根验证结果"
```

---

## Spec Coverage Check

| Spec 项 | Task |
|---------|------|
| URL → host/path 解析 | Task 1 |
| 新增目录带 common 前缀 | Task 2 |
| upload `target_url` / 单文件覆盖 | Task 2 |
| parse 命令 + diag | Task 2 |
| 面板输入/徽章/预览/确认/单选 | Task 3 |
| FTP 根风险处理 | Task 4 |
| 不改落地页 FTP | 全程不改 landing 默认上传入口 |

## Placeholder Scan

无 TBD /「类似 Task N」占位；关键函数与断言已写出。
