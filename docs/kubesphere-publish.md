# KubeSphere 镜像发布（集成说明）

在 JarPorter 中新增「KubeSphere 发布」能力：连接 KubeSphere 控制台 → 查看部署实时状态 → 修改镜像并滚动发布。

## 入口

侧边栏 → **KubeSphere 发布**（运营区，位于「打包加速」之后）。

## 功能

| 功能 | 说明 |
|---|---|
| 连接 | 输入控制台地址/账号/密码，`ks_login` 登录（复刻控制台前端自定义加密），成功后自动列出命名空间 |
| 命名空间 | 下拉选择（可搜索），切换即加载该命名空间的部署列表 |
| 部署状态表 | 状态徽章（运行中/更新中/拉取失败/崩溃重启/创建中/已停止）、容器、镜像Tag、就绪、版本、Pod 原因 |
| 新/旧版本 Pod | **新版本（当前 revision）Pod 优先**，旧版本灰显——发布中即使旧 Pod 运行，新 Pod 异常也会标红 |
| 只看异常 | 过滤出非运行中部署 |
| 自动/手动刷新 | 10s/30s/60s 轮询，或手动刷新（保留选中） |
| 导出 CSV | 全部部署状态导出（BOM+CRLF，Excel 中文正常） |
| 修改镜像发布 | 选部署 → 填新镜像 → `ks_update_image`（strategic-merge-patch）→ 回读验证 revision |
| 历史版本 | 选中部署后展示 ReplicaSet revision 列表（镜像 / 就绪 / 创建时间），支持「填入」或「回滚」 |

## 后端（Rust）

`src-tauri/src/kubesphere.rs`：

- `ks_login(console, username, password)`：登录并缓存 Cookie 会话（token/refreshToken/expire）
  - 登录加密复刻：`encrypt = Base64(奇偶位串) + "@" + 字符串`，key=`kubesphere`（非标准 AES）
  - 成功标志：Set-Cookie 含 `token`（响应体是 HTML 外壳页）
- `ks_list_namespaces()`：`GET /api/v1/namespaces?limit=100`
- `ks_list_deployments(namespace)`：deployments + replicasets + pods，按 ReplicaSet revision 分组新/旧 Pod，状态汇总
- `ks_list_deployment_revisions(namespace, deployment)`：按 Deployment 列出 ReplicaSet 历史 revision 与镜像
- `ks_update_image(namespace, deployment, container, image)`：
  `PATCH /apis/apps/v1/namespaces/{ns}/deployments/{name}`，`Content-Type: application/strategic-merge-patch+json`，
  body `{"spec":{"template":{"spec":{"containers":[{"name":..,"image":..}]}}}}`，随后回读验证
- `ks_logout()`：清空会话

会话为进程内全局（`static SESSION: Mutex<Option<Session>>`），密码不落盘。

## 连接配置（系统设置）

KubeSphere 连接参数放在 **系统设置 → KubeSphere** tab，支持配置多个环境：

- 每个环境：名称（dev / test / prod）、控制台地址、用户名、密码
- 可随时添加 / 删除环境
- 旧的单套 `ks_console` / `ks_username` / `ks_password` 会在加载时自动迁成一个名为 `dev` 的环境

发布面板顶部用下拉框选择环境，切换后重新登录并刷新命名空间。上次选中的环境记在 `ks_last_env_id`。

配置保存在 `HarborConfig.ks_environments`。

## 前端（React + Mantine）

`src/components/KsPublishPanel.tsx`：

- Mantine 组件（Card/Table/Badge/Select/Checkbox…），符合项目 OPT-018「运营向用 Mantine」约定
- `@tauri-apps/api` invoke 调上述命令；`@mantine/notifications` 展示结果
- 时间显示使用上海时区（`toLocaleString(..., {timeZone:'Asia/Shanghai'})`）

## 验证

- `cargo build`（后端）✅
- `npx tsc --noEmit`（前端）✅
- 侧栏菜单与面板渲染 ✅（vite dev）

> 说明：完整功能需在 Tauri 运行时内验证（invoke 依赖 Tauri 后端）；浏览器 vite dev 仅验证 UI 渲染。

## 踩坑记录（已修复）

1. **登录拿不到 Cookie**：login 可能返回 302，Set-Cookie 在首个响应上；reqwest 默认跟随重定向会丢失。
   修复：登录请求 `redirect(Policy::none())`，直接读首个响应的 Set-Cookie；错误信息附带 HTTP 状态码与响应片段。
2. **新/旧 Pod 全被判为旧版本**：注解键 `deployment.kubernetes.io/revision` 含 `/`，JSON Pointer 必须写 `~1`（`/metadata/annotations/deployment.kubernetes.io~1revision`）。
   修复：所有该键的 pointer 转义后，Pod 分组正确（实测 9 个部署 new1/old0）。
3. 集成测试 `real_login_and_list`（`#[ignore]`，手动 `cargo test -- --ignored`）验证：登录、命名空间、部署状态、无变更发布全链路。
