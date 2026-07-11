# JarPorter 优化 Backlog 实施计划

> **For agentic workers:** 可按 Wave 顺序实施；大拆分任务建议 subagent-driven。  
> **约束：** 不实施 OPT-001 / OPT-002（frozen）。**未经用户明确要求禁止 `git commit` / `git push`。**

**Goal:** 落地规格 `docs/superpowers/specs/2026-07-11-optimization-backlog-design.md` 中全部 **open** 条目（除 001/002）。

**Architecture:** 分四波：快赢（安全日志+文档）→ 后端分文件 → 前端状态下沉 → 测试与体验收尾。每波可独立验收。

**Tech Stack:** Tauri 2 + React 19 + Rust；diag 日志；pnpm；cargo test。

## Global Constraints

- 应用根：`jar-to-harbor/`
- 不改 FTP/Harbor 凭证存储策略（OPT-001/002 frozen）
- 对外 Tauri command 签名与行为尽量不变（结构拆分时）
- Landing 不变量见 `CLAUDE.md`（临时目录、预览只读、127.0.0.1）
- 诊断日志模块名约定见 `CLAUDE.md`
- 提交策略：仅用户说「提交」时 commit

## 文件职责（目标态）

| 区域 | 目标 |
|------|------|
| `diag.rs` | 统一写日志 + 敏感字段脱敏 |
| `build/` 或 `build_*.rs` | package / push / detect 分离 |
| `landing/` | generate / ftp / templates |
| `settlement/` | parse / write / parallel |
| `utils` 拆分 | paths / process / npm_cache / config_io |
| `App.tsx` | 壳 + tab；逻辑进 hooks |
| `docs` | 边界、OPS、冒烟、UI 双轨、版本 |

---

## Wave 1 — 快赢（P0 部分 + P4 + 小 P1/P3）

### Task 1: OPT-003 诊断日志脱敏

**Files:**
- Modify: `src-tauri/src/diag.rs`
- Test: `src-tauri/src/diag.rs` 内 `#[cfg(test)]`

**Produces:** `redact_secrets(s: &str) -> String`；`diag_log` 写入前调用

- [ ] **Step 1:** 实现 `redact_secrets`：对常见模式替换为 `***`  
  - 键值：`password=` / `passwd=` / `token=` / `authorization=` / `secret=`（大小写不敏感）后的非空白串  
  - `Bearer <token>`  
  - 不修改非敏感路径日志
- [ ] **Step 2:** `diag_log` 对 `message` 先 `redact_secrets` 再写 stderr/文件
- [ ] **Step 3:** 单测：含 `password=foo` / `Bearer abc` 的字符串脱敏后不含明文
- [ ] **Step 4:** `cd src-tauri && cargo test diag -- --nocapture` 通过  
- [ ] **不 commit**（除非用户要求）

### Task 2: OPT-018 / 041 / 042 / 023 / 040 文档

**Files:**
- Modify: `CLAUDE.md`（UI 双轨、版本入口、应用根）
- Modify: `README.md`（应用根一句 + 可选 OPS 链接）
- Create: `docs/smoke-checklist.md`（冒烟清单）
- Create 或节：`docs/ops-vs-full.md`（OPS vs 完整版对照）

- [ ] **Step 1:** CLAUDE 增加「UI 双轨」：运营系（Landing/Settlement/Merge/PackSpeed）优先 Mantine；构建系（Upload/Branch/Push/History/Config）沿用现有 CSS，新代码不引入第三套
- [ ] **Step 2:** CLAUDE/README 写清应用根 = 本仓库 `jar-to-harbor/`，勿用父目录 `Desktop/tauri` 当 app 根
- [ ] **Step 3:** 版本：仅通过 `pnpm version:set` / `version:patch` 等改版本
- [ ] **Step 4:** 冒烟清单：上传推送、分支打包、镜像推送、落地页预览+FTP、结算、历史、更新检查
- [ ] **Step 5:** OPS 对照表：`OPS_MODE=true` 隐藏非运营菜单（与 `is_ops_mode` / 前端逻辑一致处据实填写）
- [ ] **不 commit**

### Task 3: OPT-017 进度 emit helper + OPT-030 缓存日志已覆盖则补齐

**Files:**
- Modify: `src-tauri/src/build.rs`（及必要时 `utils` 缓存路径）

- [ ] **Step 1:** 增加  
  `fn emit_progress(app: &AppHandle, percent: u32, message: impl AsRef<str>)`  
  内部 `app.emit("build-progress", json!({percent, message}))`
- [ ] **Step 2:** 将 `build.rs` 内重复 emit 块逐步替换为 helper（可分 PR 式分批，本波至少替换 package_from_branch / build_and_push 主路径）
- [ ] **Step 3:** 确认 npm cache hit/miss 已有 `diag_log`/`logs`；若缺 `diag_log("build"|"utils", hit/miss)` 则补一条
- [ ] **Step 4:** `cargo check` 通过  
- [ ] **不 commit**

---

## Wave 2 — 后端分文件（P1）

### Task 4: OPT-016 utils 拆分

**目标模块（名称可微调，保持 `pub(crate)`）：**
- `config_io.rs` — normalize_config, config_path, get_config_path  
- `npm_cache.rs` — lock_file_hash, try_restore, save_cache  
- `process_cmd.rs` — silent_command, run_command, find_maven/docker, CANCEL_FLAG  
- `paths_fs.rs` — temp dirs, copy helpers, render_template  

**Files:** 新建上述文件；`utils.rs` re-export 或删薄；`lib.rs` `mod`；迁移 tests

- [ ] 每迁一类后 `cargo test` / `cargo check`
- [ ] 不 commit

### Task 5: OPT-013 + 017 收尾 build 分文件

**建议：**
- `build/mod.rs` 对外 re-export commands  
- `build/package.rs` — package_from_branch  
- `build/push.rs` — build_and_push, push_local_image, list_local_images  
- `build/detect.rs` — list_npm_scripts, detect_frontend_dir, detect_spring_profiles, check_dockerfile  
- `build/progress.rs` — emit_progress  

- [ ] `lib.rs` invoke_handler 路径不变（仍 `use build::...`）
- [ ] 行为回归：手动或现有流程分支打包命令预览不变
- [ ] 不 commit

### Task 6: OPT-014 landing 分文件

- `landing/mod.rs`, `generate.rs`, `ftp.rs`, `templates.rs`  
- **禁止**改 FTP 常量策略（001 frozen）；仅移动代码  
- 保持 CLAUDE landing 不变量  
- 不 commit

### Task 7: OPT-015 settlement 分文件

- parse / write / parallel / mod  
- 现有 `#[cfg(test)]` 全部绿  
- 不 commit

---

## Wave 3 — 前端（P1 + P3 部分）

### Task 8: OPT-010 App 状态下沉

**样板：** `src/hooks/useLanding.ts`

**建议 hooks：**
- `useUploadPush.ts` — 上传/推送状态与 handler  
- `useBranchPack.ts` — 分支打包、spring profile、commit list 相关  
- `useBuildProgress.ts` — isBuilding / progress / log / cancel  
- `useAppConfig.ts` — config load/save  

- [ ] App.tsx 只保留 tab、布局、组合 hooks  
- [ ] 目标：App.tsx 行数明显下降（方向：&lt;800 或更少，以行为正确为准）  
- [ ] 不 commit

### Task 9: OPT-011 / 012 CSS 与面板拆分

- App.css 按 layout / upload / branch / history… 拆文件，`App.tsx` 或入口 import  
- LandingPanel / MergePanel / BranchPanel 按表单/列表/进度拆子组件  
- 不 commit

### Task 10: OPT-032 无关重渲

- 随 010：状态下沉后用 React DevTools 定性验证  
- 必要时 `memo` 面板组件  
- 不 commit

---

## Wave 4 — 测试与体验（P2/P3）

### Task 11: OPT-020 / 021 后端测试

- Dockerfile/模板 `render_template`、路径推断、PASV 解析等纯函数单测  
- `cargo test`  
- 不 commit

### Task 12: OPT-022 前端 test 脚本

- `package.json` 增加 `"test": "node --test scripts/**/*.test.ts"` 或项目现有可运行方式  
- `pnpm test` 绿  
- 不 commit

### Task 13: OPT-031 / 033

- 031：`docs/superpowers/notes/git-large-repo.md` 评估结论（可先笔记，不改默认行为）  
- 033：阶段枚举 + 前端映射（依赖 017 完成）  
- 不 commit

---

## 验收总表

| ID | Wave | 验收 |
|----|------|------|
| 003 | 1 | 单测 + 日志无明文 password/token |
| 018,041,042,023,040 | 1 | 文档存在且 CLAUDE 有约定 |
| 017,030 | 1 | helper 用上；缓存 hit/miss 可观测 |
| 016,013,014,015 | 2 | cargo check/test；command 行为不变 |
| 010,011,012,032 | 3 | UI 功能正常；App 变薄 |
| 020,021,022,031,033 | 4 | 测试命令绿；笔记/阶段模型 |

**Frozen 不在计划内：** 001, 002

---

## Spec 覆盖自检

- open 条目均有 Wave/Task  
- 001/002 明确排除  
- 无「TBD 实现」空步骤（大拆分给了文件边界与验收，细节在执行时按现有代码移动）  
- 提交策略与用户反馈一致  

---

## 执行选择

计划写入后默认 **本会话 Inline 从 Wave 1 开始做**（用户已授权「除敏感外都要做」）。  
大拆分（Wave 2–3）可继续本会话或改 subagent。

**开始执行：Wave 1 Task 1–3。**
