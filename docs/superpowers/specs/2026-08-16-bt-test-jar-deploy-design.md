# test 打包后自动 FTP + 宝塔重启（仅 Java）

**日期**: 2026-08-16  
**状态**: 已批准（设计对话确认）  
**范围**: 仅 Java JAR；前端 dist 自动部署明确延后  
**参考**: [宝塔 restart_project](https://docs.bt.cn/api/java/restart_project)、[宝塔 API 概览](https://docs.bt.cn/api/)、`~/code/bt-gateway/README.md` 面板档案

## 背景

JarPorter 对非 `rc-master` 目标分支以 `Spring Profile=test` 打包 JAR，且不推 Harbor。测试环境 Java 服务跑在宝塔面板上（固定 JAR 路径，如 `/www/wwwroot/pcm2/tksy-backend-1.0.0.jar`）。研发期望：test 打包成功后自动覆盖服务器 JAR 并重启对应 Java 项目。

不使用 `bt-gateway`：JarPorter 直连面板 API + FTP。

## 目标

1. `package_from_branch` 成功且 profile 为 `test`、产物为 JAR 时，自动：匹配宝塔 Java 项目 → FTP 覆盖同名 JAR → 调用 `restart_project`。
2. 面板密钥与 FTP 凭证进本地配置（`~/.config/jarporter/config.json`），Config 面板可改；默认值可用，密钥默认留空。
3. 部署失败不阻断打包成功；诊断日志可排查。

## 非目标（本轮）

- 前端 dist / 静态站 FTP 部署与站点重载
- 对接 bt-gateway
- 在宝塔上新建 Java 项目（只覆盖已有项目的 JAR）
- 生产（`prod` / `rc-master`）自动部署

## 触发条件

在 `package_from_branch` **打包成功、产物已复制到输出目录之后**：

| 条件 | 要求 |
|------|------|
| Spring Profile | `trim` + 小写后等于 `test` |
| 产物类型 | JAR（Maven 主产物；若 `package_with_backend` 且有 backend JAR，backend 也走同一套部署） |
| 面板密钥 | `bt_panel_secret` 非空；为空则跳过部署并 `diag_log`，打包仍成功 |

前端 npm / `frontend_dist` 本轮不触发。

## 部署流程

```
打包成功 (profile=test, JAR)
  → 签名请求 project_list
  → 按 JAR basename 匹配 project_config.project_jar
  → FTP STOR 覆盖远程完整路径
  → restart_project
  → 进度事件 + 诊断日志 + 返回摘要
```

### 1. 列项目

- `POST {bt_panel_url}/mod/java/project/project_list/stype`
- Content-Type: `application/x-www-form-urlencoded`
- 表单字段：`request_time`、`request_token`，以及列表分页参数（如 `p=1`、`limit=100`，以实测为准）
- 签名（官方）：`request_token = md5(request_time + md5(api_sk))`，`request_time` 为 unix 秒字符串
- TLS：`bt_panel_insecure == true` 时跳过证书校验（默认 true，面板自签）

### 2. 匹配

- 本地文件名 == 远程 `project_config.project_jar`（或等价字段）的 basename
- **0 条**：跳过，告警日志「未匹配到宝塔 Java 项目」
- **1 条**：采用
- **多条**：优先远程父目录名与仓库名（`repo_name`）模糊相等（忽略大小写、`-`/`_`）；仍歧义则跳过并告警，不盲目覆盖

参考路径样例（会过时，以实时 `project_list` 为准）：

| 项目名 | JAR |
|--------|-----|
| 中台二期 | `/www/wwwroot/pcm2/tksy-backend-1.0.0.jar` |
| 渠道后台 | `/www/wwwroot/channel/channeladmin-1.0.0.jar` |
| vpn-1 | `/www/wwwroot/vpn/vpn-1.0.0.jar` |

### 3. FTP 覆盖

- Host / User / Pass：配置项，默认 `47.107.51.228` / `admin` / `pcm520..`
- 二进制上传，覆盖已存在文件；远程路径为面板上的完整 `project_jar` 路径（目录需已存在，不负责新建项目目录）
- 复用/扩展现有 FTP 客户端：支持自定义 host/user/pass + **单文件**上传（落地页是目录上传，需补单文件路径）

### 4. 重启

- `POST {bt_panel_url}/mod/java/project/restart_project/stype`
- 携带签名 + 业务参数
- 参数策略：先发官方文档的 `project_name`；若面板返回失败且响应暗示需 `id`，再试 `id`（以实现时实测为准，写入诊断日志）
- 成功判据：响应 JSON `status == true`（或等价成功字段）

### 5. 失败策略

| 阶段 | 行为 |
|------|------|
| 未配置密钥 | 跳过，info 日志 |
| 列项目 / 匹配失败 | 跳过该 JAR，warn；打包成功 |
| FTP 失败 | 不重启；error 日志 + toast；打包成功 |
| 重启失败 | error 日志 + toast；打包成功（JAR 可能已覆盖） |

## 配置

`HarborConfig` 新增（`serde(default)`，旧配置可加载）：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `bt_panel_url` | string | `https://47.107.51.228:10163` | 面板 API 根 |
| `bt_panel_secret` | string | `""` | API 密钥，勿提交 git |
| `bt_panel_insecure` | bool | `true` | 跳过 TLS 校验 |
| `bt_ftp_host` | string | `47.107.51.228` | |
| `bt_ftp_user` | string | `admin` | |
| `bt_ftp_pass` | string | `pcm520..` | 可改；UI 密码框 |
| `bt_auto_deploy_test` | bool | `true` | 总开关；关闭则即使 profile=test 也不部署 |

Config 面板：在「JAR 打包」或独立「宝塔部署」分区编辑上述字段；保存走现有 `save_config`。

## 代码落点

| 位置 | 职责 |
|------|------|
| `src-tauri/src/build/bt_deploy.rs`（新） | 签名、HTTP、匹配、编排 FTP+重启 |
| `src-tauri/src/landing/ftp.rs` 或 `utils` | 扩展自定义凭证 + 单文件 `STOR`（避免复制硬编码） |
| `src-tauri/src/build/package.rs` / `package_finish.rs` | 成功路径调用部署钩子 |
| `src-tauri/src/models.rs` + `src/types.ts` | 配置字段 |
| `src/components/ConfigPanel.tsx` | UI |
| `diag_log("build", …)` | 全程诊断；密钥/密码靠现有脱敏 |

模块名：沿用 `build`（部署是打包后置步骤）；不新增无表 tag。

## 返回与 UI

- 打包结果可增加可选字段（如 `bt_deploy_summary: string | null`），或仅追加到打包日志文本
- 前端：部署成功/失败用 notification；日志区可见步骤
- 进度：`emit_progress` 在 85–100 之间增加「上传宝塔 / 重启」阶段文案

## 测试

- 单元：MD5 签名向量；JAR basename 匹配（0/1/多条消歧）
- 集成（可选、需密钥）：对测试机 `project_list` 冒烟；不在 CI 强制连外网
- 回归：`profile=prod` 或未填密钥时不调用 FTP/重启

## 验收

1. Config 可保存宝塔 URL / 密钥 / FTP；密钥留空时 test 打包不部署且有日志
2. 填好密钥后，Maven + profile=test 打包成功 → 服务器对应 JAR 被覆盖 → 面板项目重启
3. 同名多项目且无法消歧时不覆盖，有明确告警
4. FTP 或重启失败不影响「打包成功」状态与产物输出
5. 系统日志可搜 `[build]` 看到部署步骤（无明文密钥）

## 风险

- 面板 API 版本差异：`restart_project` 文档写 GET/`project_name`，社区与网关笔记多用 POST/`id` —— 实现时以实测为准并记录
- FTP 与面板同机但权限不足 → 上传失败需清晰错误
- 同名 JAR（多份 `tksy-backend-1.0.0.jar`）消歧依赖仓库名启发式，极端情况需日后加映射表
