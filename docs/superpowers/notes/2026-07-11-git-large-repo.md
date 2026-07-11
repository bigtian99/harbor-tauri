# OPT-031：大仓 git 策略评估

**日期**: 2026-07-11  
**范围**: 分支打包 `package_from_branch` 的 git 路径  
**结论性质**: 评估笔记（**不改默认行为**；改行为须另开 plan）

---

## 1. 当前实现

路径：`src-tauri/src/build/package.rs`（配合 `git` 模块 worktree 清理）。

| 步骤 | 行为 | 说明 |
|------|------|------|
| 仓库校验 | 在用户已选本地仓库根上操作 | **不是**每次远程 clone 新仓 |
| 更新 | `git fetch --all --prune` | 拉全部分支引用并清理过期远端 |
| 隔离 | `git worktree add --detach <path> <branch>` | 与主工作区隔离；产物/输出目录侧建临时 worktree |
| 构建 | Maven / npm 在 worktree 内执行 | npm 另有 lockfile hash 缓存（`~/.cache/jarporter/npm-cache/`） |
| 收尾 | 清理 worktree（自定义 Dockerfile 时可能保留上下文） | 启动时也会扫残留 `jarporter-worktree-*` 等 |

**设计意图**：假定用户本机已有完整（或近完整）仓库；打包只做 fetch + 隔离 worktree，避免把「克隆大仓」塞进每次打包。

---

## 2. 大仓可能的痛点

- `fetch --all --prune`：远端分支极多 / 对象体积大时，网络与对象传输偏慢。
- worktree：仍需检出目标树；超大 monorepo 首次 checkout 磁盘与时间成本高。
- 历史对象已在本地时，重复 fetch 多为增量，痛点常出在「本机本就不全」或「首次拉齐」。

---

## 3. 可选策略（均未默认启用）

| 策略 | 思路 | 收益 | 风险 / 成本 |
|------|------|------|-------------|
| **浅克隆 / 浅 fetch** | `--depth=N` 或浅化已有仓 | 少传历史 | 依赖完整历史的工具/blame/部分 Maven 场景可能失败；加深/反浅化运维成本 |
| **稀疏检出 (sparse checkout)** | 只检出子目录 | monorepo 只建部分树 | 需配置 sparse 规则；漏目录导致构建失败；与现有 worktree 路径假设要重核 |
| **仅本地 / 跳过 fetch** | 用户勾选「不 fetch，用当前本地 ref」 | 离线、秒开 | 易打到过期分支；需 UI 与明确提示 |
| **单分支 fetch** | `fetch origin <branch>` 替代 `--all` | 减少无关 refs | 多 remote / 非常规分支命名要处理 |
| **复用已有 worktree / 缓存树** | 同 branch+commit 不重复 add | 重复打包加速 | 失效与并发清理复杂，易脏状态 |

---

## 4. 建议（保持默认）

1. **默认保持现状**：本地仓 + `fetch --all --prune` + detach worktree。  
   - 与「用户已 clone 好业务仓」的产品假设一致。  
   - 不引入浅仓/稀疏的隐性失败面。  
2. **不做默认浅克隆**：分支打包依赖的是已有本地仓，不是 app 内 clone；浅化默认收益有限、回归面大。  
3. **文档与排障优先于改默认**：大仓慢时先看本机 `git fetch` 本身是否慢、磁盘是否在网络盘、是否可用局域网镜像。

---

## 5. 何时再开 plan 改行为

满足以下**任一**再单独立项（勿无评估直接改默认）：

- 真实业务仓可复现：单次 `fetch --all` 或 worktree 显著拖垮打包（有耗时数据）。  
- 明确 monorepo 子集构建需求（稀疏规则可产品化）。  
- 需要「离线打包 / 禁止动网络」开关（仅本地 ref）。  
- 需要「只 fetch 当前分支」作为可选策略且有 UI 配置位。

改动验收应包括：普通小仓无回归、取消打包/清理 worktree、自定义 Dockerfile 保留上下文路径、系统日志可区分策略分支。

---

## 6. 与其它 OPT 关系

- **OPT-030** npm 缓存可观测：大仓慢时常是 install，与 git 策略独立。  
- **OPT-033** 进度 stage：`fetch` / `worktree` 阶段可帮助区分「卡在 git」还是「卡在构建」。  
- 本条 **OPT-031** 本身只要求书面结论；**默认 git 行为不变**。
