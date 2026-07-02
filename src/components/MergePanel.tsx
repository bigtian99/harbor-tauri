import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import {
  GitMerge, FolderOpen, Loader2, RefreshCw, CheckCircle, AlertTriangle,
  ArrowRight, GitBranch, GitCommit, ExternalLink, Info, Search
} from "lucide-react";
import { SearchableDropdown } from "./SearchableDropdown";
import type { HarborConfig, GitBranchOption, LocalMergeCheck, RemoteBranchListResult, CommitInfo } from "../types";
import { isTauriRuntime } from "../types";

interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
}

type MergeOverlayPhase = "idle" | "running" | "success" | "error";

function summarizeMergeError(error: unknown): string {
  const msg = String(error).trim();
  if (!msg) return "合并失败，请稍后重试";
  if (msg.includes("冲突") || msg.includes("CONFLICT")) {
    return msg.split("\n")[0].trim();
  }
  return msg.split("\n")[0].trim();
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
  const [mergeOverlayPhase, setMergeOverlayPhase] = useState<MergeOverlayPhase>("idle");
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeProgressMessage, setMergeProgressMessage] = useState("");
  const [mergeResultMessage, setMergeResultMessage] = useState("");
  const mergeAutoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCheckDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      return;
    }
    setIsChecking(true);
    setIsLoadingDiff(true);
    setCheckResult(null);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
    setDiffCommitSearch("");
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
      .catch((e) => {
        const message = String(e);
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
  const filteredDiffCommits = useMemo(() => {
    const q = diffCommitSearch.trim().toLowerCase();
    if (!q) return diffCommits;
    return diffCommits.filter((c) =>
      c.hash.toLowerCase().includes(q) ||
      c.short_hash.toLowerCase().includes(q) ||
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.date.toLowerCase().includes(q)
    );
  }, [diffCommits, diffCommitSearch]);
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
              }}
              placeholder={isLoadingBranches ? "加载中..." : branchNames.length === 0 ? "请先选择仓库并刷新分支" : "选择源分支（如 origin/feature）..."}
              disabled={branchNames.length === 0}
              loading={isLoadingBranches}
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
              }}
              placeholder={isLoadingBranches ? "加载中..." : branchNames.length === 0 ? "请先选择仓库并刷新分支" : "选择目标分支（如 origin/master）..."}
              disabled={branchNames.length === 0}
              loading={isLoadingBranches}
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
                      <li key={f}>{f}</li>
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
                      <div key={c.hash} className="merge-diff-item">
                        <div className="merge-diff-item-main">
                          {c.url ? (
                            <button
                              className="commit-link"
                              style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, flexShrink: 0 }}
                              title={`在浏览器中打开: ${c.hash}`}
                              onClick={() => openUrl(c.url!)}
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
