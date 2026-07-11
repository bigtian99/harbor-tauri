import type { MutableRefObject } from "react";
import { ArrowDown, ArrowUp, FileText, GitBranch, Loader2, X } from "lucide-react";
import type { MergeConflictDetail } from "../../types";
import type { ConflictBlock } from "./types";

interface ConflictDetailModalProps {
  conflictDetail: MergeConflictDetail;
  isLoading: boolean;
  sourceBranch: string;
  targetBranch: string;
  conflictBlocks: ConflictBlock[];
  activeConflictBlock: number;
  conflictChangedLines: { targetLines: Set<number>; sourceLines: Set<number> };
  targetLineRefs: MutableRefObject<Record<number, HTMLDivElement | null>>;
  sourceLineRefs: MutableRefObject<Record<number, HTMLDivElement | null>>;
  onClose: () => void;
  onJumpBlock: (step: -1 | 1) => void;
}

export function ConflictDetailModal({
  conflictDetail,
  isLoading,
  sourceBranch,
  targetBranch,
  conflictBlocks,
  activeConflictBlock,
  conflictChangedLines,
  targetLineRefs,
  sourceLineRefs,
  onClose,
  onJumpBlock,
}: ConflictDetailModalProps) {
  return (
    <div
      className="commit-modal-overlay commit-diff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-diff-title"
      onClick={onClose}
    >
      <div className="commit-modal merge-conflict-compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="commit-modal-header">
          <h3 id="conflict-diff-title"><FileText size={16} /> 冲突文件对比</h3>
          <span className="template-hint" style={{ marginLeft: 12 }}>
            {conflictDetail.filePath}
          </span>
          <div className="commit-diff-jump-actions" style={{ marginLeft: "auto", marginRight: 8 }}>
            <button
              type="button"
              className="commit-diff-jump-btn"
              onClick={() => onJumpBlock(-1)}
              disabled={conflictBlocks.length === 0}
              title="上一个冲突块"
            >
              <ArrowUp size={14} /> 上一个
            </button>
            <span className="commit-diff-jump-count">
              {conflictBlocks.length > 0 ? `${activeConflictBlock + 1 || 0}/${conflictBlocks.length}` : "0/0"}
            </span>
            <button
              type="button"
              className="commit-diff-jump-btn"
              onClick={() => onJumpBlock(1)}
              disabled={conflictBlocks.length === 0}
              title="下一个冲突块"
            >
              <ArrowDown size={14} /> 下一个
            </button>
          </div>
          <button className="commit-modal-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <div className="modal-loading"><Loader2 size={16} className="spin" /> 加载中...</div>
        ) : (
          <div className="merge-conflict-compare">
            <div className="merge-conflict-panel">
              <div className="merge-conflict-panel-header">
                <GitBranch size={14} /> {targetBranch.replace(/^origin\//, "")}
                <span className="merge-conflict-role-tag">目标</span>
              </div>
              <div className="merge-conflict-content">
                {conflictDetail.targetContent.split("\n").map((line, i) => {
                  const ln = i + 1;
                  const changed = conflictChangedLines.targetLines.has(ln);
                  const activeBlock = conflictBlocks[activeConflictBlock];
                  const inActiveBlock = activeBlock && activeBlock.targetLines.has(ln);
                  return (
                    <div
                      key={i}
                      ref={(el) => { targetLineRefs.current[ln] = el; }}
                      className={`merge-conflict-line${changed ? " merge-conflict-line--removed" : ""}${inActiveBlock ? " merge-conflict-line--active" : ""}`}
                    >
                      <span className="merge-conflict-ln">{ln}</span>
                      <span className="merge-conflict-text">{line || " "}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="merge-conflict-divider" />
            <div className="merge-conflict-panel">
              <div className="merge-conflict-panel-header">
                <GitBranch size={14} /> {sourceBranch.replace(/^origin\//, "")}
                <span className="merge-conflict-role-tag merge-conflict-role-tag--source">源</span>
              </div>
              <div className="merge-conflict-content">
                {conflictDetail.sourceContent.split("\n").map((line, i) => {
                  const ln = i + 1;
                  const changed = conflictChangedLines.sourceLines.has(ln);
                  const activeBlock = conflictBlocks[activeConflictBlock];
                  const inActiveBlock = activeBlock && activeBlock.sourceLines.has(ln);
                  return (
                    <div
                      key={i}
                      ref={(el) => { sourceLineRefs.current[ln] = el; }}
                      className={`merge-conflict-line${changed ? " merge-conflict-line--added" : ""}${inActiveBlock ? " merge-conflict-line--active" : ""}`}
                    >
                      <span className="merge-conflict-ln">{ln}</span>
                      <span className="merge-conflict-text">{line || " "}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
