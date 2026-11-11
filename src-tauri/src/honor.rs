//! 荣耀转化批量回传：从投流库（MySQL）读取荣耀点击设备，按「激活⊇注册⊇付费」漏斗批量回传。
//! 组装口径与 tksy-admin/scripts/honor_batch_report.py / honor_report_debug.py 保持一致：
//!   - 激活 conversionId=10001、注册 10002、付费 10004（付费带 payAmount / orderId）
//!   - conversionTime 必须严格大于点击时间：取点击时间上限 +1s 起步，全局逐条 +1s，
//!     保证同设备内 激活 < 注册 < 付费
//!   - trackId / advertiserId / oaid 三件套齐全的设备才可回传；默认按 trackId 去重（保留最新一条点击）

use std::collections::HashSet;
use std::time::Duration;

use chrono::{DateTime, Local};
use mysql::{prelude::Queryable, Conn, OptsBuilder, Params, Row, Value};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::diag::diag_log;

const CONVERSION_URL: &str = "https://ads-drcn.platform.hihonorcloud.com/api/ad-tracking/v1/conversion";
const CONVERSION_ACTIVATE: u32 = 10001;
const CONVERSION_REGISTER: u32 = 10002;
const CONVERSION_PAY: u32 = 10004;

/// 点击表候选：中台 / 独立投流服务命名不统一，表名留空时按序自动识别，
/// 取第一个存在且必需列齐全的表。
const CANDIDATE_TABLES: &[&str] = &["click_log", "media_click_log", "tksy_media_click_log"];

/// 回传必需的点击列；缺失时在测试连接结果中明示，避免 SQL 报错不知所云
const REQUIRED_COLUMNS: &[&str] = &["track_id", "advertiser_id", "oaid", "click_time_ms", "create_time"];

const DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const TRACK_DISPLAY_LEN: usize = 32;

// ==================== 入参 / 出参 ====================

#[derive(Debug, Clone, Deserialize)]
pub struct HonorDbConfig {
    pub host: String,
    #[serde(default = "default_db_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// 留空自动识别候选表
    #[serde(default)]
    pub table: String,
}

fn default_db_port() -> u16 {
    3306
}

#[derive(Debug, Clone, Deserialize)]
pub struct HonorReportParams {
    pub db: HonorDbConfig,
    pub activate: u32,
    pub register: u32,
    pub pay: u32,
    #[serde(default = "default_pay_amount")]
    pub pay_amount: String,
    #[serde(default = "default_order_prefix")]
    pub order_prefix: String,
    #[serde(default = "default_interval_ms")]
    pub interval_ms: u64,
    /// None / 空 = 全部；"YYYY-MM-DD" = 指定日期（按 create_time 过滤）
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default = "default_true")]
    pub dedupe: bool,
    #[serde(default)]
    pub dry_run: bool,
}

fn default_pay_amount() -> String {
    "6.00".to_string()
}

fn default_order_prefix() -> String {
    "T".to_string()
}

fn default_interval_ms() -> u64 {
    300
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
pub struct HonorDbTestResult {
    pub ok: bool,
    pub resolved_table: String,
    pub missing_columns: Vec<String>,
    pub available_all: u64,
    pub available_today: u64,
    pub message: String,
}

/// 设备预检入参：与回传同一套数量/日期/去重口径，但只读查库、绝不发送
#[derive(Debug, Clone, Deserialize)]
pub struct HonorCheckParams {
    pub db: HonorDbConfig,
    pub activate: u32,
    pub register: u32,
    pub pay: u32,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default = "default_true")]
    pub dedupe: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct HonorDeviceCheckResult {
    pub resolved_table: String,
    /// 命中过滤条件的可用点击行数（platform='honor' 且三件套齐全）
    pub click_rows: u64,
    /// 按当前去重口径实际可回传的设备数（与回传取数一致）
    pub devices: usize,
    pub advertiser_id: String,
    pub click_time_min: String,
    pub click_time_max: String,
    pub activate: u32,
    pub register: u32,
    pub pay: u32,
    pub enough: bool,
    pub shortfall: u32,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct HonorSendDetail {
    pub event: String,
    pub conversion_id: u32,
    pub track_id: String,
    /// success / failed / unknown / error / dry-run
    pub outcome: String,
    pub message: String,
    /// 试运行时给出完整回传 URL
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HonorEventStat {
    pub event: String,
    pub requested: u32,
    pub success: u32,
    pub failed: u32,
    pub unknown: u32,
    pub error: u32,
    pub dry_run: u32,
}

#[derive(Debug, Serialize)]
pub struct HonorReportSummary {
    pub dry_run: bool,
    pub devices: usize,
    pub advertiser_id: String,
    pub click_time_ceiling: String,
    pub total: usize,
    pub events: Vec<HonorEventStat>,
    pub details: Vec<HonorSendDetail>,
    /// 试运行样例 URL（前 3 条）
    pub sample_urls: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HonorProgressPayload {
    pub percent: u8,
    pub message: String,
    pub current: usize,
    pub total: usize,
    pub line: Option<String>,
}

// ==================== Tauri 命令 ====================

/// 测试投流库连接：识别点击表、校验必需列、统计可用荣耀设备数。
#[tauri::command]
pub async fn honor_test_db(db: HonorDbConfig) -> Result<HonorDbTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || honor_test_db_inner(db))
        .await
        .map_err(|e| format!("测试连接任务失败: {e}"))?
}

/// 批量回传：读库取设备 → 组装计划 → 逐条 GET 回传，进度经 honor-report-progress 事件下发。
#[tauri::command]
pub async fn honor_batch_report(
    app: tauri::AppHandle,
    params: HonorReportParams,
) -> Result<HonorReportSummary, String> {
    tauri::async_runtime::spawn_blocking(move || honor_batch_report_inner(&app, params))
        .await
        .map_err(|e| format!("回传任务失败: {e}"))?
}

/// 设备预检：按当前数量/日期/去重口径只读查库，报告够不够；不足时给出缺口与建议，不发送任何回传。
#[tauri::command]
pub async fn honor_check_devices(params: HonorCheckParams) -> Result<HonorDeviceCheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || honor_check_devices_inner(params))
        .await
        .map_err(|e| format!("设备查询任务失败: {e}"))?
}

fn honor_check_devices_inner(params: HonorCheckParams) -> Result<HonorDeviceCheckResult, String> {
    let activate = params.activate;
    let register = params.register;
    let pay = params.pay;
    if activate == 0 {
        return Err("激活数量必须大于 0".to_string());
    }
    if !(activate >= register && register >= pay) {
        return Err(format!("数量必须满足 激活 ≥ 注册 ≥ 付费（当前 {activate}/{register}/{pay}）"));
    }
    let date = params.date.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(d) = date {
        if !is_valid_date(d) {
            return Err(format!("日期格式错误: {d}（应为 YYYY-MM-DD）"));
        }
    }
    diag_log(
        "honor",
        &format!(
            "honor_check_devices activate={activate} register={register} pay={pay} date={} dedupe={}",
            date.unwrap_or("all"),
            params.dedupe,
        ),
    );

    let mut conn = connect_db(&params.db)?;
    let rt = resolve_table(&mut conn, &params.db)?;
    let click_rows = count_devices(&mut conn, &rt, date)?;
    let fetch_limit = (activate as usize).saturating_mul(20).clamp(200, 2000);
    let devices = load_devices(&mut conn, &rt, date, fetch_limit, params.dedupe)?;
    let advertiser_id = devices
        .first()
        .map(|d| d.advertiser_id.clone())
        .unwrap_or_default();
    let click_min = devices.iter().map(|d| d.click_time_ms).min().unwrap_or(0);
    let click_max = devices.iter().map(|d| d.click_time_ms).max().unwrap_or(0);
    let fmt_time = |ms: i64| {
        DateTime::from_timestamp_millis(ms)
            .map(|dt| dt.with_timezone(&Local).format("%m-%d %H:%M:%S").to_string())
            .unwrap_or_default()
    };
    let enough = devices.len() >= activate as usize;
    let shortfall = if enough { 0 } else { activate - devices.len() as u32 };
    let message = if enough {
        format!(
            "设备充足：命中可用点击 {click_rows} 条 / 可回传设备 {} 个，激活 {activate} / 注册 {register} / 付费 {pay} 均可执行；本次查询只读，未发送任何回传",
            devices.len()
        )
    } else {
        format!(
            "设备不足：命中可用点击 {click_rows} 条 / 可回传设备仅 {} 个，激活需要 {activate}，差 {shortfall} 个；不会回传——可放宽日期范围、关闭按 trackId 去重或调小激活数量",
            devices.len()
        )
    };
    diag_log(
        "honor",
        &format!(
            "honor_check_devices done table={} rows={click_rows} devices={} enough={enough} shortfall={shortfall}",
            rt.name, devices.len()
        ),
    );
    Ok(HonorDeviceCheckResult {
        resolved_table: rt.name,
        click_rows,
        devices: devices.len(),
        advertiser_id,
        click_time_min: fmt_time(click_min),
        click_time_max: fmt_time(click_max),
        activate,
        register,
        pay,
        enough,
        shortfall,
        message,
    })
}

fn honor_test_db_inner(db: HonorDbConfig) -> Result<HonorDbTestResult, String> {
    diag_log(
        "honor",
        &format!(
            "honor_test_db host={} port={} db={} table={}",
            db.host.trim(),
            db.port,
            db.database.trim(),
            db.table.trim()
        ),
    );
    let mut conn = connect_db(&db)?;
    let rt = resolve_table(&mut conn, &db)?;
    let table_name = rt.name.clone();
    let all = count_devices(&mut conn, &rt, None)?;
    let today = count_devices(&mut conn, &rt, Some(&Local::now().format("%Y-%m-%d").to_string()))?;
    diag_log(
        "honor",
        &format!("honor_test_db ok table={table_name} all={all} today={today}"),
    );
    Ok(HonorDbTestResult {
        ok: true,
        resolved_table: table_name.clone(),
        missing_columns: Vec::new(),
        available_all: all,
        available_today: today,
        message: format!("连接成功：命中点击表 `{table_name}`，可用荣耀设备 全部 {all} / 今日 {today}"),
    })
}

fn honor_batch_report_inner(
    app: &tauri::AppHandle,
    params: HonorReportParams,
) -> Result<HonorReportSummary, String> {
    let activate = params.activate;
    let register = params.register;
    let pay = params.pay;
    if activate == 0 {
        return Err("激活数量必须大于 0".to_string());
    }
    if !(activate >= register && register >= pay) {
        return Err(format!("数量必须满足 激活 ≥ 注册 ≥ 付费（当前 {activate}/{register}/{pay}）"));
    }
    let date = params.date.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(d) = date {
        if !is_valid_date(d) {
            return Err(format!("日期格式错误: {d}（应为 YYYY-MM-DD）"));
        }
    }
    let pay_amount = if params.pay_amount.trim().is_empty() {
        String::new()
    } else {
        let v: f64 = params
            .pay_amount
            .trim()
            .parse()
            .map_err(|_| format!("付费金额格式错误: {}", params.pay_amount.trim()))?;
        if !(0.0..=1e9).contains(&v) {
            return Err(format!("付费金额超出合理范围: {v}"));
        }
        format!("{v:.2}")
    };
    let order_prefix: String = params.order_prefix.trim().chars().take(40).collect();
    let interval_ms = params.interval_ms.min(10_000);
    let dry_run = params.dry_run;

    diag_log(
        "honor",
        &format!(
            "honor_batch_report activate={activate} register={register} pay={pay} amount={pay_amount} prefix={order_prefix} interval_ms={interval_ms} date={} dedupe={} dry_run={dry_run}",
            date.unwrap_or("all"),
            params.dedupe,
        ),
    );

    emit_progress(app, 1, "连接投流库...", 0, 0, None);
    let mut conn = connect_db(&params.db)?;
    let rt = resolve_table(&mut conn, &params.db)?;
    emit_progress(app, 5, &format!("读取荣耀点击（表 `{}`）...", rt.name), 0, 0, None);

    // 多取一些行再在内存里按 trackId 去重，保证能凑够 activate 个不同设备
    let fetch_limit = (activate as usize).saturating_mul(20).clamp(200, 2000);
    let devices = load_devices(&mut conn, &rt, date, fetch_limit, params.dedupe)?;
    if devices.len() < activate as usize {
        let hint = date.map(|d| format!("（日期 {d}）")).unwrap_or_default();
        diag_log(
            "honor",
            &format!("honor_batch_report 设备不足: need={activate} got={}", devices.len()),
        );
        return Err(format!(
            "可用荣耀设备不足{hint}：需要 {activate}，实得 {}；可放宽日期范围或关闭按 trackId 去重重试",
            devices.len()
        ));
    }
    let advertiser_id = devices[0].advertiser_id.clone();
    emit_progress(
        app,
        12,
        &format!("凑齐 {} 个设备（advertiserId={advertiser_id}），组装回传计划...", devices.len()),
        0,
        0,
        None,
    );

    // conversionTime 必须严格大于任何一条点击时间，并按事件顺序递增
    let click_max = devices.iter().map(|d| d.click_time_ms).max().unwrap_or(0);
    let base_time = click_max + 1000;
    let click_ceiling = DateTime::from_timestamp_millis(click_max)
        .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default();
    let date_compact = Local::now().format("%Y%m%d").to_string();

    let mut plan: Vec<(&'static str, u32, &Device, Option<String>)> = Vec::new();
    for d in &devices {
        plan.push(("activate", CONVERSION_ACTIVATE, d, None));
    }
    for d in devices.iter().take(register as usize) {
        plan.push(("register", CONVERSION_REGISTER, d, None));
    }
    for (idx, d) in devices.iter().take(pay as usize).enumerate() {
        plan.push(("pay", CONVERSION_PAY, d, Some(format!("{order_prefix}{date_compact}{idx:03}"))));
    }
    let total = plan.len();
    let mut stats = new_event_stats(activate, register, pay);
    diag_log(
        "honor",
        &format!(
            "honor_batch_report plan total={total} devices={} click_ceiling={click_ceiling} conversion_time_base={base_time}",
            devices.len()
        ),
    );

    if dry_run {
        let mut details = Vec::with_capacity(total);
        let mut sample_urls = Vec::new();
        for (seq, (event, conv, d, order_id)) in plan.iter().enumerate() {
            let conversion_time = base_time + seq as i64 * 1000;
            let amount = if *event == "pay" { pay_amount.as_str() } else { "" };
            let url = build_report_url(d, *conv, conversion_time, amount, order_id.as_deref());
            if sample_urls.len() < 3 {
                sample_urls.push(url.clone());
            }
            details.push(HonorSendDetail {
                event: event.to_string(),
                conversion_id: *conv,
                track_id: short_track(&d.track_id),
                outcome: "dry-run".to_string(),
                message: "试运行未发送".to_string(),
                url: Some(url),
            });
            bump(&mut stats, event, "dry-run");
            if seq % 10 == 0 {
                // 百分比必须用 u32 计算：u8 在 68 条计划下 seq*84 会溢出（debug 构建直接 panic）
                let percent = (15 + (seq as u32 + 1) * 84 / total.max(1) as u32).min(99) as u8;
                emit_progress(
                    app,
                    percent,
                    &format!("试运行组装中 {}/{}...", seq + 1, total),
                    seq + 1,
                    total,
                    None,
                );
            }
        }
        emit_progress(app, 100, &format!("试运行完成：共 {total} 条（未发送）"), total, total, None);
        diag_log("honor", &format!("honor_batch_report dry_run done total={total}"));
        return Ok(HonorReportSummary {
            dry_run: true,
            devices: devices.len(),
            advertiser_id,
            click_time_ceiling: click_ceiling,
            total,
            events: stats,
            details,
            sample_urls,
        });
    }

    let client = build_http_client()?;
    emit_progress(
        app,
        15,
        &format!("开始回传：共 {total} 条（点击时间上限 {click_ceiling}，conversionTime 起点 +1s）"),
        0,
        total,
        None,
    );

    let mut details = Vec::with_capacity(total);
    for (seq, (event, conv, d, order_id)) in plan.iter().enumerate() {
        let conversion_time = base_time + seq as i64 * 1000;
        let amount = if *event == "pay" { pay_amount.as_str() } else { "" };
        let url = build_report_url(d, *conv, conversion_time, amount, order_id.as_deref());
        let (outcome, message) = send_one(&client, &url);
        bump(&mut stats, event, outcome);
        details.push(HonorSendDetail {
            event: event.to_string(),
            conversion_id: *conv,
            track_id: short_track(&d.track_id),
            outcome: outcome.to_string(),
            message: message.clone(),
            url: None,
        });
        diag_log(
            "honor",
            &format!(
                "send {}/{total} event={event} conv={conv} track={} -> {outcome} {message}",
                seq + 1,
                short_track(&d.track_id),
            ),
        );
        let percent = (15 + (seq as u32 + 1) * 84 / total.max(1) as u32).min(99) as u8;
        emit_progress(
            app,
            percent,
            &format!("[{}/{}] {}回传 {}", seq + 1, total, event_label(event), outcome),
            seq + 1,
            total,
            Some(format!(
                "[{}/{}] {} conv={conv} track={} -> {outcome} {message}",
                seq + 1,
                total,
                event,
                short_track(&d.track_id),
            )),
        );
        if interval_ms > 0 && seq + 1 < total {
            std::thread::sleep(Duration::from_millis(interval_ms));
        }
    }
    emit_progress(app, 100, "回传完成", total, total, None);
    let success = stats.iter().map(|s| s.success).sum::<u32>();
    let failed = stats.iter().map(|s| s.failed).sum::<u32>();
    let unknown = stats.iter().map(|s| s.unknown).sum::<u32>();
    let error = stats.iter().map(|s| s.error).sum::<u32>();
    diag_log(
        "honor",
        &format!(
            "honor_batch_report done devices={} total={total} success={success} failed={failed} unknown={unknown} error={error}",
            devices.len()
        ),
    );
    Ok(HonorReportSummary {
        dry_run: false,
        devices: devices.len(),
        advertiser_id,
        click_time_ceiling: click_ceiling,
        total,
        events: stats,
        details,
        sample_urls: Vec::new(),
    })
}

// ==================== DB ====================

fn connect_db(db: &HonorDbConfig) -> Result<Conn, String> {
    let host = db.host.trim();
    if host.is_empty() || db.user.trim().is_empty() || db.database.trim().is_empty() {
        return Err("请先填写数据源（主机 / 用户名 / 数据库）并保存".to_string());
    }
    // mysql 28 无 connect_timeout 选项：独立线程建连，主线程限时等待，超时/失败都能确定返回
    let (tx, rx) = std::sync::mpsc::channel::<Result<Conn, mysql::Error>>();
    let db_inner = db.clone();
    std::thread::spawn(move || {
        let _ = tx.send(connect_db_opts(&db_inner));
    });
    match rx.recv_timeout(DB_CONNECT_TIMEOUT) {
        Ok(res) => res.map_err(|e| format!("MySQL 连接失败（{host}:{}）: {e}", db.port)),
        Err(_) => Err(format!(
            "MySQL 连接超时（{host}:{}，超过 {DB_CONNECT_TIMEOUT:?}；请检查主机/端口/IP 白名单）",
            db.port
        )),
    }
}

fn connect_db_opts(db: &HonorDbConfig) -> Result<Conn, mysql::Error> {
    // 不设 ssl_opts：与 honor_batch_report.py（pymysql 默认明文）一致，
    // caching_sha2_password 全量认证走「向服务器索取 RSA 公钥」路径
    let opts = OptsBuilder::new()
        .ip_or_hostname(Some(db.host.trim()))
        .tcp_port(db.port)
        .user(Some(db.user.trim()))
        .pass(Some(db.password.as_str()))
        .db_name(Some(db.database.trim()))
        .prefer_socket(false)
        .read_timeout(Some(Duration::from_secs(30)))
        .write_timeout(Some(Duration::from_secs(30)));
    Conn::new(opts)
}

struct ResolvedTable {
    name: String,
    has_platform: bool,
    has_package: bool,
}

fn ensure_identifier(name: &str) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(format!("非法标识符: {name}"));
    }
    Ok(())
}

/// 定位点击表：显式表名优先，否则按候选表找第一个存在且必需列齐全的表。
fn resolve_table(conn: &mut Conn, db: &HonorDbConfig) -> Result<ResolvedTable, String> {
    let schema = db.database.trim();
    if schema.is_empty() {
        return Err("请先填写数据库名并保存".to_string());
    }
    let mut candidates: Vec<String> = Vec::new();
    let requested = db.table.trim();
    if !requested.is_empty() {
        ensure_identifier(requested)?;
        candidates.push(requested.to_string());
    } else {
        candidates.extend(CANDIDATE_TABLES.iter().map(|s| s.to_string()));
    }

    let mut resolved: Option<ResolvedTable> = None;
    let mut first_missing: Option<(String, Vec<String>)> = None;
    for name in &candidates {
        let exists: Option<String> = conn
            .exec_first(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
                (schema, name.as_str()),
            )
            .map_err(|e| format!("查询 information_schema 失败: {e}"))?;
        if exists.is_none() {
            continue;
        }
        let columns: Vec<String> = conn
            .exec(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
                (schema, name.as_str()),
            )
            .map_err(|e| format!("查询表列失败: {e}"))?;
        let missing: Vec<String> = REQUIRED_COLUMNS
            .iter()
            .filter(|c| !columns.iter().any(|x| x.eq_ignore_ascii_case(c)))
            .map(|c| c.to_string())
            .collect();
        if !missing.is_empty() {
            if first_missing.is_none() {
                first_missing = Some((name.clone(), missing));
            }
            continue;
        }
        resolved = Some(ResolvedTable {
            name: name.clone(),
            has_platform: columns.iter().any(|c| c.eq_ignore_ascii_case("platform")),
            has_package: columns.iter().any(|c| c.eq_ignore_ascii_case("package_name")),
        });
        break;
    }

    let Some(rt) = resolved else {
        let mut msg = match &first_missing {
            Some((name, missing)) => format!("表 `{name}` 存在但缺少回传必需列: {}", missing.join(", ")),
            None => format!("库 `{schema}` 中未找到点击表（候选: {}）", candidates.join(" / ")),
        };
        let like_tables: Vec<String> = conn
            .exec(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME LIKE '%click%'",
                Params::Positional(vec![Value::from(schema)]),
            )
            .unwrap_or_default();
        if !like_tables.is_empty() {
            msg.push_str(&format!("；库中 click 相关表: {}", like_tables.join(", ")));
        }
        return Err(msg);
    };
    Ok(rt)
}

/// 统计三件套齐全的荣耀设备数（platform 列存在时限定 platform='honor'）
fn count_devices(conn: &mut Conn, rt: &ResolvedTable, date: Option<&str>) -> Result<u64, String> {
    let (sql, params) = device_count_sql(rt, date);
    let count: Option<u64> = conn
        .exec_first(&sql, params)
        .map_err(|e| format!("统计可用设备失败: {e}"))?;
    Ok(count.unwrap_or(0))
}

fn device_count_sql(rt: &ResolvedTable, date: Option<&str>) -> (String, Params) {
    let mut sql = format!(
        "SELECT COUNT(*) FROM `{}` WHERE track_id IS NOT NULL AND track_id<>'' AND advertiser_id IS NOT NULL AND advertiser_id<>'' AND oaid IS NOT NULL AND oaid<>'' AND click_time_ms IS NOT NULL",
        rt.name
    );
    let mut params: Vec<Value> = Vec::new();
    if rt.has_platform {
        sql.push_str(" AND platform='honor'");
    }
    if let Some(d) = date {
        sql.push_str(" AND DATE(create_time)=?");
        params.push(Value::from(d));
    }
    (sql, Params::Positional(params))
}

/// 读取点击记录（最新优先），凑齐不超过 limit 个设备
fn load_devices(
    conn: &mut Conn,
    rt: &ResolvedTable,
    date: Option<&str>,
    limit: usize,
    dedupe: bool,
) -> Result<Vec<Device>, String> {
    let package_col = if rt.has_package { "package_name" } else { "NULL AS package_name" };
    let mut sql = format!(
        "SELECT track_id, advertiser_id, oaid, click_time_ms, {package_col} FROM `{}` WHERE track_id IS NOT NULL AND track_id<>'' AND advertiser_id IS NOT NULL AND advertiser_id<>'' AND oaid IS NOT NULL AND oaid<>'' AND click_time_ms IS NOT NULL",
        rt.name
    );
    let mut params: Vec<Value> = Vec::new();
    if rt.has_platform {
        sql.push_str(" AND platform='honor'");
    }
    if let Some(d) = date {
        sql.push_str(" AND DATE(create_time)=?");
        params.push(Value::from(d));
    }
    sql.push_str(&format!(" ORDER BY id DESC LIMIT {limit}"));

    let rows: Vec<Row> = conn
        .exec(&sql, Params::Positional(params))
        .map_err(|e| format!("读取点击记录失败: {e}"))?;
    let mut devices = Vec::with_capacity(limit);
    let mut seen: HashSet<String> = HashSet::new();
    for row in rows {
        let track_id: Option<String> = row.get("track_id");
        let advertiser_id: Option<String> = row.get("advertiser_id");
        let oaid: Option<String> = row.get("oaid");
        let click_time_ms: Option<i64> = row.get("click_time_ms");
        let package_name: Option<String> = row.get("package_name");
        let (Some(track_id), Some(advertiser_id), Some(oaid), Some(click_ms)) =
            (track_id, advertiser_id, oaid, click_time_ms)
        else {
            continue;
        };
        if track_id.trim().is_empty() || advertiser_id.trim().is_empty() || oaid.trim().is_empty() {
            continue;
        }
        if dedupe && !seen.insert(track_id.clone()) {
            continue;
        }
        devices.push(Device {
            track_id,
            advertiser_id,
            oaid,
            click_time_ms: click_ms,
            package_name,
        });
        if devices.len() >= limit {
            break;
        }
    }
    Ok(devices)
}

#[derive(Debug, Clone)]
struct Device {
    track_id: String,
    advertiser_id: String,
    oaid: String,
    click_time_ms: i64,
    #[allow(dead_code)]
    package_name: Option<String>,
}

// ==================== 荣耀回传 ====================

fn build_report_url(
    device: &Device,
    conversion_id: u32,
    conversion_time_ms: i64,
    pay_amount: &str,
    order_id: Option<&str>,
) -> String {
    let mut url = url::Url::parse(CONVERSION_URL).expect("固定回传地址必须是合法 URL");
    let mut q = url.query_pairs_mut();
    q.append_pair("trackId", &device.track_id)
        .append_pair("conversionId", &conversion_id.to_string())
        .append_pair("conversionTime", &conversion_time_ms.to_string())
        .append_pair("advertiserId", &device.advertiser_id);
    if !device.oaid.trim().is_empty() {
        q.append_pair("oaid", device.oaid.trim()).append_pair("id_type", "0");
    }
    if !pay_amount.is_empty() {
        q.append_pair("payAmount", pay_amount);
    }
    if let Some(order_id) = order_id {
        q.append_pair("orderId", order_id);
    }
    drop(q);
    url.to_string()
}

/// 按荣耀响应常见字段判定结果（与 honor_batch_report.py 的 classify 一致）
fn classify(status: u16, body: &str) -> (&'static str, String) {
    let body_short = truncate_str(body, 200);
    let http_ok = (200..300).contains(&status);
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let Some(data) = parsed.filter(|v| v.is_object()) else {
        return (
            if http_ok { "success" } else { "failed" },
            format!("HTTP {status} body={body_short}"),
        );
    };
    for key in ["code", "resultCode", "error_code", "errno"] {
        if let Some(val) = data.get(key).filter(|v| !v.is_null()) {
            let ok = val == &serde_json::Value::from(0);
            return (
                if ok { "success" } else { "failed" },
                format!("HTTP {status} {key}={val} body={body_short}"),
            );
        }
    }
    ("unknown", format!("HTTP {status} body={body_short}"))
}

fn build_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

fn send_one(client: &reqwest::blocking::Client, url: &str) -> (&'static str, String) {
    match client.get(url).send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().unwrap_or_default();
            classify(status, &body)
        }
        Err(e) => ("error", format!("请求异常: {e}")),
    }
}

// ==================== 杂项 ====================

fn new_event_stats(activate: u32, register: u32, pay: u32) -> Vec<HonorEventStat> {
    vec![
        HonorEventStat {
            event: "activate".to_string(),
            requested: activate,
            success: 0,
            failed: 0,
            unknown: 0,
            error: 0,
            dry_run: 0,
        },
        HonorEventStat {
            event: "register".to_string(),
            requested: register,
            success: 0,
            failed: 0,
            unknown: 0,
            error: 0,
            dry_run: 0,
        },
        HonorEventStat {
            event: "pay".to_string(),
            requested: pay,
            success: 0,
            failed: 0,
            unknown: 0,
            error: 0,
            dry_run: 0,
        },
    ]
}

fn bump(stats: &mut [HonorEventStat], event: &str, outcome: &str) {
    if let Some(s) = stats.iter_mut().find(|s| s.event == event) {
        match outcome {
            "success" => s.success += 1,
            "failed" => s.failed += 1,
            "unknown" => s.unknown += 1,
            "error" => s.error += 1,
            _ => s.dry_run += 1,
        }
    }
}

fn event_label(event: &str) -> &'static str {
    match event {
        "activate" => "激活",
        "register" => "注册",
        "pay" => "付费",
        _ => "转化",
    }
}

fn is_valid_date(s: &str) -> bool {
    s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

fn short_track(track_id: &str) -> String {
    truncate_str(track_id, TRACK_DISPLAY_LEN)
}

fn emit_progress(
    app: &tauri::AppHandle,
    percent: u8,
    message: &str,
    current: usize,
    total: usize,
    line: Option<String>,
) {
    let _ = app.emit(
        "honor-report-progress",
        HonorProgressPayload {
            percent,
            message: message.to_string(),
            current,
            total,
            line,
        },
    );
}
