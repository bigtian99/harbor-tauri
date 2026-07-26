# 构建历史：未推送 JAR 一键推 Harbor

**日期**：2026-07-26  
**状态**：已批准并实现  
**范围**：历史页「项目列表」右侧记录中，未推送的 JAR 可一键推 Harbor，并自动带出项目配置

---

## 1. 背景

分支打包后产物会出现在构建历史；当前只能打开目录 / 复制镜像，无法从历史直接推 Harbor。  
用户希望：**没推过的才显示推送**，并**自动带出该项目配置**后上传。

## 2. 已确认需求

| 项 | 约定 |
|----|------|
| 入口 | 历史页记录操作区「推 Harbor」 |
| 显示 | 仅 `status !== "pushed"` 且存在可推送 JAR |
| 配置 | 优先记录字段，缺省用该仓库分支记忆（expose_port 等），镜像名再 `inferImageName` |
| 交互 | 一键推送（方案 1），不跳转上传页、不弹编辑表单 |
| 产物 | Maven：`artifact_path`；npm 含后端：`backend_artifact_path`；纯前端 dist **不做** |
| 推送后 | 按**记录 id** 更新 `image_name` / `image_tag` / `status=pushed`，刷新列表 |

## 3. 技术方案

### 3.1 可推送判定

```ts
function historyJarPushTarget(record: BuildRecord): string | null {
  if (record.status === "pushed") return null;
  const type = record.project_type.toLowerCase();
  if (type === "maven" && record.artifact_path) return record.artifact_path;
  if (type === "npm" && record.backend_artifact_path) return record.backend_artifact_path;
  return null;
}
```

### 3.2 配置解析

1. `imageName` = `record.image_name` trim 非空，否则 `inferImageName(jarPath, "jar")`（可再加项目名兜底）  
2. `exposePort` = 仓库记忆 `getRememberedBranchAdvancedSettings(config, record.repo_path).exposePort`  
3. `springProfile` = `record.spring_profile`  
4. `imageTag` = 生成时间 tag（与分支自动推送相同的 `branch-v.yy.mm.dd.hh.mi` 风格，分支取 `record.branch`）

### 3.3 后端

现有 `update_build_record_image` 只改 `build_history.first`，不适合历史任意一条。

新增（或扩展）命令，例如：

```rust
update_build_record_push(record_id, image_name, image_tag) // 将该 id 标为 pushed
```

打 `diag_log("history", ...)`。

### 3.4 前端接线

- `HistoryPanel`：未推送 JAR 显示 Rocket/Upload 按钮；`onPushJar(record)`  
- `App` / hook：校验 Harbor 配置 → `invoke("build_and_push", { jarPath, imageName, imageTag, artifactType: "jar", exposePort, ... })` → `update_build_record_push` → `loadBuildHistory`  
- 复用 `isBuilding` / progress / log；推送中禁用按钮

## 4. 验收

1. `status=success` 且有 JAR → 显示推送；`pushed` → 不显示  
2. 点推送后走构建进度，成功后该条变 `pushed` 且出现镜像可复制  
3. 镜像名 / 端口尽量来自记录 + 项目记忆  
4. 纯前端记录无推送按钮  

## 5. 非目标

- 历史页内推前端 dist  
- 推送前编辑表单  
- 批量多选推送  
