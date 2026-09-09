# Harbor 多环境（开发 / 生产）设计

**日期**: 2026-09-08  
**状态**: 已定稿（实现中）  
**范围**: `jar-to-harbor/` 主应用 — Harbor 推送相关配置与 UI

## 目标

将 Harbor 从「单套连接」改为与 KubeSphere 同构的**多环境模型**：每套环境含完整地址 / 账号 / 密码 / 项目。凡会推送到 Harbor 的界面都提供环境下拉，默认带出上次选择；用户可随时改。

## 非目标

- 不与 `ks_environments` 绑定或共用 id
- 不写死仅「开发 / 生产」两个槽位（名称自由，建议名开发/生产）
- 不改落地页 / 隐私 FTP、宝塔、镜像构建模板逻辑

## 配置模型

### 新增

```ts
interface HarborEnvironment {
  id: string;
  name: string;       // 如「开发」「生产」
  harbor_url: string;
  username: string;
  password: string;
  project: string;
}
```

`HarborConfig` 新增：

- `harbor_environments?: HarborEnvironment[]`
- `harbor_last_env_id?: string`

顶层 `harbor_url` / `username` / `password` / `project` 标为 `@deprecated`，仅兼容；`normalize_config` / 前端 resolve 时同步写回活跃环境的四字段，保证旧调用路径仍可读。

### 加载迁移（对齐 KS）

1. 若 `harbor_environments.length > 0` → 用列表
2. 否则若旧四字段有效（至少有 url，或有 username）→ 生成一条 `{ id, name: "默认", ...旧字段 }`
3. `harbor_last_env_id` 无效或不在列表 → 回退第一项
4. 将活跃环境的四字段 mirror 到顶层（与 KS mirror console/username/password 同模式）

### 解析辅助

前端 `src/utils/harborEnvironments.ts`（镜像 `ksEnvironments.ts`）：

- `resolveHarborEnvironments(config)`
- `pickHarborEnvironment(envs, lastId)`
- `createHarborEnvironment(existing)` / `nextHarborEnvName`（建议名：开发、生产、测试…）
- `resolveActiveHarbor(config)` → 当前 url/user/pass/project

后端 `migrate_harbor_environments` 放在 `config_io::normalize_config`；`require_harbor_config` 与推送路径基于 mirror 后的顶层字段即可（迁移后始终与活跃环境一致）。若命令支持显式 `harbor_env_id`，优先用该 id 解析，否则用 `harbor_last_env_id`。

## 设置页

「Harbor 连接」Tab：单表单 → 环境列表（交互对齐 KubeSphere Tab）。

- 说明：多套 Harbor；推送页按环境切换；切换会记住为默认
- 添加 / 编辑弹窗：环境名 + 地址/用户/密码/项目 + 测试连接
- 删除确认；删当前 last id 则清空并由 normalize 回退
- 同 Tab 落地页 FTP 区块不变

## 推送入口 UI（均需下拉）

| 入口 | 行为 |
|------|------|
| 上传打包 | 构建推送前选 Harbor 环境；预览地址随环境变 |
| 推送镜像 | 同上 |
| 分支打包 | 「推送与发布」区：勾选推 Harbor 时显示环境下拉（可始终显示，未勾选时灰显） |
| 历史记录再推 JAR | 推送前选环境（行内或确认区） |
| KS 批量打包推送 | 模态内选 Harbor 环境（一次批量共用） |
| 合并后同步打包 | 若会推 Harbor：合并表单或确认提示旁提供环境下拉 |

规则：

- 选项来自 `harbor_environments`；空则提示去设置，推送禁用或 toast
- 默认值 = `pickHarborEnvironment(..., harbor_last_env_id)`
- `onChange` → 写 `harbor_last_env_id`（`onConfigChange` / `patchHarborConfig`），并 mirror 顶层四字段；与现有「保存配置」节奏一致（可即时 patch 内存 + 可选持久化，对齐 KS last env）
- 实际 `build_and_push` / `push_local_image` 使用选中环境凭证

## 后端

- `normalize_config` 增加 `migrate_harbor_environments`
- `require_harbor_config` 继续校验顶层四字段（迁移后 = 活跃环境）
- 可选：推送命令增加 `harbor_env_id: Option<String>`；有则临时覆盖本次推送所用环境，无则用 last；**推荐实现**，避免并发/竞态下只靠 last id
- 诊断日志：`[build]` / `[docker]` 记录环境名或 id + full_image，脱敏密码

## 验收

1. 旧配置首次加载自动出现一条「默认」环境，推送行为与升级前一致
2. 设置可添加「开发」「生产」两套不同 Harbor，测试连接分别成功
3. 上传 / 推送镜像 / 分支 / 历史 / 批量打包：均能看到环境下拉，默认上次；切换后下次打开仍默认该项
4. 切到生产推送 → 镜像打到生产 Harbor 项目地址；再切开发同理
5. 系统日志可见环境标识与最终镜像地址

## 修订记录

- 初稿：仅「推送镜像」页有选择器（方案 B）
- **修订**：凡上传/推送到 Harbor 的入口均提供下拉，默认带出上次选择
