import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LocalMergeCheck } from "../../types";
import { isTauriRuntime } from "../../types";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import type { MergeOverlayPhase } from "./types";
import { summarizeMergeError } from "./utils";
import { mergeSyncPackageConfirmHint } from "../../mergeSyncPackage";

type UseMergeActionArgs = {
  checkResult: LocalMergeCheck | null;
  resolvedRepoPath: string;
  sourceBranch: string;
  targetBranch: string;
  repoPath: string;
  pushAfterMerge: boolean;
  packageAfterMerge: boolean;
  tagAfterMerge: boolean;
  tagName: string;
  tagMessage: string;
  loadBranches: (input: string) => Promise<void>;
  setCheckResult: (result: LocalMergeCheck | null) => void;
  onPackageAfterMerge?: (args: { repoPath: string; targetBranch: string }) => void;
};

export function useMergeAction({
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
}: UseMergeActionArgs) {
  const { confirm } = useConfirmDialog();
  const [isMerging, setIsMerging] = useState(false);
  const [mergeOverlayPhase, setMergeOverlayPhase] = useState<MergeOverlayPhase>("idle");
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeProgressMessage, setMergeProgressMessage] = useState("");
  const [mergeResultMessage, setMergeResultMessage] = useState("");
  const mergeAutoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    };
  }, []);

  const handleMerge = useCallback(async () => {
    if (!checkResult?.canMerge || !sourceBranch || !targetBranch) return;
    const targetRemoteName = (targetBranch || "").replace(/^origin\//, "");
    const tagInfo = tagAfterMerge && tagName.trim()
      ? `\n合并后打 tag「${tagName.trim()}」并推送\nTag 内容：${tagMessage}`
      : "";
    const packageInfo = packageAfterMerge
      ? `\n${mergeSyncPackageConfirmHint(targetBranch)}`
      : "";
    const details = [
      `将在隔离 worktree 中执行 git merge --no-ff ${sourceBranch}，不会切换当前工作区分支`,
      pushAfterMerge ? `合并后推送到远程 origin/${targetRemoteName}` : "合并结果仅更新本地分支引用，不推送远程",
    ];
    if (tagInfo) details.push(tagInfo.trim());
    if (packageInfo) details.push(packageInfo.trim());
    const ok = await confirm({
      title: "确认合并",
      message: `确认把 ${sourceBranch} 合并进 ${targetBranch}？`,
      details,
      confirmLabel: "合并",
    });
    if (!ok) return;
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
        tag: tagAfterMerge ? tagName.trim() : "",
        tagMessage: tagAfterMerge ? tagMessage : "",
      });
      setMergeProgress(100);
      setMergeProgressMessage("合并完成");
      setMergeResultMessage(summary);
      setMergeOverlayPhase("success");
      setCheckResult(null);
      await loadBranches(repoPath);
      if (packageAfterMerge) {
        onPackageAfterMerge?.({
          repoPath: resolvedRepoPath,
          targetBranch,
        });
      }
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
  }, [
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
    closeMergeOverlay,
    onPackageAfterMerge,
    setCheckResult,
    confirm,
  ]);

  return {
    isMerging,
    mergeOverlayPhase,
    mergeProgress,
    mergeProgressMessage,
    mergeResultMessage,
    closeMergeOverlay,
    handleMerge,
  };
}
