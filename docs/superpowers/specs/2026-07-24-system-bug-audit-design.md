# JarPorter 系统 Bug 排查与修复计划

**日期**: 2026-07-24  
**状态**: Wave 1–3 已实施（BUG-005 多 PID 槽 2026-09-03）  
**方法**: systematic-debugging Phase 1–2 + 代码 diff / 测试证据  
**非目标**: 本规格不实施 OPT-001/002（凭证 frozen）；不做无 ID 的大重构

---

## 1. 排查结论摘要

| 类别 | 数量 | 说明 |
|------|------|------|
| **P0 功能错误（已定位根因）** | 2 | 复制按钮高亮逻辑错误 |
| **P1 环境/平台兼容（WIP 已改未合）** | 1 | Docker 29+ 镜像占用检测 |
| **P1 UX 回归风险（WIP 已改未合）** | 1 | 推送页搜索与选中分离 |
| **P2 架构债（取消/并行）** | 1 | npm 双镜像并行 push 取消不完整 |
| **验证通过** | — | `cargo test` 37、`pnpm test` 9、`tsc`/`pnpm build` 绿 |

---

## 2. Bug 清单（根因 + 证据）

### BUG-001 · UploadPanel 复制高亮误触发（P0）

| 字段 | 内容 |
|------|------|
| **现象** | 在分支/推送/历史任一 Tab 复制镜像后，上传 Tab 的「完整镜像」行也会显示「已复制」高亮 |
| **根因** | 三 Tab 共享 `useBuildProgress.copied: string \| null`，但 `UploadPanel` 用 `copied !== null` 判断高亮，而非 `copied === fullImage` |
| **证据** | `UploadPanel.tsx` L185–197；`PushImagePanel` / `BranchPanel` 已改为 per-image 比较；`App.tsx` 三处均传 `build.copied` |
| **对比（正确实现）** | `PushImagePanel`: `copied === fullImage`；`BranchPanel` results: `copied === item.image` |

### BUG-002 · BranchPanel 兜底行复制后永不高亮（P0）

| 字段 | 内容 |
|------|------|
| **现象** | 当仅存在 `branchFullImage`（无 `branchImageResults`）时，点击复制后按钮不进入「已复制」状态 |
| **根因** | `onCopyImage` 写入 `branchFullImage.replace(/\n/g, '  ')`，但 UI 比较 `copied === branchFullImage`（原字符串） |
| **证据** | `BranchPanel.tsx` L436–448 |
| **触发频率** | 低（npm/Maven 自动推送成功路径均写 `branchImageResults`）；兜底路径在提取镜像失败或旧数据时仍可能命中 |

### BUG-003 · Docker 镜像「使用中」误判（P1，工作区 WIP）

| 字段 | 内容 |
|------|------|
| **现象** | 有容器占用时仍显示可删除；或空闲镜像被标为使用中 |
| **根因** | Docker 29+ 移除 `docker ps --format {{.ImageID}}`；旧逻辑仅匹配 ImageID/digest，未处理 `repo` 无 tag、`name` ↔ `name:latest` 别名 |
| **证据** | `push.rs` diff：`collect_in_use_image_keys` 改为 `ps` + `inspect`；新增 `remember_in_use_key` / `split_repo_tag`；4 个单测通过 |
| **验收** | 本地有运行中容器时 `list_local_images` 的 `in_use` 与 `docker ps` 一致；`remove_local_image` 阻塞文案正确 |

### BUG-004 · PushImagePanel 搜索即改选中引用（P1，工作区 WIP）

| 字段 | 内容 |
|------|------|
| **现象** | 输入搜索词时，`localImage` 被同步改写，导致已选镜像被搜索字符串覆盖 |
| **根因** | 旧版 `handleQueryChange` 内调用 `setLocalImage(value)` |
| **证据** | diff：`query` 与 `localImage` 分离；Enter 提交手输引用；选中条 `image-selected-bar` 独立展示 |
| **验收** | 选中镜像 → 输入搜索 → 选中不变；Enter 手输新引用 → 选中更新 |

### BUG-005 · npm 并行 push 取消只杀一个进程（P2，已修复）

| 字段 | 内容 |
|------|------|
| **现象** | npm 前端+后端并行 `build_and_push` 时点「取消」，可能只终止其中一个 docker build |
| **根因** | 全局单例 `CANCEL_FLAG` + `CURRENT_PID`（`utils`），后启动进程覆盖前者 PID |
| **修复** | `CURRENT_PIDS: Mutex<Vec<u32>>` + `TrackedPid` RAII；`cancel_build` 对快照内全部 PID TERM/KILL |
| **证据** | `utils/mod.rs` 多槽 API；`process_cmd` / `push` / `push_helpers` 改用 `TrackedPid`；单测 `tracked_pids_support_parallel_register_and_cancel_snapshot` |

---

## 3. 修复方案对比

### 方案 A · 最小 diff（推荐）

1. **合入当前工作区 WIP**（BUG-003、BUG-004）+ 冒烟清单推送相关项  
2. **BUG-001**：`UploadPanel` 改为与 Push 一致——定义 `const copyText = fullImage.replace(/\n/g, '  ')`，高亮 `copied === copyText`  
3. **BUG-002**：`BranchPanel` fallback 同样 `copied === copyText`  
4. **BUG-005**：文档化限制 + 后续单独立项（不改架构本波）

| 优点 | 风险 |
|------|------|
| 改动小、可快速闭环 | 并行取消仍为已知限制 |

### 方案 B · 复制状态按 Tab 隔离

各 Panel 自持 `copied` 或 `copiedByTab: Record<TabType, string \| null>`，不再全局共享。

| 优点 | 风险 |
|------|------|
| 彻底消除跨 Tab 污染 | 需改 `App.tsx` + 三 hooks，范围大于 bug 本身 |

### 方案 C · BUG-005 一并改 PID 为多槽

`CURRENT_PID` → `Arc<Mutex<Vec<u32>>>`，cancel 时 kill_all。

| 优点 | 风险 |
|------|------|
| 并行取消正确 | 触及 build 核心，需集成测试，不宜与 UI 小修捆绑 |

**推荐：方案 A**（先闭环 P0/P1，P2 单独立项）。

---

## 4. 实施计划（Wave）

### Wave 1 · 合入 WIP + 验证（~0.5d）

- [ ] Review & merge 工作区：`push.rs`、`PushImagePanel`、`upload.css` 等  
- [ ] `cargo test in_use_tests`、`cargo test`  
- [ ] 手动：Docker 有容器时镜像列表 in_use 正确  
- [ ] 手动：推送 Tab 搜索/选中/手输 Enter  

### Wave 2 · 复制高亮统一（~0.25d）

- [ ] 新增 `src/copyImage.ts`（或 `branchImageResults.ts` 旁）：`normalizeCopyText(text: string)`  
- [ ] 修 `UploadPanel`、`BranchPanel` fallback  
- [ ] 新增 `scripts/copyHighlight.test.ts`：给定 copy 文本，断言高亮条件  
- [ ] 手动：Upload / Branch / Push / History 交叉复制，仅对应行高亮  

### Wave 3 · 并行取消（可选，~1d）

- [ ] 设计 `CancelHandle` / PID 列表  
- [ ] `cancel_build` kill 全部子进程  
- [ ] 分支 npm 双 push 取消集成验证  

### Wave 4 · 回归

- [ ] 跑 `docs/smoke-checklist.md` 构建与推送章节  
- [ ] 系统日志搜 `[docker]` 确认 in_use / remove 有诊断  

---

## 5. 测试策略

| Bug | 自动化 | 手动 |
|-----|--------|------|
| BUG-001/002 | `copyHighlight.test.ts` | 跨 Tab 复制 |
| BUG-003 | `in_use_tests`（已有） | docker ps 对照 |
| BUG-004 | — | 搜索/选中/Enter |
| BUG-005 | done | 多 PID 槽 + cancel 全杀 |

---

## 6. 自检

- [x] 无 TBD 占位  
- [x] 每条 bug 有根因与证据  
- [x] 范围可在一个 implementation plan 内完成（Wave 1–2）；Wave 3 可选拆分  
- [x] 与 OPT backlog 无冲突（001/002 frozen）

---

## 7. 下一步

用户确认本规格后 → 调用 **writing-plans** 生成 `docs/superpowers/plans/2026-07-24-system-bug-fix.md` 并逐步实施。
