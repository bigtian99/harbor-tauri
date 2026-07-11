import { ChevronDown, ChevronRight, FileText, FolderOpen } from "lucide-react";
import type { CommitDiffFileTreeNode } from "../../commitDiff";
import type { ConflictBlock } from "./types";

/** 解析 unified diff，提取 target（旧文件）中被删除/修改的行号，和 source（新文件）中被新增/修改的行号 */
export function parseChangedLines(diff: string): { targetLines: Set<number>; sourceLines: Set<number> } {
  const targetLines = new Set<number>();
  const sourceLines = new Set<number>();
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[3], 10);
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      targetLines.add(oldLine);
      oldLine++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      sourceLines.add(newLine);
      newLine++;
    } else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  return { targetLines, sourceLines };
}

/** 从 unified diff 提取冲突块（连续变更合并为一个块，块间 gap ≤ 3 行视为连续） */
export function parseConflictBlocks(diff: string): ConflictBlock[] {
  // 先收集每个 hunk 的原始信息
  interface RawHunk { targetStart: number; sourceStart: number; tLines: Set<number>; sLines: Set<number>; tEnd: number; sEnd: number }
  const hunks: RawHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let current: RawHunk | null = null;

  for (const line of diff.split("\n")) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      if (current) hunks.push(current);
      oldLine = parseInt(m[1], 10);
      newLine = parseInt(m[3], 10);
      current = { targetStart: oldLine, sourceStart: newLine, tLines: new Set(), sLines: new Set(), tEnd: oldLine, sEnd: newLine };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.tLines.add(oldLine);
      current.tEnd = oldLine;
      oldLine++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.sLines.add(newLine);
      current.sEnd = newLine;
      newLine++;
    } else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  if (current) hunks.push(current);

  // 合并 gap ≤ 3 的相邻 hunk 为一个 block
  const blocks: ConflictBlock[] = [];
  for (const h of hunks) {
    const last = blocks[blocks.length - 1];
    if (last && h.targetStart <= Math.max(...last.targetLines, last.targetLine) + 4) {
      // 合并：把 h 的行号并入 last
      for (const l of h.tLines) last.targetLines.add(l);
      for (const l of h.sLines) last.sourceLines.add(l);
    } else {
      blocks.push({
        targetLine: h.targetStart,
        sourceLine: h.sourceStart,
        targetLines: h.tLines,
        sourceLines: h.sLines,
      });
    }
  }
  return blocks;
}

export function summarizeMergeError(error: unknown): string {
  const msg = String(error).trim();
  if (!msg) return "合并失败，请稍后重试";
  if (msg.includes("冲突") || msg.includes("CONFLICT")) {
    return msg.split("\n")[0].trim();
  }
  return msg.split("\n")[0].trim();
}

export function renderCommitDiffFileTree(
  nodes: CommitDiffFileTreeNode[],
  activeFile: number,
  onSelectFile: (fileIndex: number) => void,
  collapsedDirs: Set<string>,
  onToggleDir: (path: string) => void,
  depth = 0,
) {
  return nodes.map((node) => {
    if (node.children) {
      const isCollapsed = collapsedDirs.has(node.path);
      return (
        <div key={node.path} className="commit-diff-file-tree-node">
          <button
            type="button"
            className={`commit-diff-file-tree-dir${isCollapsed ? " commit-diff-file-tree-dir--collapsed" : ""}`}
            style={{ paddingLeft: `${depth * 14}px` }}
            title={node.path}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleDir(node.path)}
          >
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <FolderOpen size={13} />
            <span>{node.name}</span>
          </button>
          {!isCollapsed && (
            <div className="commit-diff-file-tree-children">
              {renderCommitDiffFileTree(node.children, activeFile, onSelectFile, collapsedDirs, onToggleDir, depth + 1)}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={`${node.path}-${node.fileIndex}`}
        type="button"
        className={`commit-diff-file-tree-file${activeFile === node.fileIndex ? " commit-diff-file-tree-file--active" : ""}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        title={node.path}
        onClick={() => {
          if (node.fileIndex !== undefined) {
            onSelectFile(node.fileIndex);
          }
        }}
      >
        <FileText size={13} />
        <span>{node.name}</span>
      </button>
    );
  });
}
