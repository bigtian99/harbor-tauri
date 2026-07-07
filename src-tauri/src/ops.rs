use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const BATCH_PACK_URL: &str = "https://tksyadmin.tiankongshuyu.cn/channel/sub/batch-pack";

#[derive(Debug, Serialize)]
pub struct BatchPackResult {
    code: i64,
    message: String,
    data: Option<Value>,
    timestamp: Option<String>,
    unauthorized: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchPackPayload {
    sub_channel_ids: Vec<String>,
    priority: i64,
}

#[derive(Debug, Deserialize)]
struct BatchPackApiResponse {
    code: i64,
    message: String,
    data: Option<Value>,
    timestamp: Option<String>,
}

#[tauri::command]
pub async fn batch_pack_sub_channels(
    authorization: String,
    sub_channel_ids: Vec<String>,
    priority: i64,
) -> Result<BatchPackResult, String> {
    let authorization = authorization.trim().to_string();
    if authorization.is_empty() {
        return Err("Authorization 不能为空".to_string());
    }

    let sub_channel_ids: Vec<String> = sub_channel_ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if sub_channel_ids.is_empty() {
        return Err("子渠道 ID 不能为空".to_string());
    }

    let response = reqwest::Client::new()
        .put(BATCH_PACK_URL)
        .header(AUTHORIZATION, authorization)
        .header(ACCEPT, "application/json, text/plain, */*")
        .header(CONTENT_TYPE, "application/json")
        .json(&BatchPackPayload {
            sub_channel_ids,
            priority,
        })
        .send()
        .await
        .map_err(|e| format!("请求打包加速接口失败: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取打包加速响应失败: {}", e))?;

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(BatchPackResult {
            code: 401,
            message: "Authorization 已失效，请重新获取 token".to_string(),
            data: None,
            timestamp: None,
            unauthorized: true,
        });
    }

    let parsed: BatchPackApiResponse = serde_json::from_str(&text).map_err(|e| {
        format!(
            "解析打包加速响应失败(status={}): {}\n{}",
            status.as_u16(),
            e,
            text
        )
    })?;
    let unauthorized = parsed.code == 401;

    Ok(BatchPackResult {
        code: parsed.code,
        message: parsed.message,
        data: parsed.data,
        timestamp: parsed.timestamp,
        unauthorized,
    })
}
