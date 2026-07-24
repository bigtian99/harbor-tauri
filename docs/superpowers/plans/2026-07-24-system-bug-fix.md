# 系统 Bug 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or inline execution per task.  
> **约束:** 未经用户明确要求禁止 `git commit` / `git push`。BUG-005 本计划不实施。

**Goal:** 合入 Docker in_use / PushImagePanel WIP，并修复复制按钮跨 Tab 误高亮与兜底行永不高亮。

**Architecture:** 共享 `src/copyImage.ts` 统一剪贴板文本与高亮比对；Rust 侧 `push.rs` 已用 inspect + 别名集合；前端搜索与 `localImage` 分离。

**Tech Stack:** Tauri 2 + React 19 + Rust；`pnpm test`；`cargo test in_use_tests`

## Global Constraints

- 应用根：`jar-to-harbor/`
- 不实施 OPT-001/002、BUG-005（并行取消）
- 诊断日志模块名不变
- 提交策略：仅用户说「提交」时 commit

---

### Task 1: 合入 Docker in_use 修复（BUG-003）

**Files:**
- Modify: `src-tauri/src/build/push.rs`（工作区已有）

- [x] `remember_in_use_key` / `split_repo_tag` / `is_image_in_use`
- [x] `in_use_tests` 四个单测
- [ ] 手动：`docker ps` 有容器时列表 `in_use` 正确

**Verify:**

```bash
cd src-tauri && cargo test in_use_tests -- --nocapture
```

Expected: 4 passed

---

### Task 2: PushImagePanel 搜索/选中分离（BUG-004）

**Files:**
- Modify: `src/components/PushImagePanel.tsx`, `src/styles/upload.css`

- [x] `query` 与 `localImage` 分离；Enter 提交；`image-selected-bar`
- [ ] 手动：选中镜像 → 搜索 → 选中不变

---

### Task 3: 复制高亮统一（BUG-001 / BUG-002）

**Files:**
- Create: `src/copyImage.ts`
- Create: `scripts/copyHighlight.test.ts`
- Modify: `src/components/UploadPanel.tsx`, `src/components/BranchPanel.tsx`

**Interfaces:**
- Produces: `normalizeCopyText(display: string): string`
- Produces: `isCopyHighlighted(copied: string | null, display: string): boolean`

- [x] 实现 `copyImage.ts`
- [x] UploadPanel：`fullImageCopied` / `fullImageCopyText`
- [x] BranchPanel fallback：`branchFallbackCopied` / `branchFallbackCopyText`
- [x] 单测 `copyHighlight.test.ts`

**Verify:**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Expected: 10 tests pass（含新 copyHighlight）；build 绿

---

### Task 4: 文档与已知限制

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-system-bug-audit-design.md`（状态 → 已实施 Wave 1–2）

- [x] BUG-005 保留为已知限制（npm 并行 push + 取消）
- [ ] 冒烟：`docs/smoke-checklist.md` 构建推送章节（需桌面 + Docker 环境）

---

## 验收总表

| ID | 状态 | 验收 |
|----|------|------|
| BUG-001 | done | 跨 Tab 复制仅对应行高亮 |
| BUG-002 | done | 兜底行复制后按钮高亮 |
| BUG-003 | code done | cargo test + 手动 docker |
| BUG-004 | code done | 手动搜索/选中 |
| BUG-005 | deferred | 文档已知限制 |

---

## Spec 覆盖

- Wave 1–2 与 spec 方案 A 一致
- BUG-005 按约定 defer
