# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JarPorter is a Tauri 2.0 desktop app that packages JAR files or frontend `dist` directories into Docker images and pushes them to a Harbor registry. It also supports branch-based packaging via git worktree isolation.

**应用根目录**：本仓库 `jar-to-harbor/`（勿把父目录 `Desktop/tauri` 当成 app 根）。

## Build & Development Commands

```bash
# Frontend only (Vite dev server on port 1420)
pnpm dev

# Full Tauri dev (frontend + Rust backend hot reload)
pnpm tauri

# Production build (platform binary)
pnpm tauri:build

# Architecture-specific builds
pnpm tauri:build:arm64      # macOS ARM64
pnpm tauri:build:x64        # macOS x64
pnpm tauri:build:universal  # macOS universal

# OPS 构建（裁剪非运营菜单，见 docs/ops-vs-full.md）
pnpm tauri:build:ops
pnpm tauri:build:ops:win64

# 版本号（唯一入口，同步 package.json / Cargo.toml / tauri.conf.json）
pnpm version:set <x.y.z>
pnpm version:patch   # 或 minor / major

# Release (tag + push)
pnpm release
```

**冒烟清单**：发版前见 [docs/smoke-checklist.md](docs/smoke-checklist.md)。

## Architecture

**Frontend** (`src/`): React 19 + TypeScript + Vite。主 UI 逻辑在 `App.tsx` 与各 `components/*Panel`。

**Backend** (`src-tauri/src/`): Rust via Tauri 2.0。入口 `lib.rs` 注册 command；业务在 `build` / `landing` / `settlement` 等模块。

### UI 双轨约定（OPT-018）

| 体系 | 面板 | 说明 |
|------|------|------|
| **Mantine** | Landing、Settlement、Merge、PackSpeed 等运营向 | 优先用 `@mantine/core` + notifications |
| **现有 CSS** | Upload、Branch、Push、History、Config、侧栏 | 沿用 `App.css` / 面板样式 |

新代码：**不要引入第三套 UI 体系**。新增运营功能跟 Mantine；新增构建/推送跟现有 CSS。

### OPS vs 完整版

见 [docs/ops-vs-full.md](docs/ops-vs-full.md)。

**Key Tauri commands** (defined in `lib.rs`, invoked from `App.tsx`):
- `load_config` / `save_config` — persist Harbor settings to `~/.config/jarporter/config.json`
- `build_and_push` — build Docker image from JAR or dist, push to Harbor, then clean up local image
- `package_from_branch` — git fetch → worktree create → build artifact → optional auto-push
- `list_git_branches` — read local and remote branches from a repo
- `detect_spring_profiles` — scan `src/main/resources` for `application-*.yml` profiles
- `list_npm_scripts` / `detect_frontend_dir` — read package.json scripts, detect frontend subdirectory
- `open_directory` — open folder in system file manager

**Config storage**: `~/.config/jarporter/config.json` (migrates from legacy `jar-to-harbor` directory if found).

**Template system**: Frontend Dockerfile and nginx.conf use `{{VARIABLE}}` placeholders (`BASE_IMAGE`, `EXPOSE_PORT`, `DIST_DIR`, `NGINX_CONF_PATH`, etc.) rendered at build time.

## Key Design Decisions

- **Artifact types**: `"jar"` uses Eclipse Temurin base image with custom entrypoint; `"frontend_dist"` copies dist contents into nginx site root (no nested `dist/` in image).
- **Branch packaging**: Uses `git worktree` for isolation, cleans up temp dirs on completion. Supports both Maven (`mvn clean package -DskipTests`) and npm (`npm install && npm run <script>`).
- **npm cache**: `node_modules` are cached by lock file hash at `~/.cache/jarporter/npm-cache/` to speed up repeated builds.
- **Temp dirs**: Prefixed `jarporter-worktree-` and `jarporter-build-` in system temp directory; old leftovers are cleaned on app start.

## 落地页生成与预览（Landing）

落地页生成与预览涉及三个组件，改动时务必遵守以下不变量：

- **数据流**：`fetch_sub_channels`（取渠道）→ `generate_landing_pages`（按 `type_code` 找模板目录、复制到临时输出目录、用 `render_template` 渲染 `{{NAME}}`/`{{LOGO}}`/`{{DOWNLOAD_URL}}` 占位符）→ iframe 预览 → `upload_landing_to_ftp`（Python 脚本上传）。
- **临时输出根目录是单一真相源**：`landing::landing_temp_root()`（`{temp}/jarporter-landing-pages`）。`get_temp_dir` 命令与预览服务器 `preview_server::preview_root()` 都复用它，**改根目录只能改这一处**，否则预览 404。
- **预览走本地 HTTP，不走 asset 协议**：模板 index.html 大量依赖本地相对路径图片/字体（`./image/xxx.png`、`url("./font/xxx.ttf")`），用 Tauri asset 协议 + iframe 加载会显示不出来。`preview_server.rs` 起一个只绑 `127.0.0.1`、系统分配端口的 tiny_http 静态服务器，iframe 用 `http://127.0.0.1:port/.../index.html` 加载，加载环境与 FTP 部署一致。前端 `getTemplateIframeSrc`（`LandingPanel.tsx`）据此拼 URL，服务未就绪时回退 `convertFileSrc`。
- **预览服务器只读不改文件**：它只读取与 FTP 上传相同的文件，**绝不能为预览改写 index.html 或资源**——否则会污染上传内容。需修改 HTML 时，只在 `generate_landing_pages` 的生成阶段改。
- **预览服务器有意不下发 CSP**：让预览页与真实部署一致（内联脚本、远程字体都加载）。仅绑 `127.0.0.1`、仅响应 GET/HEAD、有路径穿越防护（canonicalize + starts_with）。
- **CSP**：`tauri.conf.json` 的 `frame-src` / `img-src` 已放开 `http://127.0.0.1:*` 与 `http://localhost:*` 以容纳预览 iframe。
- **FTP 凭证**：`landing.rs` 顶部硬编码了 FTP host/user/pass（历史遗留）。新增上传逻辑时尽量改走配置，不要在别处再复制一份硬编码。

## Tauri Plugins

- `@tauri-apps/plugin-dialog` — native file/directory picker
- `@tauri-apps/plugin-shell` — shell command execution
- `@tauri-apps/plugin-opener` — open URLs/files in system default app

## 日志规范（强制性）

**每个功能开发都必须输出诊断日志**，方便通过「系统日志」查看器排查问题，不依赖控制台或外部工具。

### 现状结论（已落地）

| 能力 | 状态 | 说明 |
|------|------|------|
| 统一诊断 API | ✅ 已落地 | `crate::diag::diag_log(module, msg)`：写 stderr + 当天诊断文件 |
| 按模块打标签 | ✅ 已落地 | 行格式 `[JarPorter][{module}] {message}`，可按 `[updater]` 等过滤 |
| 按天滚动文件 | ✅ 已落地 | `app_log_dir/diagnostic-YYYY-MM-DD.log`（`diag::init` 于启动时设置目录） |
| 侧边栏「系统日志」 | ✅ 已落地 | `read_diagnostic_log` 默认合并最近 ≤3 天，**新日志在前**，支持关键词搜索与日期下拉切换 |
| 兼容入口 | ✅ 已落地 | `templates_log(msg)` ≡ `diag_log("templates", msg)` |

**结论**：业务路径必须用 `diag_log` 带正确模块名；禁止业务路径仅用 `eprintln!`（系统日志看不到）。  
**敏感信息**：`diag_log` 会脱敏 `password` / `token` / `Bearer` / `authorization` 等字段值，业务侧仍勿主动拼接明文密钥。

### 日志格式

```text
[YYYY-MM-DD HH:MM:SS] [JarPorter][模块名] 消息内容
```

示例：

```text
[2026-07-11 04:26:46] [JarPorter][updater] check_update: current=0.2.36, latest=0.2.37, needs_update=true
[2026-07-11 04:27:01] [JarPorter][landing] generate_landing_pages base=... count=3
[2026-07-11 04:27:10] [JarPorter][build] package_from_branch repo=... branch=main
```

系统日志搜索框输入 `[updater]` / `[landing]` / `[build]` 即可只看该模块。

### 模块名约定（固定小写英文，禁止临时造词）

| 模块名 | 对应代码 / 功能 |
|--------|-----------------|
| `templates` | 模板目录 init、list、上传/删除、资源 resolve |
| `landing` | 渠道拉取、落地页生成、FTP 上传 |
| `preview` | 本地预览 HTTP 服务（`preview_server`） |
| `updater` | 检查更新、下载、安装 |
| `build` | JAR/dist 构建推送、分支打包 `package_from_branch` |
| `git` | 分支列表、worktree、commit 查询 |
| `docker` | 本地镜像、tag、push、清理 |
| `ops` | 运营/打包加速等 ops 相关命令 |
| `settlement` | 结算模块 |
| `history` | 构建历史读写 |
| `config` | 配置 load/save |
| `db` | 本地数据库初始化 |
| `utils` | 通用工具、路径/进程等辅助逻辑 |
| `app` | 启动总控、跨模块、无法归类时 |

新增业务模块时：**先在本表加一行**，再写代码，禁止无表自创 tag。

### Rust 后端日志（已落地）

实现位于 `src-tauri/src/diag.rs`。统一 API：

```rust
crate::diag::diag_log("updater", &format!("check_update: current={cur}, latest={latest}"));
crate::diag::diag_log("build", &format!("package_from_branch repo={repo} branch={branch}"));
crate::diag::diag_log("landing", &format!("generate_landing_pages base={} count={}", base.display(), n));
// 兼容
templates_log("list_template_infos ok"); // ≡ diag_log("templates", ...)
```

行格式必须是：`[JarPorter][{module}] {message}`（文件中另有时间戳前缀）。

**存储与读取**：

- 写入：当天文件 `diagnostic-YYYY-MM-DD.log`（目录由 `diag::init` 设为 `app_log_dir`）
- 读取：`read_diagnostic_log` 默认合并最近 **≤3 天** 的 `diagnostic-*.log`，新日志在前；传 `{ day: "YYYY-MM-DD" }` 时仅读该日
- 列日期：`list_diagnostic_log_dates` 返回 `[{date, size, lines}]`（按日期降序），供 UI 日期下拉
- 路径查询：`get_templates_diagnostic_log_path` 返回当天文件路径

规则：

1. **新功能 / 改现有命令**：关键路径必须 `crate::diag::diag_log(模块名, …)`；禁止业务路径仅用 `eprintln!`。
2. **错误路径必打**：API 失败、路径不存在、匹配失败、文件 IO 错误——带实际路径/参数/返回值。
3. **输入与决策点**：每个 Tauri 命令至少一条：入参摘要 + 关键分支（选了哪条路径）。
4. **`eprintln!`**：禁止作为业务诊断手段；合入前要么删，要么改为 `diag_log`。
5. **`templates_log`**：仅 templates 域兼容封装，内部转发 `diag_log("templates", …)`；其它模块不得冒用，应写自己的模块名。

### 前端日志

- 关键 API 结果：`notifications.show` 通知用户
- 调试：`console.error`（dev 终端可见）
- 需要事后排查的链路：走后端诊断日志，不要只打在浏览器控制台

### 日志查看与验收

- 入口：侧边栏底部 **「系统日志」** → `read_diagnostic_log`（默认最近 ≤3 天合并）
- 按日期切换：顶部日期下拉默认「最近 3 天」；选 `YYYY-MM-DD` 时传 `{ day }` 仅读该日；选项来自 `list_diagnostic_log_dates`
- 搜索：`[模块名]` 过滤模块；再叠加关键词（如 `check_update`、`FTP`）
- 开发完成自检：打开系统日志 → 搜本功能模块 tag → 确认关键步骤有记录且模块名正确
- 当天文件：`get_templates_diagnostic_log_path`（打包后 GUI 无控制台时可直接打开该路径）

## CI/CD

GitHub Actions workflow (`build.yml`) builds for macOS (ARM64 + x64), Linux x64, and Windows x64 on tag push (`v*`). Uses pnpm 9, Node 20, and Rust stable.
