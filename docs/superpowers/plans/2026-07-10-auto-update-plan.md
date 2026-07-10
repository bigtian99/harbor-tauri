# 自动更新功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JarPorter macOS 桌面应用启动时自动检查 GitHub Releases 新版本，静默下载后弹窗确认安装

**Architecture:** Rust `updater.rs` 通过 `reqwest::blocking` 调 GitHub Releases API，版本比较用 `semver` crate，下载完成后用 `hdiutil` + `cp -R` 静默替换 `/Applications` 中的 .app。前端 Mantine Modal 展示进度，通过 Tauri events 接收后端进度推送。

**Tech Stack:** Rust (reqwest 0.12, semver 1.0), TypeScript (React 19, Mantine 9, @tauri-apps/api 2)

## 全局约束

- 仅 macOS（aarch64 / x86_64），不覆盖 Windows/Linux
- GitHub owner/repo 硬编码为 `daijunxiong/jarporter`
- 下载缓存目录：`~/Library/Caches/jarporter/update/`
- 日志规范：关键路径用 `templates_log!` 宏记录
- 网络错误静默跳过，不阻塞正常使用
- 安装中 Modal 不可关闭

---

### Task 1: 配置 Rust 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: `semver` crate 可用，`reqwest::blocking` 模块可用

- [ ] **Step 1: 修改 Cargo.toml**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中，将 `reqwest` 行和 `semver` 加入：

```toml
reqwest = { version = "0.12", features = ["json", "blocking"] }
semver = "1"
```

具体改动：`reqwest` 的 features 从 `["json"]` 改为 `["json", "blocking"]`，新增 `semver = "1"` 一行。

- [ ] **Step 2: 验证编译通过**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor/src-tauri && cargo check
```

Expected: 无编译错误（新增 dep 不应影响现有代码）。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: 添加 semver 和 reqwest blocking 依赖"
```

---

### Task 2: Rust updater 模块 — 核心逻辑

**Files:**
- Create: `src-tauri/src/updater.rs`

**Interfaces:**
- Produces:
  - `UpdateInfo { needs_update: bool, current_version: String, latest_version: String, download_url: String, file_size: u64 }`
  - `check_update() -> Result<UpdateInfo, String>`
  - `download_and_install(app: AppHandle, download_url: String) -> Result<(), String>`
  - Event: `"update-progress"` payload `{ phase: String, percent: u8, message: String }`

- [ ] **Step 1: 创建 `src-tauri/src/updater.rs`**

```rust
use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const GITHUB_API_URL: &str =
    "https://api.github.com/repos/daijunxiong/jarporter/releases/latest";
const USER_AGENT: &str = "JarPorter-Updater/1.0";
const REQUEST_TIMEOUT: u64 = 10;
const DOWNLOAD_TIMEOUT: u64 = 600; // 10 分钟，dmg 可能较大

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub needs_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub file_size: u64,
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    phase: String,
    percent: u8,
    message: String,
}

#[tauri::command]
pub fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    // 1. HTTP GET GitHub Releases API
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = match client.get(GITHUB_API_URL).send() {
        Ok(r) => r,
        Err(_) => {
            // 网络不通 → 静默跳过
            return Ok(UpdateInfo {
                needs_update: false,
                current_version,
                latest_version: String::new(),
                download_url: String::new(),
                file_size: 0,
            });
        }
    };

    if !response.status().is_success() {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version: String::new(),
            download_url: String::new(),
            file_size: 0,
        });
    }

    let json: serde_json::Value = response
        .json()
        .map_err(|e| format!("解析 GitHub API 响应失败: {}", e))?;

    // 2. 版本比较
    let tag_name = json["tag_name"].as_str().unwrap_or("");
    let latest_version = tag_name.strip_prefix('v').unwrap_or(tag_name).to_string();

    let Ok(current) = semver::Version::parse(&current_version) else {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version,
            download_url: String::new(),
            file_size: 0,
        });
    };

    let Ok(latest) = semver::Version::parse(&latest_version) else {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version,
            download_url: String::new(),
            file_size: 0,
        });
    };

    if latest <= current {
        return Ok(UpdateInfo {
            needs_update: false,
            current_version,
            latest_version: latest.to_string(),
            download_url: String::new(),
            file_size: 0,
        });
    }

    // 3. 匹配当前架构的 dmg asset
    let arch = std::env::consts::ARCH;
    // macOS: ARCH 为 "aarch64" 或 "x86_64"
    let arch_key: &str = if arch == "aarch64" { "aarch64" } else { "x64" };

    let assets = match json["assets"].as_array() {
        Some(a) => a,
        None => {
            return Ok(UpdateInfo {
                needs_update: false,
                current_version,
                latest_version: latest.to_string(),
                download_url: String::new(),
                file_size: 0,
            });
        }
    };

    let mut download_url = String::new();
    let mut file_size = 0u64;

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if name.ends_with(".dmg") && name.contains(arch_key) {
            download_url = asset["browser_download_url"]
                .as_str()
                .unwrap_or("")
                .to_string();
            file_size = asset["size"].as_u64().unwrap_or(0);
            break;
        }
    }

    Ok(UpdateInfo {
        needs_update: !download_url.is_empty(),
        current_version,
        latest_version: latest.to_string(),
        download_url,
        file_size,
    })
}

#[tauri::command]
pub fn download_and_install(
    app: AppHandle,
    download_url: String,
) -> Result<(), String> {
    let cache_dir = dirs::cache_dir()
        .ok_or("无法获取缓存目录")?
        .join("jarporter")
        .join("update");

    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("创建缓存目录失败: {}", e))?;

    let filename = download_url
        .split('/')
        .last()
        .unwrap_or("JarPorter.dmg");
    let dmg_path = cache_dir.join(filename);

    // Phase 1: 下载
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "downloading",
            "percent": 0,
            "message": "正在下载更新..."
        }),
    )
    .ok();

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut response = client
        .get(&download_url)
        .send()
        .map_err(|e| format!("下载请求失败: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&dmg_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;

    let mut buf = [0u8; 8192];
    loop {
        let n = response
            .read(&mut buf)
            .map_err(|e| format!("下载读取失败: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += n as u64;
        if total_size > 0 {
            let pct = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            app.emit(
                "update-progress",
                serde_json::json!({
                    "phase": "downloading",
                    "percent": pct,
                    "message": format!("正在下载更新... {}%", pct),
                }),
            )
            .ok();
        }
    }
    drop(file);

    // 校验文件大小
    if total_size > 0 {
        let actual_size = fs::metadata(&dmg_path)
            .map_err(|e| format!("读取文件信息失败: {}", e))?
            .len();
        if actual_size != total_size {
            let _ = fs::remove_file(&dmg_path);
            return Err(format!(
                "文件校验失败: 预期 {} 字节, 实际 {} 字节",
                total_size, actual_size
            ));
        }
    }

    // Phase 2: 挂载 dmg
    app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "installing",
            "percent": 100,
            "message": "正在安装更新..."
        }),
    )
    .ok();

    let mount_output = Command::new("hdiutil")
        .args([
            "attach",
            dmg_path.to_str().unwrap(),
            "-nobrowse",
            "-quiet",
        ])
        .output()
        .map_err(|e| format!("挂载 dmg 失败: {}", e))?;

    if !mount_output.status.success() {
        let _ = fs::remove_file(&dmg_path);
        return Err(format!(
            "挂载 dmg 失败: {}",
            String::from_utf8_lossy(&mount_output.stderr)
        ));
    }

    // hdiutil 输出的最后一行格式: /dev/disk4s1\t/Volumes/JarPorter
    let stdout = String::from_utf8_lossy(&mount_output.stdout);
    let mount_point = stdout
        .lines()
        .last()
        .and_then(|line| line.split('\t').last())
        .map(|s| s.trim().to_string())
        .ok_or("无法解析挂载点")?;

    let app_name = "JarPorter.app";
    let mounted_app = PathBuf::from(&mount_point).join(app_name);
    let target_app = PathBuf::from("/Applications").join(app_name);

    // Phase 3: 复制到 /Applications
    let cp_status = Command::new("cp")
        .args([
            "-R",
            mounted_app.to_str().unwrap(),
            target_app.to_str().unwrap(),
        ])
        .status()
        .map_err(|e| format!("复制应用失败: {}", e))?;

    if !cp_status.success() {
        // 卸载再报错
        let _ = Command::new("hdiutil")
            .args(["detach", &mount_point, "-quiet"])
            .output();
        let _ = fs::remove_file(&dmg_path);
        return Err("复制应用到 /Applications 失败".into());
    }

    // Phase 4: 卸载 + 清理
    let _ = Command::new("hdiutil")
        .args(["detach", &mount_point, "-quiet"])
        .output();
    let _ = fs::remove_file(&dmg_path);

    // Phase 5: 拉起新版本 + 退出
    let _ = Command::new("open")
        .args([target_app.to_str().unwrap()])
        .spawn();

    std::process::exit(0);
}
```

- [ ] **Step 2: 编译检查**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor/src-tauri && cargo check
```

Expected: 无编译错误。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/updater.rs
git commit -m "feat: 添加自动更新 Rust 模块 (check_update + download_and_install)"
```

---

### Task 3: 注册 Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `updater::check_update`, `updater::download_and_install`
- Produces: Tauri command handlers 注册到 invoke_handler

- [ ] **Step 1: 在 lib.rs 中添加 mod 声明**

在 `src-tauri/src/lib.rs` 的 mod 声明区域（约第 14 行 `mod utils;` 附近）添加：

```rust
mod updater;
```

- [ ] **Step 2: 在 lib.rs 中添加 use 导入**

在 `src-tauri/src/lib.rs` 的 use 区域（约第 33 行 `use settlement::...` 之后）添加：

```rust
use updater::{check_update, download_and_install};
```

- [ ] **Step 3: 在 invoke_handler 中注册两个命令**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 列表末尾（约第 114 行，`list_remote_branches,` 之后）添加：

```rust
            check_update,
            download_and_install,
```

注意末尾逗号保持一致。

- [ ] **Step 4: 编译检查**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor/src-tauri && cargo check
```

Expected: 无编译错误。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: 注册 check_update 和 download_and_install 命令"
```

---

### Task 4: 前端 UpdateModal 组件

**Files:**
- Create: `src/components/UpdateModal.tsx`

**Interfaces:**
- Consumes: `UpdateInfo` from Rust `check_update` command
- Consumes: `update-progress` Tauri event
- Produces: `<UpdateModal>` React component

- [ ] **Step 1: 创建 `src/components/UpdateModal.tsx`**

```tsx
import { useState, useEffect } from "react";
import { Modal, Button, Progress, Text, Stack, Group, Anchor } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 与 Rust updater.rs 中 UpdateInfo 一一对应 */
export interface UpdateInfo {
  needs_update: boolean;
  current_version: string;
  latest_version: string;
  download_url: string;
  file_size: number;
}

interface DownloadProgress {
  phase: string;
  percent: number;
  message: string;
}

interface UpdateModalProps {
  opened: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function UpdateModal({ opened, onClose, updateInfo }: UpdateModalProps) {
  const [phase, setPhase] = useState<"confirm" | "downloading" | "installing" | "error">("confirm");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 监听 Rust 后端发来的下载/安装进度事件
  useEffect(() => {
    if (!opened || !updateInfo) return;

    const unlisten = listen<DownloadProgress>("update-progress", (event) => {
      const { phase: p, percent } = event.payload;
      setProgress(percent);
      if (p === "downloading") setPhase("downloading");
      else if (p === "installing") setPhase("installing");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [opened, updateInfo]);

  // 重置状态，每次打开 Modal 都是新流程
  useEffect(() => {
    if (opened) {
      setPhase("confirm");
      setProgress(0);
      setError("");
      setBusy(false);
    }
  }, [opened]);

  const handleInstall = async () => {
    if (!updateInfo || busy) return;
    setBusy(true);
    try {
      await invoke("download_and_install", { downloadUrl: updateInfo.download_url });
      // 成功后进程会退出，不会走到这里
    } catch (e) {
      setError(String(e));
      setPhase("error");
      setBusy(false);
    }
  };

  const isLocked = phase === "downloading" || phase === "installing";

  return (
    <Modal
      opened={opened}
      onClose={isLocked ? () => {} : onClose}
      title="发现新版本"
      closeOnClickOutside={!isLocked}
      closeOnEscape={!isLocked}
    >
      {/* 确认阶段 */}
      {phase === "confirm" && updateInfo && (
        <Stack>
          <Text size="sm">
            当前版本: <strong>{updateInfo.current_version}</strong>
          </Text>
          <Text size="sm">
            最新版本: <strong>{updateInfo.latest_version}</strong>
          </Text>
          <Text size="sm" c="dimmed">
            文件大小: {formatSize(updateInfo.file_size)}
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>稍后</Button>
            <Button onClick={handleInstall} loading={busy}>立即更新</Button>
          </Group>
        </Stack>
      )}

      {/* 下载/安装阶段 */}
      {(phase === "downloading" || phase === "installing") && (
        <Stack>
          <Progress
            value={phase === "installing" ? 100 : progress}
            animated={phase === "downloading"}
            striped={phase === "installing"}
          />
          <Text size="sm" c="dimmed" ta="center">
            {phase === "downloading" ? `正在下载... ${progress}%` : "正在安装，即将重启..."}
          </Text>
        </Stack>
      )}

      {/* 错误阶段 */}
      {phase === "error" && (
        <Stack>
          <Text size="sm" c="red">
            更新失败: {error}
          </Text>
          <Anchor
            href="https://github.com/daijunxiong/jarporter/releases/latest"
            target="_blank"
            size="sm"
          >
            手动下载最新版本 →
          </Anchor>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>关闭</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: 编译检查前端**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor && pnpm tsc --noEmit
```

Expected: 无 TypeScript 错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/UpdateModal.tsx
git commit -m "feat: 添加 UpdateModal 更新弹窗组件"
```

---

### Task 5: 前端 App.tsx 集成

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `UpdateModal` component, `UpdateInfo` type, `check_update` Tauri command

- [ ] **Step 1: 在 App.tsx 中添加 import**

在 `src/App.tsx` 顶部的 import 区域，添加：

```tsx
import { UpdateModal, type UpdateInfo } from "./components/UpdateModal";
```

- [ ] **Step 2: 添加状态变量**

在 `src/App.tsx` 的 state 定义区域（约第 48 行 `const [activeTab, ...]` 附近），添加：

```tsx
const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
const [updateModalOpen, setUpdateModalOpen] = useState(false);
```

- [ ] **Step 3: 添加启动检查 useEffect**

在 `src/App.tsx` 的最后一个 useEffect 之后、第一个 handler 之前，添加：

```tsx
// 启动 2 秒后检查更新（不阻塞首屏渲染）
useEffect(() => {
  const timer = setTimeout(() => {
    invoke<UpdateInfo>("check_update")
      .then((info) => {
        if (info.needs_update && info.download_url) {
          setUpdateInfo(info);
          setUpdateModalOpen(true);
        }
      })
      .catch(() => {
        // 网络不通或 API 异常 → 静默跳过，不影响正常使用
      });
  }, 2000);
  return () => clearTimeout(timer);
}, []);
```

- [ ] **Step 4: 在 JSX 末尾添加 UpdateModal**

在 `src/App.tsx` 的 JSX 最末尾（`</div>` 闭合标签之前），添加：

```tsx
      <UpdateModal
        opened={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        updateInfo={updateInfo}
      />
```

- [ ] **Step 5: 编译检查前端**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor && pnpm tsc --noEmit
```

Expected: 无 TypeScript 错误。

- [ ] **Step 6: 全量编译检查**

```bash
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 无编译错误。

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: App 启动时检查更新，接入 UpdateModal"
```

---

## 验证清单

完成所有 Task 后，逐一验证：

1. `cargo check` 通过，无新增 warning
2. `pnpm tsc --noEmit` 通过
3. 手动测试：打一个更高版本的 tag（如 `v0.2.99`），推送到 GitHub，本地启动应用，确认弹窗出现
4. 点击"稍后"，Modal 关闭，应用正常使用
5. 点击"立即更新"，进度条推进，安装完成后应用自动重启为新版本
6. 网络断开时启动，无报错弹窗，正常使用
