# 分支打包：复用输出目录 `_pack`（切分支更新）

**日期**: 2026-08-27  
**状态**: 已实现  
**范围**: `package_from_branch` 的 Git 准备 / worktree 生命周期；Maven 仍全量 `clean package`  
**参考**: `src-tauri/src/build/package_worktree.rs`、`package_finish.rs`、产物输出目录配置 `artifact_output_dir`

## 背景

当前每次分支打包都会：

1. `git fetch`（已改为只拉目标分支）
2. **新建**临时目录 `{output}/{repo}/_{branch}_{timestamp}/`
3. `git worktree add --detach`
4. `mvn clean package`
5. 多数情况**删掉**整份临时目录

用户体感慢的主因之一是「每次新拷一份源码」。打包目标不是日常开发工作区；产物已落到「产物输出目录」（空则桌面）。无需另开 `~/.cache/jarporter/pack/`。

## 目标

1. 在**已有产物输出根目录**下，按仓库复用固定打包目录 `{output_base}/{repo_name}/_pack/`。
2. **第一次**：在 `_pack` 检出目标提交；**之后**：同一目录切到目标分支 / 更新该分支引用后全量编译。
3. 继续 **只 fetch 目标分支**（不 `fetch --all`）。
4. Maven / npm 构建命令保持 **全量**：`mvn clean package -DskipTests`（及现有 npm 流程）；不靠复用 `target` 做增量提速。
5. **不修改**用户配置的日常仓库工作区（不在 `repo_path` 上 `checkout`）。
6. 产物仍输出到带时间戳的干净目录；诊断日志可区分「复用 `_pack`」与「新建 `_pack`」。

## 非目标（本轮）

- 持久化到 `~/.cache/...` 或新配置项
- 默认跳过 fetch（「永远不拉远程」）
- Maven 增量编译（去掉 `clean`）
- UI 新增「刷新远程 / 干净构建」开关（需要时可后续加）
- 改 Docker 推送、宝塔部署、KS 自动发布逻辑
- 多仓库并行策略大改（见约束）

## 方案对比（已选）

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 每次新 worktree（现状） | 隔离强，每次全量检出 | 否，过慢 |
| B. 日常仓库内切分支 | 最快但弄脏开发区 | 否 |
| C. `{output}/_pack` 复用 + 切分支更新 | 用现有输出配置，不动开发仓 | **采用** |

## 目录约定

```text
{output_base}/                          # artifact_output_dir，空则桌面
  {repo_name}/
    _pack/                              # 持久打包工作区（git worktree 或等价检出）
    {branchSlug}_{timestamp}/           # 产物目录（不变）
```

- `_pack` **固定名**，无时间戳；按 **仓库** 一份（同一仓库切换不同分支时在此目录 `checkout`/`reset`）。
- 仍通过 `git worktree add` 挂到主仓 `repo_root`，避免第二份完整 `.git` 对象库（ponytail：复用现有 worktree 机制，只改路径与是否删除）。

## 数据流

```text
package_from_branch
  → prepare_worktree
       output_base = artifact_output_dir | Desktop
       pack_dir    = output_base / repo_name / _pack
       fetch 仅目标分支（origin/foo → fetch origin +refs/heads/foo:refs/remotes/origin/foo）
       if pack_dir 已是本仓 worktree:
            git -C pack_dir fetch…（或在 repo_root fetch 后）
            git -C pack_dir checkout --detach <branch_ref>
            git -C pack_dir reset --hard <branch_ref>
       else:
            清理损坏残留 → worktree add --detach pack_dir <branch_ref>
  → validate pom/package.json
  → run_project_build（clean package / npm，不变）
  → copy 产物到 {branch}_{timestamp}/
  → 若无自定义 Dockerfile：不再 remove _pack；仅可选清理 target 外的临时垃圾
  → 若有自定义 Dockerfile：_pack 继续作为 docker context（与现逻辑一致，只是路径固定）
```

### 更新语义

- 「更新这个代码」= 对目标 ref 做 **单分支 fetch** + 在 `_pack` 内 **`reset --hard` 到该 ref**（与远程跟踪引用对齐）。
- 不在用户 `repo_path` 主工作树上 checkout。

### 并发约束（ponytail）

同一 `{repo_name}` 共用一个 `_pack`。若批量打包**同一仓库的不同分支**并行，会抢目录。

**本轮**：同一 `repo_name` 的 `_pack` 使用进程内互斥（或打包前检测「目录锁定」失败则报错提示稍后重试）。不同仓库仍可并行。  
不做「每分支一个 `_pack_<slug>`」（可后续加）。

## 错误处理

| 情况 | 行为 |
|------|------|
| fetch 失败 | 报错返回；保留 `_pack` |
| `_pack` 损坏 / 不是 worktree | 删除残留后重新 `worktree add` |
| checkout/reset 失败 | 报错；尝试 `worktree remove --force` 后重建一次 |
| 构建失败 | 保留 `_pack` 便于排障；产物目录规则不变 |

## 诊断日志

模块名 `build` / `git`：

- `pack_reuse path=... branch=...`
- `pack_create path=... branch=...`
- `fetch_target_branch remote=... branch=...`（已有）
- `pack_reset ref=...`

## 测试

- 单元：`split_remote_tracking_ref`（已有）；pack 路径拼接 `output/repo/_pack`。
- 行为（可手工 / 轻量集成）：第二次同仓库打包不再创建 `_{branch}_{timestamp}` 源码目录；产物目录仍带时间戳。

## 实现触及文件（预期）

- `src-tauri/src/build/package_worktree.rs` — 核心
- `src-tauri/src/build/package_finish.rs` — 停止删除 `_pack`（无自定义 Dockerfile 时）
- 可能：`git.rs` `cleanup_worktree` 调用点收敛

前端可不改（无新开关）。

## 成功标准

1. 同仓库连续打包两次：第二次日志为 `pack_reuse`，磁盘上源码目录仍为 `_pack`，无新的 `_{branch}_*` 源码目录。
2. 切换分支再打包：`_pack` 内容对应新分支；`mvn clean package` 仍执行。
3. 日常 `repo_path` 的 `git status` 不因打包被改到别的分支。
4. 只 fetch 目标分支，无 `fetch --all`。
