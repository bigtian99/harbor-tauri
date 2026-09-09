import { Stack } from "@mantine/core";
import type { MergePanelProps } from "./merge/types";
import { useMergePanel } from "./merge/useMergePanel";
import { MergeProgressOverlay } from "./merge/MergeProgressOverlay";
import { CommitDiffModal } from "./merge/CommitDiffModal";
import { ConflictDetailModal } from "./merge/ConflictDetailModal";
import { MergeFormSection } from "./merge/MergeFormSection";

export type { MergePanelProps } from "./merge/types";

export function MergePanel({
  config, onOpenDirectory, onPackageAfterMerge, onConfigPatch, getConfigSnapshot, onHarborEnvChange,
}: MergePanelProps) {
  const m = useMergePanel(config, onOpenDirectory, onPackageAfterMerge, onConfigPatch, getConfigSnapshot);
  const bothBranches = Boolean(m.sourceBranch && m.targetBranch);

  return (
    <Stack gap="sm" className="merge-panel">
      <header className="upload-head">
        <div className="upload-head-text">
          <span className="upload-eyebrow">MERGE &amp; SYNC</span>
          <h1 className="upload-title">分支合并</h1>
          <p className="upload-sub">在分支之间合并同步代码变更，打包前保持一致</p>
        </div>
        <ol className="upload-steps" aria-label="合并流程">
          <li className={`upload-step ${bothBranches ? "done" : "active"}`}>
            <span className="upload-step-num">{bothBranches ? "✓" : "1"}</span>
            <span className="upload-step-label">选择分支</span>
          </li>
          <li className="upload-step-line" aria-hidden />
          <li className={`upload-step ${m.canMerge ? "done" : bothBranches ? "active" : ""}`}>
            <span className="upload-step-num">2</span>
            <span className="upload-step-label">检查冲突</span>
          </li>
          <li className="upload-step-line" aria-hidden />
          <li className={`upload-step ${m.mergeOverlayPhase === "success" ? "done" : m.canMerge ? "active" : ""}`}>
            <span className="upload-step-num">3</span>
            <span className="upload-step-label">执行合并</span>
          </li>
        </ol>
      </header>
      <MergeProgressOverlay
        phase={m.mergeOverlayPhase}
        sourceBranch={m.sourceBranch}
        targetBranch={m.targetBranch}
        progress={m.mergeProgress}
        progressMessage={m.mergeProgressMessage}
        resultMessage={m.mergeResultMessage}
        onClose={m.closeMergeOverlay}
      />
      {m.selectedDiffCommit && (
        <CommitDiffModal
          commit={m.selectedDiffCommit}
          commitDiff={m.commitDiff}
          commitDiffError={m.commitDiffError}
          isLoading={m.isLoadingCommitDiff}
          commitDiffFiles={m.commitDiffFiles}
          commitDiffFileTree={m.commitDiffFileTree}
          commitDiffChangeRefs={m.commitDiffChangeRefs}
          activeCommitDiffChange={m.activeCommitDiffChange}
          activeCommitDiffFile={m.activeCommitDiffFile}
          collapsedCommitDiffDirs={m.collapsedCommitDiffDirs}
          commitDiffLineRefs={m.commitDiffLineRefs}
          commitDiffFileRefs={m.commitDiffFileRefs}
          onClose={m.closeCommitDiffModal}
          onJumpChange={m.jumpCommitDiffChange}
          onSelectFile={m.scrollCommitDiffFile}
          onToggleDir={m.toggleCommitDiffTreeDir}
        />
      )}
      {m.conflictDetail && (
        <ConflictDetailModal
          conflictDetail={m.conflictDetail}
          isLoading={m.isLoadingConflictDiff}
          sourceBranch={m.sourceBranch}
          targetBranch={m.targetBranch}
          conflictBlocks={m.conflictBlocks}
          activeConflictBlock={m.activeConflictBlock}
          conflictChangedLines={m.conflictChangedLines}
          targetLineRefs={m.targetLineRefs}
          sourceLineRefs={m.sourceLineRefs}
          onClose={m.closeConflictDiff}
          onJumpBlock={m.jumpConflictBlock}
        />
      )}
      <MergeFormSection
        config={m.config}
        repoPath={m.repoPath}
        sourceBranch={m.sourceBranch}
        targetBranch={m.targetBranch}
        sourceOptions={m.sourceOptions}
        targetOptions={m.targetOptions}
        branchNames={m.branchNames}
        isLoadingBranches={m.isLoadingBranches}
        pushAfterMerge={m.pushAfterMerge}
        packageAfterMerge={m.packageAfterMerge}
        tagAfterMerge={m.tagAfterMerge}
        tagName={m.tagName}
        tagMessage={m.tagMessage}
        defaultTagName={m.defaultTagName}
        defaultTagMessage={m.autoTagMessage}
        latestTag={m.latestTag}
        useQuickMerge={m.useQuickMerge}
        showQuickMergeConfig={m.showQuickMergeConfig}
        isChecking={m.isChecking}
        isMerging={m.isMerging}
        checkResult={m.checkResult}
        canMerge={m.canMerge}
        isSameBranch={m.isSameBranch}
        hasNoDiff={m.hasNoDiff}
        mergeResultClass={m.mergeResultClass}
        isLoadingDiff={m.isLoadingDiff}
        diffLoaded={m.diffLoaded}
        diffError={m.diffError}
        diffCommits={m.diffCommits}
        filteredDiffCommits={m.filteredDiffCommits}
        diffAuthors={m.diffAuthors}
        selectedAuthor={m.selectedAuthor}
        diffCommitSearch={m.diffCommitSearch}
        diffCountLabel={m.diffCountLabel}
        onRepoChange={m.handleRepoChange}
        onInputBlur={m.handleInputBlur}
        onSelectRepo={m.onSelectRepo}
        onRefreshBranches={m.handleRefreshBranches}
        onOpenDirectory={m.onOpenDirectory}
        onSourceBranchChange={m.handleSourceBranchChange}
        onTargetBranchChange={m.handleTargetBranchChange}
        onPushAfterMergeChange={m.setPushAfterMerge}
        onPackageAfterMergeChange={m.setPackageAfterMerge}
        onHarborEnvChange={onHarborEnvChange}
        onTagAfterMergeChange={m.handleTagAfterMergeChange}
        onUseQuickMergeChange={m.setUseQuickMerge}
        onShowQuickMergeConfig={m.setShowQuickMergeConfig}
        onQuickMergeConfigSaved={m.handleQuickMergeConfigSaved}
        getConfigSnapshot={getConfigSnapshot}
        quickMergeSource={m.quickMergeSource}
        quickMergeTarget={m.quickMergeTarget}
        onTagNameChange={m.setTagName}
        onTagMessageChange={m.setTagMessage}
        onCheck={m.handleCheck}
        onMerge={m.handleMerge}
        onLoadConflictDiff={m.loadConflictDiff}
        onSelectAuthor={m.setSelectedAuthor}
        onDiffCommitSearchChange={m.setDiffCommitSearch}
        onOpenCommitDiff={m.openCommitDiffModal}
      />
    </Stack>
  );
}
