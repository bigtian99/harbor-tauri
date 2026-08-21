# 分支打包推送后自动发布到 KubeSphere

**日期**: 2026-08-21  
**状态**: 已批准（全自动 C + 显式映射方案 A；匹配键改为 Git 远程地址 + 镜像角色 B）  
**范围**: 分支打包且「自动推送镜像」成功后，按映射表调用 `ks_update_image`  
**参考**: `docs/kubesphere-publish.md`、`useBranchPack` / `branchPackageAction`、`ks_update_image`

## 背景

分支打包可产出并推送 Harbor 完整镜像地址；KubeSphere 发布面板已有 `ks_connect` + `ks_update_image`。两边目前隔离。研发希望推送成功后**自动**改部署镜像，并有可排查日志。

关联键采用 **Git 远程地址**（与「当前在打哪个仓库」对齐），同一仓库可配置多行，用 **镜像角色**（frontend / backend / any）区分多产物。

## 目标

1. 配置显式映射：规范化后的 **Git remote URL** + **角色** → KS 环境 + 命名空间 + 部署名（可选容器名）。
2. 分支打包开启「推送后自动发布」时：读取当前仓库 remote URL；对每个成功推送的镜像按角色查表；命中则 `ks_connect` + `ks_update_image`。
3. 打包页进度 + 系统诊断日志（`[build]` / `[kubesphere]`）记录匹配、旧/新镜像、revision、失败原因。
4. **未配置映射或发布失败不阻断「推镜像成功」**。

## 非目标（本轮）

- 发布任务队列 / 异步 worker
- 把推送与发布绑死成单条 Rust command
- 仅靠 Harbor 仓库名或上次 NS 猜测部署
- History 面板一键再发布
- 创建 Deployment / 改 ConfigMap

## 数据模型

在 `HarborConfig` 增加：

```ts
ks_publish_maps: Array<{
  id: string;
  git_url: string;            // 用户录入的 Git 远程地址（展示用原文）
  git_url_key: string;        // 规范化后的匹配键（小写、去 .git、统一分隔符）
  role: "frontend" | "backend" | "any";
  env_id: string;             // ks_environments[].id
  namespace: string;
  deployment: string;
  container?: string;         // 空 = 发布时取该 Deployment 第一个容器名
}>
```

### Git URL 规范化（前后端/脚本共用同一规则）

对 `git remote get-url origin`（或配置的 remote）与映射里的 `git_url` 均执行：

1. `trim`
2. 小写
3. 去掉末尾 `/` 与可选的 `.git`
4. 若为 `git@host:path` 形式，转为 `host/path`（`:` → `/`，去掉 `git@`）
5. 若为 `https://` / `http://` / `ssh://`，去掉 scheme 与可选用户名，保留 `host/path`

示例：`git@gitlab.example.com:group/app.git` 与 `https://gitlab.example.com/group/app` → 同一 `git_url_key` = `gitlab.example.com/group/app`。

### 角色匹配

| 推送产物 role（已有 `BranchImageResult.role`） | 命中的映射 `role` |
|-----------------------------------------------|-------------------|
| `frontend` | `frontend` 或 `any` |
| `backend` | `backend` 或 `any` |
| Maven 单 JAR（视为 `backend`） | `backend` 或 `any` |

同一 `(git_url_key, role)` 多条：取第一条并 `diag_log` 警告。配置 UI 保存时尽量禁止完全重复键。

匹配顺序：先 `git_url_key` 相等，再按上表筛角色；优先精确角色（`frontend`/`backend`），没有再用 `any`。

## 触发条件

`autoPushImage` 且 **`build_and_push` 成功得到完整镜像**之后：

| 条件 | 要求 |
|------|------|
| UI 开关 | 「推送后自动发布到 KubeSphere」开启（依赖「自动推送镜像」） |
| Git remote | 能读到当前 `repoPath` 的 remote URL |
| 映射 | 规范化 URL + 角色命中至少一条 |
| 环境凭证 | 对应 `env_id` 的 console/username/password 齐全 |

不满足：跳过该镜像发布，写日志，不改打包成功态。

## 流程

```
package_from_branch 成功
  →（若 autoPush）build_and_push → BranchImageResult[] { role, image }
  →（若 autoPublish）
        remote = git remote get-url origin（repoPath）
        key = normalizeGitUrl(remote)
        对每个 result:
          map = lookup(ks_publish_maps, key, result.role)
          miss → log 跳过
          hit  → ks_connect(env) → resolve container → ks_update_image(...)
               → log 旧/新镜像 + revision
  → 汇总「推送 N / 发布成功 M / 跳过·失败 K」
```

实现落点（方案 A，前端编排）：

- 纯函数：`normalizeGitUrl` / `lookupKsPublishMap`（`src/utils/` + `scripts/*.test.ts`）
- 读 remote：已有或补 `invoke`（如 `get_git_remote_url`）；失败则 skip + 日志
- `branchPackageAction.ts`：推送成功后调用发布循环（Maven 早退路径与 npm 汇总路径都要挂）
- 复用 `ks_connect` / `ks_list_deployments`（取容器）/ `ks_update_image`
- `container` 为空：列表里找同名 deployment 的 `containers[0]`；拿不到则 skip

## UI

**BranchPanel**

- 「自动推送镜像」旁：「推送后自动发布到 KubeSphere」（未开推送则禁用）
- 可选：记忆到 `last_auto_publish_ks`（与 `last_auto_push_image` 同级）

**Config → KubeSphere**

- 映射表 CRUD：Git 地址 / 角色 / 环境 / 命名空间 / 部署 / 容器（可选）
- 「填入当前仓库」：若分支页有 `last_repo_path` 或传入 repo，调 remote URL 预填（可选增强；最小可用可先手填）

## 日志

| 通道 | 内容 |
|------|------|
| 打包进度 log | 发布目标 `env/ns/deploy`、成功 revision、跳过/失败原因 |
| `write_diagnostic_log` / `diag_log` `build` | remote、git_url_key、role、命中/未命中 |
| `kubesphere` | connect / update 入参摘要（无 password）、revision、错误 |

## 错误与边界

- 多产物：各自按角色独立匹配
- KS 失败：该条失败，其余继续；不回滚 Harbor
- remote 读失败：全部 skip 发布并提示

## 验收

1. 映射 git URL 与仓库 origin 一致、角色匹配 → 勾选推送+自动发布 → Deployment 镜像更新，系统日志有记录。
2. 无映射 → 推送成功，日志跳过发布。
3. 发布 API 失败 → 推送仍成功。
4. 同 git 配 frontend + backend 两行 → 双镜像分别发到对应部署。
5. `pnpm exec tsc --noEmit`；`node --test scripts/ksPublishMap.test.ts`（或等价）。

## 后续（本轮不做）

- History「用此镜像再发布」
- 从 KS 部署列表一键生成映射草稿
