# KubeSphere：勾选部署批量复制到其他环境

**日期**: 2026-08-28  
**状态**: 已实现  
**范围**: KubeSphere 发布面板部署列表、发布映射（`ks_publish_maps`）、现有 `ks_*` Tauri 命令  
**参考**: `KsPublishPanel.tsx`、`ksBatchPackPublish.ts`、`kubesphere.rs`（`ks_get_deployment_edit` / `ks_create_deployment` / `ks_update_deployment` / ConfigMap CRUD）

## 背景

运营在 dev 环境配置好几十个 Deployment 及本地发布映射后，迁到 test/prod 仍需逐个「创建部署 + 系统设置里填 Git 映射」，成本高、易漏。

用户诉求：**勾选已部署项目 → 选择目标环境与命名空间 → 一次性在新环境新增对应配置**（Deployment + 发布映射；关联 ConfigMap 可选复制）。

## 需求摘要（已确认）

| 项 | 决策 |
|----|------|
| 复制范围 | **C**：K8s Deployment + 本地发布映射 |
| 目标选择 | **B**：目标 **环境** + **命名空间** 均单独选择 |
| 目标已存在同名 Deployment | **C**：弹窗选择 **跳过** / **覆盖**（默认跳过） |
| 关联 ConfigMap | **C**：弹窗勾选「同时复制 ConfigMap」（**默认勾选**） |
| 发布映射冲突 | 与 Deployment **同一套**跳过/覆盖规则 |
| 镜像 | **保持源环境相同 tag**（不在复制阶段做环境替换） |
| 实现方式 | **方案 1**：前端编排 + 现有 Tauri 命令（与 `runKsBatchPackPublish` 同模式） |

## 目标

1. 在部署列表工具栏提供 **「复制到其他环境」**，依赖现有勾选 `checkedNames`。
2. 确认弹窗：源（只读）、目标环境、目标命名空间、冲突策略、ConfigMap/映射勾选、可选 dry-run。
3. 按部署逐条：读取源配置 → 切换目标 KS 会话 → 创建/更新 Deployment（及 ConfigMap）→ 写入 `ks_publish_maps` 并 `save_config`。
4. 进度弹窗 + 执行日志 + 汇总（成功 / 失败 / 跳过）；关键步骤 `diag_log("kubesphere", …)`。
5. 遵守 `docs/non-blocking-ui-spec.md`：长 I/O 走 async command，UI loading 不卡死。

## 非目标（V1）

- Service / Ingress 创建或复制
- Secret、Volume、多容器 Deployment 的完整克隆
- 镜像 tag / Harbor 项目按环境自动改写
- 一次复制到 **多个** 目标环境（仅单目标；可后续扩展）
- 跨集群 YAML 文件导入导出

## 方案对比（已选）

| 方案 | 说明 | 结论 |
|------|------|------|
| 1. 前端编排 | `runKsBatchCloneToEnv` 串 `ks_*` + `save_config` | **采用** |
| 2. 单条 Rust `ks_batch_clone_*` | 后端一次完成 | 否，V1 过重 |
| 3. JSON 导出再导入 | 离线两步 | 否，不符合交互 |

## 「全量配置」定义（V1）

### Deployment（经 `DeployEditInfo` ↔ 创建/更新 API）

| 字段 | 复制 |
|------|------|
| name | 同名 |
| alias | ✓ |
| image | ✓（与源一致） |
| port | ✓ |
| replicas | ✓ |
| healthPath | ✓ |
| envs（字面量 K=V） | ✓ |
| configMap（引用名） | ✓；内容见 ConfigMap 节 |
| container | 更新路径使用；创建仍 `container-main` 模板 |

自动注入字段（`SW_AGENT_NAME`、hostPath 等）由现有 `build_deployment_json` 处理，不单独读取。

**限制**：`ks_get_deployment_edit` 对多 ConfigMap 引用取「票数最多」的一个；非 `configMapKeyRef` / 非字面量 env 不复制。

### ConfigMap（勾选时）

- 源：`ks_get_configmap(sourceNs, name)` 取 `data`
- 目标无同名 → `ks_create_configmap`
- 目标已有 → 按 Deployment **同一冲突策略**（跳过 / `ks_update` 或 delete+create，复用现有 CM 更新能力若有；否则 create 失败则记失败）

### 发布映射（勾选时）

源键：`(sourceEnvId, sourceNamespace, deploymentName)`  
目标键：`(targetEnvId, targetNamespace, deploymentName)`

复制字段：`git_url`、`role`、`container`、`expose_port`（`git_url_key` 由 `createKsPublishMap` 规范化）

- 目标无映射 → 新增
- 目标已有 → 跳过或覆盖（同冲突策略）

持久化：批量结束后一次 `save_config`（或每条 merge 后统一 save，避免中途丢配置）。

## UI 设计

### 入口

`KsPublishPanel` 部署 Tab 工具栏，**「批量打包并发布」** 右侧：

- 按钮：**复制到其他环境** `{checkedNames.size > 0 ? ` (${n})` : ""}`
- `disabled`：`!connected || !namespace || checkedNames.size === 0 || batchRunning`

### 确认弹窗 `KsBatchCloneModal`

| 区域 | 内容 |
|------|------|
| 源 | `{sourceEnvName} / {sourceNamespace}` · 已选 N 个部署（可折叠列表） |
| 目标环境 | Select（`resolveKsEnvironments`） |
| 目标命名空间 | Select（选环境后 `ks_connect` + `ks_list_namespaces`） |
| 已存在时 | Radio：**跳过**（默认）/ **覆盖更新** |
| 选项 | ☑ 同时复制关联 ConfigMap（默认开） |
| 选项 | ☑ 同时复制发布映射（默认开） |
| 选项 | ☐ 仅预检（dry-run，Deployment 走 `dryRun=true`） |
| 操作 | 取消 / 开始复制 |

### 进度弹窗

复用 `KsBatchPackModal` 布局（或抽共用 `KsBatchProgressModal`）：

- 标题：**批量复制到其他环境**
- 进度条、当前项 message、执行日志 ScrollArea
- 完成汇总：成功 / 失败 / 跳过

## 数据流

```text
用户勾选 deploys → 打开 KsBatchCloneModal → 选 targetEnv + targetNs + 选项
  → runKsBatchCloneToEnv({
       source: { envId, namespace, deployNames },
       target: { envId, namespace },
       conflict: skip | overwrite,
       copyConfigMap, copyPublishMaps, dryRun,
       config, onProgress, appendLog,
     })

Phase A — 读取源（当前已连接 source env）
  for each name:
    edit = ks_get_deployment_edit(sourceNs, name)
    if copyConfigMap && edit.configMap:
      cm = ks_get_configmap(sourceNs, edit.configMap)  // 缓存到内存

Phase B — 写入目标
  ks_connect(targetEnvId)
  existing = Set(ks_list_deployments(targetNs).map(name))
  for each cached item:
    if copyConfigMap && cm: ensureConfigMap(targetNs, ...)  // skip/overwrite
    if name in existing:
      skip → 记 skip；overwrite → ks_update_deployment(...)
    else:
      ks_create_deployment(..., dryRun?)
    if copyPublishMaps:
      merge ks_publish_maps for target key
  save_config(updated maps)

Phase C — 可选：ks_connect 切回 source env（若用户仍在源环境浏览）

onComplete → 若当前 UI env === target → load deploy list
```

## 模块与文件

| 文件 | 职责 |
|------|------|
| `src/utils/ksBatchCloneDeploy.ts` | 核心编排、`KsBatchCloneSummary`、冲突/CM/映射逻辑 |
| `src/components/KsBatchCloneModal.tsx` | 确认弹窗（Mantine，与 KS 面板一致） |
| `src/components/KsPublishPanel.tsx` | 入口按钮、状态、调用 clone、进度弹窗 |
| `src/types.ts` | 如需：`KsBatchCloneOptions` 类型（可放 util 文件内 export） |

**不新增** Rust command（V1）；必要时仅补充 `ks_update_configmap` 若覆盖 CM 缺 API 则 V1 覆盖 CM 用 delete+create 或仅支持 skip。

## 错误与跳过

| 情况 | 行为 |
|------|------|
| 源 `ks_get_deployment_edit` 失败 | 该条 failed，继续下一条 |
| 目标 CM 创建失败 | 该条 failed（Deployment 不创建） |
| 目标 Deployment 已存在且 skip | skip，日志 `⏭ 已存在` |
| 无源发布映射 | 仍复制 Deployment；映射步骤 skip（日志提示） |
| `ks_connect` 目标失败 | 整批 abort，汇总错误 |
| dry-run | 只调 `ks_create_deployment(dryRun: true)`，不写映射、不 create CM |

## 日志

- 模块名：`kubesphere`（API）、前端关键决策可 `write_diagnostic_log`
- 每条至少：源/目标 env+ns、deployment 名、动作（create/update/skip）、结果

## 测试 / 验收

1. dev / `klcj-zt-dev` 勾选 3 个部署 → 复制到 test / `klcj-zt-test`，默认选项：3 个新建成功，映射写入 config。
2. 再跑一次默认跳过：3 个 skip，config 不变。
3. 选覆盖：Deployment 字段与源一致；映射被覆盖。
4. 勾掉 ConfigMap：Deployment 引用 CM 但目标无 CM → 创建失败有明确日志。
5. dry-run：无真实创建，日志有 dry-run 成功。
6. 系统日志搜 `[kubesphere]` 可见 `ks_batch_clone` 或逐步命令日志。

## 后续（非 V1）

- 一次复制到多目标环境
- Service/Ingress 模板
- 镜像 tag 规则（如 dev → test 后缀）
- Rust 侧 `ks_batch_clone_deployments` 减少 connect 往返
