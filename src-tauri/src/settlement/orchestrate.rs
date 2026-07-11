//! 结算单生成编排：路径解析、进度事件与主流程。

use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{Local, NaiveDate};
use tauri::Emitter;

use super::parse::{
    group_by_account, parse_settlement_rows, parse_source_rows, read_first_sheet,
};
use super::parallel::generate_accounts_parallel;
use super::types::{SettlementGenerateResult, SettlementProgressPayload};

/// 对外 Tauri 命令：异步包装阻塞生成流程。
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

pub(super) fn resolve_settlement_source_path(source_path: &str) -> Result<PathBuf, String> {
    let source_path = source_path.trim();
    if !source_path.is_empty() {
        return Ok(PathBuf::from(source_path));
    }
    Err("请选择渠道打款信息表".to_string())
}

pub(super) fn normalize_rows_per_sheet(rows_per_sheet: Option<usize>) -> usize {
    match rows_per_sheet {
        Some(0) | None => 0,
        Some(n) => n.max(1),
    }
}

pub(super) fn dated_settlement_output_dir(base_dir: &Path, date: NaiveDate) -> PathBuf {
    base_dir.join(date.format("%Y%m%d").to_string())
}

pub(super) fn generate_settlement_statements_inner(
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
