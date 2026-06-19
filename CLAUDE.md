# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JarPorter is a Tauri 2.0 desktop app that packages JAR files or frontend `dist` directories into Docker images and pushes them to a Harbor registry. It also supports branch-based packaging via git worktree isolation.

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

# Release (tag + push)
pnpm release
```

## Architecture

**Frontend** (`src/`): React 19 + TypeScript + Vite. Single-page app with three tabs — upload push, branch packaging, and Harbor config. The main UI logic lives in `App.tsx` (~1270 lines).

**Backend** (`src-tauri/src/`): Rust via Tauri 2.0. All core logic is in `lib.rs` (~1450 lines). The frontend communicates with the backend via `invoke()` calls to Tauri commands.

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

## CI/CD

GitHub Actions workflow (`build.yml`) builds for macOS (ARM64 + x64), Linux x64, and Windows x64 on tag push (`v*`). Uses pnpm 9, Node 20, and Rust stable.
