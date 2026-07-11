//! Excel 读取与渠道 / 结算行解析。

use std::{collections::HashMap, path::Path};

use calamine::{open_workbook_auto, Data, Reader};

use super::{AccountData, ChannelData, SettlementData};

pub(super) fn read_first_sheet(path: &Path) -> Result<Vec<Vec<Data>>, String> {
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

pub(super) fn parse_source_rows(rows: &[Vec<Data>]) -> Result<Vec<ChannelData>, String> {
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

pub(super) fn parse_settlement_rows(
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

pub(super) fn group_by_account(data: Vec<ChannelData>) -> Vec<AccountData> {
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

pub(super) fn clean_cell(cell: Option<&Data>) -> String {
    cell.map(cell_to_string)
        .map(|value| clean_text(&value))
        .unwrap_or_default()
}

pub(super) fn clean_text(value: &str) -> String {
    value.chars().filter(|c| !c.is_whitespace()).collect()
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
