import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import { getCommitDiffChangeRefs, getCommitDiffFileTree, parseCommitDiffFiles } from "../../commitDiff";
import type {
  GitBranchOption, LocalMergeCheck, RemoteBranchListResult, CommitInfo, AuthorInfo,
  CommitDiffResult, MergeConflictDetail, HarborConfig,
} from "../../types";
import { isTauriRuntime } from "../../types";
import type { MergeOverlayPhase } from "./types";
import { parseChangedLines, parseConflictBlocks, summarizeMergeError } from "./utils";

export function useMergePanel(config: HarborConfig, onOpenDirectory: (path: string) => void) {
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

  const handleSourceBranchChange = useCallback((v: string) => {
    setSourceBranch(v);
    setCheckResult(null);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedAuthor("");
  }, []);

  const handleTargetBranchChange = useCallback((v: string) => {
    setTargetBranch(v);
    setCheckResult(null);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedAuthor("");
  }, []);

  return {
    repoPath,
    sourceBranch,
    targetBranch,
    sourceOptions,
    targetOptions,
    branchNames,
    isLoadingBranches,
    pushAfterMerge,
    isChecking,
    isMerging,
    checkResult,
    canMerge,
    isSameBranch,
    hasNoDiff,
    mergeResultClass,
    isLoadingDiff,
    diffLoaded,
    diffError,
    diffCommits,
    filteredDiffCommits,
    diffAuthors,
    selectedAuthor,
    diffCommitSearch,
    diffCountLabel,
    handleRepoChange,
    handleInputBlur,
    onSelectRepo,
    handleRefreshBranches,
    handleSourceBranchChange,
    handleTargetBranchChange,
    setPushAfterMerge,
    handleCheck,
    handleMerge,
    loadConflictDiff,
    setSelectedAuthor,
    setDiffCommitSearch,
    openCommitDiffModal,
    mergeOverlayPhase,
    mergeProgress,
    mergeProgressMessage,
    mergeResultMessage,
    closeMergeOverlay,
    selectedDiffCommit,
    commitDiff,
    commitDiffError,
    isLoadingCommitDiff,
    commitDiffFiles,
    commitDiffFileTree,
    commitDiffChangeRefs,
    activeCommitDiffChange,
    activeCommitDiffFile,
    collapsedCommitDiffDirs,
    commitDiffLineRefs,
    commitDiffFileRefs,
    closeCommitDiffModal,
    jumpCommitDiffChange,
    scrollCommitDiffFile,
    toggleCommitDiffTreeDir,
    conflictDetail,
    isLoadingConflictDiff,
    conflictBlocks,
    activeConflictBlock,
    conflictChangedLines,
    targetLineRefs,
    sourceLineRefs,
    closeConflictDiff,
    jumpConflictBlock,
    onOpenDirectory,
    config,
  };
}
