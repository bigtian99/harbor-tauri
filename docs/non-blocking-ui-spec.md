# JarPorter 防 UI 卡死开发规范

**日期**: 2026-08-28  
**状态**: 强制（新代码合入前自检；存量问题按优先级逐步迁移）  
**关联**: [自动更新设计](superpowers/specs/2026-07-10-auto-update-design.md)、[KubeSphere 发布说明](kubesphere-publish.md)

---

## 1. 问题定义

用户反馈「检查更新」等操作会导致**整个窗口无响应**（无法点按钮、无法滚动、进度条不动）。这不是「慢」，而是 **主线程被同步阻塞** 导致的假死。

JarPorter 为 Tauri 2 桌面应用：**WebView 渲染与 Tauri 命令调度共享主线程事件循环**。任何在主线程上执行的耗时操作，都会直接冻结 UI。

---

## 2. 根因模型

```
┌─────────────────────────────────────────────────────────────┐
│  主线程（WebView + Tauri IPC）                               │
│  ┌──────────────┐    invoke("check_update")    ┌──────────┐ │
│  │ React 渲染   │ ───────────────────────────► │ sync cmd │ │
│  │ 点击/滚动    │         阻塞 0~15s           │ HTTP/git │ │
│  └──────────────┘         UI 无法 paint        └──────────┘ │
└─────────────────────────────────────────────────────────────┘

正确路径：

┌──────────────┐   invoke(async cmd)   ┌─────────────────┐
│ React + 主线程 │ ◄── 立即返回 ──────── │ async command   │
│ loading 态   │   emit 进度事件        │ spawn_blocking  │
└──────────────┘                       │ 后台线程做 I/O   │
                                       └─────────────────┘
```

### 2.1 典型阻塞源

| 类型 | 示例 | 风险 |
|------|------|------|
| 同步网络 | `reqwest::blocking`、无超时的 HTTP | 高（15~30s 假死） |
| 子进程 | `Command::output()`（git、mvn、docker、hdiutil） | 高（无上限） |
| 大文件 IO | 读/写/复制目录、解压 zip、合并日志 | 中~高 |
| 全局锁 | `Mutex` 内再调网络/子进程 | 高（死锁或串行卡死） |
| 前端 | 同步 `invoke` 链、启动时无 loading、重入无防抖 | 中（体验差 + 叠加重入） |

---

## 3. 强制规则（MUST）

### 3.1 Rust：Tauri 命令分层

**凡可能超过 50ms 的操作，禁止写成同步 `#[tauri::command]`。**

「可能超过 50ms」包括但不限于：

- 任意 HTTP/HTTPS（含 GitHub API、业务 API、FTP、KubeSphere）
- `git` / `docker` / `mvn` / `npm` / `hdiutil` / `msiexec` 等子进程
- 遍历大目录、复制模板树、读合并诊断日志、SQLite 批量读写

**标准写法**：

```rust
#[tauri::command]
pub async fn my_heavy_command(arg: String) -> Result<MyResult, String> {
    crate::diag::diag_log("module", &format!("my_heavy_command arg={arg}"));
    tauri::async_runtime::spawn_blocking(move || my_heavy_command_sync(arg))
        .await
        .map_err(|e| format!("任务异常: {e}"))?
}
```

- 同步实现放在 `*_sync` 或 `*_blocking` 私有函数中
- `async fn` 本体只做：入参校验、`diag_log`、可选 `app.emit` 初始进度、`spawn_blocking`、错误映射

**参考实现（已合规）**：

- `list_git_branches` — `src-tauri/src/git.rs`
- `read_diagnostic_log` — `src-tauri/src/diag.rs`
- `download_and_install` — `src-tauri/src/updater.rs`（下载/安装已合规）

### 3.2 网络与子进程必须设超时

| 场景 | connect 超时 | 整请求/进程超时 |
|------|-------------|----------------|
| 探测/检查更新 | ≤ 5s | ≤ 15s |
| 普通 API | ≤ 5s | ≤ 15~30s |
| 大文件下载 | ≤ 10s | 按体积（如 600s），且必须后台线程 + 进度事件 |
| git ls-remote / fetch | — | ≤ 30s（超时后返回明确错误，勿无限等） |
| docker ps / images | — | ≤ 30s |

禁止：`reqwest::get()` 无 timeout、`Command::output()` 对可能 hang 的外部命令不设超时策略。

### 3.3 长任务必须可观测

- 后端：`diag_log` 记录开始、关键分支、结束/失败（模块名见 `CLAUDE.md` 日志表）
- 需要用户等待 ≥ 1s 的操作：通过 `app.emit("xxx-progress", …)` 或现有 `build-progress` / `update-progress` 推送进度
- 前端：按钮进入 loading/disabled，禁止重复点击叠加重入

### 3.4 启动路径不得阻塞首屏

- 启动后 **延迟 ≥ 2s** 再触发非关键网络（如自动检查更新）
- 自动检查更新失败 **静默跳过**，不得弹阻塞式错误
- 禁止在 `setup` / 首屏 `useEffect` 中串行 await 多个重命令

### 3.5 禁止在主线程持有锁做 I/O

```rust
// ❌ 禁止：Mutex 内调网络，其他命令排队假死
let mut sess = SESSION.lock().unwrap();
let resp = client.get(url).send()?; // 阻塞 + 占锁

// ✅ 正确：锁内只读写内存/短路径；I/O 在锁外或 spawn_blocking 内完成
```

---

## 4. 推荐规则（SHOULD）

### 4.1 前端 invoke 约定

```typescript
// ✅ 带 loading + 防重入
const [checking, setChecking] = useState(false);
async function handleCheck() {
  if (checking || !isTauriRuntime()) return;
  setChecking(true);
  try {
    const info = await invoke<UpdateInfo>("check_update");
    // ...
  } finally {
    setChecking(false);
  }
}
```

- 所有 `invoke` 前 `isTauriRuntime()` 守卫（项目既有约定）
- 用户触发的重操作：toast/按钮文案表明「进行中」
- 面板 `useEffect` 自动刷新：加 `AbortController` 或 mounted 标志，避免 unmount 后 setState

### 4.2 并行与取消

- 独立子任务可并行（如 KubeSphere 命名空间级 3 路并行），但 **总并发受控**，避免同时 50 个 HTTP
- 可取消的长任务（构建、部署）：提供 `cancel_*` 命令 + 前端取消按钮（见 `cancel_build`）

### 4.3 非关键路径降级

- 网络不可用 → 返回空/默认值 + `diag_log`，不 throw 到前端弹窗（自动更新、探测类）
- 基础设施 5xx → **保留本地会话**，不强制重登（见 `kubesphere` 的 `is_infra_http` 处理）

---

## 5. 反模式清单（禁止）

| 反模式 | 后果 | 示例位置（存量，待迁移） |
|--------|------|-------------------------|
| 同步 command + `reqwest::blocking` | 主线程网络阻塞 | 存量示例：`list_local_images`；`check_update`/`ks_*` 已迁 async |
| 同步 command + `Command::output()` | docker/git hang 即假死 | `list_local_images`、`remove_local_image` |
| 启动时同步 check_update | 打开 App 2s 后卡一下 | ~~已修：`check_update` 走 spawn_blocking~~ |
| 无超时 HTTP | 代理/ DNS 故障时长时间假死 | 任何新建 Client |
| 前端 await 链过长且无 UI 反馈 | 用户以为死机 | 多步 wizard 未分步 loading |
| `spawn_blocking` 内 `block_on` /async 混用 | 线程池耗尽 | 新建代码需避免 |

---

## 6. 存量违规与迁移优先级

| 优先级 | 命令/模块 | 问题 | 建议 |
|--------|-----------|------|------|
| P0 | ~~`check_update`~~ | ~~同步 + blocking HTTP~~ → **已改为 async + spawn_blocking** | — |
| P0 | ~~`ks_*`~~ | ~~全部同步 + blocking HTTP~~ → **已统一 `ks_blocking`；失败必打 `[kubesphere]` 日志** | — |
| P1 | `list_local_images` / `remove_local_image` | 同步 docker 多次调用 | async + spawn_blocking |
| P1 | `load_config` / `save_config` | 同步但通常 <50ms | 可保留；若 config 膨胀再迁 |
| P2 | `get_build_history` | 同步读小 JSON | 低优先级 |

迁移时 **行为不变**：仅调度方式变化；合入前用「系统日志」+ 手动点按验证 UI 不冻结。

---

## 7. 新功能合入自检清单

开发完成后，在 PR / 自测中逐项确认：

- [ ] 新增/修改的 Tauri command 若含网络、子进程、大 IO → 是否为 `async` + `spawn_blocking`（或纯 async reqwest）？
- [ ] HTTP Client 是否配置 `connect_timeout` 与 `timeout`？
- [ ] 是否在 `diag_log` 中记录入参与失败原因（模块名正确）？
- [ ] 耗时 ≥ 1s 是否 emit 进度或前端 loading？
- [ ] 启动/自动触发路径是否延迟、失败是否静默？
- [ ] 手动测试：操作进行时 **窗口可拖动、侧栏可切换、进度条可刷新**（Mac 上观察彩虹球不应长时间转）

---

## 8. 代码模板

### 8.1 标准 heavy command

```rust
fn do_work_sync(input: String) -> Result<Output, String> {
    // blocking IO here
    Ok(Output { .. })
}

#[tauri::command]
pub async fn do_work(input: String) -> Result<Output, String> {
    crate::diag::diag_log("module", &format!("do_work input={input}"));
    tauri::async_runtime::spawn_blocking(move || do_work_sync(input))
        .await
        .map_err(|e| format!("do_work 任务异常: {e}"))?
}
```

### 8.2 带进度的大任务

```rust
#[tauri::command]
pub async fn do_work_with_progress(app: AppHandle, input: String) -> Result<(), String> {
    app.emit("my-progress", json!({ "percent": 0, "message": "准备中…" })).ok();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // 阶段性 app2.emit(...)
        do_work_sync(input)
    })
    .await
    .map_err(|e| format!("任务异常: {e}"))??;
    Ok(())
}
```

### 8.3 检查更新（目标形态）

`check_update` 应与 `download_and_install` 一致：

```rust
#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(check_update_sync)
        .await
        .map_err(|e| format!("检查更新任务异常: {e}"))?
}
```

---

## 9. 与现有文档的关系

- **日志**：阻塞/超时/重试路径必须 `diag_log`，便于用户在「系统日志」搜 `[updater]` / `[kubesphere]` 排查
- **冒烟**：发版前 `docs/smoke-checklist.md` 增加一项——「检查更新 / KubeSphere 连接时 UI 仍可响应」
- **OPS 版**：规范同样适用；OPS 裁剪菜单不豁免后端阻塞问题

---

## 10. 一句话原则

> **主线程只做调度与渲染；一切可能等 I/O 的活，都放到 `spawn_blocking` 或 async 任务里，并设超时、给反馈。**
