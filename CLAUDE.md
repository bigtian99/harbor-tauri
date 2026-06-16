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

## Tauri Plugins

- `@tauri-apps/plugin-dialog` — native file/directory picker
- `@tauri-apps/plugin-shell` — shell command execution
- `@tauri-apps/plugin-opener` — open URLs/files in system default app

## CI/CD

GitHub Actions workflow (`build.yml`) builds for macOS (ARM64 + x64), Linux x64, and Windows x64 on tag push (`v*`). Uses pnpm 9, Node 20, and Rust stable.
