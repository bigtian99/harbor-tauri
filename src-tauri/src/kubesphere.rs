//! KubeSphere 控制台 API 客户端
//!
//! 集成「修改 Deployment 镜像并发布」能力：
//!   1. 登录（复刻控制台前端自定义加密，Cookie 会话）
//!   2. 命名空间 / 部署列表（含实时状态，按新/旧 ReplicaSet 分组）
//!   3. strategic-merge-patch 改镜像触发滚动发布

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use reqwest::header::{HeaderMap, SET_COOKIE};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

const ENCRYPT_KEY: &str = "kubesphere";

/// 当前登录会话（进程内缓存）
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

struct Session {
    console: String,
    cookie: String, // "token=..; refreshToken=..; expire=.."
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

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

fn login(console: &str, username: &str, password: &str) -> Result<Session, String> {
    // 禁用重定向：login 可能返回 302，Set-Cookie 在首个响应上，跟随重定向会丢失
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
    let base = console.trim_end_matches('/');
    let body = serde_json::json!({ "username": username, "encrypt": ks_encrypt(ENCRYPT_KEY, password) });
    let resp = client
        .post(format!("{base}/login"))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("登录请求失败: {e}"))?;
    let status = resp.status().as_u16();
    let cookies = parse_set_cookies(resp.headers());
    if !cookies.contains_key("token") {
        let body_snippet = resp.text().unwrap_or_default();
        let snippet: String = body_snippet.chars().take(200).collect();
        return Err(format!(
            "登录失败：未获得 token Cookie（HTTP {status}）\n响应: {snippet}"
        ));
    }
    let cookie = ["token", "refreshToken", "expire"]
        .iter()
        .filter_map(|k| cookies.get(*k).map(|v| format!("{k}={v}")))
        .collect::<Vec<_>>()
        .join("; ");
    Ok(Session { console: base.to_string(), cookie })
}

/// 同源 API 调用（Cookie 认证）
fn ks_api(method: &str, path: &str, body: Option<serde_json::Value>) -> Result<(u16, serde_json::Value), String> {
    let guard = SESSION.lock().map_err(|_| "会话锁不可用".to_string())?;
    let sess = guard.as_ref().ok_or("请先连接 KubeSphere（登录）")?;
    let client = http_client()?;
    let url = format!("{}{}", sess.console, path);
    let mut req = match method {
        "GET" => client.get(&url),
        "PATCH" => {
            let mut r = client.patch(&url);
            if let Some(b) = body {
                r = r.header("Content-Type", "application/strategic-merge-patch+json").body(b.to_string());
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
    let json = if text.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null)
    };
    Ok((status, json))
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
    pub image: String,
    pub containers: Vec<String>,
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
    let meta = po.get("metadata").cloned().unwrap_or_default();
    let status = po.get("status").cloned().unwrap_or_default();
    PodInfo {
        name: meta.pointer("/name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        phase: status.pointer("/phase").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        state,
        reason,
        restarts,
        ready,
        total,
        start_time: status.pointer("/startTime").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        node: po.pointer("/spec/nodeName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// 登录 KubeSphere 控制台（成功后缓存会话，供后续命令使用）
#[tauri::command]
pub fn ks_login(console: String, username: String, password: String) -> Result<(), String> {
    crate::diag::diag_log(
        "kubesphere",
        &format!("ks_login console={console} user={username}"),
    );
    match login(&console, &username, &password) {
        Ok(sess) => {
            let mut guard = SESSION.lock().map_err(|_| "会话锁不可用".to_string())?;
            *guard = Some(sess);
            crate::diag::diag_log("kubesphere", "ks_login ok");
            Ok(())
        }
        Err(e) => {
            crate::diag::diag_log("kubesphere", &format!("ks_login failed: {e}"));
            Err(e)
        }
    }
}

/// 列出集群全部命名空间
#[tauri::command]
pub fn ks_list_namespaces() -> Result<Vec<String>, String> {
    let (status, json) = ks_api("GET", "/api/v1/namespaces?limit=100", None)?;
    if status != 200 {
        return Err(format!("读取命名空间失败 HTTP {status}"));
    }
    let mut names: Vec<String> = json
        .pointer("/items")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|it| it.pointer("/metadata/name").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    Ok(names)
}

/// 列出命名空间下全部 Deployment（含实时状态 + 新/旧 Pod 明细）
#[tauri::command]
pub fn ks_list_deployments(namespace: String) -> Result<Vec<DeployInfo>, String> {
    let ns = urlencoding(&namespace);
    let (status, json) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/deployments?limit=100"), None)?;
    if status != 200 {
        return Err(format!("读取部署列表失败 HTTP {status}"));
    }
    let items = json.pointer("/items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut out: Vec<DeployInfo> = Vec::with_capacity(items.len());
    for it in items {
        let name = it.pointer("/metadata/name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let containers: Vec<String> = it
            .pointer("/spec/template/spec/containers")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|c| c.get("name").and_then(|v| v.as_str()).map(String::from)).collect())
            .unwrap_or_default();
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
                arr.iter().find(|c| c.get("type").and_then(|t| t.as_str()) == Some("Progressing"))
            })
            .and_then(|c| c.get("reason").and_then(|v| v.as_str()))
            .map(String::from);

        // ReplicaSet revision 映射（区分新/旧 Pod）
        let mut rs_map: HashMap<String, String> = HashMap::new();
        if let Ok((_, rsd)) = ks_api("GET", &format!("/apis/apps/v1/namespaces/{ns}/replicasets?labelSelector={}&limit=50", selector_of(&it)), None) {
            if let Some(arr) = rsd.pointer("/items").and_then(|v| v.as_array()) {
                for rs in arr {
                    if let (Some(n), Some(rev)) = (
                        rs.pointer("/metadata/name").and_then(|v| v.as_str()),
                        rs.pointer("/metadata/annotations/deployment.kubernetes.io~1revision").and_then(|v| v.as_str()),
                    ) {
                        rs_map.insert(n.to_string(), rev.to_string());
                    }
                }
            }
        }

        let mut new_pods: Vec<PodInfo> = Vec::new();
        let mut old_pods: Vec<PodInfo> = Vec::new();
        if let Ok((_, pd)) = ks_api("GET", &format!("/api/v1/namespaces/{ns}/pods?labelSelector={}&limit=20", selector_of(&it)), None) {
            if let Some(arr) = pd.pointer("/items").and_then(|v| v.as_array()) {
                for po in arr {
                    let info = parse_pod(po);
                    let owner_rs = po
                        .pointer("/metadata/ownerReferences")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| {
                            arr.iter().find(|o| o.get("kind").and_then(|k| k.as_str()) == Some("ReplicaSet"))
                        })
                        .and_then(|o| o.get("name").and_then(|v| v.as_str()));
                    let is_new = match (cur_rev.as_deref(), owner_rs) {
                        (Some(rev), Some(rs)) => rs_map.get(rs).map(|r| r == rev).unwrap_or(false),
                        _ => false,
                    };
                    if is_new { new_pods.push(info) } else { old_pods.push(info) }
                }
            }
        }
        new_pods.sort_by(|a, b| b.start_time.cmp(&a.start_time));
        old_pods.sort_by(|a, b| b.start_time.cmp(&a.start_time));

        let status = deploy_status(prog_reason.as_deref(), desired, &new_pods, &old_pods);
        out.push(DeployInfo {
            name,
            image,
            containers,
            status,
            pods: PodsGroup { new_pods, old_pods },
            revision: cur_rev.unwrap_or_default(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
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

/// 登出（清空会话）
#[tauri::command]
pub fn ks_logout() -> Result<(), String> {
    let mut guard = SESSION.lock().map_err(|_| "会话锁不可用".to_string())?;
    *guard = None;
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
}

#[cfg(test)]
mod integration {
    use super::*;

    #[test]
    #[ignore] // 需要真实控制台；手动运行: cargo test -- --ignored
    fn real_login_and_list() {
        let sess = login("http://192.168.31.254:30880", "admin", "1qaz!QAZ@klcj").expect("login failed");
        println!("cookie head: {}", &sess.cookie[..60]);
        *SESSION.lock().unwrap() = Some(sess);
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
    }
}
