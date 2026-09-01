# kunlunchuangjie-cli 多模块 Maven + K8s 批量按服务打包

**日期**: 2026-09-01  
**状态**: 已确认  
**范围**: `package_from_branch`、K8s 批量打包、分支打包（Maven 路径）

## 目标

1. 在 K8s 发布页**勾选某一个 Deployment**，自动从 Git 拉取、**匹配对应 Maven 子模块**，仅构建该服务（`-pl {module} -am`），取该模块 `target/` 下 jar，推镜像并更新 KS。
2. **不做全仓 reactor 打包**（不跑无 `-pl` 的 `mvn clean package`）。
3. **同一 Git 仓库下勾选多个服务时并行处理**（受全局并发度上限约束）。
4. 单模块仓库行为不变（无 `-pl`，仍用根目录 `target/`）。

## 非目标

- 全量 reactor 一次构建、多分 jar
- 匹配失败时 fallback 到「最大 jar」或根 `target/`
- 通用 Maven 模块选手动 UI（一期）
- 修改 KubeSphere 部署 YAML 模板

## 背景：现状缺口

| 环节 | 现状 | cli 多模块后果 |
|------|------|----------------|
| 构建 | 根目录 `mvn clean package` | 父 POM `packaging=pom`，根无 jar |
| 取 jar | 仅 `{root}/target/` | jar 在 `ruoyi-gateway/target/` 等 |
| 批量同仓 | 前端 `withRepoGate` + 后端 `PackRepoGuard` 串行单 `_pack` | 慢；且无法并行 |

`klcjZtGitDefaults` 仅映射 Git URL / 端口，**不解决模块构建**。

## 方案概览

```mermaid
flowchart LR
  A[勾选 Deployment] --> B[resolve Git + 本地仓]
  B --> C[扫描 pom 可执行模块]
  C --> D[Deployment 名打分匹配]
  D --> E[独立 worktree _pack-{slot}]
  E --> F["mvn -pl module -am"]
  F --> G["find_jar module/target"]
  G --> H[build_and_push + ks_update_image]
```

## 1. Maven 模块自动匹配

### 1.1 扫描（Rust：`utils/maven_modules.rs`）

从 worktree 根 `pom.xml` 递归 `<modules>`，对每个子目录读 `pom.xml`，收集**可执行模块**：

- 含 `spring-boot-maven-plugin`，或
- `packaging=jar` 且非纯 library（排除 common/api 等：无 Boot 插件则跳过）

记录：`rel_path`（如 `ruoyi-modules/ruoyi-system`）、`artifact_id`、`dir_name`（末段目录名）。

### 1.2 Deployment → 模块（打分）

Rust 实现与 `klcjZtGitDefaults` 相同的 `normalizeDeployName` + `scoreKeyMatch`：

对 deployment `d`、候选 `m`：

```
score = max(
  scoreKeyMatch(d, m.artifact_id),
  scoreKeyMatch(d, m.dir_name),
  scoreKeyMatch(d, m.rel_path.replace('/', '-')),
)
```

**决策**：

- 最高分 ≥ 100 且领先第二名 ≥ 50 → 命中
- 否则 → 失败，日志列出 Top3 候选（禁止 silent 错包）
- 仅 1 个可执行模块或根为 jar 模块 → 返回 `None`，走现有单模块逻辑

### 1.3 cli 预期映射

| Deployment 示例 | Maven `-pl` 路径 | artifactId |
|-----------------|------------------|------------|
| `ruoyi-gateway` | `ruoyi-gateway` | `ruoyi-gateway` |
| `ruoyi-auth` | `ruoyi-auth` | `ruoyi-auth` |
| `klcj-zt-system-service` | `ruoyi-modules/ruoyi-system` | `ruoyi-modules-system` |
| `ruoyi-job` | `ruoyi-modules/ruoyi-job` | `ruoyi-modules-job` |
| `ruoyi-monitor` | `ruoyi-visual/ruoyi-monitor` | `ruoyi-visual-monitor` |

## 2. 构建与取 jar

### 2.1 Maven 命令

**多模块命中**：

```bash
mvn clean package -pl {rel_path} -am -Dmaven.test.skip=true
# 可选 -Dspring.profiles.active=...
```

**单模块仓（未命中多模块）**：保持现有命令。

### 2.2 取 jar

`find_maven_artifact(build_root: &Path)`：

- 多模块：`build_root = worktree.join(rel_path)`，只扫该目录 `target/`
- 单模块：`build_root = worktree` 根

保留：排除 sources/javadoc/original，Boot fat jar 优先，否则体积最大。

### 2.3 Tauri API

`package_from_branch` 新增可选参数：

```rust
deployment_hint: Option<String>  // K8s Deployment 名，用于模块匹配
pack_slot: Option<String>       // worktree 槽位，批量并行用
```

- `deployment_hint` → resolve → `maven_module: Option<MavenModuleMatch>`
- 日志：`☕ Maven 模块: ruoyi-gateway (deployment=ruoyi-gateway)`

## 3. 同 Git 多服务并行

### 3.1 问题

共用 `{repo}/_pack` 时：

- `PackRepoGuard` 按 `repo_name` 互斥 → 强制串行
- 即使并行，多路 `mvn` 会写同一 worktree 下公共模块的 `target/` → 竞态

### 3.2 策略：每任务独立 worktree 槽位

路径规则：

```
{artifact_output_dir}/{repo_name}/_pack                    # 分支打包单任务（兼容）
{artifact_output_dir}/{repo_name}/_pack-{slot}              # 批量并行
```

`slot` = 模块路径 slug（`/` → `-`），如 `_pack-ruoyi-gateway`、`_pack-ruoyi-modules-ruoyi-system`。  
冲突时追加 deployment 短 hash。

**锁粒度**：`PackRepoGuard` 改为按 **worktree 绝对路径**（或 `repo_name + slot`）互斥，不再按 `repo_name` 全局互斥。

### 3.3 前端批量

- **移除** `createRepoPathGate` 对同 `repoPath` 的串行限制（或仅保留「同 slot 串行」由后端锁保证）。
- 保留 `mapPool(concurrency)` 全局并行度（默认按 CPU / 任务数 / 4 上限）。
- 每个 target 调用 `runBranchPackageAndPush` 时传：
  - `deploymentHint: target.deployment`
  - `packSlot: moduleSlug`（或由后端从 deployment 解析后生成）

### 3.4 Git fetch

- 各并行任务仍各自 `fetch` + `worktree add`（实现简单，正确性优先）。
- 二期可选：同 `repo_root` 共享一次 fetch（需 `repo_root` 级短锁）。

## 4. 数据流（K8s 批量）

```
resolveKsBatchTargets
  → 每 Deployment：gitUrl, repoPath, exposePort, deployment
runKsBatchPackPublish (mapPool 并行)
  → package_from_branch(
       repoPath, branch,
       deployment_hint=deployment,
       pack_slot=slug(module),
     )
  → resolve module → mvn -pl -am → jar → push → ks_update_image
```

**每个 Deployment 独立一条完整链路**，仅构建其对应模块，互不触发 sibling 微服务打包。

## 5. 错误处理与日志

| 场景 | 行为 |
|------|------|
| 无法匹配模块 | 失败，列候选模块 |
| 歧义匹配 | 失败，列 Top3 与分数 |
| worktree 槽位被占用 | 短暂重试或明确错误 |
| Maven Home 无效 | 批量开始前整批拦截（现有逻辑） |

诊断 tag：`[build]`，关键行 `resolve_maven_module`、`mvn -pl`、`pack_slot=`.

## 6. 测试

### Rust unit

- `scan_executable_modules` 对 cli 目录结构（fixture pom 片段）
- `resolve_maven_module("klcj-zt-system-service", …)` → `ruoyi-modules/ruoyi-system`
- `resolve_maven_module("ruoyi-gateway", …)` → `ruoyi-gateway`
- 歧义 deployment → `Err`
- 单模块仓 → `None`
- `pack_worktree_dir(..., Some("ruoyi-gateway"))` → `.../_pack-ruoyi-gateway`
- `PackRepoGuard` 不同 slot 可同时 acquire

### 前端 unit

- 批量不再因同 repoPath 强制串行（gate 行为）

### 冒烟

1. 仅选 `ruoyi-gateway` → 只构建 gateway，日志含 `-pl ruoyi-gateway`
2. 同选 gateway + auth → 并行两路，各 `-pl` 不同模块，无全量 reactor
3. 单模块 `klcj-zt-user-service` 仓 → 行为与现网一致

## 7. 实现顺序

1. `maven_modules.rs`：扫描 + 匹配 + unit tests  
2. `find_maven_artifact` + `package_build.rs`：`-pl -am` + 子目录 target  
3. `package_worktree.rs`：`pack_slot`、按路径加锁  
4. `package_from_branch`：`deployment_hint` / `pack_slot`  
5. `branchPackageRun.ts` / `ksBatchPackPublish.ts`：传参 + 去掉同仓串行 gate  
6. 冒烟 cli 多选并行  

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Deployment 名与 artifactId 不一致 | 打分 + 歧义失败；klcj defaults keys 可作二期加分 |
| 并行多 worktree 占磁盘 | 任务结束保留策略与现 `_pack` 一致；文档说明 |
| `-am` 仍编译依赖模块 | 预期行为，非 sibling 微服务 |
