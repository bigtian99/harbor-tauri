import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import type { MergeOverlayPhase } from "./types";

interface MergeProgressOverlayProps {
  phase: MergeOverlayPhase;
  sourceBranch: string;
  targetBranch: string;
  progress: number;
  progressMessage: string;
  resultMessage: string;
  onClose: () => void;
}

export function MergeProgressOverlay({
  phase,
  sourceBranch,
  targetBranch,
  progress,
  progressMessage,
  resultMessage,
  onClose,
}: MergeProgressOverlayProps) {
  if (phase === "idle") return null;

  return (
    <div className="merge-progress-overlay" role="dialog" aria-modal="true" aria-labelledby="merge-progress-title">
      <div className="merge-progress-modal">
        {phase === "running" && (
          <>
            <Loader2 size={42} className="spin merge-progress-icon" />
            <h3 id="merge-progress-title" className="merge-progress-title">正在合并分支</h3>
            <p className="merge-progress-subtitle">
              {sourceBranch} → {targetBranch}
            </p>
            <p className="merge-progress-message">{progressMessage || "处理中..."}</p>
            <div className="merge-progress-track">
              <div
                className="merge-progress-bar"
                style={{ width: `${Math.max(progress, 8)}%` }}
              />
            </div>
            <span className="merge-progress-percent">{progress}%</span>
          </>
        )}
        {phase === "success" && (
          <>
            <CheckCircle size={42} className="merge-progress-icon merge-progress-icon--success" />
            <h3 id="merge-progress-title" className="merge-progress-title">合并成功</h3>
            <p className="merge-progress-message merge-progress-message--center">
              {resultMessage}
            </p>
            <button type="button" className="merge-progress-btn" onClick={onClose}>
              完成
            </button>
          </>
        )}
        {phase === "error" && (
          <>
            <AlertTriangle size={42} className="merge-progress-icon merge-progress-icon--error" />
            <h3 id="merge-progress-title" className="merge-progress-title">合并失败</h3>
            <p className="merge-progress-message merge-progress-message--center">
              {resultMessage}
            </p>
            <button type="button" className="merge-progress-btn" onClick={onClose}>
              关闭
            </button>
          </>
        )}
      </div>
    </div>
  );
}
