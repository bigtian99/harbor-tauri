import type { MutableRefObject } from "react";
import { Button, Group, Modal } from "@mantine/core";
import { ArrowDown, ArrowUp, FileText, GitBranch, Loader2 } from "lucide-react";
import type { MergeConflictDetail } from "../../types";
import type { ConflictBlock } from "./types";
import "../Modal.css";

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

const modalStyles = {
  content: {
    background: "var(--color-bg-surface)",
    border: "1px solid var(--color-border)",
    maxWidth: "78vw",
    width: "78vw",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: { background: "var(--color-bg-surface)", flexShrink: 0 },
  title: { color: "var(--color-text)", fontWeight: 600 },
  body: {
    padding: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minHeight: 0,
    overflow: "hidden",
  },
} as const;

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
    <Modal
      opened
      onClose={onClose}
      title={
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} style={{ flexShrink: 0 }}>
            <FileText size={16} />
            <span>冲突文件对比</span>
          </Group>
          <span className="template-hint" style={{ fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {conflictDetail.filePath}
          </span>
          <div className="commit-diff-jump-actions" style={{ marginLeft: "auto" }}>
            <Button
              type="button"
              variant="default"
              color="cyan"
              size="compact-sm"
              className="commit-diff-jump-btn"
              onClick={() => onJumpBlock(-1)}
              disabled={conflictBlocks.length === 0}
              title="上一个冲突块"
              leftSection={<ArrowUp size={14} />}
            >
              上一个
            </Button>
            <span className="commit-diff-jump-count">
              {conflictBlocks.length > 0 ? `${activeConflictBlock + 1 || 0}/${conflictBlocks.length}` : "0/0"}
            </span>
            <Button
              type="button"
              variant="default"
              color="cyan"
              size="compact-sm"
              className="commit-diff-jump-btn"
              onClick={() => onJumpBlock(1)}
              disabled={conflictBlocks.length === 0}
              title="下一个冲突块"
              leftSection={<ArrowDown size={14} />}
            >
              下一个
            </Button>
          </div>
        </Group>
      }
      size="90%"
      centered
      classNames={{ content: "merge-conflict-compare-modal" }}
      styles={modalStyles}
    >
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
    </Modal>
  );
}
