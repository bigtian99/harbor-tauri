# 隐私协议覆盖上传设计

**日期**：2026-08-12  
**状态**：已实现  
**前置**：`docs/superpowers/specs/2026-07-31-privacy-html-upload-design.md`（新增上传已落地）  
**范围**：隐私协议菜单增加「覆盖」模式；统一远端目录为 `主机名/路径`；可预览线上页；不改落地页 FTP  
**实测备注**：隐私 FTP `60.205.155.142`、`base_dir=None`；上传前 `diag_log` 记录 `host` + 完整 `remote_dir`（含主机名段）。若子域名覆盖失败，检查账号登录根是否为各站点上级目录。

## 1. 目标

运营在「隐私协议」页：

1. **新增**（现状增强）：不填覆盖目标时，上传到新目录并返回可访问 URL  
2. **覆盖**：粘贴已有访问地址 → 自动解析 FTP 目录 → 预览线上页 → 选 HTML 上传覆盖同目录 `index.html`

## 2. 已确认决策

| 项 | 结论 |
|----|------|
| 方案 | 统一「主机+路径」为远端目录（方案 1） |
| 输入 | 完整访问 URL（可带 `http`/`https`） |
| 解析规则 | 去掉协议与首尾 `/`，得到 `remote_dir = host[/path…]` |
| 空路径子域名 | `https://ythtpictorial.tiankongshuyu.cn/` → `ythtpictorial.tiankongshuyu.cn` |
| 带路径 | `http://common.tiankongshuyu.cn/1785467601raven/` → `common.tiankongshuyu.cn/1785467601raven` |
| 新增目录 | `common.tiankongshuyu.cn/{unix秒}{随机英文小写词}`（相对现网「仅时间戳词」升级为带主机前缀，与覆盖规则一致） |
| 预览 | 解析成功后可打开目标 URL（默认系统浏览器） |
| 覆盖确认 | 覆盖上传前二次确认 |
| 多文件 | 覆盖模式仅允许 **1** 个 HTML；新增仍可多选 |
| UI | Mantine，仍在 `PrivacyPanel`，不新菜单 |
| 历史 | 成功写入/更新本地 `privacy_uploads.json`；按 `remote_dir`（或 id）去重置顶 |
| 不做 | 不删远端目录、不改落地页 FTP、不做多目录批量覆盖 |

## 3. URL 解析

输入示例与结果：

| 输入 | `remote_dir` | `preview_url`（规范化） |
|------|----------------|-------------------------|
| `http://common.tiankongshuyu.cn/1785467601raven/` | `common.tiankongshuyu.cn/1785467601raven` | 保留用户 scheme，补尾 `/` |
| `https://ythtpictorial.tiankongshuyu.cn/` | `ythtpictorial.tiankongshuyu.cn` | 同上 |
| `https://ythtpictorial.tiankongshuyu.cn/foo/bar/` | `ythtpictorial.tiankongshuyu.cn/foo/bar` | 同上 |

校验失败（空串以外且无法解析出 host）→ 前端提示，禁止上传。  
目标输入框为空 → 新增模式，不调用解析。

## 4. FTP 与公开 URL

- FTP host：仍用隐私专用 `60.205.155.142`（与落地页隔离）  
- **远端路径**：相对登录后工作根，写入完整 `remote_dir`（含主机名段）。若现网登录根仍是 `common` 站点根，实现时需将隐私上传工作根调整为可覆盖各站点目录的上级（或等价 `base_dir`），使  
  - 新增：`common.tiankongshuyu.cn/{unix}{word}/index.html`  
  - 覆盖：`{host}/{path}/index.html`  
  均可到达。  
- 上传内容：本地临时目录仅含 `index.html`（原文件改名）  
- 覆盖：目录已存在则直接 `STOR`；不存在则 `MKD` 后上传（与现 `ensure_dir` 行为一致）  
- 新增公开 URL：`http://common.tiankongshuyu.cn/{unix}{word}/`  
- 覆盖公开 URL：优先用用户输入规范化后的 `preview_url`

## 5. 后端 API

```text
parse_privacy_target_url(url: string)
  -> { remote_dir: string, preview_url: string }

upload_privacy_html(paths: Vec<string>, target_url?: string | null)
  -> Vec<PrivacyUploadResult>
```

行为：

1. `target_url` 空/未传：每个 path 独立新增（多选 OK）  
2. `target_url` 有值：  
   - 解析失败 → 整体返回错误  
   - `paths.len() != 1` → 错误「覆盖模式仅支持单个 HTML」  
   - 使用解析出的 `remote_dir` 上传覆盖  
3. 成功：`prepend_history`，同 `id`/`remote_dir` 去重置顶  
4. `diag_log("ops", …)`：模式（create/overwrite）、`remote_dir`、源文件、成功/失败

历史模型沿用现有字段；`id` 建议继续用 `remote_dir`（覆盖与新增同一键空间）。

单元测试（Rust）：

- 解析：上述三例 + 非法 URL  
- `is_html_path` 等既有测试保留

## 6. 前端（PrivacyPanel）

上传区增加：

1. TextInput：覆盖目标 URL（placeholder 提示可空=新增）  
2. 解析展示：`remote_dir` + Badge「新增」/「覆盖」  
3. Button「预览」：仅覆盖且解析成功时启用 → `openUrl(preview_url)`  
4. 主上传按钮文案：`新增上传` / `覆盖上传`  
5. 覆盖时 `modals`/`window.confirm` 二次确认（文案含 `remote_dir`）  
6. 选文件：覆盖强制单选（`multiple: false`）；新增保持多选  

历史区、删除/清空本地记录逻辑不变。

## 7. 验收

1. 不填 URL，上传 1～2 个 HTML → 新 URL 形如 `http://common.tiankongshuyu.cn/{dir}/`，且 `dir` 含 `common.tiankongshuyu.cn/` 前缀；历史新增  
2. 填入 `http://common.tiankongshuyu.cn/<已有dir>/`，预览可开；覆盖上传后同 URL 内容更新  
3. 填入 `https://ythtpictorial.tiankongshuyu.cn/`，解析目录为该主机名；确认后覆盖其根 `index.html`  
4. 覆盖时多选被拒或 UI 仅单选  
5. 系统日志 `[ops]` 可见 create/overwrite 与 `remote_dir`  
6. 落地页 FTP 行为不变  

## 8. 非目标 / 风险

- 非目标：HTTPS 强制、远端删除、富文本编辑、批量覆盖多 URL  
- 风险：FTP 登录根若仍锁在 common 站点内，覆盖子域名会失败——实现任务需先验证/调整工作根，并在日志中打出实际 CWD  
