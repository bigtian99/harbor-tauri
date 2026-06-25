import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import {
  GitMerge, FolderOpen, Loader2, RefreshCw, CheckCircle, AlertTriangle,
  ArrowRight, GitBranch
} from "lucide-react";
import { SearchableDropdown } from "./SearchableDropdown";
import type { HarborConfig, GitBranchOption, LocalMergeCheck } from "../types";
import { isTauriRuntime } from "../types";

interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
}

export function MergePanel({ config, onOpenDirectory }: MergePanelProps) {
  const [repoPath, setRepoPath] = useState("");
  const [branches, setBranches] = useState<GitBranchOption[]>([]);
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [checkResult, setCheckResult] = useState<LocalMergeCheck | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [pushAfterMerge, setPushAfterMerge] = useState(true);

  const loadBranches = useCallback(async (path: string) => {
    if (!isTauriRuntime() || !path.trim()) return;
    setIsLoadingBranches(true);
    setCheckResult(null);
    try {
      const list = await invoke<GitBranchOption[]>("list_remote_branches", { repoPath: path.trim() });
      setBranches(list);
    } catch (e) {
      notifications.show({ title: "读取分支失败", message: String(e), color: "red", autoClose: 6000 });
      setBranches([]);
    } finally {
      setIsLoadingBranches(false);
    }
  }, []);

  const branchNames = branches.map((b) => b.name);

  const handleRepoChange = useCallback((value: string) => {
    setRepoPath(value);
    setBranches([]);
    setSourceBranch("");
    setTargetBranch("");
    setCheckResult(null);
  }, []);

  const onSelectRepo = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, directory: true });
    if (selected) {
      const path = typeof selected === "string" ? selected : (selected as { path?: string }).path || "";
      handleRepoChange(path);
      await loadBranches(path);
    }
  }, [handleRepoChange, loadBranches]);

  const handleRefreshBranches = useCallback(async () => {
    await loadBranches(repoPath);
  }, [repoPath, loadBranches]);

  const handleCheck = useCallback(async () => {
    if (!isTauriRuntime() || !sourceBranch || !targetBranch) return;
    if (sourceBranch === targetBranch) {
      notifications.show({ message: "源分支和目标分支不能相同", color: "yellow", autoClose: 3000 });
      return;
    }
    setIsChecking(true);
    setCheckResult(null);
    try {
      const result = await invoke<LocalMergeCheck>("check_remote_merge", {
        repoPath: repoPath.trim(),
        source: sourceBranch,
        target: targetBranch,
      });
      setCheckResult(result);
    } catch (e) {
      notifications.show({ title: "冲突检查失败", message: String(e), color: "red", autoClose: 6000 });
    } finally {
      setIsChecking(false);
    }
  }, [repoPath, sourceBranch, targetBranch]);

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
        repoPath: repoPath.trim(),
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
  }, [checkResult, sourceBranch, targetBranch, repoPath, pushAfterMerge, loadBranches]);

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
                placeholder="输入本地仓库路径或选择目录"
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
              options={branchNames}
              onChange={(v) => { setSourceBranch(v); setCheckResult(null); }}
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
              options={branchNames}
              onChange={(v) => { setTargetBranch(v); setCheckResult(null); }}
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
