# 诊断日志按模块 + 按天滚动设计

**日期**: 2026-07-11  
**项目**: JarPorter  
**状态**: 待实现  

## 概述

统一后端诊断日志：独立 `diag` 模块、按模块 tag 写入、按天滚动文件、系统日志可读最近最多 3 天。全仓业务 `eprintln!` / 错模块 `templates_log` 一刀切迁移到 `diag_log(module, msg)`，使侧边栏「系统日志」可用 `[build]`、`[updater]` 等快速定位。

## 决策记录

| 决策点 | 选择 |
|--------|------|
| 方案 | B：独立 `diag` 模块（非 tracing、非寄生 landing） |
| 范围 | 基础设施 + 全模块迁移 |
| 迁移粒度 | 一刀切：业务路径现有 `eprintln!` / 错标 `templates_log` 全部改掉 |
| 日志格式 | `[ts] [JarPorter][module] message` |
| 滚动 | 按天：`diagnostic-YYYY-MM-DD.log` |
| 读取 | 合并最近 ≤3 天，新日志在前 |
| 错误标记 | 不加独立 level API；消息正文自行写清错误 |
| 旧文件 | `templates-diagnostic.log` 不迁移、不删除、新逻辑不写 |
| 成功标准 | ① 按模块可搜 ② 按天滚动可读 |

## 现状（问题）

- `landing::templates_log` 硬编码 `[JarPorter][templates]`，无 module 参数。
- 仅 `landing.rs`、`updater.rs` 写入诊断文件；`updater` 被误标为 `templates`。
- `build` / `git` / `docker` / `ops` / `settlement` / `history` / `preview` / `config` / `db` / `utils` 等大量 `eprintln!`，系统日志不可见。
- 文件名 `templates-diagnostic.log` 语义过窄。

## 架构

```
启动 lib::run / setup
    └─► diag::init(app)          // 解析 app_log_dir，记住根目录

各模块命令 / 错误路径
    └─► diag_log("build", msg)   // stderr + 追加当天文件
            │
            ▼
  {app_log_dir}/diagnostic-YYYY-MM-DD.log

侧边栏「系统日志」
    └─► read_diagnostic_log(lines?)
            └─► 收集最近 ≤3 天文件 → 按时间序合并 → reverse 取最近 N 行
```

## 组件

### 1. 新建 `src-tauri/src/diag.rs`

职责：

| 函数 | 说明 |
|------|------|
| `pub fn init(app: &AppHandle)` | 解析 `app_log_dir`（失败回退 `dirs::config_dir()/jarporter/logs` 或 temp），`create_dir_all`，`OnceLock` 存根目录 |
| `pub fn diag_log(module: &str, message: impl AsRef<str>)` | 行：`[JarPorter][{module}] {message}`；`eprintln!` + 带本地时戳 append 当天文件；文件锁防并发写乱 |
| `pub fn diagnostic_log_dir() -> Option<PathBuf>` | 根目录 |
| `pub fn today_log_path() -> Option<PathBuf>` | `diagnostic-YYYY-MM-DD.log` |
| `pub async fn get_templates_diagnostic_log_path() -> Result<String, String>` | **命令名可暂保持**（少改前端），返回**当天**文件路径；实现迁到 `diag` |
| `pub async fn read_diagnostic_log(lines: Option<usize>) -> Result<String, String>` | 默认约 300 行；合并最近 ≤3 个按日期命名的文件（按文件名日期排序），行级拼接后 **reverse** 取 N 行（新在前） |

实现约束：

- 不引入 `tracing` / 新 crate（沿用现有 `chrono`、标准库）。
- `module` 不做运行时枚举校验（避免改 API 摩擦）；约定靠 `CLAUDE.md` 模块表。
- 写失败静默（不因日志 IO 拖垮主流程）；stderr 仍输出。
- 日期用本地时区 `Local::now().format("%Y-%m-%d")`。

### 2. `templates_log` 兼容

仍导出（可放在 `diag` 或 `landing` 再导出）：

```rust
pub fn templates_log(message: impl AsRef<str>) {
    diag_log("templates", message);
}
```

`landing` 内模板 init/list 可继续 `templates_log` 或改为 `diag_log("templates", …)`；落地页生成 / FTP 改为 `diag_log("landing", …)`。

### 3. `lib.rs` 接线

- `mod diag;`
- 启动路径：在现有 `landing::init_bundled_templates_dir` 之前或之内调用 `diag::init`；**以 `diag::init` 为日志根唯一初始化点**。
- 注册命令：`get_templates_diagnostic_log_path`、`read_diagnostic_log` 从 `landing` 迁到 `diag`（或 landing 转发到 diag，二选一，推荐迁走避免双实现）。
- 删除 / 停用 `landing` 内 `TEMPLATES_LOG_FILE` 与旧 `templates_log` 写文件逻辑，避免双写。

### 4. 模块名表（写入日志时使用）

| 模块 | 主要文件 |
|------|----------|
| `templates` | 模板目录 init、list、zip 上传/删除 |
| `landing` | 渠道、生成落地页、FTP |
| `preview` | `preview_server.rs` |
| `updater` | `updater.rs` |
| `build` | `build.rs` 及分支打包主路径 |
| `git` | `git.rs`、`commit.rs` |
| `docker` | `docker.rs` |
| `ops` | `ops.rs` |
| `settlement` | `settlement.rs` |
| `history` | `history.rs` |
| `config` | `config_cmd.rs` |
| `db` | `db.rs` |
| `app` | `lib.rs` 启动、跨模块 |
| `utils` | `utils.rs` 缓存/nginx 探测等工具（表中可记为 `app` 或 `utils`；本设计采用 **`utils`**，并同步进 CLAUDE.md 模块表） |

> 注：当前 CLAUDE.md 未列 `utils`，实现时在模块表补一行 `utils`，与本 spec 对齐。

### 5. 全仓迁移规则（一刀切）

| 现状 | 动作 |
|------|------|
| `eprintln!("[JarPorter] …")` 业务信息/错误 | → `diag_log("<模块>", …)` |
| `crate::landing::templates_log` 在 updater | → `diag_log("updater", …)` |
| `templates_log` 用于 generate/FTP | → `diag_log("landing", …)` |
| `templates_log` 用于模板目录 | 保留或 `diag_log("templates", …)` |
| 纯临时调试、无业务语义的 println | 删除或改为对应 `diag_log`（禁止留下裸 `eprintln!` 业务路径） |

扫描范围：`src-tauri/src/**/*.rs`（含 `utils`）。

前端：

- `App.tsx` / Sidebar 仍 `invoke("read_diagnostic_log")`；若命令仍同名则可不改。
- **本阶段不做**模块筛选 UI / 着色（YAGNI）。

### 6. 文件与路径

| 项 | 值 |
|----|-----|
| 目录 | `{app_log_dir}/`（与现 init 一致） |
| 新文件 | `diagnostic-YYYY-MM-DD.log` |
| 旧文件 | `templates-diagnostic.log` 保留磁盘，新代码不读写 |
| path 命令 | 返回当天新文件绝对路径 |

### 7. 错误处理

- 日志目录不可写：仅 stderr，不 panic。
- `read_diagnostic_log`：目录未 init → 明确错误字符串；无任何按天文件 → 返回空或「暂无日志」字符串（二选一实现时定：**返回空字符串**，前端已有「无日志内容」展示）。
- 单日文件损坏/无法读：跳过该文件，尽量返回其它天。

### 8. 测试 / 验收

最小可运行检查（无重测试框架要求）：

1. `cargo check -p jarporter`（或项目等价 package 名）通过。
2. 手动或 dev：触发 `check_update` + 打开系统日志，能搜到 `[updater]`。
3. 确认日志目录出现 `diagnostic-YYYY-MM-DD.log`。
4. 可选：`diag` 内 `#[cfg(test)]` 单测「格式含模块名」「today 路径含日期」（若时间紧可省略，不阻塞验收）。

成功标准（产品）：

- [ ] 系统日志可按 `[模块名]` 搜到迁移后的关键路径日志  
- [ ] 按天文件存在且 `read_diagnostic_log` 能读到最新内容（含跨天时最近 3 天合并行为在有多文件时可测）

## 非目标（本 spec 不做）

- 前端按模块下拉筛选 / 着色  
- 引入 tracing、远程上报、日志等级体系  
- 迁移或删除历史 `templates-diagnostic.log` 内容  
- 日志压缩、自动清理超过 N 天的文件（可后续加；若实现清理，默认保留 ≥7 天）

## 实现顺序（供 writing-plans 拆任务）

1. 新增 `diag.rs` + `lib` 注册 / `init`  
2. 迁移 `read_diagnostic_log` / path 命令；拆除 landing 旧写文件逻辑；`templates_log` 转发  
3. 按文件一刀切替换：`updater` → `landing` → `build`/`git`/`docker` → 其余  
4. 更新 `CLAUDE.md` 模块表（补 `utils`）与「过渡期」为「已落地」  
5. 验收：模块可搜 + 按天文件可读  

## 风险

| 风险 | 缓解 |
|------|------|
| 日志量增大（原 eprintln 全进文件） | 按天拆分；后续可加保留天数 |
| 命令仍名 `get_templates_diagnostic_log_path` 语义过时 | 本阶段保持兼容；可另开 rename + 前端双读 |
| 并发写 | 进程内 `Mutex` 锁写（与现 templates_log 同级） |
