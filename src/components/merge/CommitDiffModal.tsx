import type { MutableRefObject } from "react";
import { ArrowDown, ArrowUp, FileText, Loader2, X } from "lucide-react";
import type { CommitDiffChangeRef, CommitDiffFile, CommitDiffFileTreeNode } from "../../commitDiff";
import type { CommitInfo } from "../../types";
import { renderCommitDiffFileTree } from "./utils";

interface CommitDiffModalProps {
  commit: CommitInfo;
  commitDiff: string;
  commitDiffError: string;
  isLoading: boolean;
  commitDiffFiles: CommitDiffFile[];
  commitDiffFileTree: CommitDiffFileTreeNode[];
  commitDiffChangeRefs: CommitDiffChangeRef[];
  activeCommitDiffChange: number;
  activeCommitDiffFile: number;
  collapsedCommitDiffDirs: Set<string>;
  commitDiffLineRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  commitDiffFileRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  onClose: () => void;
  onJumpChange: (step: -1 | 1) => void;
  onSelectFile: (fileIndex: number) => void;
  onToggleDir: (path: string) => void;
}

export function CommitDiffModal({
  commit,
  commitDiffError,
  isLoading,
  commitDiffFiles,
  commitDiffFileTree,
  commitDiffChangeRefs,
  activeCommitDiffChange,
  activeCommitDiffFile,
  collapsedCommitDiffDirs,
  commitDiffLineRefs,
  commitDiffFileRefs,
  onClose,
  onJumpChange,
  onSelectFile,
  onToggleDir,
}: CommitDiffModalProps) {
  return (
    <div
      className="commit-modal-overlay commit-diff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-diff-title"
      onClick={onClose}
    >
      <div className="commit-modal commit-diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="commit-modal-header">
          <h3 id="commit-diff-title"><FileText size={16} /> 提交 Diff</h3>
          <button className="commit-modal-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="commit-diff-summary">
          <div className="commit-diff-summary-main">
            <span className="commit-hash" title={commit.hash}>{commit.short_hash}</span>
            <strong>{commit.message}</strong>
          </div>
          <div className="commit-diff-summary-meta">
            <span>{commit.author}</span>
            <span>{commit.date}</span>
          </div>
          <div className="commit-diff-jump-actions">
            <button
              type="button"
              className="commit-diff-jump-btn"
              onClick={() => onJumpChange(-1)}
              disabled={commitDiffChangeRefs.length === 0}
              title="上一个修改点"
            >
              <ArrowUp size={14} /> 上一个
            </button>
            <span className="commit-diff-jump-count">
              {commitDiffChangeRefs.length > 0 ? `${activeCommitDiffChange + 1 || 0}/${commitDiffChangeRefs.length}` : "0/0"}
            </span>
            <button
              type="button"
              className="commit-diff-jump-btn"
              onClick={() => onJumpChange(1)}
              disabled={commitDiffChangeRefs.length === 0}
              title="下一个修改点"
            >
              <ArrowDown size={14} /> 下一个
            </button>
          </div>
        </div>
        {isLoading ? (
          <div className="modal-loading"><Loader2 size={16} className="spin" /> 加载 diff 中...</div>
        ) : commitDiffError ? (
          <div className="commit-diff-error">获取 diff 失败：{commitDiffError}</div>
        ) : commitDiffFiles.length > 0 ? (
          <div className="commit-diff-layout">
            <aside className="commit-diff-file-menu" aria-label="变更文件">
              <div className="commit-diff-file-tree">
                {renderCommitDiffFileTree(
                  commitDiffFileTree,
                  activeCommitDiffFile,
                  onSelectFile,
                  collapsedCommitDiffDirs,
                  onToggleDir,
                )}
              </div>
            </aside>
            <div className="commit-diff-files">
              {commitDiffFiles.map((file, fileIndex) => {
                return (
                  <section
                    key={`${fileIndex}-${file.path}`}
                    ref={(el) => {
                      commitDiffFileRefs.current[fileIndex] = el;
                    }}
                    className={`commit-diff-file${activeCommitDiffFile === fileIndex ? " commit-diff-file--active" : ""}`}
                  >
                    <div className="commit-diff-file-title">{file.path}</div>
                    <div className="commit-diff-lines">
                      {file.lines.map((line, index) => (
                        <div
                          key={`${file.path}-${index}-${line.text}`}
                          ref={(el) => {
                            commitDiffLineRefs.current[`${fileIndex}-${index}`] = el;
                          }}
                          className={`commit-diff-line commit-diff-line--${line.kind}${commitDiffChangeRefs[activeCommitDiffChange]?.fileIndex === fileIndex && commitDiffChangeRefs[activeCommitDiffChange]?.lineIndex === index ? " commit-diff-line--active" : ""}`}
                        >
                          <span className="commit-diff-line-marker">
                            {line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "}
                          </span>
                          <code>{line.text || " "}</code>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="modal-empty">这个提交没有可展示的文件变更</div>
        )}
      </div>
    </div>
  );
}
