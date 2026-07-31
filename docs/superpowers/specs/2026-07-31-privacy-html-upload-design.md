# 隐私协议 HTML 上传设计

**日期**：2026-07-31  
**状态**：待用户确认  
**范围**：运营侧栏新菜单「隐私协议」；新 FTP 目标站；不改落地页 FTP

## 1. 目标

运营人员在 JarPorter 中选择一个或多个隐私协议 HTML，经 FTP 上传到  
[http://common.tiankongshuyu.cn/](http://common.tiankongshuyu.cn/) 对应站点，并得到可复制的访问地址。

## 2. 已确认决策

| 项 | 结论 |
|----|------|
| 菜单位置 | 侧栏独立「隐私协议」；加入 `OPS_TABS`（OPS 版与完整版均可见） |
| UI 体系 | Mantine（运营向，与落地页/结算单一致） |
| 文件 | 多选 `.html`；每个文件独立目录与 URL |
| 远端布局 | `{unix时间戳}{随机英文小写词}/index.html`（原文件改名为 index.html） |
| 公开 URL | `http://common.tiankongshuyu.cn/{目录}/` |
| FTP | host `60.205.155.142:21`；账密与落地页一致（`admin` / 现有硬编码）；登录后 `/` 即站点根（chroot ≈ `/www/wwwroot/common.tiankongshuyu.cn`） |
| 上传记录 | **本菜单内持久化展示**（防遗忘）；仅成功记录入库；不做远端删除 |
| 不做 | 不改落地页现有 FTP（`120.77.204.231` / `.fun`） |

## 3. 方案

**独立运营页 + 参数化/抽离 FTP 连接（方案 1）**

- 前端：新 `TabType`（如 `privacy`）+ `PrivacyPanel`（选文件、上传、结果表、复制链接）
- 后端：新 command `upload_privacy_html(paths: Vec<String>) -> Vec<PrivacyUploadResult>`
- FTP：复用落地页原生 FTP 客户端逻辑，但允许指定 host / 基路径（隐私用空基路径，直接在站点根建目录）；避免整份复制客户端

## 4. 后端行为

对每个本地 HTML 路径：

1. 校验存在且为 `.html` / `.htm`
2. 生成目录名：`{unix_secs}{random_english_word}`（词表固定小列表即可，如 `apple`/`ocean`/`swift`…，碰撞则换词或加短后缀）
3. 本地临时目录写入 `index.html`（复制源文件内容）
4. FTP：`MKD` 远程目录 → `STOR index.html`
5. 返回 `{ source_name, remote_dir, url, status, message }`
6. 全程 `diag_log("ops", …)`（模块名用现有表内 `ops`）；错误路径必打日志

结果 URL 固定前缀：`http://common.tiankongshuyu.cn/`（与用户需求一致；站点当前默认页为 HTTP）。

## 5. 前端行为

- 选文件：`@tauri-apps/plugin-dialog`，`multiple: true`，filter `html`
- 上传中：loading + 进度提示（可复用现有 progress 事件或面板内状态）
- 结果：表格「本地文件名 | 访问地址 | 复制」；失败行显示错误信息
- `isTauriRuntime()` 守卫

## 6. 配置与安全

- 首版凭证仍硬编码在后端（与落地页历史一致）；**不**再复制到前端
- 后续若抽配置，落地页与隐私协议可共用 user/pass、分 host 字段（本需求不强制）

## 7. 验收

1. OPS / 完整版侧栏可见「隐私协议」
2. 多选 2 个 HTML 上传成功 → 两个不同目录 URL，浏览器打开均为协议内容
3. 系统日志可搜 `[ops]` 看到上传路径与结果
4. 落地页 FTP 行为不变

## 8. 非目标

- HTTPS 强制、CDN、删除远端文件、富文本编辑协议正文
