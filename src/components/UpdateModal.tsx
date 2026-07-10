import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowRight, Download, Loader2, Rocket, X, AlertCircle, ExternalLink } from "lucide-react";
import "./UpdateModal.css";

/** 与 Rust updater.rs 中 UpdateInfo 一一对应 */
export interface UpdateInfo {
  needs_update: boolean;
  current_version: string;
  latest_version: string;
  download_url: string;
  asset_id: number;
  file_size: number;
}

interface DownloadProgress {
  phase: string;
  percent: number;
  message: string;
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

export function UpdateModal({ opened, onClose, updateInfo }: UpdateModalProps) {
  const [phase, setPhase] = useState<"confirm" | "downloading" | "installing" | "error">("confirm");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened || !updateInfo) return;

    const unlisten = listen<DownloadProgress>("update-progress", (event) => {
      const { phase: p, percent } = event.payload;
      setProgress(percent);
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
      setError("");
      setBusy(false);
    }
  }, [opened]);

  const handleInstall = async () => {
    if (!updateInfo || busy) return;
    setBusy(true);
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
                className={`update-progress-bar ${phase === "installing" ? "update-progress-bar--pulse" : ""}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <p className="update-progress-text">
              {phase === "downloading"
                ? `正在下载… ${progress}%`
                : "正在安装，即将重启…"}
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
