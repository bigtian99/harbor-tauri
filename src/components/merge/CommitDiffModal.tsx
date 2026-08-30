import type { MutableRefObject } from "react";
import { Button, Group, Modal, Text } from "@mantine/core";
import { ArrowDown, ArrowUp, FileText, Loader2 } from "lucide-react";
import type { CommitDiffChangeRef, CommitDiffFile, CommitDiffFileTreeNode } from "../../commitDiff";
import type { CommitInfo } from "../../types";
import { renderCommitDiffFileTree } from "./utils";
import "../Modal.css";

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

const modalStyles = {
  content: {
    background: "var(--color-bg-surface)",
    border: "1px solid var(--color-border)",
    maxWidth: 1120,
    width: "94%",
    height: "80vh",
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
    <Modal
      opened
      onClose={onClose}
      title={
        <Group gap={6}>
          <FileText size={16} />
          <span>提交 Diff</span>
        </Group>
      }
      size="90%"
      centered
      classNames={{ content: "commit-diff-modal" }}
      styles={modalStyles}
    >
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
          <Button
            type="button"
            variant="default"
            color="cyan"
            size="compact-sm"
            className="commit-diff-jump-btn"
            onClick={() => onJumpChange(-1)}
            disabled={commitDiffChangeRefs.length === 0}
            title="上一个修改点"
            leftSection={<ArrowUp size={14} />}
          >
            上一个
          </Button>
          <span className="commit-diff-jump-count">
            {commitDiffChangeRefs.length > 0 ? `${activeCommitDiffChange + 1 || 0}/${commitDiffChangeRefs.length}` : "0/0"}
          </span>
          <Button
            type="button"
            variant="default"
            color="cyan"
            size="compact-sm"
            className="commit-diff-jump-btn"
            onClick={() => onJumpChange(1)}
            disabled={commitDiffChangeRefs.length === 0}
            title="下一个修改点"
            leftSection={<ArrowDown size={14} />}
          >
            下一个
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="modal-loading">
          <Loader2 size={16} className="spin" /> 加载 diff 中...
        </div>
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
            {commitDiffFiles.map((file, fileIndex) => (
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
            ))}
          </div>
        </div>
      ) : (
        <Text ta="center" c="var(--color-text-muted)" py="xl">这个提交没有可展示的文件变更</Text>
      )}
    </Modal>
  );
}
