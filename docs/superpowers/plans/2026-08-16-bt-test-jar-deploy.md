# test JAR 自动 FTP + 宝塔重启 Implementation Plan

> **For agentic workers:** 按任务顺序实现；步骤用 checkbox 跟踪。不自动 commit（除非用户要求）。

**Goal:** Maven/`package_from_branch` 在 `spring_profile=test` 且产物为 JAR 时，自动 FTP 覆盖宝塔 Java 项目 JAR 并 `restart_project`。

**Architecture:** 新模块 `build/bt_deploy.rs` 负责签名 HTTP + 匹配 + 编排；扩展 `landing/ftp.rs` 支持自定义账号与单文件上传；在 `finish_package` 成功路径末尾调用；配置进 `HarborConfig`。

**Tech Stack:** Rust / Tauri 2 / reqwest (blocking + danger_accept_invalid_certs) / md-5 / 现有 FTP 客户端

**Spec:** `docs/superpowers/specs/2026-08-16-bt-test-jar-deploy-design.md`

## Global Constraints

- 仅 Java JAR；前端延后
- 不走 bt-gateway；直连面板
- 部署失败不阻断打包成功
- `diag_log("build", …)`；密钥不进 git 默认值
- FTP 默认 `47.107.51.228` / `admin` / `pcm520..`
- 面板默认 `https://47.107.51.228:10163`，`insecure=true`

## File map

| File | Role |
|------|------|
| `src-tauri/src/build/bt_deploy.rs` | 签名、列项目、匹配、重启、编排 |
| `src-tauri/src/landing/ftp.rs` | `connect_with` + `run_ftp_upload_file_with` |
| `src-tauri/src/build/package_finish.rs` | 钩子 |
| `src-tauri/src/build/mod.rs` | `mod bt_deploy` |
| `src-tauri/src/models.rs` | 配置字段 + `bt_deploy_summary` |
| `src/types.ts` / `useAppConfig.ts` / `ConfigPanel.tsx` | 前端配置 |
| `src-tauri/Cargo.toml` | `md-5` |

---

### Task 1: 配置字段 + 签名/匹配单测

**Files:** `models.rs`, `types.ts`, `useAppConfig.ts`, `Cargo.toml`, `bt_deploy.rs`（签名+匹配+测试）

- [x] 在 `HarborConfig` / TS 增加 `bt_*` 字段与 Default
- [x] 加 `md-5` 依赖；实现 `bt_request_token` 与 `match_java_project`；单元测试

### Task 2: FTP 单文件上传

**Files:** `landing/ftp.rs`, `landing/mod.rs`（如需 re-export）

- [x] `FtpClient::connect_with(host, user, pass)`
- [x] `run_ftp_upload_file_with(local, remote_full_path, host, user, pass, log_module)`

### Task 3: 面板 HTTP + 部署编排

**Files:** `bt_deploy.rs`, `package_finish.rs`, `mod.rs`

- [x] `project_list` / `restart_project` POST
- [x] `maybe_deploy_test_jars(...)` 在 finish_package 调用
- [x] 结果写入 `log` 与 `bt_deploy_summary`

### Task 4: Config UI

**Files:** `ConfigPanel.tsx`, `useAppConfig.ts`（bool 字段）

- [x] JAR 分区增加宝塔部署表单
- [x] `cargo test` / `tsc` 验证

---

执行方式：本会话 inline 实现全部任务。
