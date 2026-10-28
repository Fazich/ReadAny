pub mod schema;

use crate::storage;
use anyhow::Result;
use tauri::{AppHandle, Manager};

#[derive(serde::Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCheck {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
    expected_rows: Vec<serde_json::Value>,
}

fn sql_params(values: Vec<serde_json::Value>) -> Result<Vec<rusqlite::types::Value>> {
    values.into_iter().map(|value| match value {
        serde_json::Value::Null => Ok(rusqlite::types::Value::Null),
        serde_json::Value::String(value) => Ok(rusqlite::types::Value::Text(value)),
        serde_json::Value::Bool(value) => Ok(rusqlite::types::Value::Integer(value as i64)),
        serde_json::Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(rusqlite::types::Value::Integer(value))
            } else {
                value.as_f64().map(rusqlite::types::Value::Real)
                    .ok_or_else(|| anyhow::anyhow!("Invalid SQL number"))
            }
        }
        _ => Err(anyhow::anyhow!("SQL parameters must be scalar values")),
    }).collect()
}

fn execute_batch(
    conn: &mut rusqlite::Connection,
    statements: Vec<Statement>,
    checks: Vec<SnapshotCheck>,
) -> Result<()> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    for check in checks {
        let mut statement = tx.prepare(&check.sql)?;
        let columns: Vec<String> = statement.column_names().iter().map(|name| name.to_string()).collect();
        let rows = statement.query_map(rusqlite::params_from_iter(sql_params(check.params)?), |row| {
            let mut object = serde_json::Map::new();
            for (index, name) in columns.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => value.into(),
                    rusqlite::types::ValueRef::Real(value) => value.into(),
                    rusqlite::types::ValueRef::Text(value) => String::from_utf8_lossy(value).into_owned().into(),
                    rusqlite::types::ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidQuery),
                };
                object.insert(name.clone(), value);
            }
            Ok(serde_json::Value::Object(object))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        if rows != check.expected_rows {
            anyhow::bail!("Database changed while editing; retry the operation");
        }
    }
    for statement in statements {
        let params = sql_params(statement.params)?;
        tx.execute(&statement.sql, rusqlite::params_from_iter(params))?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub async fn database_batch(
    app: AppHandle,
    path: String,
    statements: Vec<Statement>,
    checks: Option<Vec<SnapshotCheck>>,
) -> Result<(), String> {
    let path = path.strip_prefix("sqlite:").unwrap_or(&path);
    let path = std::path::PathBuf::from(path);
    let path = if path.is_absolute() { path } else {
        app.path().app_config_dir().map_err(|e| e.to_string())?.join(path)
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let mut conn = rusqlite::Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(15))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        execute_batch(&mut conn, statements, checks.unwrap_or_default())
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_rejects_changed_snapshot_and_preserves_concurrent_insert() {
        let path = std::env::temp_dir().join(format!("readany-db-check-{}.sqlite", uuid::Uuid::new_v4()));
        let mut conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT);
            INSERT INTO messages VALUES ('old', 'original');").unwrap();
        let other = rusqlite::Connection::open(&path).unwrap();
        other.execute("INSERT INTO messages VALUES ('late', 'late answer')", []).unwrap();
        let check = SnapshotCheck {
            sql: "SELECT * FROM messages ORDER BY rowid".into(),
            params: vec![],
            expected_rows: vec![serde_json::json!({"id": "old", "content": "original"})],
        };
        let error = execute_batch(&mut conn, vec![
            Statement { sql: "DELETE FROM messages".into(), params: vec![] },
        ], vec![check]).unwrap_err();
        assert!(error.to_string().contains("Database changed while editing"));
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);
        drop(other);
        drop(conn);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn batch_accepts_snapshot_regardless_of_object_key_order() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT);
            INSERT INTO messages VALUES ('old', 'original');").unwrap();
        execute_batch(&mut conn, vec![
            Statement { sql: "UPDATE messages SET content = ? WHERE id = ?".into(), params: vec!["edited".into(), "old".into()] },
        ], vec![SnapshotCheck {
            sql: "SELECT * FROM messages WHERE id = ?".into(),
            params: vec!["old".into()],
            expected_rows: vec![serde_json::json!({"content": "original", "id": "old"})],
        }]).unwrap();
        let content: String = conn.query_row("SELECT content FROM messages", [], |row| row.get(0)).unwrap();
        assert_eq!(content, "edited");
    }

    #[test]
    fn batch_rolls_back_all_writes_on_failure() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT);
            INSERT INTO messages VALUES ('old', 'original');").unwrap();
        let statements = vec![
            Statement { sql: "DELETE FROM messages".into(), params: vec![] },
            Statement { sql: "INSERT INTO messages VALUES (?, ?)".into(), params: vec!["new".into(), "edited".into()] },
            Statement { sql: "INSERT INTO missing VALUES (1)".into(), params: vec![] },
        ];
        assert!(execute_batch(&mut conn, statements, vec![]).is_err());
        let content: String = conn.query_row("SELECT content FROM messages", [], |row| row.get(0)).unwrap();
        assert_eq!(content, "original");
    }
}

/// Initialize the SQLite database synchronously (called in setup before frontend loads)
pub fn init_database_sync(app: &AppHandle) -> Result<()> {
    let app_dir = storage::resolve_data_root(app).expect("failed to resolve data root");
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("readany.db");
    schema::initialize(&db_path)?;

    Ok(())
}
