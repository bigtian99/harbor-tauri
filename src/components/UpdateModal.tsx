import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowRight, Download, Loader2, Rocket, X, AlertCircle, ExternalLink, FileText } from "lucide-react";
import "./UpdateModal.css";

/** 与 Rust updater.rs 中 UpdateInfo 一一对应 */
export interface UpdateInfo {
  needs_update: boolean;
  current_version: string;
  latest_version: string;
  download_url: string;
  asset_id: number;
  file_size: number;
  release_notes: string;
}

interface DownloadProgress {
  phase: string;
  percent: number;
  message: string;
  downloaded?: number;
  total?: number;
}

interface UpdateModalProps {
  opened: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** 极简 markdown → 安全 HTML：标题/列表/粗体/链接/代码，其余转义 */
function notesToHtml(raw: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const inline = (s: string) => {
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
    t = t.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
    );
    return t;
  };

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      continue;
    }
    closeLists();
    if (/^###\s+/.test(line)) {
      out.push(`<h4>${inline(line.replace(/^###\s+/, ""))}</h4>`);
    } else if (/^##\s+/.test(line)) {
      out.push(`<h3>${inline(line.replace(/^##\s+/, ""))}</h3>`);
    } else if (/^#\s+/.test(line)) {
      out.push(`<h3>${inline(line.replace(/^#\s+/, ""))}</h3>`);
    } else if (line.trim() === "") {
      out.push("<br/>");
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeLists();
  return out.join("");
}

export function UpdateModal({ opened, onClose, updateInfo }: UpdateModalProps) {
  const [phase, setPhase] = useState<"confirm" | "downloading" | "installing" | "error">("confirm");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened || !updateInfo) return;

    const unlisten = listen<DownloadProgress>("update-progress", (event) => {
      const { phase: p, percent, message } = event.payload;
      if (typeof percent === "number" && !Number.isNaN(percent)) {
        setProgress(Math.max(0, Math.min(100, percent)));
      }
      if (message) setProgressMsg(message);
      if (p === "downloading") setPhase("downloading");
      else if (p === "installing") setPhase("installing");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [opened, updateInfo]);

  useEffect(() => {
    if (opened) {
      setPhase("confirm");
      setProgress(0);
      setProgressMsg("");
      setError("");
      setBusy(false);
    }
  }, [opened]);

  const handleInstall = async () => {
    if (!updateInfo || busy) return;
    setBusy(true);
    // 立刻切到下载态；flushSync 强制本帧画出进度条（否则 await 后才 paint）
    setPhase("downloading");
    setProgress(0);
    setProgressMsg("正在准备下载…");
    setError("");
    // 让 React 先 commit 下载 UI，再进阻塞 invoke
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    try {
      await invoke("download_and_install", {
        downloadUrl: updateInfo.download_url,
        assetId: updateInfo.asset_id || null,
        fileSize: updateInfo.file_size || null,
      });
      // 成功后进程会退出
    } catch (e) {
      setError(String(e));
      setPhase("error");
      setBusy(false);
    }
  };

  if (!opened || !updateInfo) return null;

  const isLocked = phase === "downloading" || phase === "installing";
  const barPct = phase === "installing" ? 100 : progress;
  const notes = (updateInfo.release_notes || "").trim();

  return (
    <div
      className="update-overlay"
      onClick={isLocked ? undefined : onClose}
    >
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-glow" aria-hidden />

        <div className="update-header">
          <div className="update-icon-wrap">
            <Rocket size={22} />
          </div>
          <div className="update-header-text">
            <h3>发现新版本</h3>
            <p>JarPorter 有可用更新</p>
          </div>
          {!isLocked && (
            <button className="update-close" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          )}
        </div>

        {phase === "confirm" && (
          <>
            <div className="update-version-row">
              <div className="update-version-card">
                <span className="update-version-label">当前</span>
                <span className="update-version-value">v{updateInfo.current_version}</span>
              </div>
              <ArrowRight size={18} className="update-version-arrow" />
              <div className="update-version-card update-version-card--new">
                <span className="update-version-label">最新</span>
                <span className="update-version-value">v{updateInfo.latest_version}</span>
              </div>
            </div>

            <div className="update-meta">
              <span className="update-chip">
                <Download size={12} />
                {formatSize(updateInfo.file_size)}
              </span>
              <span className="update-chip update-chip--muted">macOS · 自动安装并重启</span>
            </div>

            <div className="update-notes">
              <div className="update-notes-title">
                <FileText size={13} />
                更新内容
              </div>
              <div
                className="update-notes-body"
                // notesToHtml 已转义；仅渲染受控 markdown 子集
                dangerouslySetInnerHTML={{
                  __html: notes
                    ? notesToHtml(notes)
                    : "<p class=\"update-notes-empty\">暂无更新说明</p>",
                }}
              />
            </div>

            <div className="update-actions">
              <button className="update-btn update-btn--ghost" onClick={onClose}>
                稍后
              </button>
              <button
                className="update-btn update-btn--primary"
                onClick={handleInstall}
                disabled={busy}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                立即更新
              </button>
            </div>
          </>
        )}

        {(phase === "downloading" || phase === "installing") && (
          <div className="update-progress-block">
            <div className="update-progress-track">
              <div
                className={`update-progress-bar ${
                  phase === "installing" || progress <= 0
                    ? "update-progress-bar--pulse"
                    : ""
                } ${progress <= 0 && phase === "downloading" ? "update-progress-bar--indeterminate" : ""}`}
                style={{
                  width:
                    phase === "installing"
                      ? "100%"
                      : progress > 0
                        ? `${barPct}%`
                        : "30%",
                }}
              />
            </div>
            <p className="update-progress-text">
              {phase === "installing"
                ? progressMsg || "正在安装，即将重启…"
                : progressMsg ||
                  (progress > 0
                    ? `正在下载… ${progress}%`
                    : "正在连接并下载…")}
            </p>
          </div>
        )}

        {phase === "error" && (
          <>
            <div className="update-error">
              <AlertCircle size={16} />
              <span>更新失败：{error}</span>
            </div>
            <a
              className="update-manual-link"
              href="https://github.com/bigtian99/harbor-tauri/releases/latest"
              target="_blank"
              rel="noreferrer"
            >
              手动下载最新版本
              <ExternalLink size={12} />
            </a>
            <div className="update-actions">
              <button className="update-btn update-btn--ghost" onClick={onClose}>
                关闭
              </button>
              <button
                className="update-btn update-btn--primary"
                onClick={handleInstall}
                disabled={busy}
              >
                重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
