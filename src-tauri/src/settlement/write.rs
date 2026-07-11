//! 结算单工作簿 / 工作表写入。

use std::{collections::HashMap, path::{Path, PathBuf}};

use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};

use super::{AccountData, SettlementData, SettlementLine};

pub(super) fn generate_account_workbook(
    account: &AccountData,
    settlement_data: &HashMap<String, Vec<SettlementData>>,
    output_dir: &Path,
    rows_per_sheet: usize,
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

    let chunk_size = if rows_per_sheet == 0 {
        lines.len().max(1)
    } else {
        rows_per_sheet
    };
    for (group_index, group_lines) in lines.chunks(chunk_size).enumerate() {
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

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_whitespace())
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

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub(super) fn num_to_chinese(num: f64) -> String {
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
