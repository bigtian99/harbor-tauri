import { useState, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { getCommitDiffChangeRefs, getCommitDiffFileTree, parseCommitDiffFiles } from "../../commitDiff";
import type { AuthorInfo, CommitDiffResult, CommitInfo } from "../../types";
import { isTauriRuntime } from "../../types";

export function useMergeDiff(resolvedRepoPath: string) {
  const [diffCommits, setDiffCommits] = useState<CommitInfo[]>([]);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffCommitSearch, setDiffCommitSearch] = useState("");
  const [selectedAuthor, setSelectedAuthor] = useState("");
  const [selectedDiffCommit, setSelectedDiffCommit] = useState<CommitInfo | null>(null);
  const [branchDiffOpen, setBranchDiffOpen] = useState(false);
  const [branchDiffLabel, setBranchDiffLabel] = useState("");
  const [commitDiff, setCommitDiff] = useState("");
  const [commitDiffError, setCommitDiffError] = useState("");
  const [isLoadingCommitDiff, setIsLoadingCommitDiff] = useState(false);
  const [activeCommitDiffChange, setActiveCommitDiffChange] = useState(-1);
  const [activeCommitDiffFile, setActiveCommitDiffFile] = useState(-1);
  const [collapsedCommitDiffDirs, setCollapsedCommitDiffDirs] = useState<Set<string>>(new Set());
  const commitDiffRequest = useRef(0);
  const commitDiffLineRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const commitDiffFileRefs = useRef<Record<number, HTMLElement | null>>({});

  const clearCommitDiffUi = useCallback(() => {
    setSelectedDiffCommit(null);
    setBranchDiffOpen(false);
    setBranchDiffLabel("");
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(false);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
    commitDiffRequest.current++;
  }, []);

  const resetDiffOnRepoChange = useCallback(() => {
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedAuthor("");
    clearCommitDiffUi();
  }, [clearCommitDiffUi]);

  const resetDiffOnBranchChange = useCallback(() => {
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedAuthor("");
  }, []);

  const applySameBranchDiff = useCallback(() => {
    setDiffCommits([]);
    setDiffLoaded(true);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedDiffCommit(null);
    setCollapsedCommitDiffDirs(new Set());
  }, []);

  const clearDiffIdle = useCallback(() => {
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedDiffCommit(null);
    setCollapsedCommitDiffDirs(new Set());
  }, []);

  /** 开始冲突检查时的 diff 侧重置，并返回差异提交拉取 Promise（供并行 await） */
  const beginDiffCheck = useCallback((source: string, target: string) => {
    setIsLoadingDiff(true);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
    setSelectedDiffCommit(null);
    setBranchDiffOpen(false);
    setBranchDiffLabel("");
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(false);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
    commitDiffRequest.current++;

    return invoke<CommitInfo[]>("list_branch_diff_commits", {
      repoPath: resolvedRepoPath,
      source,
      target,
    }).then((list) => setDiffCommits(list))
      .catch(() => {
        const message = "无法获取差异提交，请确认源分支和目标分支存在，并刷新分支后重试";
        setDiffError(message);
        notifications.show({ title: "获取差异提交失败", message, color: "red", autoClose: 6000 });
      })
      .finally(() => {
        setDiffLoaded(true);
      });
  }, [resolvedRepoPath]);

  const finishDiffCheck = useCallback(() => {
    setIsLoadingDiff(false);
  }, []);

  const closeCommitDiffModal = useCallback(() => {
    commitDiffRequest.current++;
    setSelectedDiffCommit(null);
    setBranchDiffOpen(false);
    setBranchDiffLabel("");
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

  const commitDiffFiles = useMemo(() => parseCommitDiffFiles(commitDiff), [commitDiff]);
  const commitDiffChangeRefs = useMemo(() => getCommitDiffChangeRefs(commitDiffFiles), [commitDiffFiles]);
  const commitDiffFileTree = useMemo(() => getCommitDiffFileTree(commitDiffFiles), [commitDiffFiles]);

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

  const openCommitDiffModal = useCallback(async (commit: CommitInfo) => {
    if (!isTauriRuntime() || !resolvedRepoPath) return;
    const requestId = ++commitDiffRequest.current;
    setSelectedDiffCommit(commit);
    setBranchDiffOpen(false);
    setBranchDiffLabel("");
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

  /** 一键查看源/目标分支的整体改动文件（`git diff target...source`） */
  const openBranchDiffModal = useCallback(async (source: string, target: string) => {
    if (!isTauriRuntime() || !resolvedRepoPath || !source || !target) return;
    const requestId = ++commitDiffRequest.current;
    setSelectedDiffCommit(null);
    setBranchDiffOpen(true);
    setBranchDiffLabel(`${source} → ${target}`);
    setCommitDiff("");
    setCommitDiffError("");
    setIsLoadingCommitDiff(true);
    setActiveCommitDiffChange(-1);
    setActiveCommitDiffFile(-1);
    setCollapsedCommitDiffDirs(new Set());
    commitDiffLineRefs.current = {};
    commitDiffFileRefs.current = {};
    try {
      const result = await invoke<CommitDiffResult>("get_branch_diff", {
        repoPath: resolvedRepoPath,
        source,
        target,
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

  const diffCountLabel = isLoadingDiff
    ? "加载中..."
    : diffCommitSearch.trim()
      ? `匹配 ${filteredDiffCommits.length} / ${diffCommits.length}`
      : String(diffCommits.length);

  return {
    diffCommits,
    isLoadingDiff,
    diffLoaded,
    diffError,
    diffCommitSearch,
    selectedAuthor,
    selectedDiffCommit,
    branchDiffOpen,
    branchDiffLabel,
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
    filteredDiffCommits,
    diffAuthors,
    diffCountLabel,
    setSelectedAuthor,
    setDiffCommitSearch,
    closeCommitDiffModal,
    jumpCommitDiffChange,
    scrollCommitDiffFile,
    toggleCommitDiffTreeDir,
    openCommitDiffModal,
    openBranchDiffModal,
    resetDiffOnRepoChange,
    resetDiffOnBranchChange,
    applySameBranchDiff,
    clearDiffIdle,
    beginDiffCheck,
    finishDiffCheck,
  };
}
