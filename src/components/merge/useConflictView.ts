import { useState, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeConflictDetail } from "../../types";
import { isTauriRuntime } from "../../types";
import { parseChangedLines, parseConflictBlocks } from "./utils";

export function useConflictView(
  resolvedRepoPath: string,
  sourceBranch: string,
  targetBranch: string,
) {
  const [conflictDetail, setConflictDetail] = useState<MergeConflictDetail | null>(null);
  const [isLoadingConflictDiff, setIsLoadingConflictDiff] = useState(false);
  const [activeConflictBlock, setActiveConflictBlock] = useState(-1);
  const targetLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const sourceLineRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const conflictChangedLines = useMemo(
    () => conflictDetail
      ? parseChangedLines(conflictDetail.diff)
      : { targetLines: new Set<number>(), sourceLines: new Set<number>() },
    [conflictDetail],
  );
  const conflictBlocks = useMemo(
    () => conflictDetail ? parseConflictBlocks(conflictDetail.diff) : [],
    [conflictDetail],
  );

  const resetConflictView = useCallback(() => {
    setConflictDetail(null);
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
  }, []);

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

  return {
    conflictDetail,
    isLoadingConflictDiff,
    conflictBlocks,
    activeConflictBlock,
    conflictChangedLines,
    targetLineRefs,
    sourceLineRefs,
    loadConflictDiff,
    closeConflictDiff,
    jumpConflictBlock,
    resetConflictView,
  };
}
