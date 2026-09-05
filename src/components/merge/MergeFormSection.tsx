import {
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle, ChevronDown, ChevronUp, ExternalLink, FileText, FolderOpen,
  GitBranch, GitCommit, GitMerge, Info, Loader2, RefreshCw, Search, Settings, Tag
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SearchableDropdown } from "../SearchableDropdown";
import { avatarColor, avatarInitials } from "../../avatarUrl";
import { QuickMergeConfigModal } from "./QuickMergeConfigModal";
import type { AuthorInfo, CommitInfo, HarborConfig, LocalMergeCheck } from "../../types";
import { commitHashButtonStyles } from "../../theme/panelStyles";

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
  packageAfterMerge: boolean;
  tagAfterMerge: boolean;
  tagName: string;
  tagMessage: string;
  defaultTagName: string;
  defaultTagMessage: string;
  latestTag: string;
  useQuickMerge: boolean;
  showQuickMergeConfig: boolean;
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
  onPackageAfterMergeChange: (checked: boolean) => void;
  onTagAfterMergeChange: (checked: boolean) => void;
  onUseQuickMergeChange: (checked: boolean) => void;
  onShowQuickMergeConfig: (show: boolean) => void;
  onQuickMergeConfigSaved: (source: string, target: string) => void;
  quickMergeSource: string;
  quickMergeTarget: string;
  onTagNameChange: (value: string) => void;
  onTagMessageChange: (value: string) => void;
  onCheck: () => void;
  onMerge: () => void;
  onLoadConflictDiff: (filePath: string) => void;
  onSelectAuthor: (author: string) => void;
  onDiffCommitSearchChange: (value: string) => void;
  onOpenCommitDiff: (commit: CommitInfo) => void;
}

const checkboxLabelStyles = { label: { color: "var(--color-text)" } } as const;

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
  packageAfterMerge,
  tagAfterMerge,
  tagName,
  tagMessage,
  defaultTagName,
  defaultTagMessage,
  latestTag,
  useQuickMerge,
  showQuickMergeConfig,
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
  onPackageAfterMergeChange,
  onTagAfterMergeChange,
  onUseQuickMergeChange,
  onShowQuickMergeConfig,
  onQuickMergeConfigSaved,
  quickMergeSource,
  quickMergeTarget,
  onTagNameChange,
  onTagMessageChange,
  onCheck,
  onMerge,
  onLoadConflictDiff,
  onSelectAuthor,
  onDiffCommitSearchChange,
  onOpenCommitDiff,
}: MergeFormSectionProps) {
  const [commitsOpen, setCommitsOpen] = useState(false);
  const commitPreview = 2;
  const hiddenCommitCount = Math.max(0, filteredDiffCommits.length - commitPreview);
  const visibleCommits = commitsOpen
    ? filteredDiffCommits
    : filteredDiffCommits.slice(0, commitPreview);

  useEffect(() => {
    setCommitsOpen(false);
  }, [sourceBranch, targetBranch, selectedAuthor, diffCommitSearch]);

  return (
    <Paper p="md" radius="md" className="branch-card">
      <Stack gap="md">
        <Stack gap={4}>
          <Text size="sm" fw={600} c="var(--color-text)">Git 仓库（本地仓库目录）</Text>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <div className="searchable-dropdown-wrapper" style={{ flex: 1, minWidth: 0 }}>
              <SearchableDropdown
                value={repoPath}
                options={config.repo_path_history || []}
                onChange={onRepoChange}
                onBlur={onInputBlur}
                placeholder="输入本地仓库路径或 Git 地址（https://... / git@...），失焦自动拉取分支"
              />
            </div>
            <Button
              variant="default"
              color="cyan"
              leftSection={<FolderOpen size={16} />}
              onClick={onSelectRepo}
            >
              选择
            </Button>
            <Button
              variant="default"
              color="cyan"
              leftSection={isLoadingBranches ? <Loader2 size={16} className="spin" /> : <GitBranch size={16} />}
              onClick={onRefreshBranches}
              disabled={!repoPath.trim() || isLoadingBranches}
            >
              {isLoadingBranches ? "读取中" : "刷新分支"}
            </Button>
          </Group>
          {repoPath && (
            <Group gap={8}>
              <Text size="xs" c="var(--color-text-muted)">当前仓库：{repoPath}</Text>
              <Button
                variant="subtle"
                color="cyan"
                size="compact-xs"
                onClick={() => onOpenDirectory(repoPath)}
              >
                打开目录
              </Button>
            </Group>
          )}
        </Stack>

        <Group align="flex-end" gap="sm" wrap="wrap" className="merge-branch-row">
          <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
            <Text size="sm" fw={600} c="var(--color-text)">源分支（远程，被合并）</Text>
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
          </Stack>
          <div className="merge-arrow">
            <ArrowRight size={18} />
          </div>
          <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
            <Text size="sm" fw={600} c="var(--color-text)">目标分支（远程，合并到此）</Text>
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
          </Stack>
        </Group>

        <Group gap="md" wrap="wrap" align="center" className="merge-toolbar">
          <Checkbox
            color="cyan"
            label="合并后推送到远程"
            checked={pushAfterMerge}
            onChange={(e) => onPushAfterMergeChange(e.currentTarget.checked)}
            styles={checkboxLabelStyles}
          />
          <Checkbox
            color="cyan"
            label="合并后同步打包"
            title="目标分支名含 rc-master 时以 build:prod / Profile=prod 打包并推 Harbor，否则以 build:test / Profile=test 只打包"
            checked={packageAfterMerge}
            onChange={(e) => onPackageAfterMergeChange(e.currentTarget.checked)}
            styles={checkboxLabelStyles}
          />
          <Checkbox
            color="cyan"
            label={
              <Group gap={4}>
                <Tag size={14} />
                <span>合并后打 tag 并推送</span>
              </Group>
            }
            checked={tagAfterMerge}
            onChange={(e) => onTagAfterMergeChange(e.currentTarget.checked)}
            styles={checkboxLabelStyles}
          />
          <Group gap={4}>
            <Checkbox
              color="cyan"
              label="预设分支"
              checked={useQuickMerge}
              onChange={(e) => onUseQuickMergeChange(e.currentTarget.checked)}
              styles={checkboxLabelStyles}
            />
            {branchNames.length > 0 && (
              <Button
                variant="default"
                color="cyan"
                size="compact-sm"
                px={8}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onShowQuickMergeConfig(true);
                }}
                title="配置预设的源分支和目标分支"
              >
                <Settings size={14} />
              </Button>
            )}
          </Group>
          <Button
            variant="default"
            color="cyan"
            ml="auto"
            leftSection={isChecking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            onClick={onCheck}
            disabled={!sourceBranch || !targetBranch || sourceBranch === targetBranch || isChecking}
          >
            检查冲突
          </Button>
        </Group>

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
              <Text component="span" size="xs" c="var(--color-text-muted)" ml={8}>
                {sourceBranch} → {targetBranch}
              </Text>
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
              <div className="merge-diff-loading">
                <Loader2 size={16} className="spin" /> 加载提交中...
              </div>
            ) : diffError ? (
              <Text size="sm" c="var(--color-error)" py="xs">
                获取差异提交失败：{diffError}
              </Text>
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
                <TextInput
                  placeholder="搜索 hash、提交信息、作者、日期..."
                  value={diffCommitSearch}
                  onChange={(e) => onDiffCommitSearchChange(e.currentTarget.value)}
                  leftSection={<Search size={14} />}
                  rightSection={
                    diffCommitSearch ? (
                      <Button
                        variant="subtle"
                        color="gray"
                        size="compact-xs"
                        onClick={() => onDiffCommitSearchChange("")}
                        title="清除搜索"
                      >
                        ✕
                      </Button>
                    ) : null
                  }
                  className="merge-diff-search"
                />
                {filteredDiffCommits.length === 0 ? (
                  <Text size="sm" c="var(--color-text-muted)" className="merge-diff-no-match">
                    没有匹配「{diffCommitSearch}」的提交
                  </Text>
                ) : (
                  <div className="merge-diff-list">
                    {visibleCommits.map((c) => (
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
                              <Button
                                variant="default"
                                size="compact-xs"
                                className="commit-link"
                                title={`在浏览器中打开: ${c.hash}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openUrl(c.url!);
                                }}
                                rightSection={<ExternalLink size={10} />}
                                styles={commitHashButtonStyles}
                              >
                                {c.short_hash}
                              </Button>
                            ) : (
                              <Badge variant="outline" color="gray" className="commit-hash" title={c.hash}>
                                {c.short_hash}
                              </Badge>
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
                    {hiddenCommitCount > 0 && (
                      <button
                        type="button"
                        className="merge-diff-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCommitsOpen((open) => !open);
                        }}
                        aria-expanded={commitsOpen}
                      >
                        {commitsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        <span>{commitsOpen ? "收起" : `+${hiddenCommitCount}`}</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tagAfterMerge && (
          <Stack gap="xs">
            {latestTag && (
              <Text size="xs" c="var(--color-text-muted)">
                远程最新 tag：<span className="merge-inline-code">{latestTag}</span>，默认 tag 为下一版本{" "}
                <span className="merge-inline-code">{defaultTagName}</span>
              </Text>
            )}
            <TextInput
              label="Tag 名称"
              value={tagName}
              onChange={(e) => onTagNameChange(e.currentTarget.value)}
              styles={{ input: { fontFamily: "monospace" } }}
            />
            <Textarea
              label="Tag 内容（可修改）"
              placeholder={defaultTagMessage || "无差异提交"}
              value={tagMessage}
              onChange={(e) => onTagMessageChange(e.currentTarget.value)}
              minRows={4}
              autosize
              styles={{ input: { fontFamily: "monospace", fontSize: "0.85em" } }}
            />
            <Text size="xs" c="var(--color-text-muted)">
              将在合并 commit 上创建此 tag 并推送 origin
            </Text>
          </Stack>
        )}

        <div className="merge-actions">
          <Button
            variant="filled"
            color="blue"
            size="md"
            fullWidth
            onClick={onMerge}
            disabled={!canMerge || hasNoDiff || isMerging || !sourceBranch || !targetBranch}
            title={
              hasNoDiff || isSameBranch
                ? "两个分支没有差异，无需合并"
                : canMerge
                  ? "合并并推送到目标分支"
                  : "有冲突或未检查，不允许合并"
            }
            leftSection={isMerging ? <Loader2 size={18} className="spin" /> : <GitMerge size={18} />}
            className="merge-submit-btn"
          >
            {isMerging ? "合并中..." : `合并 ${sourceBranch || "源"} → ${targetBranch || "目标"}`}
          </Button>

          {sourceBranch && targetBranch && (
            <div className="merge-execute-plan">
              <p className="merge-execute-plan-title">将执行（隔离 worktree，不切换当前工作区分支）</p>
              <div className="merge-cmd-block">
                <code className="merge-cmd-line">git merge --no-ff {sourceBranch}</code>
                <span className="merge-cmd-hint">基于 {targetBranch}</span>
              </div>
              {pushAfterMerge && (
                <div className="merge-cmd-block">
                  <span className="merge-cmd-label">合并后</span>
                  <code className="merge-cmd-line">
                    git push origin HEAD:refs/heads/{(targetBranch || "").replace(/^origin\//, "")}
                  </code>
                </div>
              )}
              <p className="merge-execute-plan-note">
                源/目标均为远程分支引用；主仓库当前分支与未提交改动不会被切换或覆盖。
              </p>
            </div>
          )}
        </div>

        {showQuickMergeConfig && (
          <QuickMergeConfigModal
            config={config}
            branchNames={branchNames}
            initialSource={quickMergeSource}
            initialTarget={quickMergeTarget}
            onClose={() => onShowQuickMergeConfig(false)}
            onSaved={onQuickMergeConfigSaved}
          />
        )}
      </Stack>
    </Paper>
  );
}
