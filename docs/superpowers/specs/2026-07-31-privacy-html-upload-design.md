# 隐私协议 HTML 上传设计

**日期**：2026-07-31  
**状态**：待用户确认  
**范围**：运营侧栏新菜单「隐私协议」；新 FTP 目标站；本菜单上传记录持久化；不改落地页 FTP

## 1. 目标

运营人员在 JarPorter 中选择一个或多个隐私协议 HTML，经 FTP 上传到  
[http://common.tiankongshuyu.cn/](http://common.tiankongshuyu.cn/) 对应站点，并得到可复制的访问地址；  
在本菜单内持久化展示历史上传，避免遗忘。

## 2. 已确认决策

| 项 | 结论 |
|----|------|
| 菜单位置 | 侧栏独立「隐私协议」；加入 `OPS_TABS`（OPS 版与完整版均可见） |
| UI 体系 | Mantine（运营向，与落地页/结算单一致） |
| 文件 | 多选 `.html`；每个文件独立目录与 URL |
| 远端布局 | `{unix时间戳}{随机英文小写词}/index.html`（原文件改名为 index.html） |
| 公开 URL | `http://common.tiankongshuyu.cn/{目录}/` |
| FTP | host `60.205.155.142:21`；账密与落地页一致（`admin` / 现有硬编码）；登录后 `/` 即站点根（chroot ≈ `/www/wwwroot/common.tiankongshuyu.cn`） |
| 上传记录 | 本菜单持久化；仅成功入库；支持勾选批量删除、一键清空；**只删本地记录，不删服务器文件** |
| 不做 | 不改落地页现有 FTP（`120.77.204.231` / `.fun`）；不做远端文件删除 |

## 3. 方案

**独立运营页 + 参数化/抽离 FTP 连接 + 本地 JSON 历史**

- 前端：新 `TabType`（`privacy`）+ `PrivacyPanel`（选文件、上传、本次结果、历史上传表）
- 后端：
  - `upload_privacy_html(paths: Vec<String>) -> Vec<PrivacyUploadResult>`
  - `list_privacy_uploads() -> Vec<PrivacyUploadRecord>`
  - `delete_privacy_uploads(ids: Vec<String>) -> ()`（批量删本地）
  - `clear_privacy_uploads() -> ()`（清空本地）
- FTP：复用落地页原生 FTP 客户端逻辑，允许指定 host / 基路径（隐私用空基路径）
- 存储：`{app_config_dir}/privacy_uploads.json`（与 `config.json` 同目录），不塞进 Harbor 配置，避免互相污染

## 4. 后端行为（上传）

对每个本地 HTML 路径：

1. 校验存在且为 `.html` / `.htm`
2. 生成目录名：`{unix_secs}{random_english_word}`（固定小词表；碰撞换词或加短后缀）
3. 本地临时目录写入 `index.html`
4. FTP：`MKD` 远程目录 → `STOR index.html`
5. 成功则追加写入 `privacy_uploads.json`（插到列表头部）
6. 返回 `{ id, source_name, remote_dir, url, status, message, uploaded_at }`
7. `diag_log("ops", …)`；错误路径必打

URL 前缀：`http://common.tiankongshuyu.cn/`

## 5. 持久化记录模型

```text
PrivacyUploadRecord {
  id: string          // uuid 或 `{remote_dir}` 唯一键
  source_name: string // 原本地文件名
  remote_dir: string
  url: string
  uploaded_at: string // ISO 或 `yyyy-MM-dd HH:mm:ss`
}
```

- 仅成功记录持久化；失败只出现在当次结果区
- 上限：保留最近 **200** 条（超出截断尾部）；清空/批量删不受此限

## 6. 前端行为

**上传区**

- 多选 `.html` → 上传 → 当次结果表（成功/失败）

**历史上传区（同页下方）**

- 进入菜单时 `list_privacy_uploads` 加载
- 表格：勾选 | 时间 | 文件名 | URL | 复制
- 操作：
  - **删除所选**：确认后 `delete_privacy_uploads(ids)`
  - **清空全部**：二次确认后 `clear_privacy_uploads`
- 上传成功后刷新列表（新记录置顶）
- `isTauriRuntime()` 守卫

## 7. 配置与安全

- 首版 FTP 凭证硬编码后端；不暴露到前端
- 历史 JSON 仅含 URL/文件名/时间，无账密

## 8. 验收

1. OPS / 完整版侧栏可见「隐私协议」
2. 多选 2 个 HTML 上传成功 → 两个 URL 可访问，且历史表出现 2 条
3. 重启应用后历史仍在
4. 勾选批量删除、清空后本地列表更新；服务器文件仍可访问
5. 系统日志可搜 `[ops]`；落地页 FTP 不变

## 9. 非目标

- HTTPS 强制、CDN、删除远端目录、富文本编辑协议正文
