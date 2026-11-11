use rusqlite::{Connection, params};
use std::path::PathBuf;

/// 获取数据库文件路径
fn db_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("jarporter");
    config_dir.join("data.db")
}

/// 初始化数据库表结构
pub(crate) fn init_db() -> Result<(), String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {}", e))?;
    }
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {}", e))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS jar_port_map (
            jar_name TEXT PRIMARY KEY,
            port TEXT NOT NULL
        );
        -- 荣耀回传台账：分批次回传时靠它避免同一设备重复上报
        CREATE TABLE IF NOT EXISTS honor_report_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day TEXT NOT NULL,
            account_pk TEXT NOT NULL,
            oaid TEXT NOT NULL,
            track_id TEXT NOT NULL,
            event TEXT NOT NULL,
            conversion_time_ms INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_honor_report_unique
            ON honor_report_log (day, account_pk, oaid, event);
        CREATE INDEX IF NOT EXISTS idx_honor_report_day_account
            ON honor_report_log (day, account_pk);"
    ).map_err(|e| format!("初始化数据库表失败: {}", e))?;
    Ok(())
}

pub(crate) fn get_conn() -> Result<Connection, String> {
    let path = db_path();
    Connection::open(&path).map_err(|e| format!("打开数据库失败: {}", e))
}

/// 获取 JAR 端口映射
#[tauri::command]
pub(crate) fn get_jar_port(jar_name: String) -> Result<Option<String>, String> {
    let conn = get_conn()?;
    let mut stmt = conn.prepare("SELECT port FROM jar_port_map WHERE jar_name = ?1")
        .map_err(|e| format!("查询失败: {}", e))?;
    let result = stmt.query_row(params![jar_name], |row| {
        row.get::<_, String>(0)
    });
    match result {
        Ok(port) => Ok(Some(port)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("查询端口失败: {}", e)),
    }
}

/// 保存 JAR 端口映射
#[tauri::command]
pub(crate) fn save_jar_port(jar_name: String, port: String) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute(
        "INSERT INTO jar_port_map (jar_name, port) VALUES (?1, ?2)
         ON CONFLICT(jar_name) DO UPDATE SET port = excluded.port",
        params![jar_name, port],
    ).map_err(|e| format!("保存端口映射失败: {}", e))?;
    Ok(())
}

/// 某天某账户已经回传过的设备（oaid 集合）。分批次回传时用来排除已上报设备。
pub(crate) fn honor_reported_oaids(account_pk: &str, day: &str) -> Result<Vec<String>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT oaid FROM honor_report_log
             WHERE account_pk = ?1 AND day = ?2 AND status <> 'failed'",
        )
        .map_err(|e| format!("查询回传台账失败: {}", e))?;
    let rows = stmt
        .query_map(params![account_pk, day], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询回传台账失败: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("读取回传台账失败: {}", e))?);
    }
    Ok(out)
}

/// 写入一条回传记录；同一天同一账户同一设备的同一事件重复写入时忽略（唯一索引兜底）。
pub(crate) fn honor_log_report(
    account_pk: &str,
    day: &str,
    oaid: &str,
    track_id: &str,
    event: &str,
    conversion_time_ms: i64,
    status: &str,
) -> Result<(), String> {
    let conn = get_conn()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO honor_report_log
            (day, account_pk, oaid, track_id, event, conversion_time_ms, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(day, account_pk, oaid, event) DO UPDATE SET
            track_id = excluded.track_id,
            conversion_time_ms = excluded.conversion_time_ms,
            status = excluded.status,
            created_at = excluded.created_at",
        params![
            day,
            account_pk,
            oaid,
            track_id,
            event,
            conversion_time_ms,
            status,
            now
        ],
    )
    .map_err(|e| format!("写入回传台账失败: {}", e))?;
    Ok(())
}

/// 某天某账户已回传的设备数（去重）与事件数，供界面展示
pub(crate) fn honor_report_tally(account_pk: &str, day: &str) -> Result<(u32, u32), String> {
    let conn = get_conn()?;
    let (devices, events): (u32, u32) = conn
        .query_row(
            "SELECT COUNT(DISTINCT oaid), COUNT(*) FROM honor_report_log
             WHERE account_pk = ?1 AND day = ?2 AND status <> 'failed'",
            params![account_pk, day],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("统计回传台账失败: {}", e))?;
    Ok((devices, events))
}
