import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckCircle, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { isTauriRuntime } from "../types";

/** build-progress 事件载荷（OPT-033：stage 可选，缺省兼容旧后端） */
export type BuildProgressStage =
  | "fetch"
  | "worktree"
  | "build"
  | "push"
  | "cleanup"
  | "done"
  | string;

interface BuildProgressPayload {
  percent: number;
  message: string;
  stage?: BuildProgressStage;
}

interface UseBuildProgressDeps {
  /** 复制成功后的 toast；不传则静默 */
  showToast?: (message: string, duration?: number) => void;
}

/**
 * 构建/推送过程的进度、日志与复制状态。
 * 监听 Tauri `build-progress` 事件并累积过程日志。
 */
export function useBuildProgress(deps: UseBuildProgressDeps = {}) {
  const { showToast } = deps;

  const [isBuilding, setIsBuilding] = useState(false);
  const [log, setLog] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressStage, setProgressStage] = useState<BuildProgressStage | "">("");
  const [copied, setCopied] = useState(false);
  const [showBuildLog, setShowBuildLog] = useState(false);

  async function handleCancelBuild() {
    try {
      await invoke("cancel_build");
    } catch {
      /* 忽略取消错误 */
    }
    setIsBuilding(false);
  }

  async function handleCopyImage(imageUrl: string) {
    try {
      await navigator.clipboard.writeText(imageUrl);
      setCopied(true);
      showToast?.("镜像地址已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("复制失败:", e);
      showToast?.(`复制失败: ${e}`);
    }
  }

  function renderLog(text: string): ReactNode {
    const imageMatch = text.match(/完整镜像:\s*(.+)/);
    if (imageMatch) {
      const imageUrl = imageMatch[1].trim();
      const prefix = text.substring(0, text.indexOf("完整镜像:"));
      return (
        <>
          <pre>{prefix}</pre>
          <div className="image-url-row">
            <span className="image-url-label">完整镜像:</span>
            <span className="image-url-value" title={imageUrl}>{imageUrl}</span>
            <button
              className={`copy-btn ${copied ? "copied" : ""}`}
              onClick={() => handleCopyImage(imageUrl)}
              title="复制镜像地址"
            >
              {copied ? (
                <>
                  <CheckCircle size={14} /> 已复制
                </>
              ) : (
                <>
                  <Copy size={14} /> 复制
                </>
              )}
            </button>
          </div>
        </>
      );
    }
    if (text.includes("✅")) {
      return (
        <div className="success-message">
          <CheckCircle size={20} className="success-icon" />
          <pre>{text}</pre>
        </div>
      );
    }
    return <pre>{text}</pre>;
  }

  /** 开始一轮构建/推送前重置进度与日志相关状态 */
  const beginBuild = useCallback((message: string) => {
    setIsBuilding(true);
    setCopied(false);
    setProgress(0);
    setProgressMessage(message);
    setProgressStage("");
    setLog("");
  }, []);

  useEffect(() => {
    if (!log) {
      setShowBuildLog(false);
    } else if (log.includes("❌")) {
      setShowBuildLog(true);
    }
  }, [log]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    const unlistenProgress = appWindow.listen<BuildProgressPayload>(
      "build-progress",
      (event) => {
        setProgress(event.payload.percent);
        setProgressMessage(event.payload.message);
        // stage 可选：旧载荷无字段时不强制
        if (event.payload.stage != null && event.payload.stage !== "") {
          setProgressStage(event.payload.stage);
        }
        // 累积构建/推送过程日志，让"展开构建日志"能看到打包镜像、推送镜像等过程
        setLog((prev) => (prev ? `${prev}\n${event.payload.message}` : event.payload.message));
      },
    );
    return () => {
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  return {
    isBuilding,
    setIsBuilding,
    log,
    setLog,
    progress,
    setProgress,
    progressMessage,
    setProgressMessage,
    progressStage,
    setProgressStage,
    copied,
    setCopied,
    showBuildLog,
    setShowBuildLog,
    handleCancelBuild,
    handleCopyImage,
    renderLog,
    beginBuild,
  };
}

/** 通用 toast（可与 build progress 解耦，供 App 与其它 hook 使用） */
export function useToast() {
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  const toastTimerRef = useRef<number | null>(null);

  function showToast(message: string, duration = 2000) {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ show: true, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast({ show: false, message: "" });
      toastTimerRef.current = null;
    }, duration);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return { toast, showToast };
}
