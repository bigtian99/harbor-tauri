import { useEffect } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import "./ConfirmDialog.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 主说明，支持多行 */
  message: string;
  /** 可选补充列表项 */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      role="presentation"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        className={`confirm-dialog confirm-dialog--${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="confirm-dialog-close"
          onClick={onCancel}
          disabled={loading}
          aria-label="关闭"
        >
          <X size={16} />
        </button>

        <div className="confirm-dialog-icon-wrap">
          <AlertTriangle size={22} />
        </div>

        <h3 id="confirm-dialog-title" className="confirm-dialog-title">
          {title}
        </h3>

        <p id="confirm-dialog-desc" className="confirm-dialog-message">
          {message}
        </p>

        {details && details.length > 0 && (
          <ul className="confirm-dialog-details">
            {details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}

        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn--cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog-btn confirm-dialog-btn--confirm confirm-dialog-btn--${variant}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <Loader2 size={16} className="spin" /> : null}
            {loading ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
