use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};

use calamine::{open_workbook_auto, Data, Reader};
use chrono::{Local, NaiveDate};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};

const DEFAULT_SETTLEMENT_SOURCE_RESOURCE: &str = "../resources/settlement/渠道打款信息表.xlsx";
const DEFAULT_SETTLEMENT_SOURCE_DEV_PATH: &str = "resources/settlement/渠道打款信息表.xlsx";

#[derive(Debug, Clone)]
struct ChannelData {
    channel_id: String,
    account: String,
    name: String,
    bank: String,
}

#[derive(Debug, Clone)]
struct AccountData {
    account: String,
    name: String,
    bank: String,
    channels: Vec<String>,
}

#[derive(Debug, Clone)]
struct SettlementData {
    settlement_period: String,
    product_name: String,
    unit_price: f64,
    quantity: f64,
    amount: f64,
}

#[derive(Debug, Clone)]
struct SettlementLine {
    channel_id: String,
    data: Option<SettlementData>,
}

#[derive(Debug, Serialize)]
pub struct SettlementGenerateResult {
    created: usize,
    accounts: usize,
    channels: usize,
    output_dir: String,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SettlementProgressPayload {
    percent: u8,
    message: String,
    current: usize,
    total: usize,
}

#[tauri::command]
pub async fn generate_settlement_statements(
    app: tauri::AppHandle,
    source_path: String,
    settlement_path: String,
    output_dir: String,
) -> Result<SettlementGenerateResult, String> {
    let default_source_path = default_settlement_source_path(&app);
    let source_path = resolve_settlement_source_path(&source_path, default_source_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        generate_settlement_statements_inner(
            source_path,
            PathBuf::from(settlement_path),
            PathBuf::from(output_dir),
            Some(app),
        )
    })
    .await
    .map_err(|e| format!("生成结算单任务失败: {}", e))?
}

fn default_settlement_source_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = app
        .path()
        .resolve(DEFAULT_SETTLEMENT_SOURCE_RESOURCE, BaseDirectory::Resource)
    {
        candidates.push(path);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(DEFAULT_SETTLEMENT_SOURCE_DEV_PATH));
        candidates.push(current_dir.join(DEFAULT_SETTLEMENT_SOURCE_RESOURCE));
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.join(DEFAULT_SETTLEMENT_SOURCE_DEV_PATH));
            candidates.push(parent.join(DEFAULT_SETTLEMENT_SOURCE_RESOURCE));
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

fn resolve_settlement_source_path(
    source_path: &str,
    default_source_path: Option<PathBuf>,
) -> Result<PathBuf, String> {
    let source_path = source_path.trim();
    if !source_path.is_empty() {
        return Ok(PathBuf::from(source_path));
    }
    default_source_path.ok_or_else(|| {
        "内置渠道打款信息表不存在，请确认 resources/settlement/渠道打款信息表.xlsx 已随应用打包"
            .to_string()
    })
}

fn dated_settlement_output_dir(base_dir: &Path, date: NaiveDate) -> PathBuf {
    base_dir.join(date.format("%Y%m%d").to_string())
}

fn generate_settlement_statements_inner(
    source_path: PathBuf,
    settlement_path: PathBuf,
    output_dir: PathBuf,
    app: Option<tauri::AppHandle>,
) -> Result<SettlementGenerateResult, String> {
    emit_settlement_progress(&app, 1, "检查输入文件...", 0, 0);
    ensure_file(&source_path, "渠道打款信息表")?;
    ensure_file(&settlement_path, "结算数据")?;
    let output_dir = dated_settlement_output_dir(&output_dir, Local::now().date_naive());
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    emit_settlement_progress(&app, 5, "读取渠道打款信息表...", 0, 0);
    let source_rows = read_first_sheet(&source_path)?;
    emit_settlement_progress(&app, 10, "读取结算数据...", 0, 0);
    let settlement_rows = read_first_sheet(&settlement_path)?;
    emit_settlement_progress(&app, 15, "解析渠道和结算数据...", 0, 0);
    let channel_data = parse_source_rows(&source_rows)?;
    let settlement_data = parse_settlement_rows(&settlement_rows)?;
    emit_settlement_progress(&app, 20, "按打款账号分组...", 0, 0);
    let accounts = group_by_account(channel_data);

    if accounts.is_empty() {
        return Err("没有可生成的数据".to_string());
    }
    let channel_count = accounts.iter().map(|item| item.channels.len()).sum();
    emit_settlement_progress(
        &app,
        25,
        &format!("开始生成 {} 个账号的结算单...", accounts.len()),
        0,
        accounts.len(),
    );
    let files = generate_accounts_parallel(&accounts, &settlement_data, &output_dir, app.as_ref())?;
    emit_settlement_progress(&app, 100, "结算单生成完成", accounts.len(), accounts.len());

    Ok(SettlementGenerateResult {
        created: files.len(),
        accounts: accounts.len(),
        channels: channel_count,
        output_dir: output_dir.to_string_lossy().to_string(),
        files,
    })
}

fn ensure_file(path: &Path, label: &str) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!("{}不存在: {}", label, path.display()))
    }
}

fn emit_settlement_progress(
    app: &Option<tauri::AppHandle>,
    percent: u8,
    message: &str,
    current: usize,
    total: usize,
) {
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "settlement-progress",
        SettlementProgressPayload {
            percent,
            message: message.to_string(),
            current,
            total,
        },
    );
}

fn read_first_sheet(path: &Path) -> Result<Vec<Vec<Data>>, String> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|e| format!("读取Excel失败({}): {}", path.display(), e))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| format!("Excel没有工作表: {}", path.display()))?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| format!("读取工作表失败({}): {}", sheet_name, e))?;
    Ok(range.rows().map(|row| row.to_vec()).collect())
}

fn parse_source_rows(rows: &[Vec<Data>]) -> Result<Vec<ChannelData>, String> {
    if rows.is_empty() {
        return Err("源数据为空".to_string());
    }

    let mut header_row = None;
    let mut idx_account = 0;
    let mut idx_name = None;
    let mut idx_bank = None;
    let mut idx_channel = 0;

    for (row_index, row) in rows.iter().take(10).enumerate() {
        let headers: Vec<String> = row.iter().map(|v| clean_text(&cell_to_string(v))).collect();
        let mut account = None;
        let mut name = None;
        let mut bank = None;
        let mut channel = None;

        for (idx, header) in headers.iter().enumerate() {
            if account.is_none() && is_account_header(header) {
                account = Some(idx);
            }
            if name.is_none() && is_name_header(header) {
                name = Some(idx);
            }
            if bank.is_none() && is_bank_header(header) {
                bank = Some(idx);
            }
            if channel.is_none() && is_channel_header(header) {
                channel = Some(idx);
            }
        }

        if let (Some(account_idx), Some(channel_idx)) = (account, channel) {
            header_row = Some(row_index);
            idx_account = account_idx;
            idx_name = name;
            idx_bank = bank;
            idx_channel = channel_idx;
            break;
        }
    }

    let header_row = header_row.ok_or_else(|| "未找到必要列：打款账号和渠道ID".to_string())?;
    let mut data = Vec::new();

    for row in rows.iter().skip(header_row + 1) {
        let account = clean_cell(row.get(idx_account));
        let channel = clean_cell(row.get(idx_channel));
        if channel.is_empty() {
            continue;
        }
        if account.is_empty() {
            return Err(format!("渠道 {} 缺少打款账号", channel));
        }

        data.push(ChannelData {
            channel_id: channel,
            account,
            name: idx_name.map_or_else(String::new, |idx| clean_cell(row.get(idx))),
            bank: idx_bank.map_or_else(String::new, |idx| clean_cell(row.get(idx))),
        });
    }

    Ok(data)
}

fn parse_settlement_rows(
    rows: &[Vec<Data>],
) -> Result<HashMap<String, Vec<SettlementData>>, String> {
    if rows.is_empty() {
        return Err("结算单数据为空".to_string());
    }

    let mut header_row = None;
    let mut idx_channel = None;
    let mut idx_period = None;
    let mut idx_product = None;
    let mut idx_price = None;
    let mut idx_quantity = None;
    let mut idx_amount = None;

    for (row_index, row) in rows.iter().take(10).enumerate() {
        let headers: Vec<String> = row.iter().map(|v| clean_text(&cell_to_string(v))).collect();
        let mut channel = None;
        let mut period = None;
        let mut product = None;
        let mut price = None;
        let mut quantity = None;
        let mut amount = None;

        for (idx, header) in headers.iter().enumerate() {
            if channel.is_none()
                && (header == "渠道号" || header == "渠道ID" || header.contains("渠道"))
            {
                channel = Some(idx);
            }
            if period.is_none()
                && (header == "结算日期" || header.contains("结算周期") || header.contains("日期"))
            {
                period = Some(idx);
            }
            if product.is_none() && (header == "产品名称" || header.contains("产品")) {
                product = Some(idx);
            }
            if price.is_none() && (header == "结算单价" || header.contains("单价")) {
                price = Some(idx);
            }
            if quantity.is_none()
                && (header == "结算数量" || header.contains("数量") || header.contains("七天总和"))
            {
                quantity = Some(idx);
            }
            if amount.is_none()
                && (header == "结算金额"
                    || header.contains("金额")
                    || header.contains("给渠道的钱"))
            {
                amount = Some(idx);
            }
        }

        if channel.is_some() && period.is_some() && product.is_some() {
            header_row = Some(row_index);
            idx_channel = channel;
            idx_period = period;
            idx_product = product;
            idx_price = price;
            idx_quantity = quantity;
            idx_amount = amount;
            break;
        }
    }

    let header_row = header_row.ok_or_else(|| "未找到渠道号列".to_string())?;
    let channel_idx = idx_channel.ok_or_else(|| "未找到渠道号列".to_string())?;
    let period_idx = idx_period.ok_or_else(|| "未找到结算日期列".to_string())?;
    let product_idx = idx_product.ok_or_else(|| "未找到产品名称列".to_string())?;
    let price_idx = idx_price.ok_or_else(|| "未找到结算单价列".to_string())?;
    let quantity_idx = idx_quantity.ok_or_else(|| "未找到结算数量列".to_string())?;
    let amount_idx = idx_amount.ok_or_else(|| "未找到结算金额列".to_string())?;
    let mut map = HashMap::new();

    for (row_index, row) in rows.iter().enumerate().skip(header_row + 1) {
        let channel_id = clean_cell(row.get(channel_idx));
        if channel_id.is_empty() {
            continue;
        }

        map.entry(channel_id.clone())
            .or_insert_with(Vec::new)
            .push(SettlementData {
                settlement_period: clean_cell(row.get(period_idx)),
                product_name: clean_cell(row.get(product_idx)),
                unit_price: required_number(
                    row.get(price_idx),
                    row_index + 1,
                    "结算单价",
                    &channel_id,
                )?,
                quantity: required_number(
                    row.get(quantity_idx),
                    row_index + 1,
                    "结算数量",
                    &channel_id,
                )?,
                amount: required_number(
                    row.get(amount_idx),
                    row_index + 1,
                    "结算金额",
                    &channel_id,
                )?,
            });
    }

    Ok(map)
}

fn group_by_account(data: Vec<ChannelData>) -> Vec<AccountData> {
    let mut accounts: Vec<AccountData> = Vec::new();

    for item in data {
        let Some(account) = accounts.iter_mut().find(|a| a.account == item.account) else {
            accounts.push(AccountData {
                account: item.account,
                name: item.name,
                bank: item.bank,
                channels: vec![item.channel_id],
            });
            continue;
        };

        if account.name.is_empty() && !item.name.is_empty() {
            account.name = item.name;
        }
        if account.bank.is_empty() && !item.bank.is_empty() {
            account.bank = item.bank;
        }
        if !account.channels.contains(&item.channel_id) {
            account.channels.push(item.channel_id);
        }
    }

    accounts
}

fn generate_accounts_parallel(
    accounts: &[AccountData],
    settlement_data: &HashMap<String, Vec<SettlementData>>,
    output_dir: &Path,
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<String>, String> {
    let workers = settlement_worker_count(accounts.len());
    let completed = Arc::new(AtomicUsize::new(0));
    if workers <= 1 {
        return accounts
            .iter()
            .map(|account| {
                generate_account_workbook(account, settlement_data, output_dir).map(|path| {
                    emit_account_progress(app, &completed, accounts.len(), account);
                    path.to_string_lossy().to_string()
                })
            })
            .collect();
    }

    let chunk_size = accounts.len().div_ceil(workers);
    let mut results = thread::scope(|scope| {
        let mut handles = Vec::new();

        for (chunk_index, chunk) in accounts.chunks(chunk_size).enumerate() {
            let start_index = chunk_index * chunk_size;
            let app = app.cloned();
            let completed = Arc::clone(&completed);
            let total = accounts.len();
            handles.push(
                scope.spawn(move || -> Result<Vec<(usize, String)>, String> {
                    let mut files = Vec::new();
                    for (offset, account) in chunk.iter().enumerate() {
                        let file = generate_account_workbook(account, settlement_data, output_dir)?;
                        emit_account_progress(app.as_ref(), &completed, total, account);
                        files.push((start_index + offset, file.to_string_lossy().to_string()));
                    }
                    Ok(files)
                }),
            );
        }

        let mut files = Vec::new();
        for handle in handles {
            match handle.join() {
                Ok(Ok(mut worker_files)) => files.append(&mut worker_files),
                Ok(Err(e)) => return Err(e),
                Err(_) => return Err("生成结算单线程异常退出".to_string()),
            }
        }
        Ok(files)
    })?;

    results.sort_by_key(|(index, _)| *index);
    Ok(results.into_iter().map(|(_, file)| file).collect())
}

fn emit_account_progress(
    app: Option<&tauri::AppHandle>,
    completed: &AtomicUsize,
    total: usize,
    account: &AccountData,
) {
    let Some(app) = app else {
        return;
    };
    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
    let percent = 25 + ((done as f64 / total.max(1) as f64) * 70.0).round() as u8;
    let name = if account.name.is_empty() {
        &account.account
    } else {
        &account.name
    };
    let _ = app.emit(
        "settlement-progress",
        SettlementProgressPayload {
            percent: percent.min(99),
            message: format!("已生成 {} ({}/{})", name, done, total),
            current: done,
            total,
        },
    );
}

fn settlement_worker_count(item_count: usize) -> usize {
    if item_count <= 1 {
        return 1;
    }
    let cpus = thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2);
    item_count.min(cpus.saturating_sub(1).max(1).min(4))
}

fn generate_account_workbook(
    account: &AccountData,
    settlement_data: &HashMap<String, Vec<SettlementData>>,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let mut channels = account.channels.clone();
    channels.sort();
    let mut lines = Vec::new();
    for channel in channels {
        if let Some(items) = settlement_data.get(&channel) {
            for item in items {
                lines.push(SettlementLine {
                    channel_id: channel.clone(),
                    data: Some(item.clone()),
                });
            }
        } else {
            lines.push(SettlementLine {
                channel_id: channel,
                data: None,
            });
        }
    }

    let mut workbook = Workbook::new();
    let formats = SheetFormats::new();

    for (group_index, group_lines) in lines.chunks(6).enumerate() {
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(format!("对账单{}", group_index + 1))
            .map_err(format_xlsx_error)?;
        write_sheet(worksheet, group_lines, account, &formats).map_err(format_xlsx_error)?;
    }

    let settlement_period = account
        .channels
        .iter()
        .find_map(|channel| settlement_data.get(channel).and_then(|items| items.first()))
        .map(|item| item.settlement_period.clone())
        .unwrap_or_default();
    let base_name = if account.name.is_empty() {
        sanitize_filename(&account.account)
    } else {
        format!(
            "{}_{}",
            sanitize_filename(&account.name),
            sanitize_filename(&account.account)
        )
    };
    let output_name = if settlement_period.is_empty() {
        format!("{}.xlsx", base_name)
    } else {
        format!(
            "{}_{}.xlsx",
            base_name,
            sanitize_filename(&settlement_period)
        )
    };
    let output_path = output_dir.join(output_name);
    workbook.save(&output_path).map_err(format_xlsx_error)?;
    Ok(output_path)
}

fn write_sheet(
    worksheet: &mut Worksheet,
    lines: &[SettlementLine],
    account: &AccountData,
    formats: &SheetFormats,
) -> Result<(), XlsxError> {
    set_sheet_dimensions(worksheet)?;

    let row_offset = lines.len().saturating_sub(2) as u32;
    let total_label_row = 5 + row_offset;
    let total_row = 6 + row_offset;
    let account_start_row = 7 + row_offset;
    let account_end_row = account_start_row + 6;
    let remark_text_row = 14 + row_offset;
    let remark_blank_row = 15 + row_offset;
    let signature_start_row = 16 + row_offset;
    let signature_end_row = signature_start_row + 7;

    for row in 0..=signature_end_row {
        worksheet.set_row_height(row, 18.35)?;
        for col in 0..7 {
            worksheet.write_string_with_format(row, col, "", &formats.normal)?;
        }
    }
    worksheet.set_row_height(0, 29.55)?;
    worksheet.set_row_height(2, 34.0)?;

    worksheet.merge_range(0, 0, 0, 6, "对账单", &formats.title)?;
    worksheet.merge_range(1, 0, 1, 2, "甲方：", &formats.party)?;
    worksheet.merge_range(1, 3, 1, 6, "乙方：", &formats.party)?;

    for (col, header) in [
        "序号",
        "结算周期",
        "产品名称",
        "渠道名称",
        "结算单价（元）",
        "结算数量",
        "结算金额（元）",
    ]
    .iter()
    .enumerate()
    {
        worksheet.write_string_with_format(2, col as u16, *header, &formats.header)?;
    }

    for row in 3..total_row {
        for col in 0..7 {
            let format = if col == 0 {
                &formats.data_first
            } else {
                &formats.data
            };
            worksheet.write_string_with_format(row, col, "", format)?;
        }
    }

    let mut total_amount = 0.0;
    for (idx, line) in lines.iter().enumerate() {
        let row = 3 + idx as u32;
        worksheet.write_number_with_format(row, 0, (idx + 1) as f64, &formats.data_first)?;

        if let Some(data) = &line.data {
            worksheet.write_string_with_format(row, 1, &data.settlement_period, &formats.data)?;
            worksheet.write_string_with_format(row, 2, &data.product_name, &formats.data)?;
            write_channel_value(worksheet, row, 3, &line.channel_id, &formats.data)?;
            worksheet.write_number_with_format(row, 4, data.unit_price, &formats.data)?;
            let quantity = if data.quantity.fract() == 0.0 {
                data.quantity.trunc()
            } else {
                (data.quantity * 100.0).round() / 100.0
            };
            worksheet.write_number_with_format(row, 5, quantity, &formats.data)?;
            worksheet.write_number_with_format(row, 6, data.amount, &formats.data)?;
            total_amount += data.amount;
        } else {
            worksheet.write_string_with_format(row, 1, "暂无", &formats.data)?;
            worksheet.write_string_with_format(row, 2, "暂无", &formats.data)?;
            write_channel_value(worksheet, row, 3, &line.channel_id, &formats.data)?;
            worksheet.write_string_with_format(row, 4, "暂无", &formats.data)?;
            worksheet.write_string_with_format(row, 5, "暂无", &formats.data)?;
            worksheet.write_string_with_format(row, 6, "暂无", &formats.data)?;
        }
    }
    let total_amount = round_money(total_amount);

    worksheet.write_string_with_format(
        total_label_row,
        0,
        "本期结算金额合计",
        &formats.data_first,
    )?;
    worksheet.write_string_with_format(total_label_row, 3, "总金额", &formats.data)?;
    worksheet.write_number_with_format(total_label_row, 6, total_amount, &formats.data)?;
    for col in 0..7 {
        worksheet.write_string_with_format(total_row, col, "", &formats.total)?;
    }
    worksheet.merge_range(
        total_row,
        0,
        total_row,
        2,
        "甲方收款账户信息",
        &formats.total,
    )?;
    let total_text = format!("总金额（{}）", num_to_chinese(total_amount));
    worksheet.merge_range(total_row, 3, total_row, 6, &total_text, &formats.total)?;

    worksheet.merge_range(
        account_start_row,
        0,
        account_end_row,
        0,
        "甲方收款\n账户信息",
        &formats.account_title,
    )?;
    worksheet.merge_range(
        account_start_row,
        1,
        account_end_row,
        2,
        "",
        &formats.account,
    )?;
    worksheet.merge_range(
        account_start_row,
        3,
        account_end_row,
        3,
        "乙方收款\n账户信息",
        &formats.account_title,
    )?;
    for row in account_start_row..=account_end_row {
        worksheet.merge_range(row, 4, row, 6, "", &formats.account_right)?;
    }
    let account_name = format!("开户名称：{}", fallback_text(&account.name));
    worksheet.write_string_with_format(
        account_start_row + 1,
        4,
        &account_name,
        &formats.account_right,
    )?;
    let account_bank = format!("开户行：{}", fallback_text(&account.bank));
    worksheet.write_string_with_format(
        account_start_row + 2,
        4,
        &account_bank,
        &formats.account_right,
    )?;
    let account_number = format!("开户账号：{}", account.account);
    worksheet.write_string_with_format(
        account_start_row + 3,
        4,
        &account_number,
        &formats.account_right,
    )?;

    worksheet.merge_range(
        remark_text_row,
        0,
        remark_text_row,
        6,
        "1、此结算单为原广告推广合同的有效组成部分，与原合同具有同等法律效力。",
        &formats.remark,
    )?;
    worksheet.merge_range(
        remark_blank_row,
        0,
        remark_blank_row,
        6,
        "",
        &formats.remark,
    )?;
    worksheet.merge_range(
        signature_start_row,
        0,
        signature_end_row,
        2,
        "甲方：\n法人代表或授权代表签署：\n（盖章）\n日期：",
        &formats.signature,
    )?;
    worksheet.merge_range(
        signature_start_row,
        3,
        signature_end_row,
        6,
        "乙方：\n法人代表或授权代表签署：\n（盖章）\n日期：",
        &formats.signature,
    )?;

    Ok(())
}

fn set_sheet_dimensions(worksheet: &mut Worksheet) -> Result<(), XlsxError> {
    for (col, width) in [9.15, 13.46, 13.46, 13.46, 12.62, 13.46, 22.77]
        .iter()
        .enumerate()
    {
        worksheet.set_column_width(col as u16, *width)?;
    }
    Ok(())
}

struct SheetFormats {
    normal: Format,
    title: Format,
    party: Format,
    header: Format,
    data_first: Format,
    data: Format,
    total: Format,
    account_title: Format,
    account: Format,
    account_right: Format,
    remark: Format,
    signature: Format,
}

impl SheetFormats {
    fn new() -> Self {
        let base = || {
            Format::new()
                .set_font_name("微软雅黑")
                .set_font_size(10.0)
                .set_align(FormatAlign::Center)
                .set_align(FormatAlign::VerticalCenter)
        };
        let border = |format: Format| format.set_border(FormatBorder::Thin);

        Self {
            normal: border(base()),
            title: base().set_bold().set_border(FormatBorder::Thin),
            party: base()
                .set_bold()
                .set_background_color(Color::RGB(0x4874CB))
                .set_border(FormatBorder::Thin),
            header: base()
                .set_bold()
                .set_background_color(Color::RGB(0xBEFFFF))
                .set_border(FormatBorder::Thin),
            data_first: base()
                .set_bold()
                .set_background_color(Color::RGB(0xD9E1F4))
                .set_border(FormatBorder::Thin),
            data: base()
                .set_background_color(Color::RGB(0xD9E1F4))
                .set_border(FormatBorder::Thin),
            total: base()
                .set_bold()
                .set_background_color(Color::RGB(0xBEFFFF))
                .set_border(FormatBorder::Thin),
            account_title: border(base().set_text_wrap()),
            account: border(base()),
            account_right: base().set_border_right(FormatBorder::Thin).set_text_wrap(),
            remark: border(base().set_text_wrap()),
            signature: Format::new()
                .set_font_name("微软雅黑")
                .set_font_size(10.0)
                .set_align(FormatAlign::Left)
                .set_align(FormatAlign::VerticalCenter)
                .set_text_wrap()
                .set_border(FormatBorder::Thin),
        }
    }
}

fn write_channel_value(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    value: &str,
    format: &Format,
) -> Result<(), XlsxError> {
    worksheet.write_string_with_format(row, col, value, format)?;
    Ok(())
}

fn clean_cell(cell: Option<&Data>) -> String {
    cell.map(cell_to_string)
        .map(|value| clean_text(&value))
        .unwrap_or_default()
}

fn clean_text(value: &str) -> String {
    value.chars().filter(|c| !c.is_whitespace()).collect()
}

fn sanitize_filename(value: &str) -> String {
    clean_text(value)
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect()
}

fn fallback_text(value: &str) -> &str {
    if value.is_empty() {
        "暂无"
    } else {
        value
    }
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.clone(),
        Data::Float(value) => format_number(*value),
        Data::Int(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::DateTime(value) => format!("{value:?}"),
        Data::DateTimeIso(value) => value.clone(),
        Data::DurationIso(value) => value.clone(),
        Data::Error(value) => format!("{value:?}"),
    }
}

fn cell_to_f64(cell: Option<&Data>) -> Option<f64> {
    match cell? {
        Data::Float(value) => Some(*value),
        Data::Int(value) => Some(*value as f64),
        Data::String(value) => parse_number(&clean_text(value)),
        _ => None,
    }
}

fn required_number(
    cell: Option<&Data>,
    row: usize,
    label: &str,
    channel: &str,
) -> Result<f64, String> {
    cell_to_f64(cell)
        .ok_or_else(|| format!("第 {} 行渠道 {} 的{}不是有效数字", row, channel, label))
}

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{:.0}", value)
    } else {
        value.to_string()
    }
}

fn parse_number(value: &str) -> Option<f64> {
    if value.is_empty() {
        return None;
    }
    value
        .trim()
        .trim_start_matches('￥')
        .trim_start_matches('¥')
        .trim_end_matches('元')
        .replace(',', "")
        .parse::<f64>()
        .ok()
}

fn is_account_header(text: &str) -> bool {
    text.contains("打款") && (text.contains("账号") || text.contains("账户"))
}

fn is_name_header(text: &str) -> bool {
    text.contains("打款")
        && (text.contains("名字") || text.contains("姓名") || text.contains("名称"))
}

fn is_bank_header(text: &str) -> bool {
    text.contains("开户") && (text.contains("行") || text.contains("银行"))
}

fn is_channel_header(text: &str) -> bool {
    text.contains("渠道")
        && (text.to_lowercase().contains("id") || text.contains("编号") || text.contains('号'))
}

fn num_to_chinese(num: f64) -> String {
    if num == 0.0 {
        return "零元整".to_string();
    }

    let digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    let units = ["", "拾", "佰", "仟", "万", "拾", "佰", "仟", "亿"];
    let integer_part = num.trunc() as u64;
    let decimal_part = ((num - integer_part as f64) * 100.0).round().min(99.0) as u32;
    let mut result = String::new();

    if integer_part > 0 {
        let integer = integer_part.to_string();
        let chars: Vec<char> = integer.chars().collect();
        for (idx, digit_char) in chars.iter().enumerate() {
            let digit = digit_char.to_digit(10).unwrap_or(0) as usize;
            let unit_index = chars.len() - 1 - idx;
            if digit == 0 {
                if idx > 0 && chars[idx - 1] != '0' {
                    result.push('零');
                }
            } else {
                result.push_str(digits[digit]);
                result.push_str(units.get(unit_index).unwrap_or(&""));
            }
        }
        result.push('元');
    }

    if decimal_part > 0 {
        let jiao = decimal_part / 10;
        let fen = decimal_part % 10;
        if jiao > 0 {
            result.push_str(digits[jiao as usize]);
            result.push('角');
        }
        if fen > 0 {
            result.push_str(digits[fen as usize]);
            result.push('分');
        }
    } else {
        result.push('整');
    }

    result
}

fn format_xlsx_error(error: XlsxError) -> String {
    format!("写入Excel失败: {}", error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cleans_text_like_script() {
        assert_eq!(clean_text(" 62 18\n"), "6218");
    }

    #[test]
    fn converts_amount_like_script() {
        assert_eq!(num_to_chinese(1.58), "壹元伍角捌分");
        assert_eq!(num_to_chinese(0.0), "零元整");
    }

    #[test]
    fn generates_settlement_workbook_from_two_inputs() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("jarporter-settlement-test-{stamp}"));
        let output_dir = root.join("out");
        fs::create_dir_all(&output_dir).unwrap();

        let source_path = root.join("source.xlsx");
        let settlement_path = root.join("settlement.xlsx");
        write_source_fixture(&source_path);
        write_settlement_fixture(&settlement_path);

        let result = generate_settlement_statements_inner(
            source_path,
            settlement_path,
            output_dir.clone(),
            None,
        )
        .unwrap();

        assert_eq!(result.created, 1);
        assert_eq!(result.channels, 2);

        let output_file = PathBuf::from(&result.files[0]);
        assert!(output_file.exists());

        let rows = read_first_sheet(&output_file).unwrap();
        assert_eq!(clean_cell(rows[0].first()), "对账单");
        assert_eq!(clean_cell(rows[8].get(4)), "开户名称：张三");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_source_rows_without_payment_account() {
        let rows = vec![
            vec![
                Data::String("打款账号".to_string()),
                Data::String("打款名字".to_string()),
                Data::String("开户行".to_string()),
                Data::String("渠道ID".to_string()),
            ],
            vec![
                Data::String(String::new()),
                Data::String("张三".to_string()),
                Data::String("招商银行".to_string()),
                Data::String("1001".to_string()),
            ],
        ];

        assert!(parse_source_rows(&rows).is_err());
    }

    #[test]
    fn empty_source_path_uses_default_payment_info_file() {
        let stamp = test_stamp("default-source");
        let root = std::env::temp_dir().join(stamp);
        fs::create_dir_all(&root).unwrap();
        let default_source = root.join("渠道打款信息表.xlsx");
        write_source_fixture(&default_source);

        let resolved =
            resolve_settlement_source_path("", Some(default_source.clone())).unwrap();
        assert_eq!(resolved, default_source);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn output_base_dir_resolves_to_yyyymmdd_dir() {
        let base_dir = PathBuf::from("settlement-output");
        let date = chrono::NaiveDate::from_ymd_opt(2026, 7, 6).unwrap();

        let resolved = dated_settlement_output_dir(&base_dir, date);

        assert_eq!(resolved, PathBuf::from("settlement-output").join("20260706"));
    }

    #[test]
    fn ignores_settlement_channels_missing_payment_info_like_python_script() {
        let stamp = test_stamp("missing-channel");
        let root = std::env::temp_dir().join(stamp);
        let output_dir = root.join("out");
        fs::create_dir_all(&output_dir).unwrap();

        let source_path = root.join("source.xlsx");
        let settlement_path = root.join("settlement.xlsx");
        write_text_rows(
            &source_path,
            &[
                &["打款账号", "打款名字", "开户行", "渠道ID"],
                &["621700001", "张三", "招商银行", "1001"],
            ],
        );
        write_text_rows(
            &settlement_path,
            &[
                &[
                    "结算日期",
                    "渠道ID",
                    "产品名称",
                    "结算单价",
                    "七天总和",
                    "给渠道的钱",
                ],
                &["2026.6.22-2026.6.28", "9999", "漫画", "0.65", "1", "0.65"],
            ],
        );

        let result =
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None)
                .unwrap();
        assert_eq!(result.created, 1);
        assert_eq!(result.channels, 1);

        let rows = read_first_sheet(Path::new(&result.files[0])).unwrap();
        assert_eq!(clean_cell(rows[3].get(3)), "1001");
        assert_eq!(clean_cell(rows[3].get(4)), "暂无");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn keeps_duplicate_channel_settlement_rows() {
        let stamp = test_stamp("duplicate-channel");
        let root = std::env::temp_dir().join(stamp);
        let output_dir = root.join("out");
        fs::create_dir_all(&output_dir).unwrap();

        let source_path = root.join("source.xlsx");
        let settlement_path = root.join("settlement.xlsx");
        write_text_rows(
            &source_path,
            &[
                &["打款账号", "打款名字", "开户行", "渠道ID"],
                &["621700001", "张三", "招商银行", "1001"],
            ],
        );
        write_text_rows(
            &settlement_path,
            &[
                &[
                    "结算日期",
                    "渠道ID",
                    "产品名称",
                    "结算单价",
                    "七天总和",
                    "给渠道的钱",
                ],
                &["2026.6.22-2026.6.28", "1001", "漫画", "0.65", "1", "0.65"],
                &["2026.6.22-2026.6.28", "1001", "影视", "0.65", "2", "1.30"],
            ],
        );

        let result =
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None)
                .unwrap();
        let rows = read_first_sheet(Path::new(&result.files[0])).unwrap();

        assert_eq!(clean_cell(rows[3].get(2)), "漫画");
        assert_eq!(clean_cell(rows[4].get(2)), "影视");
        assert_eq!(clean_cell(rows[5].get(6)), "1.95");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn names_files_with_account_to_avoid_same_name_overwrite() {
        let stamp = test_stamp("same-name");
        let root = std::env::temp_dir().join(stamp);
        let output_dir = root.join("out");
        fs::create_dir_all(&output_dir).unwrap();

        let source_path = root.join("source.xlsx");
        let settlement_path = root.join("settlement.xlsx");
        write_text_rows(
            &source_path,
            &[
                &["打款账号", "打款名字", "开户行", "渠道ID"],
                &["621700001", "张三", "招商银行", "1001"],
                &["621700002", "张三", "招商银行", "1002"],
            ],
        );
        write_text_rows(
            &settlement_path,
            &[
                &[
                    "结算日期",
                    "渠道ID",
                    "产品名称",
                    "结算单价",
                    "七天总和",
                    "给渠道的钱",
                ],
                &["2026.6.22-2026.6.28", "1001", "漫画", "0.65", "1", "0.65"],
                &["2026.6.22-2026.6.28", "1002", "影视", "0.65", "2", "1.30"],
            ],
        );

        let result =
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None)
                .unwrap();
        let unique_files: std::collections::HashSet<_> = result.files.iter().collect();

        assert_eq!(unique_files.len(), 2);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn preserves_channel_ids_with_leading_zeroes() {
        let stamp = test_stamp("leading-zero");
        let root = std::env::temp_dir().join(stamp);
        let output_dir = root.join("out");
        fs::create_dir_all(&output_dir).unwrap();

        let source_path = root.join("source.xlsx");
        let settlement_path = root.join("settlement.xlsx");
        write_text_rows(
            &source_path,
            &[
                &["打款账号", "打款名字", "开户行", "渠道ID"],
                &["621700001", "张三", "招商银行", "00123"],
            ],
        );
        write_text_rows(
            &settlement_path,
            &[
                &[
                    "结算日期",
                    "渠道ID",
                    "产品名称",
                    "结算单价",
                    "七天总和",
                    "给渠道的钱",
                ],
                &["2026.6.22-2026.6.28", "00123", "漫画", "0.65", "1", "0.65"],
            ],
        );

        let result =
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None)
                .unwrap();
        let rows = read_first_sheet(Path::new(&result.files[0])).unwrap();

        assert_eq!(clean_cell(rows[3].get(3)), "00123");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_invalid_amount_cells() {
        let stamp = test_stamp("bad-amount");
        let root = std::env::temp_dir().join(stamp);
        let output_dir = root.join("out");
        fs::create_dir_all(&output_dir).unwrap();

        let source_path = root.join("source.xlsx");
        let settlement_path = root.join("settlement.xlsx");
        write_text_rows(
            &source_path,
            &[
                &["打款账号", "打款名字", "开户行", "渠道ID"],
                &["621700001", "张三", "招商银行", "1001"],
            ],
        );
        write_text_rows(
            &settlement_path,
            &[
                &[
                    "结算日期",
                    "渠道ID",
                    "产品名称",
                    "结算单价",
                    "七天总和",
                    "给渠道的钱",
                ],
                &["2026.6.22-2026.6.28", "1001", "漫画", "0.65", "1", "￥abc"],
            ],
        );

        let err =
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None)
                .unwrap_err();
        assert!(err.contains("结算金额"));

        fs::remove_dir_all(root).ok();
    }

    fn write_source_fixture(path: &Path) {
        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        worksheet.write_string(0, 0, "打款账号").unwrap();
        worksheet.write_string(0, 1, "打款名字").unwrap();
        worksheet.write_string(0, 2, "开户行").unwrap();
        worksheet.write_string(0, 3, "渠道ID").unwrap();
        worksheet.write_string(1, 0, "621700001").unwrap();
        worksheet.write_string(1, 1, "张三").unwrap();
        worksheet.write_string(1, 2, "招商银行").unwrap();
        worksheet.write_string(1, 3, "1001").unwrap();
        worksheet.write_string(2, 0, "621700001").unwrap();
        worksheet.write_string(2, 1, "张三").unwrap();
        worksheet.write_string(2, 2, "招商银行").unwrap();
        worksheet.write_string(2, 3, "1002").unwrap();
        workbook.save(path).unwrap();
    }

    fn test_stamp(name: &str) -> String {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        format!("jarporter-settlement-test-{name}-{stamp}")
    }

    fn write_text_rows(path: &Path, rows: &[&[&str]]) {
        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        for (row, cells) in rows.iter().enumerate() {
            for (col, value) in cells.iter().enumerate() {
                worksheet
                    .write_string(row as u32, col as u16, *value)
                    .unwrap();
            }
        }
        workbook.save(path).unwrap();
    }

    fn write_settlement_fixture(path: &Path) {
        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        for (col, header) in [
            "结算日期",
            "渠道ID",
            "产品名称",
            "结算单价",
            "七天总和",
            "给渠道的钱",
        ]
        .iter()
        .enumerate()
        {
            worksheet.write_string(0, col as u16, *header).unwrap();
        }
        worksheet.write_string(1, 0, "2026.6.22-2026.6.28").unwrap();
        worksheet.write_string(1, 1, "1001").unwrap();
        worksheet.write_string(1, 2, "漫画").unwrap();
        worksheet.write_number(1, 3, 0.65).unwrap();
        worksheet.write_number(1, 4, 1.0).unwrap();
        worksheet.write_number(1, 5, 0.65).unwrap();
        worksheet.write_string(2, 0, "2026.6.22-2026.6.28").unwrap();
        worksheet.write_string(2, 1, "1002").unwrap();
        worksheet.write_string(2, 2, "影视").unwrap();
        worksheet.write_number(2, 3, 0.65).unwrap();
        worksheet.write_number(2, 4, 2.0).unwrap();
        worksheet.write_number(2, 5, 1.3).unwrap();
        workbook.save(path).unwrap();
    }
}
