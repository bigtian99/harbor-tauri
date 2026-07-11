use crate::models::{FtpUploadItem, FtpUploadResult};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;

const FTP_HOST: &str = "120.77.204.231";
const FTP_USER: &str = "admin";
const FTP_PASS: &str = "pcm520..";
const FTP_BASE_DIR: &str = "common.tiankongshuyu.fun";

// ========== FTP 上传功能 ==========

/// 使用原生 FTP 协议上传目录（带重试）
pub(crate) fn run_ftp_upload(
    local_dir: &Path,
    remote_dir: &str,
) -> Result<(), String> {
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        match run_ftp_upload_once(local_dir, remote_dir) {
            Ok(()) => return Ok(()),
            Err(e) => {
                crate::diag::diag_log(
                    "landing",
                    &format!("⚠️ 上传失败 (第{}次): {}", attempt, e),
                );
                last_error = e;
                if attempt < max_retries {
                    crate::diag::diag_log("landing", "⏳ 等待 2 秒后重试...");
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
    }

    Err(format!("上传失败（已重试{}次）: {}", max_retries, last_error))
}

struct FtpClient {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
}

impl FtpClient {
    fn connect() -> Result<Self, String> {
        let stream = TcpStream::connect((FTP_HOST, 21))
            .map_err(|e| format!("连接 FTP 服务器失败: {}", e))?;
        set_ftp_timeouts(&stream)?;
        let writer = stream
            .try_clone()
            .map_err(|e| format!("初始化 FTP 连接失败: {}", e))?;
        let mut client = Self {
            reader: BufReader::new(stream),
            writer,
        };

        let (code, message) = client.read_response()?;
        if code != 220 {
            return Err(format!("FTP 服务器拒绝连接: {}", message.trim()));
        }

        let (code, message) = client.command(&format!("USER {}", FTP_USER))?;
        match code {
            230 => {}
            331 => {
                client.command_expect("PASS ******", &format!("PASS {}", FTP_PASS), &[230])?;
            }
            _ => return Err(format!("FTP 登录失败: {}", message.trim())),
        }
        client.command_expect("OPTS UTF8 ON", "OPTS UTF8 ON", &[200]).ok();
        client.command_expect("TYPE I", "TYPE I", &[200])?;
        Ok(client)
    }

    fn read_response(&mut self) -> Result<(u32, String), String> {
        let mut message = String::new();
        let mut expected_code: Option<u32> = None;

        loop {
            let mut line = String::new();
            let count = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("读取 FTP 响应失败: {}", e))?;
            if count == 0 {
                return Err(format!("FTP 连接已关闭: {}", message.trim()));
            }
            message.push_str(&line);

            if line.len() < 4 || !line.as_bytes()[0..3].iter().all(u8::is_ascii_digit) {
                continue;
            }
            let code = line[0..3].parse::<u32>().unwrap_or(0);
            let separator = line.as_bytes().get(3).copied();
            match expected_code {
                None if separator == Some(b' ') => return Ok((code, message)),
                None => expected_code = Some(code),
                Some(expected) if code == expected && separator == Some(b' ') => {
                    return Ok((code, message));
                }
                _ => {}
            }
        }
    }

    fn command(&mut self, command: &str) -> Result<(u32, String), String> {
        self.writer
            .write_all(command.as_bytes())
            .and_then(|_| self.writer.write_all(b"\r\n"))
            .and_then(|_| self.writer.flush())
            .map_err(|e| format!("发送 FTP 命令失败: {}", e))?;
        self.read_response()
    }

    fn command_expect(
        &mut self,
        label: &str,
        command: &str,
        allowed_codes: &[u32],
    ) -> Result<String, String> {
        let (code, message) = self.command(command)?;
        if allowed_codes.contains(&code) {
            Ok(message)
        } else {
            Err(format!("FTP 命令失败 {}: {}", label, message.trim()))
        }
    }

    fn cwd(&mut self, dir: &str) -> Result<(), String> {
        self.command_expect(&format!("CWD {}", dir), &format!("CWD {}", dir), &[250])
            .map(|_| ())
    }

    fn ensure_dir(&mut self, path: &str) -> Result<(), String> {
        for part in path.split('/') {
            if part.trim().is_empty() {
                continue;
            }
            if self.cwd(part).is_err() {
                let _ = self.command_expect(&format!("MKD {}", part), &format!("MKD {}", part), &[257, 250]);
                self.cwd(part)?;
            }
        }
        Ok(())
    }

    fn open_passive_data(&mut self) -> Result<TcpStream, String> {
        let message = self.command_expect("PASV", "PASV", &[227])?;
        let (host, port) = parse_pasv_response(&message)?;
        let data = TcpStream::connect((host.as_str(), port))
            .map_err(|e| format!("连接 FTP 数据通道失败 {}:{}: {}", host, port, e))?;
        set_ftp_timeouts(&data)?;
        Ok(data)
    }

    fn upload_file(&mut self, name: &str, path: &Path) -> Result<(), String> {
        let mut data = self.open_passive_data()?;
        self.command_expect(&format!("STOR {}", name), &format!("STOR {}", name), &[125, 150])?;

        let mut file = fs::File::open(path)
            .map_err(|e| format!("读取待上传文件失败 {}: {}", path.display(), e))?;
        std::io::copy(&mut file, &mut data)
            .map_err(|e| format!("上传文件失败 {}: {}", name, e))?;
        data.shutdown(std::net::Shutdown::Write).ok();
        drop(data);

        let (code, message) = self.read_response()?;
        if code == 226 || code == 250 {
            Ok(())
        } else {
            Err(format!("FTP 上传文件失败 {}: {}", name, message.trim()))
        }
    }
}

fn set_ftp_timeouts(stream: &TcpStream) -> Result<(), String> {
    let timeout = Some(Duration::from_secs(30));
    stream
        .set_read_timeout(timeout)
        .and_then(|_| stream.set_write_timeout(timeout))
        .map_err(|e| format!("设置 FTP 超时失败: {}", e))
}

fn parse_pasv_response(message: &str) -> Result<(String, u16), String> {
    let payload = message
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')').map(|(inside, _)| inside))
        .unwrap_or(message);
    let nums: Vec<u16> = payload
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<u16>().ok())
        .collect();
    if nums.len() < 6 {
        return Err(format!("无法解析 FTP 被动模式响应: {}", message.trim()));
    }
    let nums = &nums[nums.len() - 6..];
    let mut host = format!("{}.{}.{}.{}", nums[0], nums[1], nums[2], nums[3]);
    let use_control_host = host == "0.0.0.0"
        || host
            .parse::<Ipv4Addr>()
            .map(|ip| ip.is_private() || ip.is_loopback() || ip.is_link_local())
            .unwrap_or(false);
    if use_control_host {
        host = FTP_HOST.to_string();
    }
    let port = nums[4] * 256 + nums[5];
    if port == 0 {
        return Err(format!("FTP 被动模式端口无效: {}", message.trim()));
    }
    Ok((host, port))
}

fn upload_dir_native(client: &mut FtpClient, local_dir: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(local_dir)
        .map_err(|e| format!("读取上传目录失败 {}: {}", local_dir.display(), e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取上传目录失败 {}: {}", local_dir.display(), e))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|e| format!("读取文件信息失败 {}: {}", path.display(), e))?;
        if metadata.is_dir() {
            client.ensure_dir(&name)?;
            upload_dir_native(client, &path)?;
            client.cwd("..")?;
        } else if metadata.is_file() {
            crate::diag::diag_log(
                "landing",
                &format!("📤 FTP 上传文件: {} ({} bytes)", name, metadata.len()),
            );
            client.upload_file(&name, &path)?;
        }
    }
    Ok(())
}

/// 单次上传
fn run_ftp_upload_once(
    local_dir: &Path,
    remote_dir: &str,
) -> Result<(), String> {
    let mut client = FtpClient::connect()?;
    client.cwd(FTP_BASE_DIR).ok();
    client.ensure_dir(remote_dir)?;
    upload_dir_native(&mut client, local_dir)?;
    client.command_expect("QUIT", "QUIT", &[221]).ok();
    Ok(())
}

#[tauri::command]
pub async fn upload_landing_to_ftp(
    app: tauri::AppHandle,
    items: Vec<FtpUploadItem>,
) -> Result<Vec<FtpUploadResult>, String> {
    use std::sync::{Arc, Mutex};

    let total = items.len();

    app.emit("build-progress", serde_json::json!({
        "percent": 0,
        "message": format!("📤 准备上传 {} 个文件...", total)
    })).ok();

    // 并行上传，限制并发数为 3
    let max_concurrent = 3;
    let completed = Arc::new(Mutex::new(0));
    let mut handles: Vec<Option<std::thread::JoinHandle<FtpUploadResult>>> = Vec::new();

    for (_idx, item) in items.iter().enumerate() {
        // 控制并发数：等待一个完成后再启动新的
        if handles.len() >= max_concurrent {
            if let Some(handle) = handles.remove(0) {
                let _ = handle.join();
            }
        }

        let app_clone = app.clone();
        let item_clone = item.clone();
        let total_clone = total;
        let completed_clone = completed.clone();

        let handle = std::thread::spawn(move || {
            let local_dir = PathBuf::from(&item_clone.local_dir);
            if !local_dir.is_dir() {
                crate::diag::diag_log(
                    "landing",
                    &format!("❌ 本地目录不存在: {}", item_clone.local_dir),
                );
                // 即使失败也更新进度
                let mut c = completed_clone.lock().unwrap();
                *c += 1;
                let progress = ((*c as f64 / total_clone as f64) * 100.0) as i32;
                drop(c);
                app_clone.emit("build-progress", serde_json::json!({
                    "percent": progress,
                    "message": format!("📤 [{}/{}] 完成", *completed_clone.lock().unwrap(), total_clone),
                })).ok();
                return FtpUploadResult {
                    id: item_clone.id.clone(),
                    url: String::new(),
                    status: "error".to_string(),
                    message: format!("本地目录不存在: {}", item_clone.local_dir),
                };
            }

            crate::diag::diag_log(
                "landing",
                &format!("📤 上传: {}", item_clone.remote_dir),
            );

            let result = match run_ftp_upload(&local_dir, &item_clone.remote_dir) {
                Ok(()) => {
                    let url = format!("https://{}/{}/", FTP_BASE_DIR, &item_clone.remote_dir);
                    crate::diag::diag_log("landing", &format!("✅ 上传成功: {}", url));
                    FtpUploadResult {
                        id: item_clone.id.clone(),
                        url,
                        status: "success".to_string(),
                        message: "上传成功".to_string(),
                    }
                }
                Err(e) => {
                    crate::diag::diag_log("landing", &format!("❌ 上传失败: {}", e));
                    FtpUploadResult {
                        id: item_clone.id.clone(),
                        url: String::new(),
                        status: "error".to_string(),
                        message: e,
                    }
                }
            };

            // 更新完成计数和进度
            let mut c = completed_clone.lock().unwrap();
            *c += 1;
            let progress = ((*c as f64 / total_clone as f64) * 100.0) as i32;
            let current = *c;
            drop(c);
            app_clone.emit("build-progress", serde_json::json!({
                "percent": progress,
                "message": format!("📤 [{}/{}] 完成", current, total_clone),
            })).ok();

            result
        });
        handles.push(Some(handle));
    }

    // 等待剩余线程完成
    let mut results = Vec::new();
    for handle in handles.into_iter().flatten() {
        if let Ok(result) = handle.join() {
            results.push(result);
        }
    }

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 100,
            "message": "✅ FTP 上传完成！",
        }),
    )
    .ok();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::parse_pasv_response;

    #[test]
    fn parse_pasv_response_extracts_host_and_port() {
        // 192.168.1.2: 20*256+80 = 5200 — private host is rewritten to control host
        let (host, port) =
            parse_pasv_response("227 Entering Passive Mode (192,168,1,2,20,80).").unwrap();
        assert_eq!(port, 5200);
        // private IP → 使用控制连接主机
        assert_eq!(host, super::FTP_HOST);
    }

    #[test]
    fn parse_pasv_response_keeps_public_host() {
        let (host, port) =
            parse_pasv_response("227 Entering Passive Mode (8,8,8,8,1,2).").unwrap();
        assert_eq!(host, "8.8.8.8");
        assert_eq!(port, 256 + 2);
    }

    #[test]
    fn parse_pasv_response_rejects_short_payload() {
        let err = parse_pasv_response("227 bad").unwrap_err();
        assert!(err.contains("无法解析"), "{err}");
    }

    #[test]
    fn parse_pasv_response_rejects_zero_port() {
        let err = parse_pasv_response("227 Entering Passive Mode (1,2,3,4,0,0).").unwrap_err();
        assert!(err.contains("端口无效"), "{err}");
    }
}
