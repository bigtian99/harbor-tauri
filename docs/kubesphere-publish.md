# KubeSphere 镜像发布（集成说明）

在 JarPorter 中新增「KubeSphere 发布」能力：连接 KubeSphere 控制台 → 查看部署实时状态 → 修改镜像并滚动发布。

## 入口

侧边栏 → **KubeSphere 发布**（运营区，位于「打包加速」之后）。

## 功能

| 功能 | 说明 |
|---|---|
| 连接 | 打开面板自动 `ks_connect`：优先复用本地会话缓存 → `refreshToken` 续期 → 密码登录；会话按环境落盘到 `~/.config/jarporter/ks-sessions.json`；API 遇到 401 会再尝试续期一次。**控制台 5xx/网络不通时保留会话并直接报错，不强制重登**（避免连环超时卡死） |
| 命名空间 | 下拉选择（可搜索），切换即加载该命名空间的部署列表 |
| 部署状态表 | 状态徽章（运行中/更新中/拉取失败/崩溃重启/创建中/已停止）、容器、镜像Tag、就绪、版本、Pod 原因 |
| 新/旧版本 Pod | **新版本（当前 revision）Pod 优先**，旧版本灰显——发布中即使旧 Pod 运行，新 Pod 异常也会标红 |
| 只看异常 | 过滤出非运行中部署 |
| 自动/手动刷新 | **默认开启**自动刷新；可选 10s/30s/60s 轮询，或点「刷新」（保留选中；无变化时不重渲染） |
| 导出 CSV | 全部部署状态导出（BOM+CRLF，Excel 中文正常） |
| 修改镜像发布 | 选部署 → 填新镜像 → `ks_update_image`（strategic-merge-patch）→ 回读验证 revision |
| 创建部署 | 「创建部署」按钮 → 弹窗填必传项（部署名/镜像/端口/副本/健康检查路径/引用配置字典/环境变量）；ConfigMap 按 key 展开为 `configMapKeyRef`；**`SW_AGENT_NAME` 固定取部署名称**（不走 ConfigMap） |
| ConfigMap 列表 | 「🗂 ConfigMap」卡片：名称/别名/键数/键列表；切 NS / 手动刷新部署时加载，自动刷新不重复拉 |
| ConfigMap 创建 | 两种模式：**表单**（名称 + `K=V` 行，`ks_create_configmap` 后端拼接）或 **YAML**（粘贴完整 YAML，`ks_create_configmap_yaml`）；均支持「预览 YAML + 📋复制」「校验 (dryRun)」 |
| ConfigMap 复制创建 | 行操作「复制创建」→ `ks_get_configmap` 读取 data → 预填表单（名称加 `-copy`）→ 改后创建 |
| 历史版本 | 选中部署后展示 ReplicaSet revision 列表（镜像 / 就绪 / 创建时间），支持「填入」或「回滚」 |
| Pod 日志 | 新/旧版本 Pod 行「日志」→ 尾部约 500 行；全屏 / 搜索 / 复制下载；**按级别着色**（FATAL/ERROR/WARN/INFO/DEBUG/TRACE）；点击级别芯片或上下键跳转到下一条同级别 |

## 后端（Rust）

`src-tauri/src/kubesphere.rs`：

- `ks_connect(env_id, console, username, password)`：优先复用落盘 Cookie → `/oauth/token` refresh → 密码 `/login`；成功后写入 `ks-sessions.json`
- `ks_login(...)`：兼容封装（落到 `_default` 环境键）
- `ks_logout(env_id?)`：清内存；传 env_id 时同时清该环境落盘缓存
- `ks_list_namespaces()`：`GET /api/v1/namespaces?limit=100`
- `ks_list_deployments(namespace)`：命名空间级 **3 次并行**拉取（deployments + replicasets + pods），内存按 ownerReference / revision 分组新/旧 Pod；旧实现按部署各打 2 次 API（1+2N）易卡死
- 前端：默认关闭自动刷新（可选手动开 60s）；静默刷新无变化时跳过 setState；搜索用 `useDeferredValue`；ConfigMap 页签 `keepMounted={false}` 懒加载；StrictMode 下连接短防抖避免双打超时
- `ks_list_deployment_revisions(namespace, deployment)`：按 Deployment 列出 ReplicaSet 历史 revision 与镜像
- `ks_get_pod_logs(namespace, pod, container?, tail_lines?, previous?)`：纯文本 Pod 日志（独立于 JSON `ks_api`，避免非 JSON 被误判 401）
- `ks_update_image(namespace, deployment, container, image)`：
  `PATCH /apis/apps/v1/namespaces/{ns}/deployments/{name}`，`Content-Type: application/strategic-merge-patch+json`，
  body `{"spec":{"template":{"spec":{"containers":[{"name":..,"image":..}]}}}}`，随后回读验证
- `ks_logout()`：清空会话

会话缓存：内存 + `~/.config/jarporter/ks-sessions.json`（按环境 ID）；密码仍只在 `config.json` 的环境配置里，不写入会话文件。
HTTP：进程内复用 `reqwest` Client（连接池），建连 5s / 请求 15s 超时。

## 连接配置（系统设置）

KubeSphere 连接参数放在 **系统设置 → KubeSphere** tab，支持配置多个环境：

- 每个环境：名称（dev / test / prod）、控制台地址、用户名、密码
- 可随时添加 / 删除环境
- 旧的单套 `ks_console` / `ks_username` / `ks_password` 会在加载时自动迁成一个名为 `dev` 的环境

发布面板顶部用下拉框选择环境，切换后重新登录并刷新命名空间。上次选中的环境记在 `ks_last_env_id`。

配置保存在 `HarborConfig.ks_environments` 与 `HarborConfig.ks_publish_maps`。

### 分支打包自动发布（Git 映射）

1. **系统设置 → KubeSphere → 发布映射**：选环境 →「连接并加载」→ 选命名空间，表格自动列出全部 Deployment；每行只需填 **Git 地址** 和角色，点「保存本命名空间」。
2. **分支打包**：勾选「打包后联动推送镜像」与「推送后自动发布到 KubeSphere」。
3. 推送成功后按当前仓库 `origin` 与映射表匹配并 `ks_update_image`。
4. **日志**：打包页进度 + 系统诊断 `[build]` / `[kubesphere]`。未配置或发布失败不阻断推送成功。

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
4. **控制台 502 误强制重登导致卡死**：探测拿到 5xx/网络错误时旧逻辑会 `放弃缓存 → 密码登录`，登录再撞 502，叠加多次 30s 超时，UI 长时间无反馈。
   修复：5xx/网络错误视为「控制台暂时不可用」→ **保留会话、直接返回错误、禁止密码重登**；连接超时改为建连 5s / 请求 12s；连接中展示状态文案。
5. **部署列表 1+2N 请求卡死**：每个 Deployment 再拉一次 ReplicaSet + Pod，命名空间几十个部署时刷新可达数十秒并与自动刷新叠加重试。
   修复：改为命名空间级 3 次批量拉取后内存关联；HTTP Client 复用连接池；前端自动刷新跳过进行中请求，且不再每次刷 ConfigMap。
6. **页面超级卡（刷新/输入卡顿）**：串行 3 次 API + 大 JSON 深拷贝 + 默认 30s 全量 setState + ConfigMap 常驻 DOM + StrictMode 双连超时。
   修复：3 路并行拉取、列表解析少 clone；静默刷新指纹不变跳过 setState；默认关自动刷新；Config 页签懒挂载；连接短防抖；搜索 deferred。
7. **「已复用会话」但命名空间为空**：API Client 默认跟随重定向，过期 Cookie → 302/401 被跟到登录页变成 **HTTP 200 HTML**，probe 误判有效，列表 JSON 解析失败得到 0 条。
   修复：业务 HTTP 禁用 redirect；probe/ks_api 校验 NamespaceList / 非 JSON 当 401；空命名空间前端不再标「已连接」。
