# 分支打包推送后自动发布到 KubeSphere

**日期**: 2026-08-21  
**状态**: 已批准（设计对话确认：全自动 C + 显式映射 + 方案 A）  
**范围**: 分支打包且「自动推送镜像」成功后，按映射表调用 `ks_update_image`  
**参考**: `docs/kubesphere-publish.md`、`useBranchPack` / `branchPackageAction`、`ks_update_image`

## 背景

分支打包可产出并推送 Harbor 完整镜像地址；KubeSphere 发布面板已有 `ks_connect` + `ks_update_image`。两边目前隔离：打包结果只能复制粘贴到发布页。研发希望推送成功后**自动**改部署镜像，并有可排查日志。

## 目标

1. 配置显式映射：Harbor **镜像仓库名** → KS 环境 + 命名空间 + 部署名（可选容器名）。
2. 分支打包开启「推送后自动发布」时：每个成功推送的镜像查表；命中则连接对应环境并 `ks_update_image`。
3. 打包页进度 + 系统诊断日志（`[build]` / `[kubesphere]`）记录匹配、旧/新镜像、revision、失败原因。
4. **未配置映射或发布失败不阻断「推镜像成功」**（与宝塔 test 自动部署一致：部署失败打包仍算成功）。

## 非目标（本轮）

- 发布任务队列 / 异步 worker
- 把推送与发布绑死成单条 Rust command（方案 B）
- 靠约定猜部署名、或仅用上次选中的 NS 自动匹配
- History 面板一键再发布（可后续复用同一映射表）
- 创建 Deployment / 改 ConfigMap

## 数据模型

在 `HarborConfig` 增加：

```ts
ks_publish_maps: Array<{
  id: string;                 // 本地生成
  match_key: string;          // Harbor 仓库名（小写），如 klcj-zt-common-service-9610
  env_id: string;             // ks_environments[].id
  namespace: string;
  deployment: string;
  container?: string;         // 空 = 发布时取该 Deployment 第一个容器名
}>
```

匹配规则：从完整镜像 `host/project/repo:tag` 取出 **repo**（最后一个 `/` 与 `:` 之间），`trim` + 小写后与 `match_key` 精确相等。  
多条命中：取第一条并 `diag_log` 警告；建议配置侧禁止重复 `match_key`。

映射 CRUD：系统设置 → **KubeSphere** tab（与环境列表同页）。

## 触发条件

在分支打包流水线里，`autoPushImage` 且 **`build_and_push` 成功解析出完整镜像**之后：

| 条件 | 要求 |
|------|------|
| UI 开关 | 「推送后自动发布到 KubeSphere」开启（依赖「自动推送镜像」） |
| 映射 | 该镜像 repo 在 `ks_publish_maps` 中有一条 |
| 环境凭证 | 对应 `env_id` 的 console/username/password 齐全 |

任一不满足：跳过该镜像的发布，写日志，继续处理其余镜像；不改打包成功态。

## 流程

```
package_from_branch 成功
  →（若 autoPush）build_and_push → 得到 BranchImageResult[].image
  →（若 autoPublish）对每个 image：
        parse repo → lookup ks_publish_maps
        miss → log 跳过
        hit  → ks_connect(env) → ks_update_image(ns, deploy, container?, image)
             → log 旧/新镜像 + revision
  → 打包页汇总「推送 N / 发布成功 M / 跳过·失败 K」
```

实现落点（方案 A，前端编排复用现有 command）：

- `branchPackageAction.ts`（或紧邻的小函数）：推送成功后循环发布
- 不新增「推送+发布」巨型 Rust API；复用 `ks_connect` / `ks_update_image`
- `container` 为空时：先 `ks_list_deployments` 或现有能拿到容器名的只读路径取第一容器；若拿不到则跳过并记日志（不瞎用 `container-main`）

## UI

**BranchPanel**

- 「自动推送镜像」旁增加「推送后自动发布到 KubeSphere」
- 未开推送时禁用该开关
- 无任何映射时：开关可开，但发布阶段会全部 skip 并提示去设置配映射

**Config → KubeSphere**

- 映射表：匹配键 / 环境下拉 / 命名空间 / 部署名 / 容器（可选）/ 删改增
- 保存走现有 `save_config`

## 日志

| 通道 | 内容 |
|------|------|
| 打包进度 log | 人读：正在发布 `image` → `env/ns/deploy`；成功 revision；跳过/失败原因 |
| `diag_log("build", …)` | 触发摘要、每个镜像 match_key、命中/未命中 |
| `diag_log("kubesphere", …)` | connect / update_image 入参摘要（脱敏）、返回 revision、错误 |

敏感信息：不写 password；镜像 URL 可记全文（非密钥）。

## 错误与边界

- 多产物（frontend + backend）：各自按 repo 独立匹配，互不影响
- KS 会话失效：`ks_connect` / update 失败 → 该条记失败，其余继续
- 映射指向已删部署：API 报错 → 记失败，不回滚已推 Harbor 镜像

## 验收

1. 配一条 `match_key` 与打包产出 repo 一致 → 勾选推送+自动发布 → 对应 Deployment 镜像变为新 tag，系统日志有 `[build]`/`[kubesphere]`。
2. 无映射 → 推送成功，日志「未配置映射，跳过发布」。
3. 发布 API 失败 → 推送仍成功，打包页与诊断可见失败原因。
4. `pnpm exec tsc --noEmit`；相关 Rust 若有改动则 `cargo check`。

## 后续（明确不做本轮）

- History「用此镜像再发布」
- 从当前 NS 部署列表一键生成映射草稿
