# 自动更新功能设计

**日期**: 2026-07-10
**项目**: JarPorter
**版本**: 目标 0.3.0

## 概述

JarPorter 桌面应用支持自动检查、下载、安装 GitHub Releases 中的新版本。macOS 先行，后续扩展到 Windows/Linux。

## 决策记录

| 决策点 | 选择 |
|--------|------|
| 更新策略 | 混合模式：后台静默下载，安装前弹窗确认重启 |
| 更新机制 | 自定义逻辑，直接调 GitHub Releases API |
| 安装方式 | macOS `hdiutil` mount + `cp -R` 替换 /Applications 中的 .app |
| 平台范围 | macOS 先行 |
| 生命周期 | 最小闭环：检查→下载→安装→重启，失败提示手动下载 |

## 架构

```
┌──────────────────┐      GitHub Releases API        ┌─────────────────┐
│  Rust updater.rs │ ◄─────────────────────────────── │ GitHub Releases │
│  check_update()  │  GET /repos/daijunxiong/         │ (已有 CI 产出)   │
│  download_and_   │  jarporter/releases/latest       │                 │
│  install()       │                                  │                 │
└────────┬─────────┘                                  └─────────────────┘
         │ invoke
         ▼
┌──────────────────┐
│  React Frontend  │
│  UpdateModal.tsx │  进度通知 → 确认重启
└──────────────────┘
```

## 组件设计

### 1. Rust 后端 — `src-tauri/src/updater.rs`

新增模块，暴露两个 Tauri command。

#### 常量

```rust
const GITHUB_API_URL: &str = "https://api.github.com/repos/daijunxiong/jarporter/releases/latest";
const USER_AGENT: &str = "JarPorter-Updater/1.0";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
```

**ponytail**: owner/repo 硬编码。多仓库需求出现时改为配置项，无需提前设计。

#### `check_update()` → Result<UpdateInfo, String>

1. `reqwest::blocking::Client` GET `GITHUB_API_URL`，10 秒超时
2. 网络错误 → 静默返回 `{ needs_update: false }`，不弹错误（非关键路径）
3. 解析 JSON `tag_name`（如 `v0.2.31`）和 `assets[].{name, browser_download_url, size}`
4. 版本比较：当前版本 `env!("CARGO_PKG_VERSION")` vs `tag_name` 去 `v` 前缀后 semver 比较
5. 匹配当前平台 asset：macOS → 文件名含 `.dmg` 且含当前架构（`aarch64` / `x86_64` 即 `x64`）
6. 返回 `{ needs_update: bool, latest_version: String, download_url: String, file_size: u64 }`

#### `download_and_install(download_url: String)` → Result<(), String>

1. 创建缓存目录 `~/Library/Caches/jarporter/update/`
2. `reqwest::blocking::Client` GET `download_url`，流式写文件 `JarPorter-<version>.dmg`
3. 校验文件大小与 API 返回的 `size` 一致，不一致则删文件报错
4. `hdiutil attach <dmg_path> -nobrowse -quiet` → 拿 mount 点
5. `cp -R /Volumes/JarPorter/JarPorter.app /Applications/`
6. `hdiutil detach <mount_point> -quiet`
7. 删临时 dmg 文件
8. `open /Applications/JarPorter.app` → 拉起新版本
9. `std::process::exit(0)` → 退出当前进程

**每个步骤失败都返回明确错误信息**，前端展示给用户。

#### 依赖

- `reqwest` 0.12 — 已存在，复用 `blocking` feature（需确认 Cargo.toml 中有无此 feature）
- `semver` 1.0 — 需新增，版本号正规比较
- 文件操作全部走 `std::fs`，无需额外依赖
- `hdiutil`/`cp`/`open` 走 `std::process::Command`

#### Cargo.toml 变更

```diff
- reqwest = { version = "0.12", features = ["json"] }
+ reqwest = { version = "0.12", features = ["json", "blocking"] }
+ semver = "1"
```

### 2. 前端 — `src/components/UpdateModal.tsx`

使用 Mantine（项目已在用），匹配现有 UI 风格。

```tsx
// 组件接口（隐式，通过 props）
interface UpdateModalProps {
  opened: boolean;
  onClose: () => void;
  updateInfo: {
    currentVersion: string;
    latestVersion: string;
    fileSize: number;  // bytes
  };
}

// 状态机
type UpdatePhase = "idle" | "downloading" | "installing" | "done" | "error";
```

#### 视觉

- Modal，标题"发现新版本"
- 内容：当前版本 vs 最新版本，文件大小（MB）
- "立即更新"按钮 → 触发安装
- 安装中显示 Progress bar + 文字"正在下载…"/"正在安装…"
- 失败显示错误信息 + "手动下载"链接（打开 GitHub Releases 页面）
- 全部使用 Mantine 组件（Modal, Button, Progress, Text, Anchor）

#### 行为

- 安装过程中 Modal 不可关闭（`closeOnClickOutside={false}`）
- 安装成功后自动关闭，应用退出重启
- 用户选择"稍后"关闭 Modal，本次会话不再提醒

### 3. 集成 — `src/App.tsx` 变更

```tsx
// 启动时检查更新（延迟 2s，不阻塞首屏）
useEffect(() => {
  const timer = setTimeout(() => {
    invoke<UpdateInfo>("check_update").then((info) => {
      if (info.needs_update) setUpdateInfo(info);
    }).catch(() => {}); // 静默失败
  }, 2000);
  return () => clearTimeout(timer);
}, []);
```

### 4. Rust 注册 — `src-tauri/src/lib.rs` 变更

```diff
+ mod updater;
+ use updater::{check_update, download_and_install};

  .invoke_handler(tauri::generate_handler![
      ...
+     check_update,
+     download_and_install,
  ])
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 网络不通 | `check_update` 静默跳过，不影响正常使用 |
| GitHub API 限流 (60/h) | 返回空，不影响 |
| 下载中断 | 报错展示，提示手动下载 |
| dmg 校验失败 | 删临时文件，报错 |
| hdiutil 失败 | 报错展示 + 提示手动操作步骤 |
| 磁盘空间不足 | 报错展示 |
| 安装成功但启动失败 | 提示用户手动打开 `/Applications/JarPorter.app` |

## 测试策略

- **Rust 单元测试**：`check_update` 的 JSON 解析和版本比较逻辑（mock HTTP 响应）
- **手动测试**：打一个预发布 tag，验证完整流程
- **ponytail**: 不写集成测试框架，开发阶段手动跑一次即可验证闭环

## CI 影响

**无需改动 `.github/workflows/build.yml`**。现有 workflow 已经在 tag push 时自动创建 Release 并上传 assets，与自动更新的消费端完美对接。

唯一需确保：**Release asset 文件名保持现有格式**（如 `JarPorter_0.2.30_aarch64.dmg`），让 updater 能按平台+架构匹配到正确的文件。

## 改动清单

| 文件 | 操作 | 量级 |
|------|------|------|
| `src-tauri/src/updater.rs` | 新增 | ~180 行 |
| `src-tauri/src/lib.rs` | 修改 | +5 行 |
| `src-tauri/Cargo.toml` | 修改 | +2 features/deps |
| `src/components/UpdateModal.tsx` | 新增 | ~120 行 |
| `src/App.tsx` | 修改 | +15 行 |

总代码量 ~320 行，两个新文件，零新增外部服务。

## 自复审结果

### 占位符检查
- ✅ 无 TBD/TODO
- ✅ GitHub owner/repo 已硬编码（`daijunxiong/jarporter`）
- ✅ 版本号来源明确（`env!("CARGO_PKG_VERSION")`）

### 一致性检查
- ✅ 前后端接口一致：`check_update` 返回 `UpdateInfo { needs_update, latest_version, download_url, file_size }`
- ✅ Rust 使用 `reqwest::blocking`，Tauri command 天然跑在独立线程
- ✅ Mantine 组件与项目现有风格一致

### 范围检查
- ✅ 仅 macOS 平台，未扩展到 Windows/Linux
- ✅ 无回滚机制（有意省略）
- ✅ 无 beta 通道（有意省略）

### 歧义检查
- ✅ "当前版本"明确来自 `CARGO_PKG_VERSION`（编译时）
- ✅ 架构匹配逻辑明确：`aarch64` → 文件名含 `aarch64` 的 dmg，`x86_64` → 文件名含 `x64` 的 dmg
- ✅ 下载缓存路径明确：`~/Library/Caches/jarporter/update/`
