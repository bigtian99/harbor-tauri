# KS 批量复制到其他环境 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 勾选部署后一键复制到目标环境+命名空间（Deployment + 可选 ConfigMap + 发布映射）

**Architecture:** 前端编排 `runKsBatchCloneToEnv`，复用现有 `ks_*` 命令；确认弹窗 + 复用进度弹窗；映射写入后 `save_config`。

**Tech Stack:** React/Mantine、Tauri invoke、现有 `KsPublishPanel` 勾选态

---

### Task 1: 核心编排 `ksBatchCloneDeploy.ts`

**Files:**
- Create: `src/utils/ksBatchCloneDeploy.ts`

导出 `runKsBatchCloneToEnv`、`KsBatchCloneSummary`、冲突策略类型；Phase A 读源、Phase B 写目标、映射 merge、`save_config`；诊断日志。

### Task 2: ConfigMap 覆盖 API（若缺）

**Files:**
- Modify: `src-tauri/src/kubesphere.rs`、`lib.rs`

新增 `ks_replace_configmap`（GET + 改 data + PUT），供 overwrite 用。

### Task 3: 确认弹窗 + 进度标题

**Files:**
- Create: `src/components/KsBatchCloneModal.tsx`
- Modify: `src/components/KsBatchPackModal.tsx`（进度 Modal 可选 title）

### Task 4: 接入 `KsPublishPanel` + App 配置回写

**Files:**
- Modify: `src/components/KsPublishPanel.tsx`、`src/App.tsx`

工具栏按钮、状态、调用 clone、完成后刷新列表 / 切回源会话。

### Task 5: 验收

`pnpm exec tsc --noEmit`；`cargo check`；更新 design 状态为已实现。
