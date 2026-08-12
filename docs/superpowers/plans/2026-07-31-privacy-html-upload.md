# 隐私协议 HTML 上传 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 运营菜单「隐私协议」：多选 HTML → FTP 上传到 `common.tiankongshuyu.cn` → 返回 URL，并本页持久化历史（勾选批量删 / 清空）。

**Architecture:** 新 `privacy` 后端模块 + 参数化 FTP connect；前端 Mantine `PrivacyPanel`；历史存 `privacy_uploads.json`。

**Tech Stack:** Tauri 2 / Rust / React 19 / Mantine

---

### Task 1: FTP 参数化 + privacy 后端

- 改 `landing/ftp.rs`：`FtpClient::connect(host)`；`run_ftp_upload` 增加 host/base_dir 参数（落地页调用保持原常量）
- 新增 `src-tauri/src/privacy.rs`：upload / list / delete / clear + JSON 存储
- `lib.rs` 注册 commands；`diag_log("ops", …)`

### Task 2: 前端面板与导航

- `TabType` 加 `privacy`；`OPS_TABS` 加入；Sidebar 菜单「隐私协议」
- `PrivacyPanel.tsx` + hook；App 挂载
- 验收：cargo check；手动选 HTML 上传

Spec: `docs/superpowers/specs/2026-07-31-privacy-html-upload-design.md`
