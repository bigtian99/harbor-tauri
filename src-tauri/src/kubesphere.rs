//! KubeSphere 控制台 API 客户端
//!
//! 集成「修改 Deployment 镜像并发布」能力：
//!   1. 登录（复刻控制台前端自定义加密，Cookie 会话）
//!   2. 会话落盘 + refreshToken 自动续期（按环境缓存，避免每次重登）
//!   3. 命名空间 / 部署列表（含实时状态，按新/旧 ReplicaSet 分组）
//!   4. strategic-merge-patch 改镜像触发滚动发布

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use reqwest::header::{HeaderMap, SET_COOKIE};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const ENCRYPT_KEY: &str = "kubesphere";
/// expire 剩余不足此时长则主动 refresh（秒）
const REFRESH_AHEAD_SECS: i64 = 300;
/// 连接/探测：建连超时（避免网关挂起时 UI 长时间假死）
const CONNECT_TIMEOUT_SECS: u64 = 5;
/// 普通 API：整请求超时（列表已改为命名空间级批量，单次请求应很快返回）
const REQUEST_TIMEOUT_SECS: u64 = 15;
/// 命名空间级列表 limit（避免 continue 分页；超限时打诊断日志）
const LIST_LIMIT_DEPLOY: u32 = 200;
const LIST_LIMIT_RS: u32 = 500;
const LIST_LIMIT_POD: u32 = 500;
const LIST_LIMIT_CM: u32 = 200;

/// 网关/上游不可用：不应丢弃本地会话，也不应强制密码重登
fn is_infra_http(status: u16) -> bool {
    matches!(status, 500 | 502 | 503 | 504)
}

fn console_unreachable_msg(kind: &str, detail: &str) -> String {
    format!(
        "控制台暂时不可用（{kind}）。本地会话已保留，请稍后重试，不会强制重新登录。\n{detail}"
    )
}

/// 当前登录会话（进程内缓存）
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Clone)]
struct Session {
    env_id: String,
    console: String,
    username: String,
    cookie: String, // "token=..; refreshToken=..; expire=.."
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct SessionStore {
    /// key = env_id
    sessions: HashMap<String, PersistedSession>,
}

#[derive(Serialize, Deserialize, Clone)]
struct PersistedSession {
    env_id: String,
    console: String,
    username: String,
    cookie: String,
    updated_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KsConnectResult {
    /// cached | refreshed | login
    pub mode: String,
    pub message: String,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn session_store_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    config_dir.join(crate::models::APP_CONFIG_DIR).join("ks-sessions.json")
}

fn load_session_store() -> SessionStore {
    let path = session_store_path();
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => SessionStore::default(),
    }
}

fn save_session_store(store: &SessionStore) -> Result<(), String> {
    let path = session_store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建会话目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(store).map_err(|e| format!("序列化会话失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入会话缓存失败: {e}"))
}

fn cookie_map(cookie: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for part in cookie.split(';') {
        let part = part.trim();
        if let Some(eq) = part.find('=') {
            map.insert(part[..eq].trim().to_string(), part[eq + 1..].trim().to_string());
        }
    }
    map
}

fn cookie_get(cookie: &str, key: &str) -> Option<String> {
    cookie_map(cookie).get(key).cloned()
}

fn build_cookie(token: &str, refresh: Option<&str>, expire: Option<&str>) -> String {
    let mut parts = vec![format!("token={token}")];
    if let Some(r) = refresh.filter(|s| !s.is_empty()) {
        parts.push(format!("refreshToken={r}"));
    }
    if let Some(e) = expire.filter(|s| !s.is_empty()) {
        parts.push(format!("expire={e}"));
    }
    parts.join("; ")
}

/// expire Cookie 多为 unix 秒；解析失败视为需要续期
fn cookie_expire_unix(cookie: &str) -> Option<i64> {
    let exp = cookie_get(cookie, "expire")?;
    if let Ok(v) = exp.parse::<i64>() {
        // 兼容毫秒时间戳
        return Some(if v > 10_000_000_000 { v / 1000 } else { v });
    }
    None
}

fn needs_refresh(cookie: &str) -> bool {
    match cookie_expire_unix(cookie) {
        Some(exp) => exp - now_unix() <= REFRESH_AHEAD_SECS,
        None => true,
    }
}

fn persist_session(sess: &Session) {
    let mut store = load_session_store();
    store.sessions.insert(
        sess.env_id.clone(),
        PersistedSession {
            env_id: sess.env_id.clone(),
            console: sess.console.clone(),
            username: sess.username.clone(),
            cookie: sess.cookie.clone(),
            updated_at: now_unix(),
        },
    );
    if let Err(e) = save_session_store(&store) {
        crate::diag::diag_log("kubesphere", &format!("persist_session warn: {e}"));
    }
}

fn clear_persisted(env_id: Option<&str>) {
    let mut store = load_session_store();
    if let Some(id) = env_id {
        store.sessions.remove(id);
    } else {
        store.sessions.clear();
    }
    let _ = save_session_store(&store);
}

fn set_memory_session(sess: Session) -> Result<(), String> {
    let mut guard = SESSION.lock().map_err(|_| "会话锁不可用".to_string())?;
    *guard = Some(sess);
    Ok(())
}

fn clone_memory_session() -> Result<Session, String> {
    let guard = SESSION.lock().map_err(|_| "会话锁不可用".to_string())?;
    guard.as_ref().cloned().ok_or_else(|| "请先连接 KubeSphere（登录）".to_string())
}

/// 从本地配置取当前环境的密码，用于 refresh 失败后无感重登
fn password_for_session(sess: &Session) -> Result<String, String> {
    let config = crate::config_cmd::load_config_sync()?;
    let env = config
        .ks_environments
        .iter()
        .find(|e| e.id == sess.env_id)
        .or_else(|| {
            // 兼容旧单环境 / 控制台地址匹配
            config.ks_environments.iter().find(|e| {
                e.console.trim_end_matches('/') == sess.console.trim_end_matches('/')
                    && e.username.trim() == sess.username.trim()
            })
        });
    let Some(env) = env else {
        return Err(format!(
            "会话已失效且配置中找不到环境「{}」，请到 系统设置 → KubeSphere 检查",
            sess.env_id
        ));
    };
    let password = env.password.trim();
    if password.is_empty() {
        let label = if env.name.trim().is_empty() {
            sess.env_id.as_str()
        } else {
            env.name.as_str()
        };
        return Err(format!(
            "会话已失效且环境「{label}」未保存密码，无法自动重登"
        ));
    }
    Ok(password.to_string())
}

/// refreshToken 续期；失败则用配置密码重新登录（UI 保持「已连接」）
fn recover_session_after_401(sess: &Session) -> Result<(Session, &'static str), String> {
    match refresh_session(sess) {
        Ok(new_sess) => {
            persist_session(&new_sess);
            set_memory_session(new_sess.clone())?;
            return Ok((new_sess, "refreshed"));
        }
        Err(e) => {
            if e.contains("控制台暂时不可用") {
                return Err(e);
            }
            crate::diag::diag_log(
                "kubesphere",
                &format!("ks recover: refresh fail → try password relogin: {e}"),
            );
        }
    }

    let password = password_for_session(sess)?;
    let (base, cookie) = login(&sess.console, &sess.username, &password).map_err(|e| {
        crate::diag::diag_log("kubesphere", &format!("ks recover: password relogin fail: {e}"));
        format!("会话已失效，自动重登失败：{e}")
    })?;
    let new_sess = Session {
        env_id: sess.env_id.clone(),
        console: base,
        username: sess.username.clone(),
        cookie,
    };
    persist_session(&new_sess);
    set_memory_session(new_sess.clone())?;
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks recover: password relogin ok env={}", new_sess.env_id),
    );
    Ok((new_sess, "relogin"))
}

// ---------------------------------------------------------------------------
// 登录加密（复刻控制台前端 encrypt 函数）
//   encrypt = Base64(奇偶位串) + "@" + 字符串
//   JS: t=Base64(password); e=key 补长; 逐字符 l=charCode(e)+charCode(t); parity + char(l/2)
// ---------------------------------------------------------------------------
fn ks_encrypt(key: &str, password: &str) -> String {
    let t = B64.encode(password.as_bytes());
    let mut e = key.to_string();
    if t.len() > e.len() {
        e.push_str(&t[..t.len() - e.len()]);
    }
    let tb = t.as_bytes();
    let eb = e.as_bytes();
    let mut parity = String::with_capacity(eb.len());
    let mut chars = String::with_capacity(eb.len());
    for (o, &ec) in eb.iter().enumerate() {
        let i = if o < tb.len() { tb[o] as u32 } else { 64 }; // 64 = '@'
        let l = ec as u32 + i;
        parity.push(if l % 2 == 0 { '0' } else { '1' });
        if let Some(c) = char::from_u32(l / 2) {
            chars.push(c);
        }
    }
    format!("{}@{}", B64.encode(parity.as_bytes()), chars)
}

fn parse_set_cookies(headers: &HeaderMap) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for v in headers.get_all(SET_COOKIE) {
        if let Ok(s) = v.to_str() {
            let name = s.split(';').next().unwrap_or("").trim();
            if let Some(eq) = name.find('=') {
                map.insert(name[..eq].trim().to_string(), name[eq + 1..].trim().to_string());
            }
        }
    }
    map
}

fn http_client() -> Result<&'static reqwest::blocking::Client, String> {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    Ok(CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            // 禁用跟随：过期 Cookie 常 302/401→/login，跟随后变成 200 HTML，会被误判为会话有效
            .redirect(reqwest::redirect::Policy::none())
            .pool_max_idle_per_host(8)
            .build()
            .expect("HTTP 客户端创建失败")
    }))
}

fn login_http_client() -> Result<&'static reqwest::blocking::Client, String> {
    // 禁用重定向：login 可能返回 302，Set-Cookie 在首个响应上，跟随重定向会丢失
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    Ok(CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::none())
            .pool_max_idle_per_host(2)
            .build()
            .expect("HTTP 客户端创建失败")
    }))
}

fn login(console: &str, username: &str, password: &str) -> Result<(String, String), String> {
    let client = login_http_client()?;
    let base = console.trim_end_matches('/');
    let body = serde_json::json!({ "username": username, "encrypt": ks_encrypt(ENCRYPT_KEY, password) });
    let resp = client
        .post(format!("{base}/login"))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .map_err(|e| {
            console_unreachable_msg("登录网络错误", &format!("登录请求失败: {e}"))
        })?;
    let status = resp.status().as_u16();
    let cookies = parse_set_cookies(resp.headers());
    if !cookies.contains_key("token") {
        let body_snippet = resp.text().unwrap_or_default();
        let snippet: String = body_snippet.chars().take(200).collect();
        if is_infra_http(status) {
            return Err(console_unreachable_msg(
                &format!("登录 HTTP {status}"),
                &format!("响应: {snippet}"),
            ));
        }
        return Err(format!(
            "登录失败：未获得 token Cookie（HTTP {status}）\n响应: {snippet}"
        ));
    }
    let cookie = ["token", "refreshToken", "expire"]
        .iter()
        .filter_map(|k| cookies.get(*k).map(|v| format!("{k}={v}")))
        .collect::<Vec<_>>()
        .join("; ");
    Ok((base.to_string(), cookie))
}

/// 用 refreshToken 换新 access token，更新 Cookie
fn refresh_session(sess: &Session) -> Result<Session, String> {
    let refresh = cookie_get(&sess.cookie, "refreshToken")
        .ok_or_else(|| "会话无 refreshToken，无法续期".to_string())?;
    let client = login_http_client()?;
    let url = format!("{}/oauth/token", sess.console.trim_end_matches('/'));
    let form = [
        ("grant_type", "refresh_token"),
        ("client_id", "kubesphere"),
        ("client_secret", "kubesphere"),
        ("refresh_token", refresh.as_str()),
    ];
    let resp = client
        .post(&url)
        .header("Accept", "application/json")
        .header("Cookie", &sess.cookie)
        .form(&form)
        .send()
        .map_err(|e| {
            console_unreachable_msg("续期网络错误", &format!("续期请求失败: {e}"))
        })?;
    let status = resp.status().as_u16();
    let set_cookies = parse_set_cookies(resp.headers());
    let text = resp.text().unwrap_or_default();

    if is_infra_http(status) {
        let snippet: String = text.chars().take(120).collect();
        return Err(console_unreachable_msg(
            &format!("续期 HTTP {status}"),
            &format!("响应: {snippet}"),
        ));
    }

    // 优先吃 Set-Cookie（部分版本）
    if set_cookies.contains_key("token") {
        let cookie = ["token", "refreshToken", "expire"]
            .iter()
            .filter_map(|k| {
                set_cookies
                    .get(*k)
                    .cloned()
                    .or_else(|| cookie_get(&sess.cookie, k))
                    .map(|v| format!("{k}={v}"))
            })
            .collect::<Vec<_>>()
            .join("; ");
        return Ok(Session {
            env_id: sess.env_id.clone(),
            console: sess.console.clone(),
            username: sess.username.clone(),
            cookie,
        });
    }

    // 常见：JSON access_token / refresh_token / expires_in
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            let snippet: String = text.chars().take(180).collect();
            format!("续期失败 HTTP {status}：未拿到 access_token\n响应: {snippet}")
        })?;
    let new_refresh = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh.as_str());
    let expires_in = json.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(7200);
    let expire = (now_unix() + expires_in.max(60)).to_string();
    Ok(Session {
        env_id: sess.env_id.clone(),
        console: sess.console.clone(),
        username: sess.username.clone(),
        cookie: build_cookie(access, Some(new_refresh), Some(&expire)),
    })
}

fn probe_session(sess: &Session) -> Result<u16, String> {
    // 走与业务相同的客户端（不跟随重定向），并校验 body 真是 NamespaceList
    let (status, json) = ks_api_raw_with(sess, "GET", "/api/v1/namespaces?limit=1", None, None)?;
    if status == 200 {
        let Some(items) = json.pointer("/items").and_then(|v| v.as_array()) else {
            crate::diag::diag_log(
                "kubesphere",
                "ks_connect probe 200 但无 items（多为登录页 HTML）→ 视为未授权",
            );
            return Ok(401);
        };
        // 正常集群至少有 default/kube-system；空列表几乎总是鉴权失败被吞掉
        if items.is_empty() {
            crate::diag::diag_log(
                "kubesphere",
                "ks_connect probe NamespaceList 为空 → 视为未授权",
            );
            return Ok(401);
        }
    }
    // 302/303/307 等同未授权（网关把过期会话踢去登录页）
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
        crate::diag::diag_log(
            "kubesphere",
            &format!("ks_connect probe HTTP {status} redirect → 视为未授权"),
        );
        return Ok(401);
    }
    Ok(status)
}

fn try_use_cached_or_refresh(env_id: &str, console: &str, username: &str) -> Result<Option<String>, String> {
    let store = load_session_store();
    let Some(saved) = store.sessions.get(env_id) else {
        return Ok(None);
    };
    let base = console.trim_end_matches('/');
    if saved.console.trim_end_matches('/') != base || saved.username != username {
        crate::diag::diag_log(
            "kubesphere",
            "ks_connect cache miss: console/username 与缓存不一致，忽略",
        );
        return Ok(None);
    }
    let sess = Session {
        env_id: env_id.to_string(),
        console: base.to_string(),
        username: username.to_string(),
        cookie: saved.cookie.clone(),
    };

    if needs_refresh(&sess.cookie) {
        crate::diag::diag_log("kubesphere", "ks_connect cache near expiry → refresh");
        match refresh_session(&sess) {
            Ok(new_sess) => {
                persist_session(&new_sess);
                set_memory_session(new_sess)?;
                return Ok(Some("refreshed".into()));
            }
            Err(e) => {
                // 网关挂了：保留会话，禁止落到密码登录
                if e.contains("控制台暂时不可用") {
                    return Err(e);
                }
                // refreshToken 失效常见表现：302 / 未拿到 access_token
                // 继续用旧 Cookie probe；若也失效则走下方 401 分支强制重登
                crate::diag::diag_log("kubesphere", &format!("ks_connect refresh fail: {e}"));
            }
        }
    }

    match probe_session(&sess) {
        Ok(200) => {
            set_memory_session(sess.clone())?;
            Ok(Some("cached".into()))
        }
        Ok(401) | Ok(403) => {
            crate::diag::diag_log("kubesphere", "ks_connect probe unauthorized → refresh");
            match refresh_session(&sess) {
                Ok(new_sess) => {
                    let status = probe_session(&new_sess)?;
                    if status == 200 {
                        persist_session(&new_sess);
                        set_memory_session(new_sess)?;
                        return Ok(Some("refreshed".into()));
                    }
                    if is_infra_http(status) {
                        return Err(console_unreachable_msg(
                            &format!("续期后探测 HTTP {status}"),
                            "会话已保留",
                        ));
                    }
                    Err(format!("续期后探测仍失败 HTTP {status}"))
                }
                Err(e) => {
                    if e.contains("控制台暂时不可用") {
                        return Err(e);
                    }
                    clear_persisted(Some(env_id));
                    crate::diag::diag_log("kubesphere", &format!("ks_connect refresh after 401 fail: {e}"));
                    Ok(None)
                }
            }
        }
        Ok(status) if is_infra_http(status) => {
            crate::diag::diag_log(
                "kubesphere",
                &format!("ks_connect probe HTTP {status}，保留会话、不强制重登"),
            );
            Err(console_unreachable_msg(
                &format!("探测 HTTP {status}"),
                "会话已保留",
            ))
        }
        Ok(status) => {
            crate::diag::diag_log("kubesphere", &format!("ks_connect probe HTTP {status}，放弃缓存"));
            Ok(None)
        }
        Err(e) => {
            crate::diag::diag_log("kubesphere", &format!("ks_connect probe err: {e}"));
            Err(console_unreachable_msg("探测网络错误", &e))
        }
    }
}

/// 同源 API 调用（Cookie 认证），原始 body（可传 YAML/JSON 文本）
fn ks_api_raw(
    method: &str,
    path: &str,
    body: Option<String>,
    content_type: Option<&str>,
) -> Result<(u16, serde_json::Value), String> {
    let sess = clone_memory_session()?;
    let result = ks_api_raw_with(&sess, method, path, body.clone(), content_type)?;
    // 401：refresh → 失败则密码重登 → 再重试一次（前端保持「已连接」）
    if result.0 != 401 {
        return Ok(result);
    }
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_api 401 {method} {path} → recover session"),
    );
    let (new_sess, mode) = recover_session_after_401(&sess)?;
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_api recover mode={mode} → retry {method} {path}"),
    );
    let retry = ks_api_raw_with(&new_sess, method, path, body.clone(), content_type)?;
    // refresh 成功但 token 仍无效时，再尝试密码重登一次
    if retry.0 == 401 && mode == "refreshed" {
        crate::diag::diag_log(
            "kubesphere",
            &format!("ks_api still 401 after refresh → password relogin {method} {path}"),
        );
        let password = password_for_session(&new_sess)?;
        let (base, cookie) = login(&new_sess.console, &new_sess.username, &password)?;
        let relogin = Session {
            env_id: new_sess.env_id.clone(),
            console: base,
            username: new_sess.username.clone(),
            cookie,
        };
        persist_session(&relogin);
        set_memory_session(relogin.clone())?;
        return ks_api_raw_with(&relogin, method, path, body, content_type);
    }
    Ok(retry)
}

fn ks_api_raw_with(
    sess: &Session,
    method: &str,
    path: &str,
    body: Option<String>,
    content_type: Option<&str>,
) -> Result<(u16, serde_json::Value), String> {
    let client = http_client()?;
    let url = format!("{}{}", sess.console, path);
    let mut req = match method {
        "GET" => client.get(&url),
        "POST" => {
            let mut r = client.post(&url);
            if let Some(b) = &body {
                r = r
                    .header("Content-Type", content_type.unwrap_or("application/json"))
                    .body(b.clone());
            }
            r
        }
        "PATCH" => {
            let mut r = client.patch(&url);
            if let Some(b) = &body {
                r = r
                    .header("Content-Type", content_type.unwrap_or("application/strategic-merge-patch+json"))
                    .body(b.clone());
            }
            r
        }
        _ => return Err(format!("不支持的方法: {method}")),
    };
    req = req
        .header("Accept", "application/json")
        .header("Cookie", &sess.cookie);
    let resp = req.send().map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().unwrap_or_default();
    // 302→登录页 或 HTML：不要当成成功 JSON（否则命名空间会解析成 0 条）
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
        return Ok((401, serde_json::Value::Null));
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok((status, serde_json::Value::Null));
    }
    match serde_json::from_str(trimmed) {
        Ok(json) => Ok((status, json)),
        Err(_) => {
            if status == 200 {
                let snippet: String = trimmed.chars().take(80).collect();
                crate::diag::diag_log(
                    "kubesphere",
                    &format!("ks_api non-json body status=200 path={path} snippet={snippet}"),
                );
                // 伪 200（登录 HTML 等）按未授权处理，触发上层续期/重登
                return Ok((401, serde_json::Value::Null));
            }
            Ok((status, serde_json::Value::Null))
        }
    }
}

/// JSON body 版（沿用旧调用方）
fn ks_api(method: &str, path: &str, body: Option<serde_json::Value>) -> Result<(u16, serde_json::Value), String> {
    ks_api_raw(method, path, body.map(|b| b.to_string()), None)
}

// ---------------------------------------------------------------------------
// 数据模型（与前端 TS interface 对应，camelCase）
// ---------------------------------------------------------------------------
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PodInfo {
    pub name: String,
    pub phase: String,
    pub state: String,   // running / waiting / unknown
    pub reason: Option<String>,
    pub restarts: u32,
    pub ready: u32,
    pub total: u32,
    pub start_time: String,
    pub node: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeployStatus {
    pub state: String,   // running/updating/pull/crash/creating/stopped/pending
    pub label: String,
    pub reason: Option<String>,
    pub detail: String,
    pub old: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PodsGroup {
    #[serde(rename = "new")]
    pub new_pods: Vec<PodInfo>,
    #[serde(rename = "old")]
    pub old_pods: Vec<PodInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeployInfo {
    pub name: String,
    /// KubeSphere 显示名（kubesphere.io/alias-name）
    pub alias: String,
    pub image: String,
    pub containers: Vec<String>,
    /// 容器端口（containerPort，去重排序）
    pub ports: Vec<u16>,
    pub status: DeployStatus,
    pub pods: PodsGroup,
    pub revision: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub ok: bool,
    pub old_image: String,
    pub new_image: String,
    pub revision: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RevisionImage {
    pub name: String,
    pub image: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeployRevision {
    pub revision: String,
    pub image: String,
    pub containers: Vec<RevisionImage>,
    pub replicas: u32,
    pub ready: u32,
    pub created_at: String,
    pub is_current: bool,
}

// ---------------------------------------------------------------------------
// 状态汇总（新版本 Pod 优先；旧版本作为次要信息）
// ---------------------------------------------------------------------------
fn pod_summary(cs: Option<&serde_json::Value>) -> (String, Option<String>, u32, u32, u32) {
    let arr = cs.and_then(|v| v.as_array());
    let total = arr.map(|a| a.len() as u32).unwrap_or(0);
    let mut ready = 0u32;
    let mut restarts = 0u32;
    let mut reasons: Vec<String> = Vec::new();
    if let Some(list) = arr {
        for c in list {
            if c.get("ready").and_then(|v| v.as_bool()).unwrap_or(false) {
                ready += 1;
            }
            restarts += c.get("restartCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            if let Some(st) = c.get("state") {
                if let Some(w) = st.get("waiting") {
                    if let Some(r) = w.get("reason").and_then(|v| v.as_str()) {
                        reasons.push(r.to_string());
                    }
                } else if let Some(t) = st.get("terminated") {
                    if t.get("exitCode").and_then(|v| v.as_i64()).unwrap_or(0) != 0 {
                        if let Some(r) = t.get("reason").and_then(|v| v.as_str()) {
                            reasons.push(r.to_string());
                        }
                    }
                }
            }
        }
    }
    let state = if total > 0 && ready == total { "running".to_string() } else if !reasons.is_empty() { "waiting".to_string() } else { "unknown".to_string() };
    (state, reasons.first().cloned(), restarts, ready, total)
}

fn ready_count(pods: &[PodInfo]) -> u32 {
    pods.iter().filter(|p| p.total > 0 && p.ready >= p.total).count() as u32
}

fn deploy_status(prog_reason: Option<&str>, desired: u32, new_pods: &[PodInfo], old_pods: &[PodInfo]) -> DeployStatus {
    let pull = ["ImagePullBackOff", "ErrImagePull", "ImageInspectError", "InvalidImageName"];
    let old_desc = if old_pods.is_empty() {
        String::new()
    } else {
        format!(" · 旧版本 {}/{} 就绪", ready_count(old_pods), old_pods.len())
    };
    if !new_pods.is_empty() {
        let n_ready = ready_count(new_pods);
        let reasons: Vec<&str> = new_pods.iter().filter_map(|p| p.reason.as_deref()).collect();
        if n_ready as usize == new_pods.len() {
            return DeployStatus { state: "running".into(), label: "运行中".into(), reason: None, detail: format!("{n_ready}/{} 就绪", new_pods.len()), old: old_desc };
        }
        if reasons.iter().any(|r| pull.contains(r)) {
            let r = reasons[0].to_string();
            return DeployStatus { state: "pull".into(), label: "拉取失败".into(), reason: Some(r.clone()), detail: format!("新 {n_ready}/{} · {r}", new_pods.len()), old: old_desc };
        }
        if reasons.contains(&"CrashLoopBackOff") {
            return DeployStatus { state: "crash".into(), label: "崩溃重启".into(), reason: Some("CrashLoopBackOff".into()), detail: format!("新 {n_ready}/{} · CrashLoopBackOff", new_pods.len()), old: old_desc };
        }
        if reasons.contains(&"ContainerCreating") {
            return DeployStatus { state: "creating".into(), label: "创建中".into(), reason: Some("ContainerCreating".into()), detail: format!("新 {n_ready}/{} · ContainerCreating", new_pods.len()), old: old_desc };
        }
        return DeployStatus { state: "updating".into(), label: "更新中".into(), reason: prog_reason.map(String::from), detail: format!("新 {n_ready}/{} 就绪", new_pods.len()), old: old_desc };
    }
    if desired == 0 && old_pods.is_empty() {
        return DeployStatus { state: "stopped".into(), label: "已停止".into(), reason: None, detail: "副本数 0".into(), old: String::new() };
    }
    if let Some(pr) = prog_reason {
        if pr != "NewReplicaSetAvailable" {
            return DeployStatus { state: "updating".into(), label: "更新中".into(), reason: Some(pr.to_string()), detail: "新版本容器组创建中".into(), old: old_desc };
        }
    }
    if !old_pods.is_empty() {
        let o_ready = ready_count(old_pods);
        return DeployStatus { state: "running".into(), label: "运行中".into(), reason: None, detail: format!("{o_ready}/{} 就绪", old_pods.len()), old: String::new() };
    }
    DeployStatus { state: "pending".into(), label: "无容器组".into(), reason: None, detail: format!("期望 {desired} 副本"), old: String::new() }
}

fn parse_pod(po: &serde_json::Value) -> PodInfo {
    let (state, reason, restarts, ready, total) = pod_summary(po.pointer("/status/containerStatuses"));
    PodInfo {
        name: po
            .pointer("/metadata/name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        phase: po
            .pointer("/status/phase")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        state,
        reason,
        restarts,
        ready,
        total,
        start_time: po
            .pointer("/status/startTime")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        node: po
            .pointer("/spec/nodeName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// 连接 KubeSphere：优先复用落盘会话 → refreshToken 续期 → 密码登录
#[tauri::command]
pub fn ks_connect(
    env_id: String,
    console: String,
    username: String,
    password: String,
) -> Result<KsConnectResult, String> {
    let env_id = env_id.trim().to_string();
    let username = username.trim().to_string();
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_connect env={env_id} console={console} user={username}"),
    );
    if env_id.is_empty() {
        return Err("环境 ID 为空".into());
    }
    if console.trim().is_empty() || username.is_empty() || password.is_empty() {
        return Err("请填写控制台地址 / 账号 / 密码".into());
    }

    match try_use_cached_or_refresh(&env_id, &console, &username) {
        Ok(Some(mode)) => {
            let message = match mode.as_str() {
                "refreshed" => "已自动续期会话".to_string(),
                _ => "已复用本地会话".to_string(),
            };
            crate::diag::diag_log("kubesphere", &format!("ks_connect ok mode={mode}"));
            return Ok(KsConnectResult { mode, message });
        }
        Ok(None) => {}
        Err(e) => {
            crate::diag::diag_log("kubesphere", &format!("ks_connect cache path err: {e}"));
            // 仅网关/网络不可用时短路；其它缓存失败仍允许密码登录
            if e.contains("控制台暂时不可用") {
                return Err(e);
            }
        }
    }

    let (base, cookie) = login(&console, &username, &password).map_err(|e| {
        crate::diag::diag_log("kubesphere", &format!("ks_connect login failed: {e}"));
        e
    })?;
    let sess = Session {
        env_id: env_id.clone(),
        console: base,
        username,
        cookie,
    };
    persist_session(&sess);
    set_memory_session(sess)?;
    crate::diag::diag_log("kubesphere", "ks_connect ok mode=login");
    Ok(KsConnectResult {
        mode: "login".into(),
        message: "已登录并缓存会话".into(),
    })
}

/// 兼容旧调用：等价于无 env_id 的密码登录（仍会落盘到 `_default`）
#[tauri::command]
pub fn ks_login(console: String, username: String, password: String) -> Result<(), String> {
    ks_connect("_default".into(), console, username, password).map(|_| ())
}

/// 列出集群全部命名空间
#[tauri::command]
pub fn ks_list_namespaces() -> Result<Vec<String>, String> {
    let t0 = Instant::now();
    crate::diag::diag_log("kubesphere", "ks_list_namespaces start");
    let (status, json) = ks_api("GET", "/api/v1/namespaces?limit=100", None)?;
    if status != 200 {
        return Err(format!("读取命名空间失败 HTTP {status}"));
    }
    let Some(arr) = json.pointer("/items").and_then(|v| v.as_array()) else {
        crate::diag::diag_log(
            "kubesphere",
            "ks_list_namespaces 响应无 items（会话可能已失效）",
        );
        return Err("读取命名空间失败：响应异常，会话可能已失效，请重新连接".into());
    };
    let mut names: Vec<String> = arr
        .iter()
        .filter_map(|it| it.pointer("/metadata/name").and_then(|v| v.as_str()).map(String::from))
        .collect();
    names.sort();
    if names.is_empty() {
        crate::diag::diag_log("kubesphere", "ks_list_namespaces 返回空列表");
    }
    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_list_namespaces ok count={} elapsed_ms={}",
            names.len(),
            t0.elapsed().as_millis()
        ),
    );
    Ok(names)
}

/// 并行拉取命名空间级列表（共享同一会话 Cookie，避免 3 次串行 RTT）
fn ks_fetch_ns_lists(
    ns: &str,
) -> Result<(serde_json::Value, serde_json::Value, serde_json::Value), String> {
    let sess = clone_memory_session()?;
    let dep_path = format!("/apis/apps/v1/namespaces/{ns}/deployments?limit={LIST_LIMIT_DEPLOY}");
    let rs_path = format!("/apis/apps/v1/namespaces/{ns}/replicasets?limit={LIST_LIMIT_RS}");
    let pod_path = format!("/api/v1/namespaces/{ns}/pods?limit={LIST_LIMIT_POD}");

    let (dep_res, rs_res, pod_res) = std::thread::scope(|scope| {
        let s1 = sess.clone();
        let s2 = sess.clone();
        let s3 = sess.clone();
        let dep_h = scope.spawn(move || ks_api_raw_with(&s1, "GET", &dep_path, None, None));
        let rs_h = scope.spawn(move || ks_api_raw_with(&s2, "GET", &rs_path, None, None));
        let pod_h = scope.spawn(move || ks_api_raw_with(&s3, "GET", &pod_path, None, None));
        (
            dep_h.join().unwrap_or_else(|_| Err("deployments 拉取线程失败".into())),
            rs_h.join().unwrap_or_else(|_| Err("replicasets 拉取线程失败".into())),
            pod_h.join().unwrap_or_else(|_| Err("pods 拉取线程失败".into())),
        )
    });

    let (mut dep_status, mut dep_json) = dep_res?;
    let (mut rs_status, mut rs_json) = rs_res?;
    let (mut pod_status, mut pod_json) = pod_res?;

    // 任一 401：续期 / 密码重登一次后串行重试（避免三线程同时 refresh 抢锁）
    if dep_status == 401 || rs_status == 401 || pod_status == 401 {
        crate::diag::diag_log(
            "kubesphere",
            "ks_list_deployments parallel 401 → recover once then retry",
        );
        let sess = clone_memory_session()?;
        let (sess, mode) = recover_session_after_401(&sess).map_err(|e| {
            crate::diag::diag_log("kubesphere", &format!("ks_list_deployments recover fail: {e}"));
            e
        })?;
        crate::diag::diag_log(
            "kubesphere",
            &format!("ks_list_deployments recover mode={mode}"),
        );
        let dep_path = format!("/apis/apps/v1/namespaces/{ns}/deployments?limit={LIST_LIMIT_DEPLOY}");
        let rs_path = format!("/apis/apps/v1/namespaces/{ns}/replicasets?limit={LIST_LIMIT_RS}");
        let pod_path = format!("/api/v1/namespaces/{ns}/pods?limit={LIST_LIMIT_POD}");
        (dep_status, dep_json) = ks_api_raw_with(&sess, "GET", &dep_path, None, None)?;
        (rs_status, rs_json) = ks_api_raw_with(&sess, "GET", &rs_path, None, None)?;
        (pod_status, pod_json) = ks_api_raw_with(&sess, "GET", &pod_path, None, None)?;

        // refresh 成功但仍 401：再密码重登一次
        if (dep_status == 401 || rs_status == 401 || pod_status == 401) && mode == "refreshed" {
            crate::diag::diag_log(
                "kubesphere",
                "ks_list_deployments still 401 after refresh → password relogin",
            );
            let password = password_for_session(&sess)?;
            let (base, cookie) = login(&sess.console, &sess.username, &password)?;
            let relogin = Session {
                env_id: sess.env_id.clone(),
                console: base,
                username: sess.username.clone(),
                cookie,
            };
            persist_session(&relogin);
            set_memory_session(relogin.clone())?;
            (dep_status, dep_json) = ks_api_raw_with(&relogin, "GET", &dep_path, None, None)?;
            (rs_status, rs_json) = ks_api_raw_with(&relogin, "GET", &rs_path, None, None)?;
            (pod_status, pod_json) = ks_api_raw_with(&relogin, "GET", &pod_path, None, None)?;
        }
    }

    if dep_status != 200 {
        return Err(format!("读取部署列表失败 HTTP {dep_status}"));
    }
    if rs_status != 200 {
        return Err(format!("读取 ReplicaSet 列表失败 HTTP {rs_status}"));
    }
    if pod_status != 200 {
        return Err(format!("读取 Pod 列表失败 HTTP {pod_status}"));
    }
    Ok((dep_json, rs_json, pod_json))
}

/// 列出命名空间下全部 Deployment（含实时状态 + 新/旧 Pod 明细）
///
/// 性能：命名空间级 3 次并行拉取（deployments / replicasets / pods），内存按 ownerReference 关联。
/// 旧实现按部署各打 2 次 API（1+2N），部署一多就会把 UI 拖死。
#[tauri::command]
pub fn ks_list_deployments(namespace: String) -> Result<Vec<DeployInfo>, String> {
    let ns = urlencoding(&namespace);
    let t0 = Instant::now();
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_list_deployments start ns={namespace}"),
    );

    let (json, rs_json, pod_json) = ks_fetch_ns_lists(&ns)?;
    let items = json
        .pointer("/items")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    warn_if_list_truncated("deployments", &json, items.len(), LIST_LIMIT_DEPLOY);

    let rs_items = rs_json
        .pointer("/items")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    warn_if_list_truncated("replicasets", &rs_json, rs_items.len(), LIST_LIMIT_RS);

    let pod_items = pod_json
        .pointer("/items")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    warn_if_list_truncated("pods", &pod_json, pod_items.len(), LIST_LIMIT_POD);

    // rs_name → revision；deploy_name → [(rs_name, revision)]
    let mut rs_rev: HashMap<String, String> = HashMap::new();
    let mut rs_by_deploy: HashMap<String, Vec<String>> = HashMap::new();
    for rs in rs_items {
        let Some(rs_name) = rs
            .pointer("/metadata/name")
            .and_then(|v| v.as_str())
            .map(String::from)
        else {
            continue;
        };
        let Some(dep_name) = owner_name(rs, "Deployment") else {
            continue;
        };
        let rev = rs
            .pointer("/metadata/annotations/deployment.kubernetes.io~1revision")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !rev.is_empty() {
            rs_rev.insert(rs_name.clone(), rev);
        }
        rs_by_deploy.entry(dep_name).or_default().push(rs_name);
    }

    // rs_name → pods
    let mut pods_by_rs: HashMap<String, Vec<PodInfo>> = HashMap::new();
    for po in pod_items {
        let Some(rs_name) = owner_name(po, "ReplicaSet") else {
            continue;
        };
        pods_by_rs.entry(rs_name).or_default().push(parse_pod(po));
    }

    let mut out: Vec<DeployInfo> = Vec::with_capacity(items.len());
    for it in items {
        let name = it
            .pointer("/metadata/name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let alias = it
            .pointer("/metadata/annotations/kubesphere.io~1alias-name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let containers: Vec<String> = it
            .pointer("/spec/template/spec/containers")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|c| c.get("name").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let mut ports: Vec<u16> = it
            .pointer("/spec/template/spec/containers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                let mut ps = Vec::new();
                for c in arr {
                    if let Some(ports_arr) = c.get("ports").and_then(|v| v.as_array()) {
                        for p in ports_arr {
                            if let Some(cp) = p.get("containerPort").and_then(|v| v.as_u64()) {
                                if cp > 0 && cp <= 65535 {
                                    ps.push(cp as u16);
                                }
                            }
                        }
                    }
                }
                ps
            })
            .unwrap_or_default();
        ports.sort_unstable();
        ports.dedup();
        let image = it
            .pointer("/spec/template/spec/containers/0/image")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cur_rev = it
            .pointer("/metadata/annotations/deployment.kubernetes.io~1revision")
            .and_then(|v| v.as_str())
            .map(String::from);
        let desired = it.pointer("/spec/replicas").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let prog_reason = it
            .pointer("/status/conditions")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|c| c.get("type").and_then(|t| t.as_str()) == Some("Progressing"))
            })
            .and_then(|c| c.get("reason").and_then(|v| v.as_str()))
            .map(String::from);

        let mut new_pods: Vec<PodInfo> = Vec::new();
        let mut old_pods: Vec<PodInfo> = Vec::new();
        if let Some(rs_names) = rs_by_deploy.get(&name) {
            for rs_name in rs_names {
                let is_new = match (cur_rev.as_deref(), rs_rev.get(rs_name).map(|s| s.as_str())) {
                    (Some(rev), Some(rs_r)) => rev == rs_r,
                    _ => false,
                };
                if let Some(pods) = pods_by_rs.remove(rs_name) {
                    if is_new {
                        new_pods.extend(pods);
                    } else {
                        old_pods.extend(pods);
                    }
                }
            }
        }
        new_pods.sort_by(|a, b| b.start_time.cmp(&a.start_time));
        old_pods.sort_by(|a, b| b.start_time.cmp(&a.start_time));

        let status = deploy_status(prog_reason.as_deref(), desired, &new_pods, &old_pods);
        out.push(DeployInfo {
            name,
            alias,
            image,
            containers,
            ports,
            status,
            pods: PodsGroup { new_pods, old_pods },
            revision: cur_rev.unwrap_or_default(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_list_deployments ok ns={namespace} deps={} rs={} pods={} elapsed_ms={}",
            out.len(),
            rs_items.len(),
            pod_items.len(),
            t0.elapsed().as_millis()
        ),
    );
    Ok(out)
}

/// 列出 Deployment 的 ReplicaSet 历史（revision → 镜像）
#[tauri::command]
pub fn ks_list_deployment_revisions(namespace: String, deployment: String) -> Result<Vec<DeployRevision>, String> {
    let ns = urlencoding(&namespace);
    let dep = urlencoding(&deployment);
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_list_deployment_revisions ns={namespace} dep={deployment}"),
    );

    let (s1, dep_json) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), None)?;
    if s1 != 200 {
        return Err(format!("读取部署失败 HTTP {s1}"));
    }
    let cur_rev = dep_json
        .pointer("/metadata/annotations/deployment.kubernetes.io~1revision")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let selector = selector_of(&dep_json);

    let (s2, rsd) = ks_api(
        "GET",
        &format!("/apis/apps/v1/namespaces/{ns}/replicasets?labelSelector={selector}&limit=100"),
        None,
    )?;
    if s2 != 200 {
        return Err(format!("读取 ReplicaSet 历史失败 HTTP {s2}"));
    }

    let mut out: Vec<DeployRevision> = Vec::new();
    if let Some(arr) = rsd.pointer("/items").and_then(|v| v.as_array()) {
        for rs in arr {
            let rev = rs
                .pointer("/metadata/annotations/deployment.kubernetes.io~1revision")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if rev.is_empty() {
                continue;
            }
            let containers: Vec<RevisionImage> = rs
                .pointer("/spec/template/spec/containers")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|c| {
                            Some(RevisionImage {
                                name: c.get("name")?.as_str()?.to_string(),
                                image: c.get("image")?.as_str()?.to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let image = containers.first().map(|c| c.image.clone()).unwrap_or_default();
            let replicas = rs.pointer("/spec/replicas").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let ready = rs.pointer("/status/readyReplicas").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let created_at = rs
                .pointer("/metadata/creationTimestamp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            out.push(DeployRevision {
                revision: rev.clone(),
                image,
                containers,
                replicas,
                ready,
                created_at,
                is_current: rev == cur_rev,
            });
        }
    }
    out.sort_by(|a, b| {
        let ra = a.revision.parse::<u64>().unwrap_or(0);
        let rb = b.revision.parse::<u64>().unwrap_or(0);
        rb.cmp(&ra)
    });
    crate::diag::diag_log("kubesphere", &format!("ks_list_deployment_revisions ok count={}", out.len()));
    Ok(out)
}

/// K8s metadata.name：小写 RFC 1123 subdomain
fn is_rfc1123_subdomain(name: &str) -> bool {
    if name.is_empty() || name.len() > 253 {
        return false;
    }
    let bytes = name.as_bytes();
    let first = bytes[0];
    let last = bytes[bytes.len() - 1];
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    if !(last.is_ascii_lowercase() || last.is_ascii_digit()) {
        return false;
    }
    name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
}

fn require_rfc1123_name(kind: &str, name: &str) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(format!("{kind} 名称不能为空"));
    }
    if !is_rfc1123_subdomain(&name) {
        return Err(format!(
            "{kind} 名称「{name}」不合法：须为小写字母/数字/'-'/'.'，且以字母或数字开头结尾（例：klcj-test-service）"
        ));
    }
    Ok(name)
}

/// 读取 ConfigMap 的 data keys（用于展开为 env[].valueFrom.configMapKeyRef）
fn fetch_configmap_keys(namespace: &str, name: &str) -> Result<Vec<String>, String> {
    let ns = urlencoding(namespace);
    let n = urlencoding(name);
    let (status, json) = ks_api("GET", &format!("/api/v1/namespaces/{ns}/configmaps/{n}"), None)?;
    if status != 200 {
        return Err(format!("读取配置字典「{name}」失败 HTTP {status}"));
    }
    let mut keys: Vec<String> = json
        .get("data")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    keys.sort();
    Ok(keys)
}

fn normalize_health_path(raw: Option<&str>) -> Result<String, String> {
    let mut p = raw.unwrap_or("/actuator/health").trim().to_string();
    if p.is_empty() {
        p = "/actuator/health".into();
    }
    if !p.starts_with('/') {
        p = format!("/{p}");
    }
    if p.contains(' ') || p.contains('\n') {
        return Err("健康检查路径不能包含空格或换行".into());
    }
    Ok(p)
}

/// 生成完整 Deployment JSON（创建与预览共用模板）
/// `config_map`：对齐 KubeSphere——对该 ConfigMap 每个 key 生成
/// `env[].valueFrom.configMapKeyRef`（不是 envFrom 整表引用）
fn build_deployment_json(
    namespace: &str,
    name: &str,
    image: &str,
    alias: &str,
    port: u16,
    replicas: u32,
    envs: &[String],
    config_map: Option<&str>,
    health_path: Option<&str>,
) -> Result<serde_json::Value, String> {
    let name = require_rfc1123_name("部署", name)?;
    let image = image.trim().to_string();
    if image.is_empty() {
        return Err("镜像地址不能为空".into());
    }
    if port == 0 {
        return Err("容器端口无效".into());
    }
    let health = normalize_health_path(health_path)?;
    let alias = alias.trim().to_string();
    let mut env: Vec<serde_json::Value> = Vec::new();

    // 1) 配置字典：每个 key → configMapKeyRef（与 KS 控制台一致）
    if let Some(cm) = config_map.map(str::trim).filter(|s| !s.is_empty()) {
        let keys = fetch_configmap_keys(namespace, cm)?;
        if keys.is_empty() {
            return Err(format!("配置字典「{cm}」没有 data key，无法引用"));
        }
        crate::diag::diag_log(
            "kubesphere",
            &format!("build_deployment_json configMapKeyRef cm={cm} keys={}", keys.len()),
        );
        for key in keys {
            // SW_AGENT_NAME 固定取部署名称，不走配置字典
            if key == "SW_AGENT_NAME" {
                continue;
            }
            env.push(serde_json::json!({
                "name": key,
                "valueFrom": {
                    "configMapKeyRef": {
                        "name": cm,
                        "key": key
                    }
                }
            }));
        }
    }

    // SW_AGENT_NAME：SkyWalking 探针名 = 部署名称
    env.push(serde_json::json!({ "name": "SW_AGENT_NAME", "value": name.clone() }));

    // 2) 手写 K=V（可叠加；同名会排在后面，K8s 以最后为准）
    for kv in envs {
        let kv = kv.trim();
        if kv.is_empty() { continue; }
        if let Some(eq) = kv.find('=') {
            let k = kv[..eq].trim().to_string();
            let v = kv[eq + 1..].trim().to_string();
            if !k.is_empty() {
                env.push(serde_json::json!({ "name": k, "value": v }));
            }
        }
    }

    let port_name = format!("http-{port}");
    let probe = serde_json::json!({
        "httpGet": { "path": health, "port": port, "scheme": "HTTP" },
        "timeoutSeconds": 1,
        "periodSeconds": 10,
        "successThreshold": 1,
        "failureThreshold": 3
    });

    let container = serde_json::json!({
        "name": "container-main",
        "image": image,
        "imagePullPolicy": "IfNotPresent",
        "ports": [{ "name": port_name, "protocol": "TCP", "containerPort": port }],
        "env": env,
        "resources": {},
        "volumeMounts": [{ "name": "host-time", "mountPath": "/etc/localtime", "readOnly": true }],
        "livenessProbe": probe.clone(),
        "readinessProbe": probe.clone(),
        "startupProbe": probe,
        "terminationMessagePath": "/dev/termination-log",
        "terminationMessagePolicy": "File"
    });

    Ok(serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "namespace": namespace,
            "name": name,
            "labels": { "app": name },
            "annotations": {
                "kubesphere.io/alias-name": if alias.is_empty() { name.clone() } else { alias.clone() },
                "kubesphere.io/description": ""
            }
        },
        "spec": {
            "replicas": replicas,
            "selector": { "matchLabels": { "app": name } },
            "template": {
                "metadata": {
                    "labels": { "app": name },
                    "annotations": { "kubesphere.io/imagepullsecrets": "{}" }
                },
                "spec": {
                    "containers": [container],
                    "restartPolicy": "Always",
                    "terminationGracePeriodSeconds": 30,
                    "dnsPolicy": "ClusterFirst",
                    "volumes": [{
                        "name": "host-time",
                        "hostPath": { "path": "/etc/localtime", "type": "" }
                    }]
                }
            },
            "strategy": {
                "type": "RollingUpdate",
                "rollingUpdate": { "maxUnavailable": "25%", "maxSurge": "25%" }
            },
            "revisionHistoryLimit": 10,
            "progressDeadlineSeconds": 600
        }
    }))
}

/// 创建 Deployment：只收必传项，完整 Deployment 由后端模板拼接
/// 参数：namespace/name/image 必填；alias 别名、port 容器端口、replicas 副本数、
///       envs 额外环境变量（"K=V" 每项）可选；
///       config_map 引用配置字典（展开为 env[].valueFrom.configMapKeyRef）可选；
///       health_path HTTP 探针路径（默认 /actuator/health）；dry_run 仅校验
#[tauri::command]
pub fn ks_create_deployment(
    namespace: String,
    name: String,
    image: String,
    alias: Option<String>,
    port: Option<u16>,
    replicas: Option<u32>,
    envs: Option<Vec<String>>,
    config_map: Option<String>,
    health_path: Option<String>,
    dry_run: Option<bool>,
) -> Result<String, String> {
    let cm = config_map.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    let health = health_path.as_deref();
    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_create_deployment ns={} name={} port={} healthPath={:?} dryRun={} configMap={:?}",
            namespace, name, port.unwrap_or(8080), health, dry_run.unwrap_or(false), cm
        ),
    );
    let deployment = build_deployment_json(
        &namespace, &name, &image,
        alias.as_deref().unwrap_or(""),
        port.unwrap_or(8080),
        replicas.unwrap_or(1),
        &envs.unwrap_or_default(),
        cm.as_deref(),
        health,
    )?;
    let ns = urlencoding(&namespace);
    let path = if dry_run.unwrap_or(false) {
        format!("/apis/apps/v1/namespaces/{ns}/deployments?dryRun=All")
    } else {
        format!("/apis/apps/v1/namespaces/{ns}/deployments")
    };
    let (status, resp) = ks_api_raw("POST", &path, Some(deployment.to_string()), Some("application/json"))?;
    if status != 201 && status != 200 {
        let msg = resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        let detail = resp
            .get("details")
            .map(|d| d.to_string())
            .unwrap_or_default();
        crate::diag::diag_log("kubesphere", &format!("ks_create_deployment fail HTTP {status}: {msg}"));
        return Err(format!("创建失败 HTTP {status}: {msg}{detail}"));
    }
    let created = resp
        .pointer("/metadata/name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(if created.is_empty() {
        "创建成功（dryRun 校验通过）".to_string()
    } else {
        format!("创建成功：{created}")
    })
}

/// ---------------------------------------------------------------------------
/// ConfigMap 管理：列表 / 读取（复制用）/ 表单创建 / YAML 创建 / 预览
/// ---------------------------------------------------------------------------
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigMapInfo {
    pub name: String,
    pub alias: String,
    pub keys: Vec<String>,
    pub data_size: usize,
}

/// 列出命名空间下全部 ConfigMap（名称 / 别名 / 键列表 / 数据大小）
#[tauri::command]
pub fn ks_list_configmaps(namespace: String) -> Result<Vec<ConfigMapInfo>, String> {
    let ns = urlencoding(&namespace);
    let t0 = Instant::now();
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_list_configmaps start ns={namespace}"),
    );
    let (status, json) = ks_api(
        "GET",
        &format!("/api/v1/namespaces/{ns}/configmaps?limit={LIST_LIMIT_CM}"),
        None,
    )?;
    if status != 200 {
        return Err(format!("读取 ConfigMap 列表失败 HTTP {status}"));
    }
    let items = json
        .pointer("/items")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    warn_if_list_truncated("configmaps", &json, items.len(), LIST_LIMIT_CM);
    let mut out: Vec<ConfigMapInfo> = Vec::with_capacity(items.len());
    for it in items {
        let name = it.pointer("/metadata/name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let alias = it
            .pointer("/metadata/annotations/kubesphere.io~1alias-name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // 只取 key 名，不 clone 整份 data（大 ConfigMap 否则会拖垮列表）
        let keys: Vec<String> = it
            .get("data")
            .and_then(|v| v.as_object())
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        let data_size = keys.len();
        out.push(ConfigMapInfo { name, alias, keys, data_size });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_list_configmaps ok ns={namespace} count={} elapsed_ms={}",
            out.len(),
            t0.elapsed().as_millis()
        ),
    );
    Ok(out)
}

/// 读取单个 ConfigMap 的 data（供「复制创建」预填）
#[tauri::command]
pub fn ks_get_configmap(namespace: String, name: String) -> Result<serde_json::Value, String> {
    let ns = urlencoding(&namespace);
    let n = urlencoding(&name);
    let (status, json) = ks_api("GET", &format!("/api/v1/namespaces/{ns}/configmaps/{n}"), None)?;
    if status != 200 {
        return Err(format!("读取 ConfigMap 失败 HTTP {status}"));
    }
    Ok(json.get("data").cloned().unwrap_or(serde_json::Value::Null))
}

/// 生成 ConfigMap JSON（表单模式：name + data 的 "K=V" 行）
fn build_configmap_json(namespace: &str, name: &str, data_lines: &[String]) -> Result<serde_json::Value, String> {
    let name = require_rfc1123_name("ConfigMap", name)?;
    let mut data = serde_json::Map::new();
    for kv in data_lines {
        let kv = kv.trim();
        if kv.is_empty() { continue; }
        if let Some(eq) = kv.find('=') {
            let k = kv[..eq].trim().to_string();
            let v = kv[eq + 1..].to_string();
            if !k.is_empty() {
                data.insert(k, serde_json::Value::String(v));
            }
        }
    }
    if data.is_empty() {
        return Err("至少需要一个键值对（K=V）".into());
    }
    // 仅当已有 SW_AGENT_NAME 时同步为 ConfigMap 名称；没有则不创建
    if data.contains_key("SW_AGENT_NAME") {
        data.insert(
            "SW_AGENT_NAME".into(),
            serde_json::Value::String(name.clone()),
        );
    }
    Ok(serde_json::json!({
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": { "name": name, "namespace": namespace },
        "data": data,
    }))
}

/// 表单模式创建 ConfigMap（窗口弹窗：名称 + K=V 行）
#[tauri::command]
pub fn ks_create_configmap(
    namespace: String,
    name: String,
    data: Vec<String>,
    dry_run: Option<bool>,
) -> Result<String, String> {
    let cm = build_configmap_json(&namespace, &name, &data)?;
    let ns = urlencoding(&namespace);
    let path = if dry_run.unwrap_or(false) {
        format!("/api/v1/namespaces/{ns}/configmaps?dryRun=All")
    } else {
        format!("/api/v1/namespaces/{ns}/configmaps")
    };
    let (status, resp) = ks_api_raw("POST", &path, Some(cm.to_string()), Some("application/json"))?;
    if status != 201 && status != 200 {
        let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("未知错误");
        return Err(format!("创建失败 HTTP {status}: {msg}"));
    }
    let created = resp.pointer("/metadata/name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(if created.is_empty() { "创建成功（dryRun 校验通过）".to_string() } else { format!("创建成功：{created}") })
}

/// YAML 模式创建 ConfigMap（粘贴完整 YAML）
#[tauri::command]
pub fn ks_create_configmap_yaml(namespace: String, yaml: String, dry_run: Option<bool>) -> Result<String, String> {
    let ns = urlencoding(&namespace);
    let path = if dry_run.unwrap_or(false) {
        format!("/api/v1/namespaces/{ns}/configmaps?dryRun=All")
    } else {
        format!("/api/v1/namespaces/{ns}/configmaps")
    };
    let (status, resp) = ks_api_raw("POST", &path, Some(yaml), Some("application/yaml"))?;
    if status != 201 && status != 200 {
        let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("未知错误");
        return Err(format!("创建失败 HTTP {status}: {msg}"));
    }
    let created = resp.pointer("/metadata/name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(if created.is_empty() { "创建成功（dryRun 校验通过）".to_string() } else { format!("创建成功：{created}") })
}

/// 预览生成的 ConfigMap YAML（复制用）
#[tauri::command]
pub fn ks_preview_configmap(namespace: String, name: String, data: Vec<String>) -> Result<String, String> {
    let cm = build_configmap_json(&namespace, &name, &data)?;
    let yaml = serde_yaml::to_string(&cm).map_err(|e| format!("YAML 生成失败: {e}"))?;
    Ok(yaml)
}

/// 预览生成的 Deployment YAML（不创建，用于复制到 kubectl / 控制台）
#[tauri::command]
pub fn ks_preview_deployment(
    namespace: String,
    name: String,
    image: String,
    alias: Option<String>,
    port: Option<u16>,
    replicas: Option<u32>,
    envs: Option<Vec<String>>,
    config_map: Option<String>,
    health_path: Option<String>,
) -> Result<String, String> {
    let cm = config_map.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    let deployment = build_deployment_json(
        &namespace, &name, &image,
        alias.as_deref().unwrap_or(""),
        port.unwrap_or(8080),
        replicas.unwrap_or(1),
        &envs.unwrap_or_default(),
        cm.as_deref(),
        health_path.as_deref(),
    )?;
    let yaml = serde_yaml::to_string(&deployment).map_err(|e| format!("YAML 生成失败: {e}"))?;
    Ok(yaml)
}

/// 修改 Deployment 镜像并发布（strategic-merge-patch，触发滚动发布）
#[tauri::command]
pub fn ks_update_image(namespace: String, deployment: String, container: String, image: String) -> Result<UpdateResult, String> {
    let ns = urlencoding(&namespace);
    let dep = urlencoding(&deployment);
    // 读当前镜像
    let (s1, cur) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), None)?;
    if s1 != 200 {
        return Err(format!("读取部署失败 HTTP {s1}"));
    }
    let old_image = cur.pointer("/spec/template/spec/containers/0/image").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let old_rev = cur.pointer("/metadata/annotations/deployment.kubernetes.io~1revision").and_then(|v| v.as_str()).unwrap_or("?").to_string();

    // PATCH 只改镜像
    let patch = serde_json::json!({
        "spec": { "template": { "spec": { "containers": [{ "name": container, "image": image }] } } }
    });
    let (s2, resp) = ks_api("PATCH", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), Some(patch))?;
    if s2 != 200 {
        let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("未知错误");
        return Err(format!("更新失败 HTTP {s2}: {msg}"));
    }
    // 回读验证
    let (s3, ver) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), None)?;
    let new_image = if s3 == 200 {
        ver.pointer("/spec/template/spec/containers/0/image").and_then(|v| v.as_str()).unwrap_or(&image).to_string()
    } else {
        image.clone()
    };
    let new_rev = if s3 == 200 {
        ver.pointer("/metadata/annotations/deployment.kubernetes.io~1revision").and_then(|v| v.as_str()).unwrap_or(&old_rev).to_string()
    } else {
        old_rev.clone()
    };
    Ok(UpdateResult { ok: new_image == image, old_image, new_image, revision: new_rev })
}

/// 拉取 Pod 容器日志（纯文本；不走 JSON ks_api，避免非 JSON 被误判 401）
fn ks_fetch_text(sess: &Session, path: &str) -> Result<(u16, String), String> {
    let client = http_client()?;
    let url = format!("{}{}", sess.console, path);
    let resp = client
        .get(&url)
        .header("Accept", "*/*")
        .header("Cookie", &sess.cookie)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status().as_u16();
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
        return Ok((401, String::new()));
    }
    let text = resp.text().unwrap_or_default();
    Ok((status, text))
}

fn ks_fetch_text_with_recover(path: &str) -> Result<(u16, String), String> {
    let sess = clone_memory_session()?;
    let result = ks_fetch_text(&sess, path)?;
    if result.0 != 401 {
        return Ok(result);
    }
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_get_pod_logs 401 {path} → recover session"),
    );
    let (new_sess, mode) = recover_session_after_401(&sess)?;
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_get_pod_logs recover mode={mode} → retry"),
    );
    let retry = ks_fetch_text(&new_sess, path)?;
    if retry.0 == 401 && mode == "refreshed" {
        let password = password_for_session(&new_sess)?;
        let (base, cookie) = login(&new_sess.console, &new_sess.username, &password)?;
        let relogin = Session {
            env_id: new_sess.env_id.clone(),
            console: base,
            username: new_sess.username.clone(),
            cookie,
        };
        persist_session(&relogin);
        set_memory_session(relogin.clone())?;
        return ks_fetch_text(&relogin, path);
    }
    Ok(retry)
}

/// 查看 Pod 日志：`GET .../pods/{pod}/log?timestamps&tailLines[&container][&previous]`
#[tauri::command]
pub fn ks_get_pod_logs(
    namespace: String,
    pod: String,
    container: Option<String>,
    tail_lines: Option<u32>,
    previous: Option<bool>,
) -> Result<String, String> {
    let ns = urlencoding(namespace.trim());
    let pod_name = urlencoding(pod.trim());
    if ns.is_empty() || pod_name.is_empty() {
        return Err("namespace / pod 不能为空".into());
    }
    let mut tail = tail_lines.unwrap_or(500);
    if tail == 0 {
        tail = 500;
    }
    tail = tail.min(5000);

    let mut path = format!(
        "/api/v1/namespaces/{ns}/pods/{pod_name}/log?timestamps=true&tailLines={tail}"
    );
    if let Some(c) = container.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        path.push_str(&format!("&container={}", urlencoding(c)));
    }
    if previous.unwrap_or(false) {
        path.push_str("&previous=true");
    }

    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_get_pod_logs ns={} pod={} container={} previous={} tail={}",
            namespace.trim(),
            pod.trim(),
            container.as_deref().unwrap_or("-"),
            previous.unwrap_or(false),
            tail
        ),
    );

    let (status, text) = ks_fetch_text_with_recover(&path)?;
    if status == 401 {
        return Err("未授权：会话失效，请重新连接环境".into());
    }
    if status != 200 {
        let snippet: String = text.chars().take(200).collect();
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or(snippet);
        crate::diag::diag_log(
            "kubesphere",
            &format!("ks_get_pod_logs fail HTTP {status}: {msg}"),
        );
        return Err(format!("拉取日志失败 HTTP {status}: {msg}"));
    }

    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_get_pod_logs ok ns={} pod={} len={}",
            namespace.trim(),
            pod.trim(),
            text.len()
        ),
    );
    Ok(text)
}

/// 修改弹框回填：与创建表单字段对齐
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeployEditInfo {
    pub name: String,
    pub alias: String,
    pub image: String,
    pub container: String,
    pub port: u16,
    pub replicas: u32,
    pub health_path: String,
    pub config_map: Option<String>,
    pub envs: Vec<String>,
}

#[tauri::command]
pub fn ks_get_deployment_edit(namespace: String, deployment: String) -> Result<DeployEditInfo, String> {
    let ns = urlencoding(&namespace);
    let dep = urlencoding(&deployment);
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_get_deployment_edit ns={namespace} dep={deployment}"),
    );
    let (status, json) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), None)?;
    if status != 200 {
        return Err(format!("读取部署失败 HTTP {status}"));
    }
    let name = json
        .pointer("/metadata/name")
        .and_then(|v| v.as_str())
        .unwrap_or(&deployment)
        .to_string();
    let alias = json
        .pointer("/metadata/annotations/kubesphere.io~1alias-name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let replicas = json.pointer("/spec/replicas").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let containers = json
        .pointer("/spec/template/spec/containers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let c0 = containers.first().cloned().unwrap_or(serde_json::Value::Null);
    let container = c0
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("container-main")
        .to_string();
    let image = c0
        .get("image")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let port = c0
        .pointer("/ports/0/containerPort")
        .and_then(|v| v.as_u64())
        .unwrap_or(8080) as u16;
    let health_path = c0
        .pointer("/livenessProbe/httpGet/path")
        .or_else(|| c0.pointer("/readinessProbe/httpGet/path"))
        .and_then(|v| v.as_str())
        .unwrap_or("/actuator/health")
        .to_string();

    let mut cm_votes: HashMap<String, usize> = HashMap::new();
    let mut envs: Vec<String> = Vec::new();
    if let Some(arr) = c0.get("env").and_then(|v| v.as_array()) {
        for e in arr {
            let key = e.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
            if key.is_empty() || key == "SW_AGENT_NAME" {
                continue;
            }
            if let Some(cm) = e
                .pointer("/valueFrom/configMapKeyRef/name")
                .and_then(|v| v.as_str())
            {
                *cm_votes.entry(cm.to_string()).or_default() += 1;
                continue;
            }
            if let Some(val) = e.get("value").and_then(|v| v.as_str()) {
                envs.push(format!("{key}={val}"));
            }
        }
    }
    let config_map = cm_votes
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(k, _)| k);

    Ok(DeployEditInfo {
        name,
        alias,
        image,
        container,
        port,
        replicas,
        health_path,
        config_map,
        envs,
    })
}

/// 按创建表单同款字段更新 Deployment（merge-patch，触发滚动发布）
#[tauri::command]
pub fn ks_update_deployment(
    namespace: String,
    name: String,
    image: String,
    alias: Option<String>,
    port: Option<u16>,
    replicas: Option<u32>,
    envs: Option<Vec<String>>,
    config_map: Option<String>,
    health_path: Option<String>,
    container: Option<String>,
) -> Result<UpdateResult, String> {
    let ns = urlencoding(&namespace);
    let dep = urlencoding(&name);
    let container = container
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("container-main")
        .to_string();
    crate::diag::diag_log(
        "kubesphere",
        &format!(
            "ks_update_deployment ns={} name={} port={} healthPath={:?} configMap={:?}",
            namespace,
            name,
            port.unwrap_or(8080),
            health_path,
            config_map
        ),
    );

    let (s1, cur) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), None)?;
    if s1 != 200 {
        return Err(format!("读取部署失败 HTTP {s1}"));
    }
    let old_image = cur
        .pointer("/spec/template/spec/containers/0/image")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let old_rev = cur
        .pointer("/metadata/annotations/deployment.kubernetes.io~1revision")
        .and_then(|v| v.as_str())
        .unwrap_or("?")
        .to_string();

    // 复用创建模板拼出目标容器字段（含 SW_AGENT_NAME / ConfigMap / 探针）
    let built = build_deployment_json(
        &namespace,
        &name,
        &image,
        alias.as_deref().unwrap_or(""),
        port.unwrap_or(8080),
        replicas.unwrap_or(1),
        &envs.unwrap_or_default(),
        config_map.as_deref(),
        health_path.as_deref(),
    )?;
    let built_container = built
        .pointer("/spec/template/spec/containers/0")
        .cloned()
        .ok_or_else(|| "生成容器配置失败".to_string())?;
    let mut container_patch = built_container;
    if let Some(obj) = container_patch.as_object_mut() {
        obj.insert("name".into(), serde_json::Value::String(container.clone()));
    }
    let alias_val = alias.as_deref().unwrap_or("").trim();
    let alias_final = if alias_val.is_empty() { name.as_str() } else { alias_val };

    let patch = serde_json::json!({
        "metadata": {
            "annotations": {
                "kubesphere.io/alias-name": alias_final
            }
        },
        "spec": {
            "replicas": replicas.unwrap_or(1),
            "template": {
                "spec": {
                    "containers": [container_patch]
                }
            }
        }
    });

    let (s2, resp) = ks_api_raw(
        "PATCH",
        &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"),
        Some(patch.to_string()),
        Some("application/merge-patch+json"),
    )?;
    if s2 != 200 {
        let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("未知错误");
        return Err(format!("更新失败 HTTP {s2}: {msg}"));
    }

    let (s3, ver) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments/{dep}"), None)?;
    let new_image = if s3 == 200 {
        ver.pointer("/spec/template/spec/containers/0/image")
            .and_then(|v| v.as_str())
            .unwrap_or(&image)
            .to_string()
    } else {
        image.clone()
    };
    let new_rev = if s3 == 200 {
        ver.pointer("/metadata/annotations/deployment.kubernetes.io~1revision")
            .and_then(|v| v.as_str())
            .unwrap_or(&old_rev)
            .to_string()
    } else {
        old_rev.clone()
    };
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_update_deployment ok name={name} rev={new_rev}"),
    );
    Ok(UpdateResult {
        ok: new_image == image.trim(),
        old_image,
        new_image,
        revision: new_rev,
    })
}

/// 登出（清空内存会话；传 env_id 时同时清该环境落盘缓存）
#[tauri::command]
pub fn ks_logout(env_id: Option<String>) -> Result<(), String> {
    let mut guard = SESSION.lock().map_err(|_| "会话锁不可用".to_string())?;
    *guard = None;
    if let Some(id) = env_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        clear_persisted(Some(id));
        crate::diag::diag_log("kubesphere", &format!("ks_logout cleared env={id}"));
    } else {
        crate::diag::diag_log("kubesphere", "ks_logout memory only");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
fn urlencoding(s: &str) -> String {
    // 仅编码非 ASCII 与保留字符，命名空间/部署名一般安全
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "-_.~".contains(c) {
                c.to_string()
            } else {
                let mut buf = [0u8; 4];
                c.encode_utf8(&mut buf).as_bytes().iter().map(|b| format!("%{b:02X}")).collect()
            }
        })
        .collect()
}

fn selector_of(dep: &serde_json::Value) -> String {
    dep.pointer("/spec/selector/matchLabels")
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .map(|(k, v)| format!("{k}={}", v.as_str().unwrap_or("")))
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default()
}

/// 取 ownerReferences 中指定 kind 的 name
fn owner_name(obj: &serde_json::Value, kind: &str) -> Option<String> {
    obj.pointer("/metadata/ownerReferences")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|o| o.get("kind").and_then(|k| k.as_str()) == Some(kind))
        })
        .and_then(|o| o.get("name").and_then(|v| v.as_str()).map(String::from))
}

/// list 触达 limit 或带 continue 时打诊断日志（避免静默丢数据）
fn warn_if_list_truncated(kind: &str, json: &serde_json::Value, count: usize, limit: u32) {
    let has_continue = json
        .pointer("/metadata/continue")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if has_continue || count as u32 >= limit {
        crate::diag::diag_log(
            "kubesphere",
            &format!(
                "list truncated? kind={kind} count={count} limit={limit} continue={has_continue}"
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_matches_python_reference() {
        // Python 已验证输出（与浏览器前端一致）
        let got = ks_encrypt("kubesphere", "1qaz!QAZ@klcj");
        let expected = "MDEwMTAxMDExMTExMTAxMTExMDE=@\\fTfllW[a]^LSMniS\\GI";
        assert_eq!(got, expected, "encrypt mismatch: {got:?}");
    }

    #[test]
    fn infra_http_covers_gateway_errors() {
        assert!(is_infra_http(502));
        assert!(is_infra_http(503));
        assert!(is_infra_http(504));
        assert!(is_infra_http(500));
        assert!(!is_infra_http(401));
        assert!(!is_infra_http(200));
    }

    #[test]
    fn unreachable_msg_keeps_session_hint() {
        let msg = console_unreachable_msg("探测 HTTP 502", "会话已保留");
        assert!(msg.contains("控制台暂时不可用"));
        assert!(msg.contains("不会强制重新登录"));
        assert!(msg.contains("会话已保留"));
    }

    #[test]
    fn password_for_session_matches_env_id() {
        // 不依赖真实配置文件：构造 Session 后若配置无匹配应返回明确错误
        let sess = Session {
            env_id: "__nonexistent_env__".into(),
            console: "http://example.invalid:30880".into(),
            username: "nobody".into(),
            cookie: "token=x".into(),
        };
        let err = password_for_session(&sess).unwrap_err();
        assert!(
            err.contains("找不到环境") || err.contains("未保存密码"),
            "unexpected err: {err}"
        );
    }

    #[test]
    fn owner_name_picks_matching_kind() {
        let obj = serde_json::json!({
            "metadata": {
                "ownerReferences": [
                    { "kind": "ReplicaSet", "name": "app-7d9f" },
                    { "kind": "Deployment", "name": "app" }
                ]
            }
        });
        assert_eq!(owner_name(&obj, "Deployment").as_deref(), Some("app"));
        assert_eq!(owner_name(&obj, "ReplicaSet").as_deref(), Some("app-7d9f"));
        assert_eq!(owner_name(&obj, "Pod"), None);
    }
}

#[cfg(test)]
mod integration {
    use super::*;

    #[test]
    #[ignore] // 需要真实控制台；手动运行: cargo test -- --ignored
    fn real_login_and_list() {
        let r = ks_connect(
            "dev".into(),
            "http://192.168.31.254:30880".into(),
            "admin".into(),
            "1qaz!QAZ@klcj".into(),
        ).expect("connect failed");
        println!("connect mode={} msg={}", r.mode, r.message);
        let ns = ks_list_namespaces().expect("ns failed");
        println!("namespaces: {:?}", ns);
        let deps = ks_list_deployments("klcj-zt-dev".into()).expect("deps failed");
        for d in &deps {
            println!("{} | {} | {} | new{} old{}", d.name, d.status.label, d.status.detail, d.pods.new_pods.len(), d.pods.old_pods.len());
        }
        // 无变更发布测试（相同镜像 -> 不产生新 revision）
        let gen = deps.iter().find(|d| d.name == "kunlunchuangjie-gen").expect("gen");
        let r = ks_update_image(
            "klcj-zt-dev".into(), "kunlunchuangjie-gen".into(),
            "gen".into(), gen.image.clone(),
        ).expect("update failed");
        println!("update: ok={} rev={} img_same={}", r.ok, r.revision, r.old_image == r.new_image);
        // 创建部署（dryRun 校验，不实际创建）——使用用户提供的 finance YAML 结构
        let create = ks_create_deployment(
            "klcj-zt-dev".into(),
            "ks-create-dryrun-test".into(),
            "dockerhub.kubekey.local/tksy-admin/test:v1".into(),
            Some("测试服务".into()),
            Some(8080),
            Some(1),
            Some(vec!["TZ=Asia/Shanghai".into(), "REDIS_PASSWORD=xxx".into()]),
            Some("klcj-ad-service".into()),
            Some("/actuator/health".into()),
            Some(true),
        ).expect("create dryRun failed");
        println!("create(dryRun): {create}");
        let preview = ks_preview_deployment(
            "klcj-zt-dev".into(),
            "preview-test".into(),
            "dockerhub.kubekey.local/tksy-admin/test:v1".into(),
            Some("预览".into()),
            Some(9616),
            Some(1),
            Some(vec!["TZ=Asia/Shanghai".into()]),
            Some("klcj-ad-service".into()),
            Some("/health".into()),
        ).expect("preview failed");
        println!("preview head: {}", &preview.lines().next().unwrap_or(""));
        // ConfigMap：列表 + 表单创建 dryRun + YAML 创建 dryRun + 预览
        let cms = ks_list_configmaps("klcj-zt-dev".into()).expect("cm list failed");
        println!("configmaps: {} (first: {:?})", cms.len(), cms.first().map(|c| &c.name));
        let cm_create = ks_create_configmap(
            "klcj-zt-dev".into(),
            "ks-cm-dryrun-test".into(),
            vec!["TZ=Asia/Shanghai".into(), "SPRING_PROFILES_ACTIVE=dev".into()],
            Some(true),
        ).expect("cm create dryRun failed");
        println!("cm create(dryRun): {cm_create}");
        let cm_yaml = ks_create_configmap_yaml(
            "klcj-zt-dev".into(),
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ks-cm-yaml-test\n  namespace: klcj-zt-dev\ndata:\n  KEY: value\n".into(),
            Some(true),
        ).expect("cm yaml dryRun failed");
        println!("cm yaml(dryRun): {cm_yaml}");
        let cm_preview = ks_preview_configmap(
            "klcj-zt-dev".into(),
            "cm-preview".into(),
            vec!["A=1".into(), "B=2".into()],
        ).expect("cm preview failed");
        println!("cm preview head: {}", cm_preview.lines().next().unwrap_or(""));
    }
}
