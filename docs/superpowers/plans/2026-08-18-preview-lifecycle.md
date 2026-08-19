# Preview Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地预览服务器只在 `landing` / `privacy` 相关页面使用时启动，离开后延迟关闭，减少空闲常驻占用。

**Architecture:** 前端把“哪些 tab 需要预览服务”抽成纯逻辑函数并驱动生命周期；后端把预览服务器改成按需启动/停止的托管状态，而不是应用启动即常驻。关闭采用空闲延迟回收，避免相关页面之间切换时频繁抢端口。

**Tech Stack:** React 19 + TypeScript；Tauri 2；Rust；Node test；cargo check。

## Global Constraints

- 不引入新依赖。
- 保持预览根目录仍复用 `landing::landing_temp_root()`。
- `privacy` 预览继续复用同一套本地 HTTP 预览服务。
- 关键生命周期动作补 `preview` 模块诊断日志。

---

### Task 1: 前端生命周期判定

**Files:**
- Create: `src/utils/previewLifecycle.ts`
- Create: `scripts/preview-lifecycle.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `shouldKeepPreviewServer(tab: TabType | null | undefined): boolean`

- [ ] 写失败测试，覆盖 `landing` / `privacy` 返回 `true`，其它 tab 返回 `false`
- [ ] 跑 `pnpm test`，确认新测试先红
- [ ] 实现最小 helper，并在 `App.tsx` 中接入 tab 生命周期 effect
- [ ] 再跑 `pnpm test`

### Task 2: 后端按需启动与停止

**Files:**
- Modify: `src-tauri/src/preview_server.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/privacy.rs`
- Modify: `src/hooks/useLanding.ts`

**Interfaces:**
- Produces: `ensure_preview_server_started`
- Produces: `stop_preview_server`
- Produces: `get_preview_server_info -> Option<PreviewServerInfo>`

- [ ] 把预览服务状态改成托管 runtime，支持启动、查询、停止
- [ ] `privacy` 预览改为按需启动后再取 base URL
- [ ] `landing` 进入页面时确保启动，离开相关页面后由 `App.tsx` 延迟关闭
- [ ] 跑 `cargo check`、`pnpm test`、`pnpm exec tsc --noEmit`
