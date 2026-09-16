import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type {
  GitBranchOption, LocalMergeCheck, RemoteBranchListResult, HarborConfig,
} from "../../types";
import { isTauriRuntime } from "../../types";
import { isAutoMergeMessage } from "./utils";
import { nextRepoPathHistory, shouldApplyLoadSeq } from "../../hooks/branch/pathHistory";
import { useMergeDiff } from "./useMergeDiff";
import { useMergeAction } from "./useMergeAction";
import { useConflictView } from "./useConflictView";

export function useMergePanel(
  config: HarborConfig,
  onOpenDirectory: (path: string) => void,
  onPackageAfterMerge?: (args: { repoPath: string; targetBranch: string }) => void,
  onConfigPatch?: (patch: Partial<HarborConfig>) => void,
  getConfigSnapshot?: () => HarborConfig,
) {
  const [repoPath, setRepoPath] = useState("");
  const [resolvedRepoPath, setResolvedRepoPath] = useState("");
  const [branches, setBranches] = useState<GitBranchOption[]>([]);
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [checkResult, setCheckResult] = useState<LocalMergeCheck | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [pushAfterMerge, setPushAfterMerge] = useState(true);
  const [packageAfterMerge, setPackageAfterMerge] = useState(true);
  const [useQuickMerge, setUseQuickMerge] = useState(false);
  const [showQuickMergeConfig, setShowQuickMergeConfig] = useState(false);
  const [quickMergeSource, setQuickMergeSource] = useState(config.quick_merge_source || "origin/rc-master");
  const [quickMergeTarget, setQuickMergeTarget] = useState(config.quick_merge_target || "origin/master");
  const [tagAfterMerge, setTagAfterMerge] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [latestTag, setLatestTag] = useState("");
  const autoCheckDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeqRef = useRef(0);

  const diff = useMergeDiff(resolvedRepoPath);
  const conflict = useConflictView(resolvedRepoPath, sourceBranch, targetBranch);

  useEffect(() => {
    setQuickMergeSource(config.quick_merge_source || "origin/rc-master");
    setQuickMergeTarget(config.quick_merge_target || "origin/master");
  }, [config.quick_merge_source, config.quick_merge_target]);

  useEffect(() => {
    return () => {
      if (autoCheckDebounce.current) {
        clearTimeout(autoCheckDebounce.current);
      }
    };
  }, []);

  const persistResolvedRepoHistory = useCallback((localPath: string) => {
    const base = getConfigSnapshot?.() ?? config;
    const next = nextRepoPathHistory(base.repo_path_history, localPath);
    if (!next) return;
    onConfigPatch?.({ repo_path_history: next });
    if (!isTauriRuntime()) return;
    const snap = getConfigSnapshot?.() ?? { ...base, repo_path_history: next };
    void invoke("save_config", { config: snap }).catch((e) => {
      console.error("保存仓库路径历史失败:", e);
    });
  }, [config, getConfigSnapshot, onConfigPatch]);

  const loadBranches = useCallback(async (input: string) => {
    if (!isTauriRuntime() || !input.trim()) return;
    const seq = ++loadSeqRef.current;
    setIsLoadingBranches(true);
    setCheckResult(null);
    try {
      const result = await invoke<RemoteBranchListResult>("list_remote_branches", { repoPath: input.trim() });
      if (!shouldApplyLoadSeq(seq, loadSeqRef.current)) return;
      setResolvedRepoPath(result.repoPath);
      setBranches(result.branches);
      persistResolvedRepoHistory(result.repoPath);
      invoke<string | null>("get_latest_tag", { repoPath: input.trim() })
        .then((tag) => {
          if (!shouldApplyLoadSeq(seq, loadSeqRef.current)) return;
          if (tag) setLatestTag(tag);
        })
        .catch(() => {});
      if (result.branches.length === 0) {
        notifications.show({ message: "该仓库没有远程分支", color: "blue", autoClose: 2500 });
      }
      if (useQuickMerge && (quickMergeSource || quickMergeTarget)) {
        const source = quickMergeSource
          ? result.branches.find((b) => b.name === quickMergeSource)
          : true;
        const target = quickMergeTarget
          ? result.branches.find((b) => b.name === quickMergeTarget)
          : true;
        const missing: string[] = [];
        if (quickMergeSource && !source) missing.push(quickMergeSource);
        if (quickMergeTarget && !target) missing.push(quickMergeTarget);
        if (missing.length > 0) {
          notifications.show({
            message: `快捷合并预设不在远程分支中：${missing.join("、")}`,
            color: "yellow",
            autoClose: 4000,
          });
        }
        if (source && quickMergeSource) setSourceBranch(quickMergeSource);
        if (target && quickMergeTarget) setTargetBranch(quickMergeTarget);
      }
    } catch (e) {
      if (!shouldApplyLoadSeq(seq, loadSeqRef.current)) return;
      notifications.show({ title: "读取分支失败", message: String(e), color: "red", autoClose: 6000 });
      setBranches([]);
      setResolvedRepoPath("");
    } finally {
      if (shouldApplyLoadSeq(seq, loadSeqRef.current)) {
        setIsLoadingBranches(false);
      }
    }
  }, [useQuickMerge, quickMergeSource, quickMergeTarget, persistResolvedRepoHistory]);

  const mergeAction = useMergeAction({
    checkResult,
    resolvedRepoPath,
    sourceBranch,
    targetBranch,
    repoPath,
    pushAfterMerge,
    packageAfterMerge,
    tagAfterMerge,
    tagName,
    tagMessage,
    loadBranches,
    setCheckResult,
    onPackageAfterMerge,
  });

  const branchNames = branches.map((b) => b.name);
  const sourceOptions = branchNames.filter((n) => n !== targetBranch);
  const targetOptions = branchNames.filter((n) => n !== sourceBranch);

  const handleRepoChange = useCallback((value: string) => {
    setRepoPath(value);
    setBranches([]);
    setResolvedRepoPath("");
    setSourceBranch("");
    setTargetBranch("");
    setCheckResult(null);
    diff.resetDiffOnRepoChange();
    conflict.resetConflictView();
    setTagAfterMerge(false);
    setTagName("");
    setLatestTag("");
  }, [diff.resetDiffOnRepoChange, conflict.resetConflictView]);

  const onSelectRepo = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: true,
      defaultPath: repoPath.trim() || undefined,
      title: "选择 Git 仓库目录",
    });
    if (selected) {
      const path = typeof selected === "string" ? selected : (selected as { path?: string }).path || "";
      setRepoPath(path);
      await loadBranches(path);
    }
  }, [loadBranches, repoPath]);

  const handleRefreshBranches = useCallback(async () => {
    await loadBranches(repoPath);
  }, [repoPath, loadBranches]);

  const handleInputBlur = useCallback((finalValue: string) => {
    const v = finalValue.trim();
    if (!v) return;
    setRepoPath(v);
    if (v !== resolvedRepoPath) {
      void loadBranches(v);
    }
  }, [resolvedRepoPath, loadBranches]);

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
      diff.applySameBranchDiff();
      return;
    }
    setIsChecking(true);
    setCheckResult(null);
    conflict.resetConflictView();
    const checkP = invoke<LocalMergeCheck>("check_remote_merge", {
      repoPath: resolvedRepoPath,
      source: sourceBranch,
      target: targetBranch,
    }).then((result) => setCheckResult(result))
      .catch((e) => {
        notifications.show({ title: "冲突检查失败", message: String(e), color: "red", autoClose: 6000 });
      });
    const diffP = diff.beginDiffCheck(sourceBranch, targetBranch);
    await Promise.all([checkP, diffP]);
    setIsChecking(false);
    diff.finishDiffCheck();
  }, [resolvedRepoPath, sourceBranch, targetBranch, diff.applySameBranchDiff, diff.beginDiffCheck, diff.finishDiffCheck, conflict.resetConflictView]);

  useEffect(() => {
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
      diff.applySameBranchDiff();
    } else if (sourceBranch && targetBranch && resolvedRepoPath) {
      autoCheckDebounce.current = setTimeout(() => {
        handleCheck();
      }, 800);
    } else {
      setCheckResult(null);
      diff.clearDiffIdle();
    }
  }, [sourceBranch, targetBranch, resolvedRepoPath, handleCheck, diff.applySameBranchDiff, diff.clearDiffIdle]);

  const autoTagMessage = useMemo(() => {
    if (!tagAfterMerge || diff.diffCommits.length === 0) return "";
    const seen = new Set<string>();
    const lines: string[] = [];
    let idx = 1;
    for (const c of diff.diffCommits) {
      const firstLine = c.message.split("\n")[0].trim();
      if (firstLine && !seen.has(firstLine) && !isAutoMergeMessage(firstLine)) {
        seen.add(firstLine);
        lines.push(`${idx}. ${firstLine}`);
        idx++;
      }
    }
    return lines.join("\n");
  }, [tagAfterMerge, diff.diffCommits]);

  useEffect(() => {
    if (!tagAfterMerge) return;
    if (diff.diffCommits.length === 0) return;
    setTagMessage((prev) => prev || autoTagMessage);
  }, [diff.diffCommits, tagAfterMerge, autoTagMessage]);

  const canMerge = checkResult?.canMerge === true;
  const isSameBranch = Boolean(sourceBranch && targetBranch && sourceBranch === targetBranch);
  const hasNoDiff = Boolean(
    diff.diffLoaded && !diff.diffError && diff.diffCommits.length === 0 && sourceBranch && targetBranch
  );
  const mergeResultClass = isSameBranch || hasNoDiff
    ? "no-diff"
    : canMerge
      ? "can-merge"
      : "has-conflict";

  const nextTag = useMemo(() => {
    if (!latestTag) return "";
    const m = latestTag.match(/^v(\d+)/);
    if (!m) return "";
    return `v${parseInt(m[1], 10) + 1}.0`;
  }, [latestTag]);

  const defaultTagName = useMemo(() => {
    if (nextTag) return nextTag;
    if (!sourceBranch || !targetBranch) return "";
    const src = sourceBranch.replace(/^origin\//, "");
    const dst = targetBranch.replace(/^origin\//, "");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return `merge-${src}-to-${dst}-${dateStr}`;
  }, [nextTag, sourceBranch, targetBranch]);

  useEffect(() => {
    if (tagAfterMerge && defaultTagName && !tagName) {
      setTagName(defaultTagName);
    }
  }, [tagAfterMerge, defaultTagName, tagName]);

  const handleTagAfterMergeChange = useCallback((checked: boolean) => {
    setTagAfterMerge(checked);
    if (checked) {
      setTagName(defaultTagName);
      setTagMessage(autoTagMessage);
    } else {
      setTagName("");
      setTagMessage("");
    }
  }, [defaultTagName, autoTagMessage]);

  const handleSourceBranchChange = useCallback((v: string) => {
    setSourceBranch(v);
    setCheckResult(null);
    diff.resetDiffOnBranchChange();
    setTagAfterMerge(false);
    setTagName("");
    setTagMessage("");
  }, [diff.resetDiffOnBranchChange]);

  const handleQuickMergeConfigSaved = useCallback((source: string, target: string) => {
    setQuickMergeSource(source);
    setQuickMergeTarget(target);
    onConfigPatch?.({
      quick_merge_source: source,
      quick_merge_target: target,
    });
    if (useQuickMerge && branches.length > 0) {
      const src = branches.find((b) => b.name === source);
      const tgt = branches.find((b) => b.name === target);
      const missing: string[] = [];
      if (source && !src) missing.push(source);
      if (target && !tgt) missing.push(target);
      if (missing.length > 0) {
        notifications.show({
          message: `快捷合并预设不在远程分支中：${missing.join("、")}`,
          color: "yellow",
          autoClose: 4000,
        });
      }
      if (src) setSourceBranch(source);
      if (tgt) setTargetBranch(target);
      if (tgt) setTagAfterMerge(true);
    }
  }, [useQuickMerge, branches, onConfigPatch]);

  const handleTargetBranchChange = useCallback((v: string) => {
    setTargetBranch(v);
    setCheckResult(null);
    diff.resetDiffOnBranchChange();
    const normalized = v.replace(/^origin\//, "");
    if (useQuickMerge || normalized === "master" || normalized === "main") {
      setTagAfterMerge(true);
    } else {
      setTagAfterMerge(false);
      setTagName("");
      setTagMessage("");
    }
  }, [useQuickMerge, diff.resetDiffOnBranchChange]);

  useEffect(() => {
    if (useQuickMerge && branches.length > 0 && quickMergeSource && quickMergeTarget) {
      const source = branches.find((b) => b.name === quickMergeSource);
      const target = branches.find((b) => b.name === quickMergeTarget);
      if (source && sourceBranch !== quickMergeSource) {
        setSourceBranch(quickMergeSource);
      }
      if (target && targetBranch !== quickMergeTarget) {
        setTargetBranch(quickMergeTarget);
        setTagAfterMerge(true);
      }
    }
  }, [useQuickMerge, branches, sourceBranch, targetBranch, quickMergeSource, quickMergeTarget]);

  return {
    repoPath,
    sourceBranch,
    targetBranch,
    sourceOptions,
    targetOptions,
    branchNames,
    isLoadingBranches,
    pushAfterMerge,
    packageAfterMerge,
    isChecking,
    isMerging: mergeAction.isMerging,
    checkResult,
    canMerge,
    isSameBranch,
    hasNoDiff,
    mergeResultClass,
    isLoadingDiff: diff.isLoadingDiff,
    diffLoaded: diff.diffLoaded,
    diffError: diff.diffError,
    diffCommits: diff.diffCommits,
    filteredDiffCommits: diff.filteredDiffCommits,
    diffAuthors: diff.diffAuthors,
    selectedAuthor: diff.selectedAuthor,
    diffCommitSearch: diff.diffCommitSearch,
    diffCountLabel: diff.diffCountLabel,
    handleRepoChange,
    handleInputBlur,
    onSelectRepo,
    handleRefreshBranches,
    handleSourceBranchChange,
    handleTargetBranchChange,
    setPushAfterMerge,
    setPackageAfterMerge,
    handleCheck,
    handleMerge: mergeAction.handleMerge,
    loadConflictDiff: conflict.loadConflictDiff,
    setSelectedAuthor: diff.setSelectedAuthor,
    setDiffCommitSearch: diff.setDiffCommitSearch,
    openCommitDiffModal: diff.openCommitDiffModal,
    openBranchDiffModal: diff.openBranchDiffModal,
    branchDiffOpen: diff.branchDiffOpen,
    branchDiffLabel: diff.branchDiffLabel,
    mergeOverlayPhase: mergeAction.mergeOverlayPhase,
    mergeProgress: mergeAction.mergeProgress,
    mergeProgressMessage: mergeAction.mergeProgressMessage,
    mergeResultMessage: mergeAction.mergeResultMessage,
    closeMergeOverlay: mergeAction.closeMergeOverlay,
    selectedDiffCommit: diff.selectedDiffCommit,
    commitDiff: diff.commitDiff,
    commitDiffError: diff.commitDiffError,
    isLoadingCommitDiff: diff.isLoadingCommitDiff,
    commitDiffFiles: diff.commitDiffFiles,
    commitDiffFileTree: diff.commitDiffFileTree,
    commitDiffChangeRefs: diff.commitDiffChangeRefs,
    activeCommitDiffChange: diff.activeCommitDiffChange,
    activeCommitDiffFile: diff.activeCommitDiffFile,
    collapsedCommitDiffDirs: diff.collapsedCommitDiffDirs,
    commitDiffLineRefs: diff.commitDiffLineRefs,
    commitDiffFileRefs: diff.commitDiffFileRefs,
    closeCommitDiffModal: diff.closeCommitDiffModal,
    jumpCommitDiffChange: diff.jumpCommitDiffChange,
    scrollCommitDiffFile: diff.scrollCommitDiffFile,
    toggleCommitDiffTreeDir: diff.toggleCommitDiffTreeDir,
    conflictDetail: conflict.conflictDetail,
    isLoadingConflictDiff: conflict.isLoadingConflictDiff,
    conflictBlocks: conflict.conflictBlocks,
    activeConflictBlock: conflict.activeConflictBlock,
    conflictChangedLines: conflict.conflictChangedLines,
    targetLineRefs: conflict.targetLineRefs,
    sourceLineRefs: conflict.sourceLineRefs,
    closeConflictDiff: conflict.closeConflictDiff,
    jumpConflictBlock: conflict.jumpConflictBlock,
    onOpenDirectory,
    config,
    tagAfterMerge,
    tagName,
    tagMessage,
    latestTag,
    handleTagAfterMergeChange,
    setTagName,
    setTagMessage,
    defaultTagName,
    autoTagMessage,
    useQuickMerge,
    setUseQuickMerge,
    showQuickMergeConfig,
    setShowQuickMergeConfig,
    handleQuickMergeConfigSaved,
    quickMergeSource,
    quickMergeTarget,
  };
}
