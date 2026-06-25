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
        );"
    ).map_err(|e| format!("初始化数据库表失败: {}", e))?;
    Ok(())
}

fn get_conn() -> Result<Connection, String> {
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
