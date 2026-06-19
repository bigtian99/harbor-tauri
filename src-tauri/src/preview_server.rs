//! 落地页预览用的本地静态 HTTP 服务器。
//!
//! 目的：模板 index.html 里依赖大量本地相对路径图片/字体（如 `./image/xxx.png`、
//! `url("./font/xxx.ttf")`），用 Tauri asset 协议 + iframe 加载时这些子资源经常解析失败，
//! 导致预览里本地图片显示不出来。而 FTP 上传后是正常 HTTP 服务，相对路径能正常解析。
//!
//! 解决方案：在应用内起一个只监听 127.0.0.1 的静态服务器，把生成的落地页输出目录作为根目录，
//! iframe 直接用 `http://127.0.0.1:port/.../index.html` 加载——加载环境与 FTP 部署完全一致，
//! 相对路径自然好使。**只读不改文件**，FTP 上传的内容一字不变。
//!
//! 注意：本服务器**有意不下发 CSP 头**，让预览页与真实 HTTP 部署一致（内联脚本、远程字体
//! 等都正常加载）。服务器只监听 127.0.0.1、只读本地模板目录，且仅响应 GET/HEAD，风险可控。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tiny_http::{Header, Response, Server};

/// 预览服务器运行时信息（暴露给前端）
#[derive(Serialize, Clone)]
pub struct PreviewServerInfo {
    /// 监听端口
    pub port: u16,
    /// 服务器根目录（绝对路径，等于落地页输出根目录）
    pub root: String,
    /// 拼好的基地址，前端 iframe 直接用
    pub base_url: String,
}

/// Tauri 托管状态
pub struct PreviewServerState {
    pub info: PreviewServerInfo,
}

/// 落地页输出根目录——复用 landing 模块的单一真相源，避免两处硬编码漂移。
fn preview_root() -> PathBuf {
    crate::landing::landing_temp_root()
}

/// 在应用启动时启动预览服务器，并把状态托管到 app 上。
pub fn start(app: &tauri::App) {
    let root = preview_root();
    let _ = fs::create_dir_all(&root);

    // 绑定 127.0.0.1:0 让系统分配空闲端口
    let server = match Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[JarPorter] ⚠️ 预览服务器启动失败: {}", e);
            return;
        }
    };

    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .unwrap_or(0);

    eprintln!(
        "[JarPorter] 🔌 预览服务器已启动: http://127.0.0.1:{} (root={})",
        port,
        root.display()
    );

    let info = PreviewServerInfo {
        port,
        root: root.to_string_lossy().to_string(),
        base_url: format!("http://127.0.0.1:{}", port),
    };

    app.manage(PreviewServerState { info });

    // 后台线程处理请求
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_request(request, &root);
        }
    });
}

#[tauri::command]
pub fn get_preview_server_info(state: tauri::State<PreviewServerState>) -> PreviewServerInfo {
    state.info.clone()
}

fn handle_request(request: tiny_http::Request, root: &Path) {
    // 预览只读，仅允许 GET/HEAD，其余一律 405
    let method = request.method().as_str();
    if method != "GET" && method != "HEAD" {
        let _ = request.respond(Response::empty(405));
        return;
    }

    let raw_url = request.url();
    let path_only = raw_url.split('?').next().unwrap_or(raw_url);
    let decoded = percent_decode(path_only);
    let rel = decoded.trim_start_matches('/');

    let full = root.join(rel);
    let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());

    // 路径穿越防护：解析后的真实路径必须在根目录之内
    let canon = match full.canonicalize() {
        Ok(c) => c,
        Err(_) => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };
    if !canon.starts_with(&root_canon) {
        let _ = request.respond(Response::empty(403));
        return;
    }

    // 目录则回退到 index.html
    let target = if canon.is_dir() {
        let idx = canon.join("index.html");
        if idx.exists() {
            idx
        } else {
            let _ = request.respond(Response::empty(404));
            return;
        }
    } else {
        canon
    };

    serve_file(request, &target);
}

fn serve_file(request: tiny_http::Request, path: &Path) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };
    let ct = content_type(path);
    let resp = Response::from_file(file).with_header(
        Header::from_bytes("Content-Type", ct.as_bytes()).expect("valid header"),
    );
    let _ = request.respond(resp);
}

fn content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("bmp") => "image/bmp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("eot") => "application/vnd.ms-fontobject",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// 简易百分号解码（路径里可能含中文/空格）
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(a), Some(b)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((a << 4) | b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}
