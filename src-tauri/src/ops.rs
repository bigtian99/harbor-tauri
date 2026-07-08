use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const BATCH_PACK_URL: &str = "https://tksyadmin.tiankongshuyu.cn/channel/sub/batch-pack";
const OPS_LOGIN_URL: &str = "https://admintksy.tiankongshuyu.cn";
const OPS_LOGIN_WINDOW_LABEL: &str = "ops-login";
const OPS_AUTH_CAPTURE_SCRIPT: &str = r#"
(() => {
  const HOST = "admintksy.tiankongshuyu.cn";
  const LOGIN_API_HOST = "tksyadmin.tiankongshuyu.cn";
  const LOGIN_PATH = "/auth/login";
  const SUB_CHANNEL_PATH = "/alarm/channel/sub";
  const EVENT = "ops-auth-token-captured";
  if (window.__JARPORTER_OPS_AUTH_CAPTURED__) return;
  window.__JARPORTER_OPS_AUTH_CAPTURED__ = true;
  if (window.location.hostname !== HOST) return;

  function isLoginUrl(input) {
    try {
      const raw = typeof input === "string" ? input : input && input.url;
      const url = new URL(raw || "", window.location.href);
      return (url.hostname === HOST || url.hostname === LOGIN_API_HOST) && url.pathname.endsWith(LOGIN_PATH);
    } catch (_) {
      return false;
    }
  }

  function emitToken(token, force, subChannelIds) {
    if (!token || typeof token !== "string") return;
    if (!force && window.__JARPORTER_OPS_AUTH_TOKEN_SENT__) return;
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;
    window.__JARPORTER_OPS_AUTH_TOKEN_SENT__ = true;
    const payload = { token };
    if (Array.isArray(subChannelIds) && subChannelIds.length > 0) {
      payload.subChannelIds = subChannelIds;
    }
    invoke("plugin:event|emit_to", {
      target: { kind: "AnyLabel", label: "main" },
      event: EVENT,
      payload
    }).catch(() => {});
    return true;
  }

  function inspectLoginPayload(body) {
    try {
      const payload = typeof body === "string" ? JSON.parse(body) : body;
      const token = payload && payload.code === 200 && payload.data && payload.data.token;
      emitToken(token);
    } catch (_) {}
  }

  function syncTokenFromLocalStorage() {
    try {
      return emitToken(localStorage.getItem("token"), true, collectSelectedSubChannelIds());
    } catch (_) {
      return false;
    }
  }

  function collectSelectedSubChannelIds() {
    if (window.location.pathname !== SUB_CHANNEL_PATH) return [];
    const rows = Array.from(document.querySelectorAll(".el-table__body-wrapper tbody tr"));
    const ids = rows
      .filter((row) => row.querySelector(".el-checkbox__input.is-checked, .el-checkbox.is-checked, input[type=\"checkbox\"]:checked"))
      .map((row) => row.querySelector("td:nth-child(2) .cell")?.textContent?.trim())
      .filter((id) => id && /^\d+$/.test(id));
    return Array.from(new Set(ids));
  }

  function mountTokenSyncButton() {
    if (document.getElementById("__jarporter_ops_token_sync")) return;
    if (!document.body) {
      window.setTimeout(mountTokenSyncButton, 200);
      return;
    }

    const button = document.createElement("button");
    button.id = "__jarporter_ops_token_sync";
    button.type = "button";
    button.textContent = "同步";
    Object.assign(button.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "2147483647",
      padding: "10px 14px",
      border: "0",
      borderRadius: "8px",
      background: "rgb(31, 111, 235)",
      color: "white",
      fontSize: "13px",
      fontWeight: "600",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
      cursor: "pointer"
    });
    button.addEventListener("click", () => {
      const selectedIds = collectSelectedSubChannelIds();
      const synced = syncTokenFromLocalStorage();
      button.textContent = synced ? (selectedIds.length > 0 ? `已同步 ${selectedIds.length} 个ID` : "已同步") : "未找到 token";
      window.setTimeout(() => {
        button.textContent = "同步";
      }, 1600);
    });
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTokenSyncButton, { once: true });
  } else {
    mountTokenSyncButton();
  }

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (isLoginUrl(args[0])) {
        response.clone().text().then(inspectLoginPayload).catch(() => {});
      }
      return response;
    };
  }

  if (window.XMLHttpRequest) {
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__jarporterOpsLoginUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    window.XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener("load", function() {
        if (!isLoginUrl(this.__jarporterOpsLoginUrl)) return;
        inspectLoginPayload(this.responseType === "json" ? this.response : this.responseText);
      });
      return originalSend.apply(this, args);
    };
  }
})();
"#;

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

#[tauri::command]
pub async fn open_ops_login_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OPS_LOGIN_WINDOW_LABEL) {
        window.set_focus().map_err(|e| format!("聚焦登录窗口失败: {}", e))?;
        return Ok(());
    }

    let url: Url = OPS_LOGIN_URL
        .parse()
        .map_err(|e| format!("解析运营后台登录地址失败: {}", e))?;

    WebviewWindowBuilder::new(
        &app,
        OPS_LOGIN_WINDOW_LABEL,
        WebviewUrl::External(url),
    )
    .title("运营后台登录")
    .inner_size(1100.0, 760.0)
    .min_inner_size(900.0, 620.0)
    .center()
    .initialization_script(OPS_AUTH_CAPTURE_SCRIPT)
    .build()
    .map_err(|e| format!("打开运营后台登录窗口失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn close_ops_login_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OPS_LOGIN_WINDOW_LABEL) {
        window.close().map_err(|e| format!("关闭登录窗口失败: {}", e))?;
    }
    Ok(())
}
