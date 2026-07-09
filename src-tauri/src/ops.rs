use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const OPS_API_BASE_URL: &str = "https://tksyadmin.tiankongshuyu.cn";
const SUB_CHANNEL_BATCH_PACK_PATH: &str = "/channel/sub/batch-pack";
const VEST_BATCH_REBUILD_PATH: &str = "/pack/vest/batch-rebuild";
const OPS_LOGIN_URL: &str = "https://admintksy.tiankongshuyu.cn";
const OPS_LOGIN_WINDOW_LABEL: &str = "ops-login";
const OPS_AUTH_CAPTURE_SCRIPT: &str = r#"
(() => {
  const HOST = "admintksy.tiankongshuyu.cn";
  const LOGIN_API_HOST = "tksyadmin.tiankongshuyu.cn";
  const LOGIN_PATH = "/auth/login";
  const SUB_CHANNEL_PATH = "/alarm/channel/sub";
  const VEST_LIST_PATH = "/pack/vest";
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

  function emitToken(token, force, ids, packType) {
    if (!token || typeof token !== "string") return;
    if (!force && window.__JARPORTER_OPS_AUTH_TOKEN_SENT__) return;
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;
    window.__JARPORTER_OPS_AUTH_TOKEN_SENT__ = true;
    const payload = { token };
    if (Array.isArray(ids) && ids.length > 0) {
      payload.ids = ids;
      if (packType) {
        payload.packType = packType;
      }
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
      if (token && typeof token === "string") {
        window.__JARPORTER_OPS_AUTH_LOGIN_TOKEN__ = token;
      }
    } catch (_) {}
  }

  function syncTokenFromLocalStorage() {
    try {
      const packType = currentPackType();
      return emitToken(localStorage.getItem("token") || window.__JARPORTER_OPS_AUTH_LOGIN_TOKEN__, true, collectSelectedIds(), packType);
    } catch (_) {
      return false;
    }
  }

  function currentPackType() {
    if (window.location.pathname === VEST_LIST_PATH) return "vest";
    if (window.location.pathname === SUB_CHANNEL_PATH) return "subChannel";
    return null;
  }

  function collectSelectedIds() {
    if (!currentPackType()) return [];
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
      const selectedIds = collectSelectedIds();
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

#[derive(Debug, Deserialize)]
struct BatchPackApiResponse {
    code: i64,
    message: String,
    data: Option<Value>,
    timestamp: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BatchPackType {
    SubChannel,
    Vest,
}

impl BatchPackType {
    fn from_input(value: Option<String>) -> Result<Self, String> {
        match value.as_deref().unwrap_or("subChannel") {
            "subChannel" => Ok(Self::SubChannel),
            "vest" => Ok(Self::Vest),
            other => Err(format!("不支持的打包加速类型: {}", other)),
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::SubChannel => SUB_CHANNEL_BATCH_PACK_PATH,
            Self::Vest => VEST_BATCH_REBUILD_PATH,
        }
    }

    fn id_label(self) -> &'static str {
        match self {
            Self::SubChannel => "子渠道 ID",
            Self::Vest => "马甲包 ID",
        }
    }

    fn payload(self, ids: Vec<String>, priority: i64) -> Value {
        match self {
            Self::SubChannel => json!({ "subChannelIds": ids, "priority": priority }),
            Self::Vest => json!({ "ids": ids, "priority": priority }),
        }
    }
}

#[tauri::command]
pub async fn batch_pack_sub_channels(
    authorization: String,
    ids: Vec<String>,
    priority: i64,
    pack_type: Option<String>,
) -> Result<BatchPackResult, String> {
    let authorization = authorization.trim().to_string();
    if authorization.is_empty() {
        return Err("Authorization 不能为空".to_string());
    }

    let pack_type = BatchPackType::from_input(pack_type)?;
    let ids: Vec<String> = ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if ids.is_empty() {
        return Err(format!("{} 不能为空", pack_type.id_label()));
    }

    let url = format!("{}{}", OPS_API_BASE_URL, pack_type.path());
    let payload = pack_type.payload(ids, priority);
    let response = reqwest::Client::new()
        .put(url)
        .header(AUTHORIZATION, authorization)
        .header(ACCEPT, "application/json, text/plain, */*")
        .header(CONTENT_TYPE, "application/json")
        .json(&payload)
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
