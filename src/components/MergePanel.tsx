import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import {
  GitMerge, FolderOpen, Loader2, RefreshCw, CheckCircle, AlertTriangle,
  ArrowRight, GitBranch, GitCommit, ExternalLink
} from "lucide-react";
import { SearchableDropdown } from "./SearchableDropdown";
import type { HarborConfig, GitBranchOption, LocalMergeCheck, RemoteBranchListResult, CommitInfo } from "../types";
import { isTauriRuntime } from "../types";

interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
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
      return;
    }
    setIsChecking(true);
    setIsLoadingDiff(true);
    setCheckResult(null);
    setDiffCommits([]);
    setDiffLoaded(false);
    setDiffError("");
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

  // 选完源和目标分支后自动检查冲突并加载差异提交
  useEffect(() => {
    if (sourceBranch && targetBranch && sourceBranch === targetBranch) {
      setCheckResult({
        canMerge: false,
        conflictFiles: [],
        message: "源分支和目标分支相同，无需合并",
      });
      setDiffCommits([]);
      setDiffLoaded(true);
      setDiffError("");
    } else if (sourceBranch && targetBranch && resolvedRepoPath) {
      handleCheck();
    } else {
      setCheckResult(null);
      setDiffCommits([]);
      setDiffLoaded(false);
      setDiffError("");
    }
  }, [sourceBranch, targetBranch, resolvedRepoPath, handleCheck]);

  const handleMerge = useCallback(async () => {
    if (!checkResult?.canMerge || !sourceBranch || !targetBranch) return;
    if (!window.confirm(
      `确认把 ${sourceBranch} 合并进 ${targetBranch}？\n` +
      `将切换到 ${targetBranch} 分支并执行 git merge --no-ff ${sourceBranch}` +
      `${pushAfterMerge ? `\n合并后推送到远程 origin/${targetBranch}` : ""}`
    )) {
      return;
    }
    setIsMerging(true);
    try {
      const log = await invoke<string>("merge_remote_branches", {
        repoPath: resolvedRepoPath,
        source: sourceBranch,
        target: targetBranch,
        push: pushAfterMerge,
      });
      notifications.show({
        title: "合并成功",
        message: log,
        color: "teal",
        autoClose: 6000,
      });
      setCheckResult(null);
      // 合并后刷新分支列表（目标分支已 checkout）
      await loadBranches(repoPath);
    } catch (e) {
      notifications.show({ title: "合并失败", message: String(e), color: "red", autoClose: 8000 });
    } finally {
      setIsMerging(false);
    }
  }, [checkResult, resolvedRepoPath, sourceBranch, targetBranch, repoPath, pushAfterMerge, loadBranches]);

  const canMerge = checkResult?.canMerge === true;

  return (
    <div className="merge-panel">
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
          <div className={`merge-result ${canMerge ? "can-merge" : "has-conflict"}`}>
            {canMerge ? (
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
          <div className="merge-diff-section">
            <div className="merge-diff-header">
              <GitCommit size={15} />
              <span>合并将带入的提交（{isLoadingDiff ? "加载中..." : diffCommits.length}）</span>
              <span className="template-hint" style={{ marginLeft: 8 }}>
                {sourceBranch} 相对 {targetBranch} 多出的提交
              </span>
            </div>
            {isLoadingDiff ? (
              <div className="merge-diff-loading"><Loader2 size={16} className="spin" /> 加载提交中...</div>
            ) : diffError ? (
              <p className="template-hint" style={{ padding: "8px 0", color: "#ff6b6b" }}>
                获取差异提交失败：{diffError}
              </p>
            ) : diffCommits.length === 0 ? (
              <p className="template-hint" style={{ padding: "8px 0" }}>
                {sourceBranch === targetBranch
                  ? "两个分支相同，没有差异提交"
                  : `没有差异提交，${sourceBranch} 没有比 ${targetBranch} 多出的提交`}
              </p>
            ) : (
              <div className="merge-diff-list">
                {diffCommits.map((c) => (
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
          </div>
        )}

        <button
          className="build-btn"
          onClick={handleMerge}
          disabled={!canMerge || isMerging || !sourceBranch || !targetBranch}
          title={canMerge ? "合并并切换到目标分支" : "有冲突或未检查，不允许合并"}
        >
          {isMerging ? (
            <><Loader2 size={18} className="spin" /> 合并中...</>
          ) : (
            <><GitMerge size={18} /> 合并 {sourceBranch || "源"} → {targetBranch || "目标"}</>
          )}
        </button>

        {sourceBranch && targetBranch && (
          <p className="template-hint" style={{ marginTop: 12 }}>
            将执行：<code>git checkout {(targetBranch || "").replace(/^origin\//, "")} &amp;&amp; git merge --no-ff {sourceBranch}</code>
            {pushAfterMerge && <><br />合并后：<code>git push origin {(targetBranch || "").replace(/^origin\//, "")}</code></>}
            <br />⚠️ 合并会切换当前工作区分支并同步远程目标分支，请先暂存未提交的改动。
          </p>
        )}
      </div>
    </div>
  );
}
