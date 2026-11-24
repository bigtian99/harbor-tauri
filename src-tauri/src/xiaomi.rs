//! 小米转化批量回传（EMI4.0 精准 API）：从投流库读取 `platform='xiaomi'` 的点击设备，
//! 按「激活⊇注册⊇付费」漏斗批量回传。组装口径与 tksy-admin/scripts/xiaomi_report_debug.py 一致：
//!   - GET https://trail.e.mi.com/v4/api/exact
//!   - 必传 oaid / carrier_id / capital_id / event / event_time / callback / is_debug
//!   - callback 取点击落库的 callback_uri：缺失该串的小米点击无法回传，取数时直接排除
//!   - sign = md5(URL 编码后的参数串 + "&secret_key=" + 资产密钥)，参数顺序固定参与签名
//!   - 响应 code==0 为成功；非 0 带 message/solution，非 JSON 视为未知（可能已到达）
//!
//! 与荣耀的差异：荣耀用 trackId + conversionId 回传，小米用点击下发的 callback 串 +
//! EMI 后台配置的事件英文名，因此事件名与资产三件套（carrier_id/capital_id/secret_key）由面板配置。

use std::collections::HashSet;

use chrono::{DateTime, Local};
use md5::{Digest, Md5};
use mysql::{prelude::Queryable, Conn, Params, Row, Value};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::diag::diag_log;
use crate::honor::{
    build_http_client, connect_db, ensure_identifier, is_valid_date, parse_account_pk, today_local,
    truncate_str, HonorAccountInfo, HonorDbConfig, HonorEventStat, HonorProgressPayload,
};

const EXACT_URL: &str = "https://trail.e.mi.com/v4/api/exact";
const PLATFORM: &str = "xiaomi";

/// 点击表候选：与荣耀同一套命名，表名留空时按序自动识别
const CANDIDATE_TABLES: &[&str] = &["click_log", "media_click_log", "tksy_media_click_log"];

/// 小米回传必需列：callback_uri 是精准 API 的回传原料，platform 用于隔离平台数据
const REQUIRED_COLUMNS: &[&str] = &[
    "platform",
    "account_pk",
    "oaid",
    "advertiser_id",
    "callback_uri",
    "click_time_ms",
    "create_time",
];

const OAID_DISPLAY_LEN: usize = 32;

// ==================== 入参 ====================

/// 小米资产配置：carrier_id（载体id=应用id）、capital_id（资产id）、资产密钥由 EMI 后台提供。
#[derive(Debug, Clone, Deserialize)]
pub struct XiaomiAssetConfig {
    #[serde(default)]
    pub carrier_id: String,
    #[serde(default)]
    pub capital_id: String,
    #[serde(default)]
    pub secret_key: String,
    /// 联调填 true（is_debug=1），正式投放填 false（is_debug=0）
    #[serde(default)]
    pub is_debug: bool,
    #[serde(default = "default_activate_event")]
    pub activate_event: String,
    #[serde(default = "default_register_event")]
    pub register_event: String,
    #[serde(default = "default_pay_event")]
    pub pay_event: String,
}

impl Default for XiaomiAssetConfig {
    fn default() -> Self {
        Self {
            carrier_id: String::new(),
            capital_id: String::new(),
            secret_key: String::new(),
            is_debug: false,
            activate_event: default_activate_event(),
            register_event: default_register_event(),
            pay_event: default_pay_event(),
        }
    }
}

impl XiaomiAssetConfig {
    fn normalized(mut self) -> Self {
        self.carrier_id = normalize_id(&self.carrier_id);
        self.capital_id = normalize_id(&self.capital_id);
        self.secret_key = self.secret_key.trim().to_string();
        self.activate_event = self.activate_event.trim().to_string();
        self.register_event = self.register_event.trim().to_string();
        self.pay_event = self.pay_event.trim().to_string();
        self
    }

    fn validate(&self) -> Result<(), String> {
        if self.carrier_id.is_empty() {
            return Err("请填写 carrier_id（载体id / 应用id，如 1776184）".to_string());
        }
        if !is_positive_int(&self.carrier_id) {
            return Err(format!(
                "carrier_id 必须是纯数字正整数（当前 `{}`）；对应 EMI 后台应用的载体id，如 1776184",
                self.carrier_id
            ));
        }
        if self.capital_id.is_empty() {
            return Err("请填写 capital_id（资产id，如 94219）".to_string());
        }
        if !is_positive_int(&self.capital_id) {
            return Err(format!(
                "capital_id 必须是纯数字正整数（当前 `{}`）；对应 EMI 后台资产页的资产id，如 94219。非数字会被小米判为 204 非法capital_id",
                self.capital_id
            ));
        }
        if self.secret_key.is_empty() {
            return Err("请填写资产密钥 secret_key（EMI 后台「联调工具」页面获取）".to_string());
        }
        Ok(())
    }

    fn event_name(&self, event: &str) -> &str {
        match event {
            "activate" => &self.activate_event,
            "register" => &self.register_event,
            "pay" => &self.pay_event,
            _ => "",
        }
    }
}

/// 小米 id 参数只接受正整数：清掉复制常见的零宽字符，再把全角数字转半角。
fn normalize_id(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !matches!(*c, '\u{200b}' | '\u{200c}' | '\u{200d}' | '\u{feff}'))
        .map(|c| match c {
            '０'..='９' => char::from_u32('0' as u32 + (c as u32 - '０' as u32)).unwrap_or(c),
            _ => c,
        })
        .collect()
}

fn is_positive_int(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|c| c.is_ascii_digit())
        && matches!(value.parse::<u64>(), Ok(v) if v > 0)
}

fn default_activate_event() -> String {
    // EMI 后台实际创建的「自定义激活」事件
    "APP_ACTIVE".to_string()
}

fn default_register_event() -> String {
    "APP_REGISTER".to_string()
}

fn default_pay_event() -> String {
    // 需在 EMI 后台资产内创建同名事件；未配置时把付费数设为 0
    "PURCHASE".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct XiaomiCheckParams {
    #[serde(default)]
    pub db: HonorDbConfig,
    /// media_account.id：点击表只能按投放账户查，必填
    #[serde(default)]
    pub account_pk: Option<String>,
    pub activate: u32,
    pub register: u32,
    pub pay: u32,
    #[serde(default)]
    pub asset: XiaomiAssetConfig,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default = "default_true")]
    pub dedupe: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct XiaomiReportParams {
    #[serde(default)]
    pub db: HonorDbConfig,
    #[serde(default)]
    pub account_pk: Option<String>,
    pub activate: u32,
    pub register: u32,
    pub pay: u32,
    #[serde(default)]
    pub asset: XiaomiAssetConfig,
    #[serde(default = "default_interval_ms")]
    pub interval_ms: u64,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default = "default_true")]
    pub dedupe: bool,
    #[serde(default)]
    pub dry_run: bool,
}

fn default_true() -> bool {
    true
}

fn default_interval_ms() -> u64 {
    300
}

#[derive(Debug, Serialize, Clone)]
pub struct XiaomiDeviceCheckResult {
    pub resolved_table: String,
    /// 今日已回传、因此被排除的设备台数
    pub already_reported: usize,
    /// 命中过滤条件、且带 callback 的可用点击行数
    pub click_rows: u64,
    /// 小米点击里 callback_uri 缺失、无法回传的行数
    pub no_callback_rows: u64,
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
pub struct XiaomiSendDetail {
    /// 中台内部事件：activate / register / pay
    pub event: String,
    /// 实际回传给小米的事件英文名
    pub event_name: String,
    pub oaid: String,
    /// success / failed / unknown / error / dry-run
    pub outcome: String,
    pub message: String,
    /// 试运行时给出完整回传 URL
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct XiaomiReportSummary {
    pub dry_run: bool,
    pub devices: usize,
    pub already_reported: usize,
    pub advertiser_id: String,
    pub click_time_ceiling: String,
    pub total: usize,
    pub events: Vec<HonorEventStat>,
    pub details: Vec<XiaomiSendDetail>,
    /// 试运行样例 URL（前 3 条）
    pub sample_urls: Vec<String>,
}

// ==================== Tauri 命令 ====================

/// 列出投流库里的投放账户（media_account）中 platform='xiaomi' 的账户，
/// 并按与预检/回传相同的口径统计可用设备数。
#[tauri::command]
pub async fn xiaomi_list_accounts(
    db: HonorDbConfig,
    date: Option<String>,
) -> Result<Vec<HonorAccountInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || xiaomi_list_accounts_inner(db, date))
        .await
        .map_err(|e| format!("读取投放账户任务失败: {e}"))?
}

/// 设备预检：按当前数量/日期/去重口径只读查库，报告够不够；不发送任何回传。
#[tauri::command]
pub async fn xiaomi_check_devices(
    params: XiaomiCheckParams,
) -> Result<XiaomiDeviceCheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || xiaomi_check_devices_inner(params))
        .await
        .map_err(|e| format!("设备查询任务失败: {e}"))?
}

/// 批量回传：读库取设备 → 组装精准 API URL（含签名）→ 逐条 GET，进度经 xiaomi-report-progress 下发。
#[tauri::command]
pub async fn xiaomi_batch_report(
    app: tauri::AppHandle,
    params: XiaomiReportParams,
) -> Result<XiaomiReportSummary, String> {
    tauri::async_runtime::spawn_blocking(move || xiaomi_batch_report_inner(&app, params))
        .await
        .map_err(|e| format!("回传任务失败: {e}"))?
}

// ==================== 账户与设备 ====================

fn xiaomi_list_accounts_inner(
    db: HonorDbConfig,
    date: Option<String>,
) -> Result<Vec<HonorAccountInfo>, String> {
    let db = db.normalized();
    let date = date.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    let today = today_local();
    let scoped_today = date.as_deref() == Some(today.as_str());
    let mut conn = connect_db(&db)?;

    let has_account_table: Option<String> = conn
        .exec_first(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='media_account'",
            (db.database.trim(),),
        )
        .map_err(|e| format!("查询 information_schema 失败: {e}"))?;
    if has_account_table.is_none() {
        return Err(format!(
            "库 `{}` 中没有 media_account 表，无法按投放账户查询",
            db.database.trim()
        ));
    }

    let rows: Vec<(u64, String, String, String, Option<String>, String)> = conn
        .exec(
            "SELECT id, platform, account_id, account_name, account_alias, status FROM media_account WHERE platform=? ORDER BY account_id",
            (PLATFORM,),
        )
        .map_err(|e| format!("读取 media_account 失败: {e}"))?;

    let mut accounts: Vec<HonorAccountInfo> = rows
        .into_iter()
        .map(
            |(pk, platform, account_id, account_name, account_alias, status)| HonorAccountInfo {
                pk: pk.to_string(),
                platform,
                account_id,
                account_name,
                account_alias: unify_null(account_alias),
                status,
                click_rows: 0,
                devices: 0,
            },
        )
        .collect();

    let rt = resolve_xiaomi_table(&mut conn, &db).ok();
    if let Some(table) = rt {
        // 1) 行数与去重台数（同一日期口径；callback 缺失的点击不可回传，不计入）
        let mut sql = format!(
            "SELECT account_pk, COUNT(*), COUNT(DISTINCT LOWER(oaid)) FROM `{}` \
             WHERE {PLATFORM_FILTER} AND {CALLBACK_FILTER} AND click_time_ms IS NOT NULL \
             AND account_pk IS NOT NULL",
            table.name
        );
        let mut params: Vec<Value> = Vec::new();
        if let Some(d) = date.as_deref() {
            sql.push_str(" AND DATE(create_time)=?");
            params.push(Value::from(d));
        }
        sql.push_str(" GROUP BY account_pk");
        let triples: Vec<(u64, u64, u64)> = conn
            .exec(sql, Params::Positional(params))
            .unwrap_or_default();
        for acc in accounts.iter_mut() {
            if let Some((_, rows_n, dev_n)) = triples
                .iter()
                .find(|(pk, _, _)| pk.to_string() == acc.pk)
                .copied()
            {
                acc.click_rows = rows_n;
                acc.devices = dev_n;
            }
        }

        // 2) 今日口径再扣掉台账里已回传过的设备（这批不会再发）
        if scoped_today {
            for acc in accounts.iter_mut() {
                let Ok(reported) = crate::db::honor_reported_oaids(&acc.pk, &today) else {
                    continue;
                };
                let set: Vec<String> = reported
                    .into_iter()
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect();
                if set.is_empty() {
                    continue;
                }
                let placeholders = vec!["?"; set.len()].join(",");
                let sql = format!(
                    "SELECT COUNT(*), COUNT(DISTINCT LOWER(oaid)) FROM `{}` \
                     WHERE {PLATFORM_FILTER} AND {CALLBACK_FILTER} AND click_time_ms IS NOT NULL \
                     AND DATE(create_time)=? AND account_pk=? \
                     AND LOWER(oaid) NOT IN ({placeholders})",
                    table.name
                );
                let mut params: Vec<Value> =
                    vec![Value::from(today.as_str()), Value::from(acc.pk.as_str())];
                params.extend(set.iter().map(|s| Value::from(s.as_str())));
                let counted: Option<(u64, u64)> = conn
                    .exec_first(sql, Params::Positional(params))
                    .unwrap_or(None);
                if let Some((rows_n, dev_n)) = counted {
                    acc.click_rows = rows_n;
                    acc.devices = dev_n;
                }
            }
        }
    }

    diag_log(
        "xiaomi",
        &format!(
            "xiaomi_list_accounts db={} date={} count={}",
            db.database.trim(),
            date.as_deref().unwrap_or("all"),
            accounts.len()
        ),
    );
    Ok(accounts)
}

fn xiaomi_check_devices_inner(
    params: XiaomiCheckParams,
) -> Result<XiaomiDeviceCheckResult, String> {
    let db = params.db.clone().normalized();
    let asset = params.asset.clone().normalized();
    let date = params
        .date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    validate_common(params.activate, params.register, params.pay, date, &asset)?;
    let account_pk = parse_account_pk(params.account_pk.as_deref())?;
    diag_log(
        "xiaomi",
        &format!(
            "xiaomi_check_devices account_pk={account_pk} activate={} register={} pay={} date={} dedupe={} is_debug={}",
            params.activate,
            params.register,
            params.pay,
            date.unwrap_or("all"),
            params.dedupe,
            asset.is_debug,
        ),
    );

    let mut conn = connect_db(&db)?;
    let table = resolve_xiaomi_table(&mut conn, &db)?;
    let (click_rows, no_callback_rows) = count_xiaomi_rows(&mut conn, &table, date, account_pk)?;
    let fetch_limit = (params.activate as usize)
        .saturating_mul(20)
        .clamp(200, 2000);
    let devices = load_xiaomi_devices(
        &mut conn,
        &table,
        date,
        account_pk,
        fetch_limit,
        params.dedupe,
    )?;
    // 当天已回传过的设备不重复计入，保证「可回传设备」就是还能再发的量
    let (devices, already_reported) = exclude_reported_devices(devices, account_pk)?;
    if already_reported > 0 {
        diag_log(
            "xiaomi",
            &format!("xiaomi_check_devices 跳过今日已回传 {already_reported} 台"),
        );
    }
    let advertiser_id = devices
        .first()
        .map(|d| d.advertiser_id.clone())
        .unwrap_or_default();
    let click_min = devices.iter().map(|d| d.click_time_ms).min().unwrap_or(0);
    let click_max = devices.iter().map(|d| d.click_time_ms).max().unwrap_or(0);
    let fmt_time = |ms: i64| {
        DateTime::from_timestamp_millis(ms)
            .map(|dt| {
                dt.with_timezone(&Local)
                    .format("%m-%d %H:%M:%S")
                    .to_string()
            })
            .unwrap_or_default()
    };
    let activate = params.activate;
    let enough = devices.len() >= activate as usize;
    let shortfall = if enough {
        0
    } else {
        activate - devices.len() as u32
    };
    let mut notes: Vec<String> = Vec::new();
    if already_reported > 0 {
        notes.push(format!(
            "今日已回传 {already_reported} 台，已从可回传设备中扣除"
        ));
    }
    if no_callback_rows > 0 {
        notes.push(format!(
            "{no_callback_rows} 条点击缺 callback，无法回传已排除"
        ));
    }
    let skip_note = if notes.is_empty() {
        String::new()
    } else {
        format!("（{}）", notes.join("；"))
    };
    let message = if enough {
        format!(
            "设备充足：命中可用点击 {click_rows} 条 / 可回传设备 {} 个{skip_note}，激活 {activate} / 注册 {} / 付费 {} 均可执行；本次查询只读，未发送任何回传",
            devices.len(),
            params.register,
            params.pay
        )
    } else {
        format!(
            "设备不足：命中可用点击 {click_rows} 条 / 可回传设备仅 {} 个{skip_note}，激活需要 {activate}，差 {shortfall} 个；不会回传——可放宽日期范围、关闭按设备去重或调小激活数量",
            devices.len()
        )
    };
    diag_log(
        "xiaomi",
        &format!(
            "xiaomi_check_devices done table={} rows={click_rows} no_callback={no_callback_rows} devices={} enough={enough} shortfall={shortfall}",
            table.name,
            devices.len()
        ),
    );
    Ok(XiaomiDeviceCheckResult {
        resolved_table: table.name,
        already_reported,
        click_rows,
        no_callback_rows,
        devices: devices.len(),
        advertiser_id,
        click_time_min: fmt_time(click_min),
        click_time_max: fmt_time(click_max),
        activate,
        register: params.register,
        pay: params.pay,
        enough,
        shortfall,
        message,
    })
}

fn xiaomi_batch_report_inner(
    app: &tauri::AppHandle,
    params: XiaomiReportParams,
) -> Result<XiaomiReportSummary, String> {
    let db = params.db.clone().normalized();
    let asset = params.asset.clone().normalized();
    let date = params
        .date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    validate_common(params.activate, params.register, params.pay, date, &asset)?;
    let interval_ms = params.interval_ms.min(10_000);
    let dry_run = params.dry_run;
    let activate = params.activate;
    let register = params.register;
    let pay = params.pay;

    diag_log(
        "xiaomi",
        &format!(
            "xiaomi_batch_report activate={activate} register={register} pay={pay} carrier_id={} capital_id={} events={}/{}/{} interval_ms={interval_ms} date={} dedupe={} dry_run={dry_run}",
            asset.carrier_id,
            asset.capital_id,
            asset.activate_event,
            asset.register_event,
            asset.pay_event,
            date.unwrap_or("all"),
            params.dedupe,
        ),
    );

    let account_pk = parse_account_pk(params.account_pk.as_deref())?;
    emit_progress(app, 1, "连接投流库...", 0, 0, None);
    let mut conn = connect_db(&db)?;
    let table = resolve_xiaomi_table(&mut conn, &db)?;
    emit_progress(
        app,
        5,
        &format!("读取小米点击（表 `{}`，账户 {account_pk}）...", table.name),
        0,
        0,
        None,
    );

    // 多取一些行再在内存里按 oaid 去重，保证能凑够 activate 个不同设备
    let fetch_limit = (activate as usize).saturating_mul(20).clamp(200, 2000);
    let devices = load_xiaomi_devices(
        &mut conn,
        &table,
        date,
        account_pk,
        fetch_limit,
        params.dedupe,
    )?;
    // 当天已回传过的设备整批排除，避免分批次回传重复上报
    let (devices, already_reported) = exclude_reported_devices(devices, account_pk)?;
    if already_reported > 0 {
        diag_log(
            "xiaomi",
            &format!("xiaomi_batch_report 跳过今日已回传 {already_reported} 台"),
        );
        emit_progress(
            app,
            10,
            &format!("已跳过今日回传过的 {already_reported} 台设备"),
            0,
            0,
            None,
        );
    }
    if devices.len() < activate as usize {
        let hint = date.map(|d| format!("（日期 {d}）")).unwrap_or_default();
        let skip_note = if already_reported > 0 {
            format!("，另有 {already_reported} 台今日已回传被排除")
        } else {
            String::new()
        };
        diag_log(
            "xiaomi",
            &format!(
                "xiaomi_batch_report 设备不足: need={activate} got={} skipped={already_reported}",
                devices.len()
            ),
        );
        return Err(format!(
            "可用小米设备不足{hint}：需要 {activate}，实得 {}{skip_note}；可放宽日期范围或关闭按设备去重（callback 缺失的点击无法回传）",
            devices.len()
        ));
    }
    let advertiser_id = devices[0].advertiser_id.clone();
    emit_progress(
        app,
        12,
        &format!(
            "凑齐 {} 个设备（capital_id={}），组装回传计划...",
            devices.len(),
            asset.capital_id
        ),
        0,
        0,
        None,
    );

    // event_time 取点击时间上限 +1s 起步逐条递增，保证事件发生在点击之后
    let click_max = devices.iter().map(|d| d.click_time_ms).max().unwrap_or(0);
    let base_time = click_max + 1000;
    let click_ceiling = DateTime::from_timestamp_millis(click_max)
        .map(|dt| {
            dt.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default();

    let mut plan: Vec<(String, String, &XiaomiDevice)> = Vec::new();
    for d in devices.iter().take(activate as usize) {
        plan.push(("activate".to_string(), asset.activate_event.clone(), d));
    }
    for d in devices.iter().take(register as usize) {
        plan.push(("register".to_string(), asset.register_event.clone(), d));
    }
    for d in devices.iter().take(pay as usize) {
        plan.push(("pay".to_string(), asset.pay_event.clone(), d));
    }
    let total = plan.len();
    let mut stats = new_event_stats(activate, register, pay);
    diag_log(
        "xiaomi",
        &format!(
            "xiaomi_batch_report plan total={total} devices={} click_ceiling={click_ceiling} event_time_base={base_time}",
            devices.len()
        ),
    );

    if dry_run {
        let mut details = Vec::with_capacity(total);
        let mut sample_urls = Vec::new();
        for (seq, (event, event_name, d)) in plan.iter().enumerate() {
            let event_time = base_time + seq as i64 * 1000;
            let url = build_xiaomi_url(&asset, d, event_name, event_time);
            if sample_urls.len() < 3 {
                sample_urls.push(url.clone());
            }
            details.push(XiaomiSendDetail {
                event: event.clone(),
                event_name: event_name.clone(),
                oaid: short_oaid(&d.oaid),
                outcome: "dry-run".to_string(),
                message: "试运行未发送".to_string(),
                url: Some(url),
            });
            bump(&mut stats, event, "dry-run");
            if seq % 10 == 0 {
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
        emit_progress(
            app,
            100,
            &format!("试运行完成：共 {total} 条（未发送）"),
            total,
            total,
            None,
        );
        diag_log(
            "xiaomi",
            &format!("xiaomi_batch_report dry_run done total={total}"),
        );
        return Ok(XiaomiReportSummary {
            dry_run: true,
            devices: devices.len(),
            already_reported,
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
        &format!("开始回传：共 {total} 条（事件时间起点 {click_ceiling} +1s）"),
        0,
        total,
        None,
    );

    let mut details = Vec::with_capacity(total);
    for (seq, (event, event_name, d)) in plan.iter().enumerate() {
        let event_time = base_time + seq as i64 * 1000;
        let url = build_xiaomi_url(&asset, d, event_name, event_time);
        let (outcome, message) = send_one(&client, &url);
        bump(&mut stats, event, outcome);
        // 台账：success / unknown（可能已到达）都记，避免下批重复；failed/error 不记，允许重试
        if outcome == "success" || outcome == "unknown" {
            let day = today_local();
            if let Err(e) = crate::db::honor_log_report(
                &account_pk.to_string(),
                &day,
                &d.oaid,
                "",
                event,
                event_time,
                outcome,
            ) {
                diag_log(
                    "xiaomi",
                    &format!("回传台账写入失败 oaid={} event={event}: {e}", d.oaid),
                );
            }
        }
        details.push(XiaomiSendDetail {
            event: event.clone(),
            event_name: event_name.clone(),
            oaid: short_oaid(&d.oaid),
            outcome: outcome.to_string(),
            message: message.clone(),
            url: None,
        });
        diag_log(
            "xiaomi",
            &format!(
                "send {}/{total} event={event_name} oaid={} -> {outcome} {message}",
                seq + 1,
                short_oaid(&d.oaid),
            ),
        );
        let percent = (15 + (seq as u32 + 1) * 84 / total.max(1) as u32).min(99) as u8;
        emit_progress(
            app,
            percent,
            &format!(
                "[{}/{}] {}回传 {}",
                seq + 1,
                total,
                event_label(event),
                outcome
            ),
            seq + 1,
            total,
            Some(format!(
                "[{}/{}] {event_name} oaid={} -> {outcome} {message}",
                seq + 1,
                total,
                short_oaid(&d.oaid),
            )),
        );
        if interval_ms > 0 && seq + 1 < total {
            std::thread::sleep(std::time::Duration::from_millis(interval_ms));
        }
    }
    emit_progress(app, 100, "回传完成", total, total, None);
    let success = stats.iter().map(|s| s.success).sum::<u32>();
    let failed = stats.iter().map(|s| s.failed).sum::<u32>();
    let unknown = stats.iter().map(|s| s.unknown).sum::<u32>();
    let error = stats.iter().map(|s| s.error).sum::<u32>();
    if let Ok((day_devices, day_events)) =
        crate::db::honor_report_tally(&account_pk.to_string(), &today_local())
    {
        diag_log(
            "xiaomi",
            &format!(
                "xiaomi_batch_report 今日累计 account_pk={account_pk} devices={day_devices} events={day_events}"
            ),
        );
    }
    diag_log(
        "xiaomi",
        &format!(
            "xiaomi_batch_report done devices={} total={total} success={success} failed={failed} unknown={unknown} error={error}",
            devices.len()
        ),
    );
    Ok(XiaomiReportSummary {
        dry_run: false,
        devices: devices.len(),
        already_reported,
        advertiser_id,
        click_time_ceiling: click_ceiling,
        total,
        events: stats,
        details,
        sample_urls: Vec::new(),
    })
}

// ==================== 校验 / DB ====================

fn validate_common(
    activate: u32,
    register: u32,
    pay: u32,
    date: Option<&str>,
    asset: &XiaomiAssetConfig,
) -> Result<(), String> {
    if activate == 0 {
        return Err("激活数量必须大于 0".to_string());
    }
    if !(activate >= register && register >= pay) {
        return Err(format!(
            "数量必须满足 激活 ≥ 注册 ≥ 付费（当前 {activate}/{register}/{pay}）"
        ));
    }
    if let Some(d) = date {
        if !is_valid_date(d) {
            return Err(format!("日期格式错误: {d}（应为 YYYY-MM-DD）"));
        }
    }
    asset.validate()?;
    for (event, qty) in [("activate", activate), ("register", register), ("pay", pay)] {
        if qty > 0 && asset.event_name(event).is_empty() {
            return Err(format!("请填写{}事件名（小米 event）", event_label(event)));
        }
    }
    Ok(())
}

struct XiaomiTable {
    name: String,
}

/// 定位点击表：显式表名优先，否则按候选表找第一个存在且小米必需列齐全的表。
fn resolve_xiaomi_table(conn: &mut Conn, db: &HonorDbConfig) -> Result<XiaomiTable, String> {
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
        return Ok(XiaomiTable { name: name.clone() });
    }

    let mut msg = match &first_missing {
        Some((name, missing)) => format!(
            "表 `{name}` 存在但缺少小米回传必需列: {}",
            missing.join(", ")
        ),
        None => format!(
            "库 `{schema}` 中未找到点击表（候选: {}）",
            candidates.join(" / ")
        ),
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
    Err(msg)
}

/// 小米点击的可用条件：必须带 callback（空串 / 字面量 NULL 都视为缺失）
const PLATFORM_FILTER: &str = "platform='xiaomi'";
const CALLBACK_FILTER: &str =
    "callback_uri IS NOT NULL AND callback_uri<>'' AND UPPER(callback_uri)<>'NULL'";
const OAID_FILTER: &str = "oaid IS NOT NULL AND oaid<>''";

fn count_xiaomi_rows(
    conn: &mut Conn,
    table: &XiaomiTable,
    date: Option<&str>,
    account_pk: u64,
) -> Result<(u64, u64), String> {
    let base = |callback: &str| -> (String, Params) {
        let mut sql = format!(
            "SELECT COUNT(*) FROM `{}` WHERE {PLATFORM_FILTER} AND {OAID_FILTER} AND {callback} \
             AND click_time_ms IS NOT NULL AND account_pk=?",
            table.name
        );
        let mut params: Vec<Value> = vec![Value::UInt(account_pk)];
        if let Some(d) = date {
            sql.push_str(" AND DATE(create_time)=?");
            params.push(Value::from(d));
        }
        (sql, Params::Positional(params))
    };
    let (sql, params) = base(CALLBACK_FILTER);
    let with_callback: Option<u64> = conn
        .exec_first(&sql, params)
        .map_err(|e| format!("统计可用设备失败: {e}"))?;
    let (sql, params) =
        base("(callback_uri IS NULL OR callback_uri='' OR UPPER(callback_uri)='NULL')");
    let without_callback: Option<u64> = conn
        .exec_first(&sql, params)
        .map_err(|e| format!("统计缺失 callback 失败: {e}"))?;
    Ok((with_callback.unwrap_or(0), without_callback.unwrap_or(0)))
}

/// 读取点击记录（最新优先），按设备（oaid）去重后凑齐不超过 limit 个设备
fn load_xiaomi_devices(
    conn: &mut Conn,
    table: &XiaomiTable,
    date: Option<&str>,
    account_pk: u64,
    limit: usize,
    dedupe: bool,
) -> Result<Vec<XiaomiDevice>, String> {
    let mut sql = format!(
        "SELECT oaid, advertiser_id, callback_uri, click_time_ms FROM `{}` \
         WHERE {PLATFORM_FILTER} AND {OAID_FILTER} AND {CALLBACK_FILTER} \
         AND click_time_ms IS NOT NULL AND account_pk=?",
        table.name
    );
    let mut params: Vec<Value> = vec![Value::UInt(account_pk)];
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
        let oaid: Option<String> = row.get("oaid");
        let advertiser_id: Option<String> = row.get("advertiser_id");
        let callback_uri: Option<String> = row.get("callback_uri");
        let click_time_ms: Option<i64> = row.get("click_time_ms");
        let (Some(oaid), Some(callback_uri), Some(click_ms)) = (oaid, callback_uri, click_time_ms)
        else {
            continue;
        };
        if oaid.trim().is_empty() || callback_uri.trim().is_empty() {
            continue;
        }
        if callback_uri.trim().eq_ignore_ascii_case("NULL") {
            continue;
        }
        // 去重按「设备」而不是点击：同一台设备点多次会拿到多个 callback，
        // 按点击去重会把同一设备算成多台，回传后小米侧转化数虚高。
        // 行按 id DESC 取，先到先留 = 保留该设备最新一次点击。
        if dedupe && !seen.insert(oaid.trim().to_lowercase()) {
            continue;
        }
        devices.push(XiaomiDevice {
            oaid,
            advertiser_id: unify_null(advertiser_id),
            callback_uri,
            click_time_ms: click_ms,
        });
        if devices.len() >= limit {
            break;
        }
    }
    Ok(devices)
}

fn exclude_reported_devices(
    devices: Vec<XiaomiDevice>,
    account_pk: u64,
) -> Result<(Vec<XiaomiDevice>, usize), String> {
    let day = today_local();
    let reported: HashSet<String> = crate::db::honor_reported_oaids(&account_pk.to_string(), &day)?
        .into_iter()
        .map(|s| s.trim().to_lowercase())
        .collect();
    if reported.is_empty() {
        return Ok((devices, 0));
    }
    let before = devices.len();
    let kept: Vec<XiaomiDevice> = devices
        .into_iter()
        .filter(|d| !reported.contains(&d.oaid.trim().to_lowercase()))
        .collect();
    let skipped = before - kept.len();
    Ok((kept, skipped))
}

#[derive(Debug, Clone)]
struct XiaomiDevice {
    oaid: String,
    advertiser_id: String,
    callback_uri: String,
    click_time_ms: i64,
}

// ==================== 组装 / 发送 ====================

/// 组装精准 API URL：参数顺序固定，sign = md5(URL 编码参数串 + "&secret_key=" + 密钥)。
fn build_xiaomi_url(
    asset: &XiaomiAssetConfig,
    device: &XiaomiDevice,
    event_name: &str,
    event_time_ms: i64,
) -> String {
    let mut pairs = url::form_urlencoded::Serializer::new(String::new());
    pairs
        .append_pair("oaid", device.oaid.trim())
        .append_pair("carrier_id", asset.carrier_id.trim())
        .append_pair("capital_id", asset.capital_id.trim())
        .append_pair("event", event_name)
        .append_pair("event_time", &event_time_ms.to_string())
        .append_pair("callback", device.callback_uri.trim())
        .append_pair("is_debug", if asset.is_debug { "1" } else { "0" });
    let query = pairs.finish();
    let sign = md5_hex(&format!("{query}&secret_key={}", asset.secret_key.trim()));
    format!("{EXACT_URL}?{query}&sign={sign}")
}

fn md5_hex(input: &str) -> String {
    let digest = Md5::digest(input.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 按小米响应判定结果：code==0 成功；code!=0 失败并带 message/solution；非 JSON 视为未知。
fn classify_xiaomi(status: u16, body: &str) -> (&'static str, String) {
    let body_short = truncate_str(body, 200);
    let Ok(data) = serde_json::from_str::<serde_json::Value>(body) else {
        return (
            "unknown",
            format!("HTTP {status} 非 JSON 响应 body={body_short}"),
        );
    };
    let code = data.get("code").filter(|v| !v.is_null());
    let message = data
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let solution = data
        .get("solution")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    match code {
        Some(v) if v.as_i64() == Some(0) || v.as_f64() == Some(0.0) => {
            ("success", format!("HTTP {status} code=0 message={message}"))
        }
        Some(v) => {
            let mut text = format!("HTTP {status} code={v} message={message} solution={solution}");
            if v.as_i64() == Some(300) {
                text.push_str(
                    "；提示：sign 校验失败，先确认 secret_key 是该 capital_id 所属资产「联调工具」页的资产秘钥（不是秘钥id/signId），且密钥没有引号、空格或换行",
                );
            }
            ("failed", text)
        }
        None => (
            "unknown",
            format!("HTTP {status} 缺少 code body={body_short}"),
        ),
    }
}

fn send_one(client: &reqwest::blocking::Client, url: &str) -> (&'static str, String) {
    match client.get(url).send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().unwrap_or_default();
            classify_xiaomi(status, &body)
        }
        Err(e) => ("error", format!("请求异常: {e}")),
    }
}

// ==================== 杂项 ====================

fn new_event_stats(activate: u32, register: u32, pay: u32) -> Vec<HonorEventStat> {
    let stat = |event: &str, requested: u32| HonorEventStat {
        event: event.to_string(),
        requested,
        success: 0,
        failed: 0,
        unknown: 0,
        error: 0,
        dry_run: 0,
    };
    vec![
        stat("activate", activate),
        stat("register", register),
        stat("pay", pay),
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

fn unify_null(value: Option<String>) -> String {
    let value = value.unwrap_or_default();
    if value.trim().eq_ignore_ascii_case("NULL") {
        String::new()
    } else {
        value
    }
}

fn short_oaid(oaid: &str) -> String {
    truncate_str(oaid, OAID_DISPLAY_LEN)
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
        "xiaomi-report-progress",
        HonorProgressPayload {
            percent,
            message: message.to_string(),
            current,
            total,
            line,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xiaomi_url_matches_python_script_signature() {
        // 期望值由 xiaomi_report_debug.py 的 urlencode + md5 口径算出：
        // python3 -c '...hasattr urlencode(query pairs)...'
        let asset = XiaomiAssetConfig {
            carrier_id: "1776184".to_string(),
            capital_id: "94219".to_string(),
            secret_key: "testsecret".to_string(),
            is_debug: true,
            ..Default::default()
        };
        let device = XiaomiDevice {
            oaid: "9a8f2c3767b1b454".to_string(),
            advertiser_id: String::new(),
            callback_uri: "OCQwabc==".to_string(),
            click_time_ms: 0,
        };
        let url = build_xiaomi_url(&asset, &device, "APP_ACTIVE", 1_700_000_000_000);
        assert_eq!(
            url,
            "https://trail.e.mi.com/v4/api/exact?oaid=9a8f2c3767b1b454&carrier_id=1776184\
             &capital_id=94219&event=APP_ACTIVE&event_time=1700000000000\
             &callback=OCQwabc%3D%3D&is_debug=1&sign=b2636e02e1e824018e153d99733a8d1b"
        );
        // reqwest 内部会先用 url crate 解析：确认它不会改写签名用的编码串
        let parsed = url::Url::parse(&url).expect("url 应可解析");
        let raw_query = url.split_once('?').expect("url 应带 query").1;
        assert_eq!(parsed.query(), Some(raw_query));
    }

    #[test]
    fn classify_xiaomi_uses_code_zero_as_success() {
        assert_eq!(
            classify_xiaomi(200, r#"{"code":0,"message":"成功"}"#).0,
            "success"
        );
        assert_eq!(
            classify_xiaomi(200, r#"{"code":207,"message":"非法event"}"#).0,
            "failed"
        );
        assert_eq!(classify_xiaomi(200, "not json").0, "unknown");

        let (outcome, message) = classify_xiaomi(200, r#"{"code":300,"message":"解析sign失败"}"#);
        assert_eq!(outcome, "failed");
        assert!(message.contains("secret_key"));
    }

    #[test]
    fn asset_ids_must_be_positive_integers() {
        let base = XiaomiAssetConfig {
            carrier_id: "1776184".to_string(),
            capital_id: "94219".to_string(),
            secret_key: "testsecret".to_string(),
            ..Default::default()
        };
        assert!(base.clone().normalized().validate().is_ok());

        let with_suffix = XiaomiAssetConfig {
            capital_id: "94219（资产）".to_string(),
            ..base.clone()
        };
        assert!(with_suffix.normalized().validate().is_err());

        let full_width = XiaomiAssetConfig {
            capital_id: "９４２１９".to_string(),
            ..base.clone()
        };
        assert_eq!(full_width.normalized().capital_id, "94219");

        let zero = XiaomiAssetConfig {
            capital_id: "0".to_string(),
            ..base
        };
        assert!(zero.normalized().validate().is_err());
    }
}
