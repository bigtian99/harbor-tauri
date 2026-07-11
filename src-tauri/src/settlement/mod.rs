//! 结算单生成：从渠道打款信息表 + 结算数据生成对账单 Excel。
//!
//! 模块划分：
//! - [`parse`] — Excel 读取与行解析
//! - [`write`] — 工作簿 / 工作表写入
//! - [`parallel`] — 并行账号生成与进度

mod parse;
mod write;
mod parallel;

use parse::{
    group_by_account, parse_settlement_rows, parse_source_rows, read_first_sheet,
};
use parallel::generate_accounts_parallel;
// write 仅由 parallel 使用

use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{Local, NaiveDate};
use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone)]
pub(super) struct ChannelData {
    pub(super) channel_id: String,
    pub(super) account: String,
    pub(super) name: String,
    pub(super) bank: String,
}

#[derive(Debug, Clone)]
pub(super) struct AccountData {
    pub(super) account: String,
    pub(super) name: String,
    pub(super) bank: String,
    pub(super) channels: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct SettlementData {
    pub(super) settlement_period: String,
    pub(super) product_name: String,
    pub(super) unit_price: f64,
    pub(super) quantity: f64,
    pub(super) amount: f64,
}

#[derive(Debug, Clone)]
pub(super) struct SettlementLine {
    pub(super) channel_id: String,
    pub(super) data: Option<SettlementData>,
}

#[derive(Debug, Serialize)]
pub struct SettlementGenerateResult {
    pub created: usize,
    pub accounts: usize,
    pub channels: usize,
    pub output_dir: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct SettlementProgressPayload {
    pub(super) percent: u8,
    pub(super) message: String,
    pub(super) current: usize,
    pub(super) total: usize,
}

#[tauri::command]
pub async fn generate_settlement_statements(
    app: tauri::AppHandle,
    source_path: String,
    settlement_path: String,
    output_dir: String,
    rows_per_sheet: Option<usize>,
) -> Result<SettlementGenerateResult, String> {
    let source_path = resolve_settlement_source_path(&source_path)?;
    let rows_per_sheet = normalize_rows_per_sheet(rows_per_sheet);
    tauri::async_runtime::spawn_blocking(move || {
        generate_settlement_statements_inner(
            source_path,
            PathBuf::from(settlement_path),
            PathBuf::from(output_dir),
            Some(app),
            rows_per_sheet,
        )
    })
    .await
    .map_err(|e| format!("生成结算单任务失败: {}", e))?
}

fn resolve_settlement_source_path(source_path: &str) -> Result<PathBuf, String> {
    let source_path = source_path.trim();
    if !source_path.is_empty() {
        return Ok(PathBuf::from(source_path));
    }
    Err("请选择渠道打款信息表".to_string())
}

fn normalize_rows_per_sheet(rows_per_sheet: Option<usize>) -> usize {
    match rows_per_sheet {
        Some(0) | None => 0,
        Some(n) => n.max(1),
    }
}

fn dated_settlement_output_dir(base_dir: &Path, date: NaiveDate) -> PathBuf {
    base_dir.join(date.format("%Y%m%d").to_string())
}

fn generate_settlement_statements_inner(
    source_path: PathBuf,
    settlement_path: PathBuf,
    output_dir: PathBuf,
    app: Option<tauri::AppHandle>,
    rows_per_sheet: usize,
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
    let files = generate_accounts_parallel(
        &accounts,
        &settlement_data,
        &output_dir,
        app.as_ref(),
        rows_per_sheet,
    )?;
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

pub(super) fn emit_settlement_progress(
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

#[cfg(test)]
mod tests {
    use super::*;
    use super::parse::{clean_cell, clean_text, parse_source_rows, read_first_sheet};
    use super::write::num_to_chinese;
    use calamine::Data;
    use rust_xlsxwriter::Workbook;
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
            6,
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
    fn empty_source_path_requires_payment_info_file() {
        let err = resolve_settlement_source_path("").unwrap_err();
        assert!(err.contains("请选择渠道打款信息表"));
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
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None, 6)
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
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None, 6)
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
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None, 6)
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
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None, 6)
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
            generate_settlement_statements_inner(source_path, settlement_path, output_dir, None, 6)
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
