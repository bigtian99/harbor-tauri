# Harbor 多环境 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harbor 多套完整连接（开发/生产等）；凡推送 Harbor 的 UI 提供环境下拉，默认上次选中。

**Architecture:** 镜像 `ks_environments`：`harbor_environments[]` + `harbor_last_env_id`；`normalize_config` 迁移旧四字段并 mirror 到顶层；前端 `harborEnvironments.ts` 解析；共用 `HarborEnvSelect` 组件挂到各推送入口；推送命令可选 `harbor_env_id`。

**Tech Stack:** React 19 + Mantine Select、Rust Tauri config/models、现有 `build_and_push` / `push_local_image`

**Spec:** `docs/superpowers/specs/2026-09-08-harbor-multi-env-design.md`

## Global Constraints

- 与 KS 环境列表独立，不共用 id
- 不引入第三套 UI；运营向用 Mantine，构建/推送沿用现有面板样式 + Mantine Select 可混用（Branch/KS 已混）
- 诊断日志用 `diag_log`，模块 `config` / `build` / `docker`
- 密码不明文进日志

## File map

| File | Responsibility |
|------|----------------|
| `src/types.ts` | `HarborEnvironment` + config 字段 |
| `src/utils/harborEnvironments.ts` | resolve/pick/create（新） |
| `scripts/harborEnvironments.test.ts` | 单元测试（新） |
| `src/components/HarborEnvSelect.tsx` | 共用下拉（新） |
| `src-tauri/src/models.rs` | Rust 结构体与 Default |
| `src-tauri/src/utils/config_io.rs` | migrate + mirror |
| `src-tauri/src/build/push.rs` + helpers | 可选 env_id、require |
| `src/components/ConfigPanel.tsx` | Harbor 连接列表 UI |
| `src/hooks/useAppConfig.ts` | 默认 config 字段 |
| `src/hooks/useUploadPush.ts` | 上传/推送用活跃环境 |
| `src/components/UploadPanel.tsx` / `PushImagePanel.tsx` | 挂载 Select |
| `src/components/BranchPanel.tsx` + hooks | 挂载 Select |
| `src/components/HistoryPanel.tsx` + App 推送路径 | 挂载 Select |
| `src/components/KsBatchPackModal.tsx` | 挂载 Select |
| `src/components/merge/MergeFormSection.tsx` | 同步打包推 Harbor 时 Select |

---

### Task 1: 类型 + 前端 resolve + 测试

- [ ] 新增 `HarborEnvironment`；扩展 `HarborConfig`
- [ ] 实现 `src/utils/harborEnvironments.ts`
- [ ] `scripts/harborEnvironments.test.ts`：legacy 迁移视图、pick last、空列表
- [ ] 跑 `node --test scripts/harborEnvironments.test.ts`

### Task 2: Rust 模型 + normalize 迁移

- [ ] `models.rs`：`HarborEnvironment`、`harbor_environments`、`harbor_last_env_id`
- [ ] `config_io.rs`：`migrate_harbor_environments`（对齐 KS；mirror 顶层四字段）
- [ ] 单元测试（config_io 内或现有测试模块）
- [ ] `cargo test -p jarporter migrate_harbor`（或相关 filter）

### Task 3: 推送命令支持 `harbor_env_id`

- [ ] `require_harbor_config` / 解析：按 env_id 或 last 选环境后写入本次用的 url/user/pass/project
- [ ] `build_and_push` / `push_local_image` 增加可选参数；`diag_log` 打环境名
- [ ] `cargo check`

### Task 4: 设置页 Harbor 列表 UI

- [ ] ConfigPanel connection Tab：列表 + 编辑弹窗 + 测登录（对草稿）
- [ ] FTP 区块保留

### Task 5: `HarborEnvSelect` + 上传 / 推送镜像

- [ ] 共用组件：props = config, value, onChange, disabled?
- [ ] UploadPanel + PushImagePanel；useUploadPush 用活跃环境拼地址并传 `harborEnvId`

### Task 6: 分支 / 历史 / 批量 / 合并

- [ ] BranchPanel「推送与发布」区
- [ ] History 再推路径
- [ ] KsBatchPackModal
- [ ] Merge 同步打包会推 Harbor 时

### Task 7: 验收

- [ ] `pnpm tsc --noEmit`（或项目惯用检查）
- [ ] `cargo check`
- [ ] 手动冒烟清单对照 spec 验收节
