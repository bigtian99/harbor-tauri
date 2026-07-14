import {
  AlertTriangle, ArrowRight, CheckCircle, ExternalLink, FileText, FolderOpen,
  GitBranch, GitCommit, GitMerge, Info, Loader2, RefreshCw, Search, Tag
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SearchableDropdown } from "../SearchableDropdown";
import { avatarColor, avatarInitials } from "../../avatarUrl";
import type { AuthorInfo, CommitInfo, HarborConfig, LocalMergeCheck } from "../../types";

interface MergeFormSectionProps {
  config: HarborConfig;
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  sourceOptions: string[];
  targetOptions: string[];
  branchNames: string[];
  isLoadingBranches: boolean;
  pushAfterMerge: boolean;
  tagAfterMerge: boolean;
  tagName: string;
  tagMessage: string;
  defaultTagName: string;
  defaultTagMessage: string;
  useQuickMerge: boolean;
  isChecking: boolean;
  isMerging: boolean;
  checkResult: LocalMergeCheck | null;
  canMerge: boolean;
  isSameBranch: boolean;
  hasNoDiff: boolean;
  mergeResultClass: string;
  isLoadingDiff: boolean;
  diffLoaded: boolean;
  diffError: string;
  diffCommits: CommitInfo[];
  filteredDiffCommits: CommitInfo[];
  diffAuthors: AuthorInfo[];
  selectedAuthor: string;
  diffCommitSearch: string;
  diffCountLabel: string;
  onRepoChange: (value: string) => void;
  onInputBlur: (finalValue: string) => void;
  onSelectRepo: () => void;
  onRefreshBranches: () => void;
  onOpenDirectory: (path: string) => void;
  onSourceBranchChange: (value: string) => void;
  onTargetBranchChange: (value: string) => void;
  onPushAfterMergeChange: (checked: boolean) => void;
  onTagAfterMergeChange: (checked: boolean) => void;
  onUseQuickMergeChange: (checked: boolean) => void;
  onTagNameChange: (value: string) => void;
  onTagMessageChange: (value: string) => void;
  onCheck: () => void;
  onMerge: () => void;
  onLoadConflictDiff: (filePath: string) => void;
  onSelectAuthor: (author: string) => void;
  onDiffCommitSearchChange: (value: string) => void;
  onOpenCommitDiff: (commit: CommitInfo) => void;
}

export function MergeFormSection({
  config,
  repoPath,
  sourceBranch,
  targetBranch,
  sourceOptions,
  targetOptions,
  branchNames,
  isLoadingBranches,
  pushAfterMerge,
  tagAfterMerge,
  tagName,
  tagMessage,
  defaultTagName,
  defaultTagMessage,
  useQuickMerge,
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
  onRepoChange,
  onInputBlur,
  onSelectRepo,
  onRefreshBranches,
  onOpenDirectory,
  onSourceBranchChange,
  onTargetBranchChange,
  onPushAfterMergeChange,
  onTagAfterMergeChange,
  onUseQuickMergeChange,
  onTagNameChange,
  onTagMessageChange,
  onCheck,
  onMerge,
  onLoadConflictDiff,
  onSelectAuthor,
  onDiffCommitSearchChange,
  onOpenCommitDiff,
}: MergeFormSectionProps) {
  return (
    <div className="branch-card">
      <div className="form-group">
        <label>Git 仓库（本地仓库目录）</label>
        <div className="path-picker-row">
          <div className="searchable-dropdown-wrapper">
            <SearchableDropdown
              value={repoPath}
              options={config.repo_path_history || []}
              onChange={onRepoChange}
              onBlur={onInputBlur}
              placeholder="输入本地仓库路径或 Git 地址（https://... / git@...），失焦自动拉取分支"
            />
          </div>
          <button type="button" className="path-picker-btn" onClick={onSelectRepo}>
            <FolderOpen size={16} /> 选择
          </button>
          <button
            type="button"
            className="path-picker-btn"
            onClick={onRefreshBranches}
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
            onChange={onSourceBranchChange}
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
            onChange={onTargetBranchChange}
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
            onChange={(e) => onPushAfterMergeChange(e.target.checked)}
          />
          <span className="checkbox-toggle"></span>
          <span>合并后推送到远程</span>
        </label>
        <label className="checkbox-label" style={{ marginLeft: 16 }}>
          <input
            type="checkbox"
            checked={tagAfterMerge}
            onChange={(e) => onTagAfterMergeChange(e.target.checked)}
          />
          <span className="checkbox-toggle"></span>
          <span><Tag size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />合并后打 tag 并推送</span>
        </label>
        <label className="checkbox-label" style={{ marginLeft: 16 }}>
          <input
            type="checkbox"
            checked={useQuickMerge}
            onChange={(e) => onUseQuickMergeChange(e.target.checked)}
          />
          <span className="checkbox-toggle"></span>
          <span>快捷模式：rc-master → master</span>
        </label>
        <button
          type="button"
          className="path-picker-btn"
          style={{ marginLeft: "auto" }}
          onClick={onCheck}
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
                        onClick={() => onLoadConflictDiff(f)}
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
                  onClick={() => onSelectAuthor(selectedAuthor === a.name ? "" : a.name)}
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
                  onClick={() => onSelectAuthor("")}
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
                  onChange={(e) => onDiffCommitSearchChange(e.target.value)}
                />
                {diffCommitSearch && (
                  <button
                    type="button"
                    className="merge-diff-search-clear"
                    onClick={() => onDiffCommitSearchChange("")}
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
                      onClick={() => onOpenCommitDiff(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenCommitDiff(c);
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

      {tagAfterMerge && (
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Tag 名称</label>
          <input
            type="text"
            className="path-input"
            placeholder={defaultTagName}
            value={tagName}
            onChange={(e) => onTagNameChange(e.target.value)}
            style={{ fontFamily: "monospace" }}
          />
          <label style={{ marginTop: 8 }}>Tag 内容（可修改）</label>
          <textarea
            className="path-input"
            rows={4}
            placeholder={defaultTagMessage || "无差异提交"}
            value={tagMessage}
            onChange={(e) => onTagMessageChange(e.target.value)}
            style={{
              fontFamily: "monospace",
              fontSize: "0.85em",
              resize: "vertical",
              minHeight: 60,
            }}
          />
          <p className="template-hint">
            将在合并 commit 上创建此 tag 并推送 origin
            {tagName.trim() === "" && defaultTagName && (
              <>（如不修改将使用默认：{defaultTagName}）</>
            )}
          </p>
        </div>
      )}

      <button
        className="build-btn"
        onClick={onMerge}
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
  );
}

