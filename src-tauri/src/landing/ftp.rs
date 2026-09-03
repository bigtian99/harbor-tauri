use crate::models::{FtpUploadItem, FtpUploadResult, HarborConfig};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// 落地页 FTP 凭证：必须从配置读取，源码不写死明文密码。
pub(crate) fn require_landing_ftp(
    config: &HarborConfig,
) -> Result<(String, String, String, String), String> {
    let host = config.landing_ftp_host.trim().to_string();
    let user = config.landing_ftp_user.trim().to_string();
    let pass = config.landing_ftp_pass.trim().to_string();
    let base = config.landing_ftp_base_dir.trim().to_string();
    if host.is_empty() || user.is_empty() || pass.is_empty() {
        return Err(
            "请先在设置 → 连接 中配置落地页 FTP 主机、用户和密码后再上传".to_string(),
        );
    }
    Ok((host, user, pass, base))
}

/// 隐私协议 FTP：主机可单独配；用户/密码复用落地页 FTP。
pub(crate) fn require_privacy_ftp(
    config: &HarborConfig,
) -> Result<(String, String, String), String> {
    let host = config.privacy_ftp_host.trim().to_string();
    let user = config.landing_ftp_user.trim().to_string();
    let pass = config.landing_ftp_pass.trim().to_string();
    if host.is_empty() || user.is_empty() || pass.is_empty() {
        return Err(
            "请先在设置 → 连接 中配置隐私 FTP 主机，以及落地页 FTP 用户/密码后再操作"
                .to_string(),
        );
    }
    Ok((host, user, pass))
}

// ========== FTP 上传功能 ==========

struct FtpClient {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    control_host: String,
}

impl FtpClient {
    fn connect_with(host: &str, user: &str, pass: &str) -> Result<Self, String> {
        use std::net::ToSocketAddrs;
        let sock_addr = (host, 21u16)
            .to_socket_addrs()
            .map_err(|e| format!("解析 FTP 主机失败 {}: {}", host, e))?
            .next()
            .ok_or_else(|| format!("无法解析 FTP 主机: {}", host))?;
        let stream = TcpStream::connect_timeout(&sock_addr, Duration::from_secs(10))
            .map_err(|e| format!("连接 FTP 服务器失败 {}:21: {}", host, e))?;
        let _ = stream.set_nodelay(true);
        set_ftp_timeouts(&stream)?;
        let writer = stream
            .try_clone()
            .map_err(|e| format!("初始化 FTP 连接失败: {}", e))?;
        let mut client = Self {
            reader: BufReader::new(stream),
            writer,
            control_host: host.to_string(),
        };

        let (code, message) = client.read_response()?;
        if code != 220 {
            return Err(format!("FTP 服务器拒绝连接: {}", message.trim()));
        }

        let (code, message) = client.command(&format!("USER {}", user))?;
        match code {
            230 => {}
            331 => {
                client.command_expect("PASS ******", &format!("PASS {}", pass), &[230])?;
            }
            _ => return Err(format!("FTP 登录失败: {}", message.trim())),
        }
        client
            .command_expect("OPTS UTF8 ON", "OPTS UTF8 ON", &[200])
            .ok();
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
                let _ = self.command_expect(
                    &format!("MKD {}", part),
                    &format!("MKD {}", part),
                    &[257, 250],
                );
                self.cwd(part)?;
            }
        }
        Ok(())
    }

    fn open_passive_data(&mut self) -> Result<TcpStream, String> {
        let message = self.command_expect("PASV", "PASV", &[227])?;
        let (host, port) = parse_pasv_response(&message, &self.control_host)?;
        let data = TcpStream::connect_timeout(
            &resolve_socket_addr(&host, port)?,
            Duration::from_secs(10),
        )
        .map_err(|e| format!("连接 FTP 数据通道失败 {}:{}: {}", host, port, e))?;
        tune_ftp_data_socket(&data)?;
        Ok(data)
    }

    fn upload_file(&mut self, name: &str, path: &Path) -> Result<(), String> {
        self.upload_file_with_progress::<fn(u64, u64)>(name, path, None)
    }

    fn upload_file_with_progress<F>(
        &mut self,
        name: &str,
        path: &Path,
        on_progress: Option<&mut F>,
    ) -> Result<(), String>
    where
        F: FnMut(u64, u64),
    {
        self.upload_file_with_progress_cancel(name, path, on_progress, None)
    }

    fn upload_file_with_progress_cancel<F>(
        &mut self,
        name: &str,
        path: &Path,
        mut on_progress: Option<&mut F>,
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<(), String>
    where
        F: FnMut(u64, u64),
    {
        let total = fs::metadata(path)
            .map(|m| m.len())
            .unwrap_or(0);
        // 不再在开头 cb(0)：重试时会把 UI 已传大小打回 0，造成「一时多一时少」
        let mut data = self.open_passive_data()?;
        self.command_expect(
            &format!("STOR {}", name),
            &format!("STOR {}", name),
            &[125, 150],
        )?;

        let mut file = fs::File::open(path)
            .map_err(|e| format!("读取待上传文件失败 {}: {}", path.display(), e))?;
        // 1MB 块：减少系统调用与 syscall 往返，显著加快大 JAR 上传
        let mut buf = vec![0u8; 1024 * 1024];
        let mut sent: u64 = 0;
        // 按真实已传字节回调；用时间节流（约 5 次/秒），避免固定 %/MB 台阶感，也不拖慢传输
        let mut last_report_at = Instant::now()
            .checked_sub(Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
        const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(200);
        // 首块写出后立刻报一次，避免长时间停在旧文案
        let mut reported_once = false;
        loop {
            if cancel
                .map(|c| c.load(std::sync::atomic::Ordering::SeqCst))
                .unwrap_or(false)
            {
                data.shutdown(std::net::Shutdown::Both).ok();
                drop(data);
                let _ = self.command("ABOR");
                return Err("已取消".to_string());
            }
            let n = std::io::Read::read(&mut file, &mut buf)
                .map_err(|e| format!("读取待上传文件失败 {}: {}", name, e))?;
            if n == 0 {
                break;
            }
            std::io::Write::write_all(&mut data, &buf[..n])
                .map_err(|e| format!("上传文件失败 {}: {}", name, e))?;
            sent += n as u64;
            if let Some(cb) = on_progress.as_mut() {
                let due = sent == total
                    || !reported_once
                    || last_report_at.elapsed() >= PROGRESS_MIN_INTERVAL;
                if due {
                    cb(sent, total);
                    last_report_at = Instant::now();
                    reported_once = true;
                }
            }
        }
        data.shutdown(std::net::Shutdown::Write).ok();
        drop(data);

        let (code, message) = self.read_response()?;
        if code == 226 || code == 250 {
            if let Some(cb) = on_progress.as_mut() {
                if total > 0 {
                    cb(total, total);
                }
            }
            Ok(())
        } else {
            Err(format!("FTP 上传文件失败 {}: {}", name, message.trim()))
        }
    }

    /// 进入已有远端目录（不创建）。
    fn cwd_path(&mut self, path: &str) -> Result<(), String> {
        let p = path
            .trim()
            .trim_start_matches('/')
            .trim_end_matches('/');
        if p.is_empty() {
            return Ok(());
        }
        // 优先一次 CWD 完整路径，少一轮往返可明显缩短「拖入后卡住」
        if self.cwd(&format!("/{p}")).is_ok() || self.cwd(p).is_ok() {
            return Ok(());
        }
        for part in p.split('/') {
            if part.is_empty() {
                continue;
            }
            self.cwd(part)?;
        }
        Ok(())
    }

    fn download_file(&mut self, name: &str, dest: &Path) -> Result<(), String> {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建本地下载目录失败 {}: {}", parent.display(), e))?;
        }
        let mut data = self.open_passive_data()?;
        self.command_expect(
            &format!("RETR {}", name),
            &format!("RETR {}", name),
            &[125, 150],
        )?;

        let mut file = fs::File::create(dest)
            .map_err(|e| format!("创建本地文件失败 {}: {}", dest.display(), e))?;
        std::io::copy(&mut data, &mut file)
            .map_err(|e| format!("下载文件失败 {}: {}", name, e))?;
        drop(data);

        let (code, message) = self.read_response()?;
        if code == 226 || code == 250 {
            Ok(())
        } else {
            Err(format!("FTP 下载文件失败 {}: {}", name, message.trim()))
        }
    }

    fn quit(mut self) {
        let _ = self.command("QUIT");
    }

    fn alive_noop(&mut self) -> bool {
        matches!(self.command("NOOP"), Ok((code, _)) if code == 200 || code == 250)
    }
}

/// 宝塔 FTP 预连接：打开 Java 页时先握手，拖入 JAR 时复用，避免松手后再等连接。
struct BtFtpPooled {
    client: FtpClient,
    host: String,
    user: String,
    pass: String,
    last_ok: Instant,
}

static BT_FTP_POOL: Mutex<Option<BtFtpPooled>> = Mutex::new(None);
/// 空闲过久视为失效（多数面板 5 分钟断连）
const BT_FTP_MAX_IDLE: Duration = Duration::from_secs(240);

fn bt_ftp_creds_match(p: &BtFtpPooled, host: &str, user: &str, pass: &str) -> bool {
    p.host == host && p.user == user && p.pass == pass
}

fn bt_ftp_take_alive(host: &str, user: &str, pass: &str) -> Option<FtpClient> {
    let mut guard = BT_FTP_POOL.lock().ok()?;
    let pooled = guard.take()?;
    if !bt_ftp_creds_match(&pooled, host, user, pass) {
        pooled.client.quit();
        return None;
    }
    if pooled.last_ok.elapsed() > BT_FTP_MAX_IDLE {
        pooled.client.quit();
        return None;
    }
    let mut client = pooled.client;
    if !client.alive_noop() {
        client.quit();
        return None;
    }
    let _ = client.command_expect("CWD /", "CWD /", &[250]);
    Some(client)
}

fn bt_ftp_put_back(mut client: FtpClient, host: &str, user: &str, pass: &str) {
    let _ = client.command_expect("CWD /", "CWD /", &[250]);
    if !client.alive_noop() {
        client.quit();
        return;
    }
    let Ok(mut guard) = BT_FTP_POOL.lock() else {
        client.quit();
        return;
    };
    if let Some(old) = guard.replace(BtFtpPooled {
        client,
        host: host.to_string(),
        user: user.to_string(),
        pass: pass.to_string(),
        last_ok: Instant::now(),
    }) {
        old.client.quit();
    }
}

/// 预连接宝塔 FTP（可重复调用；已存活则 NOOP 续期）。
pub(crate) fn warmup_bt_ftp_session(
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
) -> Result<(), String> {
    let host = host.trim();
    let user = user.trim();
    let pass = pass.trim();
    if host.is_empty() || user.is_empty() {
        return Err("FTP 主机或用户名为空".to_string());
    }
    if let Some(client) = bt_ftp_take_alive(host, user, pass) {
        bt_ftp_put_back(client, host, user, pass);
        crate::diag::diag_log(log_module, "bt ftp warmup: 复用已有连接");
        return Ok(());
    }
    crate::diag::diag_log(log_module, &format!("bt ftp warmup: 连接 {host}…"));
    let client = FtpClient::connect_with(host, user, pass)?;
    bt_ftp_put_back(client, host, user, pass);
    crate::diag::diag_log(log_module, "bt ftp warmup: 预连接成功");
    Ok(())
}

fn acquire_bt_ftp_client(
    host: &str,
    user: &str,
    pass: &str,
    on_status: &mut Option<&mut dyn FnMut(&str)>,
) -> Result<(FtpClient, bool), String> {
    if let Some(client) = bt_ftp_take_alive(host, user, pass) {
        if let Some(status) = on_status.as_mut() {
            status("复用已预连接的 FTP…");
        }
        return Ok((client, true));
    }
    if let Some(status) = on_status.as_mut() {
        status("正在连接 FTP…");
    }
    let client = FtpClient::connect_with(host, user, pass)?;
    Ok((client, false))
}

fn set_ftp_timeouts(stream: &TcpStream) -> Result<(), String> {
    let timeout = Some(Duration::from_secs(30));
    stream
        .set_read_timeout(timeout)
        .and_then(|_| stream.set_write_timeout(timeout))
        .map_err(|e| format!("设置 FTP 超时失败: {}", e))
}

/// 数据通道：更长超时 + TCP_NODELAY，适合大 JAR 连续写入
fn tune_ftp_data_socket(stream: &TcpStream) -> Result<(), String> {
    let timeout = Some(Duration::from_secs(180));
    stream
        .set_read_timeout(timeout)
        .and_then(|_| stream.set_write_timeout(timeout))
        .map_err(|e| format!("设置 FTP 数据通道超时失败: {}", e))?;
    stream
        .set_nodelay(true)
        .map_err(|e| format!("设置 FTP TCP_NODELAY 失败: {}", e))?;
    Ok(())
}

fn resolve_socket_addr(host: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    use std::net::ToSocketAddrs;
    (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("解析地址失败 {}:{}: {}", host, port, e))?
        .next()
        .ok_or_else(|| format!("无法解析地址: {}:{}", host, port))
}

fn parse_pasv_response(message: &str, control_host: &str) -> Result<(String, u16), String> {
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
        host = control_host.to_string();
    }
    let port = nums[4] * 256 + nums[5];
    if port == 0 {
        return Err(format!("FTP 被动模式端口无效: {}", message.trim()));
    }
    Ok((host, port))
}

fn upload_dir_native(
    client: &mut FtpClient,
    local_dir: &Path,
    log_module: &str,
) -> Result<(), String> {
    upload_dir_native_with_progress::<fn(u64, u64)>(
        client,
        local_dir,
        log_module,
        0,
        &mut 0,
        &mut None,
        None,
    )
}

fn collect_dir_total_bytes(local_dir: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    let mut stack = vec![local_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|e| format!("读取上传目录失败 {}: {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取上传目录失败 {}: {}", dir.display(), e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let metadata = entry
                .metadata()
                .map_err(|e| format!("读取文件信息失败 {}: {}", path.display(), e))?;
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    Ok(total)
}

fn ftp_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel
        .map(|c| c.load(Ordering::SeqCst))
        .unwrap_or(false)
}

fn upload_dir_native_with_progress<F>(
    client: &mut FtpClient,
    local_dir: &Path,
    log_module: &str,
    total_bytes: u64,
    sent: &mut u64,
    on_progress: &mut Option<&mut F>,
    cancel: Option<&AtomicBool>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    let mut entries = fs::read_dir(local_dir)
        .map_err(|e| format!("读取上传目录失败 {}: {}", local_dir.display(), e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取上传目录失败 {}: {}", local_dir.display(), e))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if ftp_cancelled(cancel) {
            return Err("已取消".to_string());
        }
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
            upload_dir_native_with_progress(
                client,
                &path,
                log_module,
                total_bytes,
                sent,
                on_progress,
                cancel,
            )?;
            client.cwd("..")?;
        } else if metadata.is_file() {
            crate::diag::diag_log(
                log_module,
                &format!("📤 FTP 上传文件: {} ({} bytes)", name, metadata.len()),
            );
            let base = *sent;
            let total = if total_bytes > 0 { total_bytes } else { metadata.len() };
            if let Some(cb) = on_progress.as_mut() {
                let mut file_cb = |file_sent: u64, _file_total: u64| {
                    cb(base.saturating_add(file_sent), total);
                };
                client.upload_file_with_progress(&name, &path, Some(&mut file_cb))?;
            } else {
                client.upload_file(&name, &path)?;
            }
            *sent = sent.saturating_add(metadata.len());
            if let Some(cb) = on_progress.as_mut() {
                cb(*sent, total);
            }
        }
    }
    Ok(())
}

/// 使用配置中的落地页 FTP 上传目录（带重试）
pub(crate) fn run_ftp_upload(
    local_dir: &Path,
    remote_dir: &str,
    host: &str,
    user: &str,
    pass: &str,
    base_dir: &str,
) -> Result<(), String> {
    let base = if base_dir.trim().is_empty() {
        None
    } else {
        Some(base_dir.trim())
    };
    run_ftp_upload_with(local_dir, remote_dir, host, user, pass, base, "landing")
}

/// 从 FTP 下载远端目录下的单个文件到本地路径（隐私协议预览等复用）
pub(crate) fn run_ftp_download_file_with(
    remote_dir: &str,
    remote_file: &str,
    local_path: &Path,
    host: &str,
    user: &str,
    pass: &str,
    base_dir: Option<&str>,
    log_module: &str,
) -> Result<(), String> {
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        match (|| -> Result<(), String> {
            let mut client = FtpClient::connect_with(host, user, pass)?;
            if let Some(base) = base_dir {
                if !base.trim().is_empty() {
                    client.cwd(base).ok();
                }
            }
            client.cwd_path(remote_dir)?;
            crate::diag::diag_log(
                log_module,
                &format!(
                    "FTP 下载 {}/{} -> {}",
                    remote_dir,
                    remote_file,
                    local_path.display()
                ),
            );
            client.download_file(remote_file, local_path)?;
            client.command_expect("QUIT", "QUIT", &[221]).ok();
            Ok(())
        })() {
            Ok(()) => return Ok(()),
            Err(e) => {
                crate::diag::diag_log(
                    log_module,
                    &format!("⚠️ FTP 下载失败 (第{}次): {}", attempt, e),
                );
                last_error = e;
                if attempt < max_retries {
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }

    Err(format!(
        "下载失败（已重试{}次）: {}",
        max_retries, last_error
    ))
}

/// 面板 JAR 绝对路径 → FTP 相对路径。
/// 宝塔 FTP 账号通常 chroot 到 `/www/wwwroot`，不能再 CWD `www`。
pub(crate) fn ftp_relative_path_from_panel(panel_path: &str) -> String {
    let normalized = panel_path.trim().replace('\\', "/");
    let mut path = normalized.as_str();
    while path.starts_with('/') {
        path = &path[1..];
    }
    const PREFIXES: &[&str] = &[
        "www/wwwroot/",
        "www/wwwroot",
        "wwwroot/",
        "wwwroot",
    ];
    for prefix in PREFIXES {
        if let Some(rest) = path.strip_prefix(prefix) {
            return rest.trim_start_matches('/').to_string();
        }
    }
    path.to_string()
}

/// 单文件上传到远程路径（面板绝对路径会自动剥 `/www/wwwroot`）。
/// `on_progress(sent, total)` 可选，用于 UI 进度。
pub(crate) fn run_ftp_upload_file_with(
    local_file: &Path,
    remote_full_path: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
) -> Result<(), String> {
    run_ftp_upload_file_with_progress(
        local_file,
        remote_full_path,
        host,
        user,
        pass,
        log_module,
        None::<fn(u64, u64)>,
    )
}

pub(crate) fn run_ftp_upload_file_with_progress<F>(
    local_file: &Path,
    remote_full_path: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
    mut on_progress: Option<F>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    run_ftp_upload_file_with_progress_cancel(
        local_file,
        remote_full_path,
        host,
        user,
        pass,
        log_module,
        on_progress.as_mut(),
        &mut None,
        None,
    )
}

/// 可取消的单文件 FTP 上传（cancel=true 时尽快中断并返回「已取消」）。
/// `on_status` 用于连接/进目录等尚未传字节时的即时文案。
pub(crate) fn run_ftp_upload_file_with_progress_cancel<F>(
    local_file: &Path,
    remote_full_path: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
    mut on_progress: Option<&mut F>,
    on_status: &mut Option<&mut dyn FnMut(&str)>,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    if !local_file.is_file() {
        return Err(format!("本地文件不存在: {}", local_file.display()));
    }
    let remote = remote_full_path.trim();
    if remote.is_empty() {
        return Err("远程路径为空".to_string());
    }
    let ftp_rel = ftp_relative_path_from_panel(remote);
    let remote_path = Path::new(&ftp_rel);
    let file_name = remote_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("无法解析远程文件名: {} (ftp={})", remote, ftp_rel))?
        .to_string();
    let parent = remote_path
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    crate::diag::diag_log(
        log_module,
        &format!(
            "FTP 路径映射 panel={} → rel={} parent={} file={}",
            remote, ftp_rel, parent, file_name
        ),
    );

    let max_retries = 3;
    let mut last_error = String::new();
    for attempt in 1..=max_retries {
        if cancel
            .map(|c| c.load(std::sync::atomic::Ordering::SeqCst))
            .unwrap_or(false)
        {
            return Err("已取消".to_string());
        }
        let result = run_ftp_upload_file_once_cancel(
            local_file,
            &parent,
            &file_name,
            host,
            user,
            pass,
            on_progress.as_deref_mut(),
            on_status,
            cancel,
        );
        match result {
            Ok(()) => {
                crate::diag::diag_log(
                    log_module,
                    &format!("FTP 单文件上传成功 → {} (ftp {})", remote, ftp_rel),
                );
                return Ok(());
            }
            Err(e) if e == "已取消" => {
                crate::diag::diag_log(log_module, "FTP 单文件上传已取消");
                return Err(e);
            }
            Err(e) => {
                crate::diag::diag_log(
                    log_module,
                    &format!("⚠️ FTP 单文件上传失败 (第{}次): {}", attempt, e),
                );
                last_error = e;
                if attempt < max_retries {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        }
    }
    Err(format!(
        "FTP 单文件上传失败（已重试{}次）: {}",
        max_retries, last_error
    ))
}

fn run_ftp_upload_file_once_cancel<F>(
    local_file: &Path,
    remote_parent: &str,
    remote_name: &str,
    host: &str,
    user: &str,
    pass: &str,
    on_progress: Option<&mut F>,
    on_status: &mut Option<&mut dyn FnMut(&str)>,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    let (mut client, _reused) = acquire_bt_ftp_client(host, user, pass, on_status)?;
    let parent = remote_parent.trim().trim_start_matches('/');
    if !parent.is_empty() {
        if let Some(status) = on_status.as_mut() {
            status("正在进入远程目录…");
        }
        let _ = client.command_expect("CWD /", "CWD /", &[250]);
        if let Err(e) = client.cwd_path(parent) {
            client.quit();
            return Err(e);
        }
    }
    if let Some(status) = on_status.as_mut() {
        status("开始传输…");
    }
    let result = match on_progress {
        Some(cb) => {
            client.upload_file_with_progress_cancel(remote_name, local_file, Some(cb), cancel)
        }
        None => {
            let mut noop = |_s: u64, _t: u64| {};
            client.upload_file_with_progress_cancel(
                remote_name,
                local_file,
                Some(&mut noop),
                cancel,
            )
        }
    };
    match result {
        Ok(()) => {
            // 传完放回连接池，下次拖入可跳过握手
            bt_ftp_put_back(client, host, user, pass);
            Ok(())
        }
        Err(e) => {
            client.quit();
            Err(e)
        }
    }
}

/// 上传本地目录**内容**到 FTP 远程目录（自定义账号；面板路径自动剥 `/www/wwwroot`）。
/// 无进度回调的目录上传（隐私协议等场景）
#[allow(dead_code)]
pub(crate) fn run_ftp_upload_dir_auth(
    local_dir: &Path,
    remote_dir: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
) -> Result<(), String> {
    run_ftp_upload_dir_auth_with_progress::<fn(u64, u64)>(
        local_dir,
        remote_dir,
        host,
        user,
        pass,
        log_module,
        None,
    )
}

/// 目录 FTP 上传；`on_progress(sent, total)` 按累计字节回调（与单文件 JAR 上传一致）。
pub(crate) fn run_ftp_upload_dir_auth_with_progress<F>(
    local_dir: &Path,
    remote_dir: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
    on_progress: Option<F>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    run_ftp_upload_dir_auth_with_progress_cancel(
        local_dir,
        remote_dir,
        host,
        user,
        pass,
        log_module,
        on_progress,
        None,
    )
}

/// 可取消的目录 FTP 上传。
pub(crate) fn run_ftp_upload_dir_auth_with_progress_cancel<F>(
    local_dir: &Path,
    remote_dir: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
    mut on_progress: Option<F>,
    cancel: Option<&AtomicBool>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    if !local_dir.is_dir() {
        return Err(format!("本地目录不存在: {}", local_dir.display()));
    }
    let ftp_rel = ftp_relative_path_from_panel(remote_dir);
    if ftp_rel.is_empty() {
        return Err("远程目录为空".to_string());
    }
    let total_bytes = collect_dir_total_bytes(local_dir).unwrap_or(0);
    crate::diag::diag_log(
        log_module,
        &format!(
            "FTP 目录上传 panel={} → rel={} local={} total_bytes={}",
            remote_dir,
            ftp_rel,
            local_dir.display(),
            total_bytes
        ),
    );

    let max_retries = 3;
    let mut last_error = String::new();
    for attempt in 1..=max_retries {
        if ftp_cancelled(cancel) {
            return Err("已取消".to_string());
        }
        let mut sent = 0u64;
        let mut progress_ref = on_progress.as_mut();
        match run_ftp_upload_dir_auth_once_progress(
            local_dir,
            &ftp_rel,
            host,
            user,
            pass,
            log_module,
            total_bytes,
            &mut sent,
            &mut progress_ref,
            cancel,
        ) {
            Ok(()) => {
                crate::diag::diag_log(
                    log_module,
                    &format!("FTP 目录上传成功 → {}", ftp_rel),
                );
                return Ok(());
            }
            Err(e) => {
                if e == "已取消" {
                    return Err(e);
                }
                crate::diag::diag_log(
                    log_module,
                    &format!("⚠️ FTP 目录上传失败 (第{}次): {}", attempt, e),
                );
                last_error = e;
                if attempt < max_retries {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        }
    }
    Err(format!(
        "FTP 目录上传失败（已重试{}次）: {}",
        max_retries, last_error
    ))
}

fn run_ftp_upload_dir_auth_once_progress<F>(
    local_dir: &Path,
    ftp_rel: &str,
    host: &str,
    user: &str,
    pass: &str,
    log_module: &str,
    total_bytes: u64,
    sent: &mut u64,
    on_progress: &mut Option<&mut F>,
    cancel: Option<&AtomicBool>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    let mut client = FtpClient::connect_with(host, user, pass)?;
    let _ = client.command_expect("CWD /", "CWD /", &[250]);
    client.ensure_dir(ftp_rel)?;
    upload_dir_native_with_progress(
        &mut client,
        local_dir,
        log_module,
        total_bytes,
        sent,
        on_progress,
        cancel,
    )?;
    let _ = client.command("QUIT");
    Ok(())
}

/// 可指定 host / 账号 / 可选站点基目录的 FTP 上传（隐私协议等复用）
pub(crate) fn run_ftp_upload_with(
    local_dir: &Path,
    remote_dir: &str,
    host: &str,
    user: &str,
    pass: &str,
    base_dir: Option<&str>,
    log_module: &str,
) -> Result<(), String> {
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        match run_ftp_upload_once(local_dir, remote_dir, host, user, pass, base_dir, log_module) {
            Ok(()) => return Ok(()),
            Err(e) => {
                crate::diag::diag_log(log_module, &format!("⚠️ 上传失败 (第{}次): {}", attempt, e));
                last_error = e;
                if attempt < max_retries {
                    crate::diag::diag_log(log_module, "⏳ 等待 2 秒后重试...");
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
    }

    Err(format!(
        "上传失败（已重试{}次）: {}",
        max_retries, last_error
    ))
}

/// 单次上传
fn run_ftp_upload_once(
    local_dir: &Path,
    remote_dir: &str,
    host: &str,
    user: &str,
    pass: &str,
    base_dir: Option<&str>,
    log_module: &str,
) -> Result<(), String> {
    let mut client = FtpClient::connect_with(host, user, pass)?;
    if let Some(base) = base_dir {
        if !base.trim().is_empty() {
            client.cwd(base).ok();
        }
    }
    client.ensure_dir(remote_dir)?;
    upload_dir_native(&mut client, local_dir, log_module)?;
    client.command_expect("QUIT", "QUIT", &[221]).ok();
    Ok(())
}

#[tauri::command]
pub async fn upload_landing_to_ftp(
    app: tauri::AppHandle,
    items: Vec<FtpUploadItem>,
) -> Result<Vec<FtpUploadResult>, String> {
    use std::sync::{Arc, Mutex};

    let config = crate::config_cmd::load_config_sync()?;
    let (ftp_host, ftp_user, ftp_pass, ftp_base) = require_landing_ftp(&config)?;
    crate::diag::diag_log(
        "landing",
        &format!(
            "upload_landing_to_ftp: host={} user={} base={} count={}",
            ftp_host,
            ftp_user,
            if ftp_base.is_empty() { "(root)" } else { &ftp_base },
            items.len()
        ),
    );

    let total = items.len();

    app.emit(
        "build-progress",
        serde_json::json!({
            "percent": 0,
            "message": format!("📤 准备上传 {} 个文件...", total)
        }),
    )
    .ok();

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
        let host = ftp_host.clone();
        let user = ftp_user.clone();
        let pass = ftp_pass.clone();
        let base = ftp_base.clone();

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

            crate::diag::diag_log("landing", &format!("📤 上传: {}", item_clone.remote_dir));

            let result = match run_ftp_upload(
                &local_dir,
                &item_clone.remote_dir,
                &host,
                &user,
                &pass,
                &base,
            ) {
                Ok(()) => {
                    let url = if base.is_empty() {
                        format!("https://{}/{}/", host, &item_clone.remote_dir)
                    } else {
                        format!("https://{}/{}/", base, &item_clone.remote_dir)
                    };
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

            let mut c = completed_clone.lock().unwrap();
            *c += 1;
            let done = *c;
            let progress = ((done as f64 / total_clone as f64) * 100.0) as i32;
            drop(c);
            app_clone
                .emit(
                    "build-progress",
                    serde_json::json!({
                        "percent": progress,
                        "message": format!("📤 [{}/{}] 完成", done, total_clone),
                    }),
                )
                .ok();
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
    use super::{
        ftp_relative_path_from_panel, parse_pasv_response, require_landing_ftp, require_privacy_ftp,
    };
    use crate::models::HarborConfig;

    const CONTROL_HOST: &str = "ftp.example.com";

    #[test]
    fn parse_pasv_response_extracts_host_and_port() {
        // 192.168.1.2: 20*256+80 = 5200 — private host is rewritten to control host
        let (host, port) = parse_pasv_response(
            "227 Entering Passive Mode (192,168,1,2,20,80).",
            CONTROL_HOST,
        )
        .unwrap();
        assert_eq!(port, 5200);
        // private IP → 使用控制连接主机
        assert_eq!(host, CONTROL_HOST);
    }

    #[test]
    fn parse_pasv_response_keeps_public_host() {
        let (host, port) =
            parse_pasv_response("227 Entering Passive Mode (8,8,8,8,1,2).", CONTROL_HOST).unwrap();
        assert_eq!(host, "8.8.8.8");
        assert_eq!(port, 256 + 2);
    }

    #[test]
    fn parse_pasv_response_rejects_short_payload() {
        let err = parse_pasv_response("227 bad", CONTROL_HOST).unwrap_err();
        assert!(err.contains("无法解析"), "{err}");
    }

    #[test]
    fn parse_pasv_response_rejects_zero_port() {
        let err =
            parse_pasv_response("227 Entering Passive Mode (1,2,3,4,0,0).", CONTROL_HOST).unwrap_err();
        assert!(err.contains("端口无效"), "{err}");
    }

    #[test]
    fn strips_www_wwwroot_prefix_for_chrooted_ftp() {
        assert_eq!(
            ftp_relative_path_from_panel("/www/wwwroot/anime/anime-1.0.0-SNAPSHOT.jar"),
            "anime/anime-1.0.0-SNAPSHOT.jar"
        );
        assert_eq!(
            ftp_relative_path_from_panel("/www/wwwroot/pcm2/tksy-backend-1.0.0.jar"),
            "pcm2/tksy-backend-1.0.0.jar"
        );
        assert_eq!(
            ftp_relative_path_from_panel("anime/foo.jar"),
            "anime/foo.jar"
        );
    }

    #[test]
    fn require_landing_ftp_rejects_empty_creds() {
        let err = require_landing_ftp(&HarborConfig::default()).unwrap_err();
        assert!(err.contains("落地页 FTP"), "{err}");
    }

    #[test]
    fn require_privacy_ftp_reuses_landing_user_pass() {
        let mut cfg = HarborConfig::default();
        cfg.privacy_ftp_host = "60.0.0.1".into();
        cfg.landing_ftp_user = "admin".into();
        cfg.landing_ftp_pass = "secret".into();
        let (host, user, pass) = require_privacy_ftp(&cfg).unwrap();
        assert_eq!(host, "60.0.0.1");
        assert_eq!(user, "admin");
        assert_eq!(pass, "secret");
    }
}
