//! 结算单生成：从渠道打款信息表 + 结算数据生成对账单 Excel。
//!
//! 模块划分：
//! - [`types`] — 领域类型
//! - [`orchestrate`] — Tauri 命令与主流程编排
//! - [`parse`] — Excel 读取与行解析
//! - [`write`] — 工作簿 / 工作表写入
//! - [`parallel`] — 并行账号生成与进度

mod orchestrate;
mod parallel;
mod parse;
mod types;
mod write;

pub use orchestrate::generate_settlement_statements;
#[allow(unused_imports)]
pub use types::SettlementGenerateResult;

#[cfg(test)]
mod tests {
    use super::orchestrate::{
        dated_settlement_output_dir, generate_settlement_statements_inner,
        resolve_settlement_source_path,
    };
    use super::parse::{clean_cell, clean_text, parse_source_rows, read_first_sheet};
    use super::write::num_to_chinese;
    use calamine::Data;
    use rust_xlsxwriter::Workbook;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

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
