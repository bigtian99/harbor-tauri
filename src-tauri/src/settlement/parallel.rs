//! 并行按账号生成结算单。

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};

use tauri::Emitter;

use super::{
    write::generate_account_workbook, AccountData, SettlementData, SettlementProgressPayload,
};

pub(super) fn generate_accounts_parallel(
    accounts: &[AccountData],
    settlement_data: &HashMap<String, Vec<SettlementData>>,
    output_dir: &Path,
    app: Option<&tauri::AppHandle>,
    rows_per_sheet: usize,
) -> Result<Vec<String>, String> {
    let workers = settlement_worker_count(accounts.len());
    let completed = Arc::new(AtomicUsize::new(0));
    if workers <= 1 {
        return accounts
            .iter()
            .map(|account| {
                generate_account_workbook(account, settlement_data, output_dir, rows_per_sheet).map(
                    |path| {
                        emit_account_progress(app, &completed, accounts.len(), account);
                        path.to_string_lossy().to_string()
                    },
                )
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
            handles.push(scope.spawn(move || -> Result<Vec<(usize, String)>, String> {
                let mut files = Vec::new();
                for (offset, account) in chunk.iter().enumerate() {
                    let file =
                        generate_account_workbook(account, settlement_data, output_dir, rows_per_sheet)?;
                    emit_account_progress(app.as_ref(), &completed, total, account);
                    files.push((start_index + offset, file.to_string_lossy().to_string()));
                }
                Ok(files)
            }));
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
