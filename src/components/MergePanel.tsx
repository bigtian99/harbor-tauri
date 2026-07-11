import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import {
  GitMerge, FolderOpen, Loader2, RefreshCw, CheckCircle, AlertTriangle,
  ArrowRight, GitBranch, GitCommit, ExternalLink, Info, Search, FileText, X,
  ArrowUp, ArrowDown, ChevronDown, ChevronRight
} from "lucide-react";
import { SearchableDropdown } from "./SearchableDropdown";
import { getCommitDiffChangeRefs, getCommitDiffFileTree, parseCommitDiffFiles } from "../commitDiff";
import "./Modal.css";
import type { CommitDiffFileTreeNode } from "../commitDiff";
import type { HarborConfig, GitBranchOption, LocalMergeCheck, RemoteBranchListResult, CommitInfo, AuthorInfo, CommitDiffResult, MergeConflictDetail } from "../types";
import { isTauriRuntime } from "../types";
import { avatarColor, avatarInitials } from "../avatarUrl";

interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
}

type MergeOverlayPhase = "idle" | "running" | "success" | "error";

interface ConflictBlock {
  /** 该块在 target 面板中的起始行（1-based） */
  targetLine: number;
  /** 该块在 source 面板中的起始行（1-based） */
  sourceLine: number;
  /** 该块在 target 中涉及的行号 */
  targetLines: Set<number>;
  /** 该块在 source 中涉及的行号 */
  sourceLines: Set<number>;
}

/** 解析 unified diff，提取 target（旧文件）中被删除/修改的行号，和 source（新文件）中被新增/修改的行号 */
function parseChangedLines(diff: string): { targetLines: Set<number>; sourceLines: Set<number> } {
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
function parseConflictBlocks(diff: string): ConflictBlock[] {
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

function summarizeMergeError(error: unknown): string {
  const msg = String(error).trim();
  if (!msg) return "合并失败，请稍后重试";
  if (msg.includes("冲突") || msg.includes("CONFLICT")) {
    return msg.split("\n")[0].trim();
  }
  return msg.split("\n")[0].trim();
}

function renderCommitDiffFileTree(
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

export function MergePanel({ config, onOpenDirectory }: MergePanelProps) {
  const [repoPath, setRepoPath] = useState("");
  // 解析后的本地仓库路径（URL 输入时为缓存克隆目录），后续 check/merge 都用它
  const [resolvedRepoPath, setResolvedRepoPath] = useState("");
  const [branches, setBranches] = useState<GitBranchOption[]>([]);
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [checkResult, setCheckResult] = useState<LocalMergeCheck | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [pushAfterMerge, setPushAfterMerge] = useState(true);
  // 源分支相对目标分支多出的提交（合并会带入这些提交）
  const [diffCommits, setDiffCommits] = useState<CommitInfo[]>([]);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffCommitSearch, setDiffCommitSearch] = useState("");
  const [selectedAuthor, setSelectedAuthor] = useState("");
  const [selectedDiffCommit, setSelectedDiffCommit] = useState<CommitInfo | null>(null);
  const [commitDiff, setCommitDiff] = useState("");
  const [commitDiffError, setCommitDiffError] = useState("");
  const [isLoadingCommitDiff, setIsLoadingCommitDiff] = useState(false);
  const [activeCommitDiffChange, setActiveCommitDiffChange] = useState(-1);
  const [activeCommitDiffFile, setActiveCommitDiffFile] = useState(-1);
  const [collapsedCommitDiffDirs, setCollapsedCommitDiffDirs] = useState<Set<string>>(new Set());
  const [mergeOverlayPhase, setMergeOverlayPhase] = useState<MergeOverlayPhase>("idle");
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeProgressMessage, setMergeProgressMessage] = useState("");
  const [mergeResultMessage, setMergeResultMessage] = useState("");
  const mergeAutoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCheckDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitDiffRequest = useRef(0);
  const commitDiffLineRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const commitDiffFileRefs = useRef<Record<number, HTMLElement | null>>({});
  // 冲突文件 diff 查看
  const [conflictDetail, setConflictDetail] = useState<MergeConflictDetail | null>(null);
  const [isLoadingConflictDiff, setIsLoadingConflictDiff] = useState(false);

  const closeMergeOverlay = useCallback(() => {
    if (mergeAutoCloseTimer.current) {
      clearTimeout(mergeAutoCloseTimer.current);
      mergeAutoCloseTimer.current = null;
    }
    setMergeOverlayPhase("idle");
    setMergeProgress(0);
    setMergeProgressMessage("");
    setMergeResultMessage("");
    setIsMerging(false);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen<{ percent: number; message: string }>("merge-progress", (event) => {
        setMergeProgress(event.payload.percent);
        setMergeProgressMessage(event.payload.message);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
      if (mergeAutoCloseTimer.current) {
        clearTimeout(mergeAutoCloseTimer.current);
      }
      if (autoCheckDebounce.current) {
        clearTimeout(autoCheckDebounce.current);
      }
    };
  }, []);

  const loadBranches = useCallback(async (input: string) => {
    if (!isTauriRuntime() || !input.trim()) return;
    setIsLoadingBranches(true);
    setCheckResult(null);
    try {
      const result = await invoke<RemoteBranchListResult>("list_remote_branches", { repoPath: input.trim() });
      setResolvedRepoPath(result.repoPath);
      setBranches(result.branches);
      if (result.branches.length === 0) {
        notifications.show({ message: "该仓库没有远程分支", color: "blue", autoClose: 2500 });
      }
    } catch (e) {
      notifications.show({ title: "读取分支失败", message: String(e), color: "red", autoClose: 6000 });
      setBranches([]);
      setResolvedRepoPath("");
    } finally {
      setIsLoadingBranches(false);
    }
  }, []);

  const branchNames = branches.map((b) => b.name);
  // 联动过滤：源分支下拉排除已选的目标分支，目标分支下拉排除已选的源分支，
  // 避免选到同一个分支。
  const sourceOptions = branchNames.filter((n) => n !== targetBranch);
  const targetOptions = branchNames.filter((n) => n !== sourceBranch);

  const handleRepoChange = useCallback((value: string) => {
    setRepoPath(value);
    setBranches([]);
    setResolvedRepoPath("");
    setSourceBranch("");
    setTargetBranch("");
    setCheckResult(null);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedAuthor("");
    setSelectedDiffCommit(null);
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(false);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    setConflictDetail(null);
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
    commitDiffRequest.current++;
  }, []);

  const onSelectRepo = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, directory: true });
    if (selected) {
      const path = typeof selected === "string" ? selected : (selected as { path?: string }).path || "";
      setRepoPath(path);
      await loadBranches(path);
    }
  }, [loadBranches]);

  const handleRefreshBranches = useCallback(async () => {
    await loadBranches(repoPath);
  }, [repoPath, loadBranches]);

  // 输入框失焦后自动加载分支（选择目录已即时加载，这里覆盖手动输入路径/URL 的场景）
  const handleInputBlur = useCallback((finalValue: string) => {
    const v = finalValue.trim();
    if (v && !isLoadingBranches && !resolvedRepoPath) {
      loadBranches(v);
    }
  }, [isLoadingBranches, resolvedRepoPath, loadBranches]);

  const handleCheck = useCallback(async () => {
    if (!isTauriRuntime() || !sourceBranch || !targetBranch) return;
    if (!resolvedRepoPath) {
      notifications.show({ message: "仓库路径尚未解析完成，请稍候或重新加载分支", color: "yellow", autoClose: 3000 });
      return;
    }
    if (sourceBranch === targetBranch) {
      setCheckResult({
        canMerge: false,
        conflictFiles: [],
        message: "源分支和目标分支相同，无需合并",
      });
      setDiffCommits([]);
      setDiffLoaded(true);
      setDiffError("");
      setDiffCommitSearch("");
      setSelectedDiffCommit(null);
      setCollapsedCommitDiffDirs(new Set());
      return;
    }
    setIsChecking(true);
    setIsLoadingDiff(true);
    setCheckResult(null);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedDiffCommit(null);
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(false);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    setConflictDetail(null);
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
    commitDiffRequest.current++;
    // 并行：冲突检查 + 差异提交列表
    const checkP = invoke<LocalMergeCheck>("check_remote_merge", {
      repoPath: resolvedRepoPath,
      source: sourceBranch,
      target: targetBranch,
    }).then((result) => setCheckResult(result))
      .catch((e) => {
        notifications.show({ title: "冲突检查失败", message: String(e), color: "red", autoClose: 6000 });
      });
    const diffP = invoke<CommitInfo[]>("list_branch_diff_commits", {
      repoPath: resolvedRepoPath,
      source: sourceBranch,
      target: targetBranch,
    }).then((list) => setDiffCommits(list))
      .catch(() => {
        const message = "无法获取差异提交，请确认源分支和目标分支存在，并刷新分支后重试";
        setDiffError(message);
        notifications.show({ title: "获取差异提交失败", message, color: "red", autoClose: 6000 });
      })
      .finally(() => {
        setDiffLoaded(true);
      });
    await Promise.all([checkP, diffP]);
    setIsChecking(false);
    setIsLoadingDiff(false);
  }, [resolvedRepoPath, sourceBranch, targetBranch]);

  // 选完源和目标分支后自动检查冲突并加载差异提交（800ms 防抖，避免输入过程中频繁触发）
  useEffect(() => {
    // 清除上一次的防抖定时器
    if (autoCheckDebounce.current) {
      clearTimeout(autoCheckDebounce.current);
      autoCheckDebounce.current = null;
    }

    if (sourceBranch && targetBranch && sourceBranch === targetBranch) {
      setCheckResult({
        canMerge: false,
        conflictFiles: [],
        message: "源分支和目标分支相同，无需合并",
      });
      setDiffCommits([]);
      setDiffLoaded(true);
      setDiffError("");
      setDiffCommitSearch("");
      setSelectedDiffCommit(null);
      setCollapsedCommitDiffDirs(new Set());
    } else if (sourceBranch && targetBranch && resolvedRepoPath) {
      // 防抖：用户停止输入 800ms 后才自动检查
      autoCheckDebounce.current = setTimeout(() => {
        handleCheck();
      }, 800);
    } else {
      setCheckResult(null);
      setDiffCommits([]);
      setDiffLoaded(false);
      setDiffError("");
      setDiffCommitSearch("");
      setSelectedDiffCommit(null);
      setCollapsedCommitDiffDirs(new Set());
    }
  }, [sourceBranch, targetBranch, resolvedRepoPath, handleCheck]);

  const handleMerge = useCallback(async () => {
    if (!checkResult?.canMerge || !sourceBranch || !targetBranch) return;
    const targetRemoteName = (targetBranch || "").replace(/^origin\//, "");
    if (!window.confirm(
      `确认把 ${sourceBranch} 合并进 ${targetBranch}？\n` +
      `将在隔离 worktree 中执行 git merge --no-ff ${sourceBranch}，不会切换当前工作区分支` +
      `${pushAfterMerge ? `\n合并后推送到远程 origin/${targetRemoteName}` : "\n合并结果仅更新本地分支引用，不推送远程"}`
    )) {
      return;
    }
    setIsMerging(true);
    setMergeOverlayPhase("running");
    setMergeProgress(0);
    setMergeProgressMessage("准备合并...");
    setMergeResultMessage("");
    try {
      const summary = await invoke<string>("merge_remote_branches", {
        repoPath: resolvedRepoPath,
        source: sourceBranch,
        target: targetBranch,
        push: pushAfterMerge,
      });
      setMergeProgress(100);
      setMergeProgressMessage("合并完成");
      setMergeResultMessage(summary);
      setMergeOverlayPhase("success");
      setCheckResult(null);
      await loadBranches(repoPath);
      mergeAutoCloseTimer.current = setTimeout(() => {
        closeMergeOverlay();
      }, 2000);
    } catch (e) {
      const message = summarizeMergeError(e);
      setMergeProgress(0);
      setMergeProgressMessage("");
      setMergeResultMessage(message);
      setMergeOverlayPhase("error");
    }
  }, [checkResult, resolvedRepoPath, sourceBranch, targetBranch, repoPath, pushAfterMerge, loadBranches, closeMergeOverlay]);

  const canMerge = checkResult?.canMerge === true;
  const isSameBranch = Boolean(sourceBranch && targetBranch && sourceBranch === targetBranch);
  const hasNoDiff = Boolean(
    diffLoaded && !diffError && diffCommits.length === 0 && sourceBranch && targetBranch
  );
  const diffAuthors = useMemo(() => {
    const map = new Map<string, AuthorInfo>();
    for (const c of diffCommits) {
      const existing = map.get(c.author);
      if (existing) {
        existing.count++;
      } else {
        map.set(c.author, { name: c.author, email: c.email, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [diffCommits]);

  const filteredDiffCommits = useMemo(() => {
    let list = diffCommits;
    if (selectedAuthor) {
      list = list.filter((c) => c.author === selectedAuthor);
    }
    const q = diffCommitSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.hash.toLowerCase().includes(q) ||
        c.short_hash.toLowerCase().includes(q) ||
        c.message.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.date.toLowerCase().includes(q)
      );
    }
    return list;
  }, [diffCommits, diffCommitSearch, selectedAuthor]);
  const commitDiffFiles = useMemo(() => parseCommitDiffFiles(commitDiff), [commitDiff]);
  const commitDiffChangeRefs = useMemo(() => getCommitDiffChangeRefs(commitDiffFiles), [commitDiffFiles]);
  const commitDiffFileTree = useMemo(() => getCommitDiffFileTree(commitDiffFiles), [commitDiffFiles]);
  const conflictChangedLines = useMemo(
    () => conflictDetail ? parseChangedLines(conflictDetail.diff) : { targetLines: new Set<number>(), sourceLines: new Set<number>() },
    [conflictDetail],
  );
  const conflictBlocks = useMemo(
    () => conflictDetail ? parseConflictBlocks(conflictDetail.diff) : [],
    [conflictDetail],
  );
  const [activeConflictBlock, setActiveConflictBlock] = useState(-1);
  const targetLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const sourceLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const closeCommitDiffModal = useCallback(() => {
    commitDiffRequest.current++;
    setSelectedDiffCommit(null);
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(false);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
  }, []);
  const toggleCommitDiffTreeDir = useCallback((path: string) => {
    setCollapsedCommitDiffDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const scrollCommitDiffFile = useCallback((fileIndex: number) => {
    setActiveCommitDiffFile(fileIndex);
    requestAnimationFrame(() => {
      commitDiffFileRefs.current[fileIndex]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);
  const jumpCommitDiffChange = useCallback((step: -1 | 1) => {
    if (commitDiffChangeRefs.length === 0) return;
    const nextIndex = activeCommitDiffChange < 0
      ? (step > 0 ? 0 : commitDiffChangeRefs.length - 1)
      : (activeCommitDiffChange + step + commitDiffChangeRefs.length) % commitDiffChangeRefs.length;
    const next = commitDiffChangeRefs[nextIndex];
    setActiveCommitDiffChange(nextIndex);
    setActiveCommitDiffFile(next.fileIndex);
    requestAnimationFrame(() => {
      commitDiffLineRefs.current[`${next.fileIndex}-${next.lineIndex}`]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  }, [activeCommitDiffChange, commitDiffChangeRefs]);
  const loadConflictDiff = useCallback(async (filePath: string) => {
    if (!isTauriRuntime() || !resolvedRepoPath) return;
    setConflictDetail(null);
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
    setIsLoadingConflictDiff(true);
    try {
      const detail = await invoke<MergeConflictDetail>("get_merge_conflict_diff", {
        repoPath: resolvedRepoPath,
        source: sourceBranch,
        target: targetBranch,
        filePath: filePath,
      });
      setConflictDetail(detail);
    } catch (e) {
      setConflictDetail({
        filePath,
        targetContent: `获取失败：${String(e)}`,
        sourceContent: `获取失败：${String(e)}`,
        diff: "",
      });
    } finally {
      setIsLoadingConflictDiff(false);
    }
  }, [resolvedRepoPath, sourceBranch, targetBranch]);
  const closeConflictDiff = useCallback(() => {
    setConflictDetail(null);
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
  }, []);
  const jumpConflictBlock = useCallback((step: -1 | 1) => {
    if (conflictBlocks.length === 0) return;
    const next = activeConflictBlock < 0
      ? (step > 0 ? 0 : conflictBlocks.length - 1)
      : Math.max(0, Math.min(conflictBlocks.length - 1, activeConflictBlock + step));
    setActiveConflictBlock(next);
    const block = conflictBlocks[next];
    requestAnimationFrame(() => {
      targetLineRefs.current[block.targetLine]?.scrollIntoView({ block: "center", behavior: "smooth" });
      sourceLineRefs.current[block.sourceLine]?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [activeConflictBlock, conflictBlocks]);
  const openCommitDiffModal = useCallback(async (commit: CommitInfo) => {
    if (!isTauriRuntime() || !resolvedRepoPath) return;
    const requestId = ++commitDiffRequest.current;
    setSelectedDiffCommit(commit);
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(true);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
    try {
      const result = await invoke<CommitDiffResult>("get_commit_diff", {
        repoPath: resolvedRepoPath,
        commitHash: commit.hash,
      });
      if (requestId === commitDiffRequest.current) {
        setCommitDiff(result.diff);
      }
    } catch (e) {
      if (requestId === commitDiffRequest.current) {
        setCommitDiffError(String(e));
      }
    } finally {
      if (requestId === commitDiffRequest.current) {
        setIsLoadingCommitDiff(false);
      }
    }
  }, [resolvedRepoPath]);
  const diffCountLabel = isLoadingDiff
    ? "加载中..."
    : diffCommitSearch.trim()
      ? `匹配 ${filteredDiffCommits.length} / ${diffCommits.length}`
      : String(diffCommits.length);
  const mergeResultClass = isSameBranch || hasNoDiff
    ? "no-diff"
    : canMerge
      ? "can-merge"
      : "has-conflict";

  return (
    <div className="merge-panel">
      {mergeOverlayPhase !== "idle" && (
        <div className="merge-progress-overlay" role="dialog" aria-modal="true" aria-labelledby="merge-progress-title">
          <div className="merge-progress-modal">
            {mergeOverlayPhase === "running" && (
              <>
                <Loader2 size={42} className="spin merge-progress-icon" />
                <h3 id="merge-progress-title" className="merge-progress-title">正在合并分支</h3>
                <p className="merge-progress-subtitle">
                  {sourceBranch} → {targetBranch}
                </p>
                <p className="merge-progress-message">{mergeProgressMessage || "处理中..."}</p>
                <div className="merge-progress-track">
                  <div
                    className="merge-progress-bar"
                    style={{ width: `${Math.max(mergeProgress, 8)}%` }}
                  />
                </div>
                <span className="merge-progress-percent">{mergeProgress}%</span>
              </>
            )}
            {mergeOverlayPhase === "success" && (
              <>
                <CheckCircle size={42} className="merge-progress-icon merge-progress-icon--success" />
                <h3 id="merge-progress-title" className="merge-progress-title">合并成功</h3>
                <p className="merge-progress-message merge-progress-message--center">
                  {mergeResultMessage}
                </p>
                <button type="button" className="merge-progress-btn" onClick={closeMergeOverlay}>
                  完成
                </button>
              </>
            )}
            {mergeOverlayPhase === "error" && (
              <>
                <AlertTriangle size={42} className="merge-progress-icon merge-progress-icon--error" />
                <h3 id="merge-progress-title" className="merge-progress-title">合并失败</h3>
                <p className="merge-progress-message merge-progress-message--center">
                  {mergeResultMessage}
                </p>
                <button type="button" className="merge-progress-btn" onClick={closeMergeOverlay}>
                  关闭
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {selectedDiffCommit && (
        <div
          className="commit-modal-overlay commit-diff-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="commit-diff-title"
          onClick={closeCommitDiffModal}
        >
          <div className="commit-modal commit-diff-modal" onClick={(e) => e.stopPropagation()}>
            <div className="commit-modal-header">
              <h3 id="commit-diff-title"><FileText size={16} /> 提交 Diff</h3>
              <button className="commit-modal-close" onClick={closeCommitDiffModal} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="commit-diff-summary">
              <div className="commit-diff-summary-main">
                <span className="commit-hash" title={selectedDiffCommit.hash}>{selectedDiffCommit.short_hash}</span>
                <strong>{selectedDiffCommit.message}</strong>
              </div>
              <div className="commit-diff-summary-meta">
                <span>{selectedDiffCommit.author}</span>
                <span>{selectedDiffCommit.date}</span>
              </div>
              <div className="commit-diff-jump-actions">
                <button
                  type="button"
                  className="commit-diff-jump-btn"
                  onClick={() => jumpCommitDiffChange(-1)}
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
                  onClick={() => jumpCommitDiffChange(1)}
                  disabled={commitDiffChangeRefs.length === 0}
                  title="下一个修改点"
                >
                  <ArrowDown size={14} /> 下一个
                </button>
              </div>
            </div>
            {isLoadingCommitDiff ? (
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
                      scrollCommitDiffFile,
                      collapsedCommitDiffDirs,
                      toggleCommitDiffTreeDir,
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
      )}
      {conflictDetail && (
        <div
          className="commit-modal-overlay commit-diff-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conflict-diff-title"
          onClick={closeConflictDiff}
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
                  onClick={() => jumpConflictBlock(-1)}
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
                  onClick={() => jumpConflictBlock(1)}
                  disabled={conflictBlocks.length === 0}
                  title="下一个冲突块"
                >
                  <ArrowDown size={14} /> 下一个
                </button>
              </div>
              <button className="commit-modal-close" onClick={closeConflictDiff} title="关闭">
                <X size={16} />
              </button>
            </div>
            {isLoadingConflictDiff ? (
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
      )}
      <div className="branch-card">
        <div className="form-group">
          <label>Git 仓库（本地仓库目录）</label>
          <div className="path-picker-row">
            <div className="searchable-dropdown-wrapper">
              <SearchableDropdown
                value={repoPath}
                options={config.repo_path_history || []}
                onChange={handleRepoChange}
                onBlur={handleInputBlur}
                placeholder="输入本地仓库路径或 Git 地址（https://... / git@...），失焦自动拉取分支"
              />
            </div>
            <button type="button" className="path-picker-btn" onClick={onSelectRepo}>
              <FolderOpen size={16} /> 选择
            </button>
            <button
              type="button"
              className="path-picker-btn"
              onClick={handleRefreshBranches}
              disabled={!repoPath.trim() || isLoadingBranches}
            >
              {isLoadingBranches ? <Loader2 size={16} className="spin" /> : <GitBranch size={16} />}
              {isLoadingBranches ? "读取中" : "刷新分支"}
            </button>
          </div>
          {repoPath && (
            <p className="template-hint">
              当前仓库：{repoPath}
              <button
                type="button"
                className="path-link-btn"
                style={{ marginLeft: 8, padding: 0, border: "none", background: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.85em" }}
                onClick={() => onOpenDirectory(repoPath)}
              >
                打开目录
              </button>
            </p>
          )}
        </div>

        <div className="merge-branch-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>源分支（远程，被合并）</label>
            <SearchableDropdown
              value={sourceBranch}
              options={sourceOptions}
              onChange={(v) => {
                setSourceBranch(v);
                setCheckResult(null);
                setDiffCommits([]);
                setDiffLoaded(false);
                setDiffError("");
                setDiffCommitSearch("");
                setSelectedAuthor("");
              }}
              placeholder={isLoadingBranches ? "加载中..." : branchNames.length === 0 ? "请先选择仓库并刷新分支" : "选择源分支（如 origin/feature）..."}
              disabled={branchNames.length === 0}
              loading={isLoadingBranches}
              commitOnInput={false}
              allowCustomValue={false}
            />
          </div>
          <div className="merge-arrow">
            <ArrowRight size={18} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>目标分支（远程，合并到此）</label>
            <SearchableDropdown
              value={targetBranch}
              options={targetOptions}
              onChange={(v) => {
                setTargetBranch(v);
                setCheckResult(null);
                setDiffCommits([]);
                setDiffLoaded(false);
                setDiffError("");
                setDiffCommitSearch("");
                setSelectedAuthor("");
              }}
              placeholder={isLoadingBranches ? "加载中..." : branchNames.length === 0 ? "请先选择仓库并刷新分支" : "选择目标分支（如 origin/master）..."}
              disabled={branchNames.length === 0}
              loading={isLoadingBranches}
              commitOnInput={false}
              allowCustomValue={false}
            />
          </div>
        </div>

        <div className="merge-toolbar">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={pushAfterMerge}
              onChange={(e) => setPushAfterMerge(e.target.checked)}
            />
            <span className="checkbox-toggle"></span>
            <span>合并后推送到远程</span>
          </label>
          <button
            type="button"
            className="path-picker-btn"
            style={{ marginLeft: "auto" }}
            onClick={handleCheck}
            disabled={!sourceBranch || !targetBranch || sourceBranch === targetBranch || isChecking}
          >
            {isChecking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            检查冲突
          </button>
        </div>

        {checkResult && (
          <div className={`merge-result ${mergeResultClass}`}>
            {isSameBranch || hasNoDiff ? (
              <span className="pr-state pr-state-info">
                {isSameBranch ? <Info size={16} /> : <CheckCircle size={16} />}
                {isSameBranch
                  ? checkResult.message
                  : `${sourceBranch} 与 ${targetBranch} 已同步，没有需要合并的提交`}
              </span>
            ) : canMerge ? (
              <span className="pr-state pr-state-ok">
                <CheckCircle size={16} /> {checkResult.message}
              </span>
            ) : (
              <div className="merge-conflict-detail">
                <span className="pr-state pr-state-conflict">
                  <AlertTriangle size={16} /> {checkResult.message}
                </span>
                {checkResult.conflictFiles.length > 0 && (
                  <ul className="conflict-file-list">
                    {checkResult.conflictFiles.map((f) => (
                      <li key={f}>
                        <button
                          type="button"
                          className="conflict-file-btn"
                          title={`查看 ${f} 在两个分支间的差异`}
                          onClick={() => loadConflictDiff(f)}
                        >
                          <FileText size={14} /> {f}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {(isLoadingDiff || diffLoaded) && sourceBranch && targetBranch && (
          <div className={`merge-diff-section${hasNoDiff ? " merge-diff-section--empty" : ""}`}>
            <div className="merge-diff-header">
              <GitCommit size={15} />
              <span>源分支需要合并到目标分支的提交（{diffCountLabel}）</span>
              <span className="template-hint" style={{ marginLeft: 8 }}>
                {sourceBranch} → {targetBranch}
              </span>
            </div>

            {diffAuthors.length > 0 && (
              <div className="merge-authors-row">
                <span className="merge-authors-label">共 {diffAuthors.length} 人提交：</span>
                {diffAuthors.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    className={`merge-author-pill${selectedAuthor === a.name ? " merge-author-pill--active" : ""}`}
                    title={`${a.name} · ${a.count} 次提交`}
                    onClick={() => setSelectedAuthor(selectedAuthor === a.name ? "" : a.name)}
                  >
                    <span
                      className="merge-author-avatar"
                      style={{ background: avatarColor(a.email || a.name) }}
                      aria-hidden
                    >
                      {avatarInitials(a.name || a.email)}
                    </span>
                    <span className="merge-author-name">{a.name}</span>
                    <span className="merge-author-count">{a.count}</span>
                  </button>
                ))}
                {selectedAuthor && (
                  <button
                    type="button"
                    className="merge-author-clear"
                    onClick={() => setSelectedAuthor("")}
                    title="清除筛选"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {isLoadingDiff ? (
              <div className="merge-diff-loading"><Loader2 size={16} className="spin" /> 加载提交中...</div>
            ) : diffError ? (
              <p className="template-hint" style={{ padding: "8px 0", color: "#ff6b6b" }}>
                获取差异提交失败：{diffError}
              </p>
            ) : diffCommits.length === 0 ? (
              <div className="merge-diff-empty" role="status">
                {isSameBranch ? <Info size={20} /> : <CheckCircle size={20} />}
                <div className="merge-diff-empty-text">
                  <strong>
                    {isSameBranch ? "两个分支相同" : "两个分支没有差异"}
                  </strong>
                  <span>
                    {isSameBranch
                      ? "源分支与目标分支指向同一引用，没有差异提交"
                      : `${sourceBranch} 相对 ${targetBranch} 没有多出的提交，无需合并`}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="merge-diff-search">
                  <Search size={14} className="merge-diff-search-icon" />
                  <input
                    type="text"
                    className="merge-diff-search-input"
                    placeholder="搜索 hash、提交信息、作者、日期..."
                    value={diffCommitSearch}
                    onChange={(e) => setDiffCommitSearch(e.target.value)}
                  />
                  {diffCommitSearch && (
                    <button
                      type="button"
                      className="merge-diff-search-clear"
                      onClick={() => setDiffCommitSearch("")}
                      title="清除搜索"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {filteredDiffCommits.length === 0 ? (
                  <p className="merge-diff-no-match">
                    没有匹配「{diffCommitSearch}」的提交
                  </p>
                ) : (
                  <div className="merge-diff-list">
                    {filteredDiffCommits.map((c) => (
                      <div
                        key={c.hash}
                        className="merge-diff-item"
                        role="button"
                        tabIndex={0}
                        title="查看提交 Diff"
                        onClick={() => openCommitDiffModal(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openCommitDiffModal(c);
                          }
                        }}
                      >
                        <div className="merge-diff-item-main">
                          {c.url ? (
                            <button
                              className="commit-link"
                              style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, flexShrink: 0 }}
                              title={`在浏览器中打开: ${c.hash}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openUrl(c.url!);
                              }}
                            >
                              {c.short_hash}
                              <ExternalLink size={10} style={{ marginLeft: 2, verticalAlign: "middle" }} />
                            </button>
                          ) : (
                            <span className="commit-hash" title={c.hash} style={{ flexShrink: 0 }}>{c.short_hash}</span>
                          )}
                          <span className="commit-message">{c.message}</span>
                        </div>
                        <div className="merge-diff-item-meta">
                          <span className="commit-author">{c.author}</span>
                          <span className="commit-date">{c.date}</span>
                          <span className="merge-diff-item-action">查看 Diff</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button
          className="build-btn"
          onClick={handleMerge}
          disabled={!canMerge || hasNoDiff || isMerging || !sourceBranch || !targetBranch}
          title={
            hasNoDiff || isSameBranch
              ? "两个分支没有差异，无需合并"
              : canMerge
                ? "合并并推送到目标分支"
                : "有冲突或未检查，不允许合并"
          }
        >
          {isMerging ? (
            <><Loader2 size={18} className="spin" /> 合并中...</>
          ) : (
            <><GitMerge size={18} /> 合并 {sourceBranch || "源"} → {targetBranch || "目标"}</>
          )}
        </button>

        {sourceBranch && targetBranch && (
          <p className="template-hint" style={{ marginTop: 12 }}>
            将执行（隔离 worktree，不切换当前工作区分支）：
            <code>git merge --no-ff {sourceBranch}</code>（基于 {targetBranch}）
            {pushAfterMerge && (
              <>
                <br />合并后：<code>git push origin HEAD:refs/heads/{(targetBranch || "").replace(/^origin\//, "")}</code>
              </>
            )}
            <br />源/目标均为远程分支引用；主仓库当前分支与未提交改动不会被切换或覆盖。
          </p>
        )}
      </div>
    </div>
  );
}
