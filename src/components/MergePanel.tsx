import "./Modal.css";
import type { MergePanelProps } from "./merge/types";
import { useMergePanel } from "./merge/useMergePanel";
import { MergeProgressOverlay } from "./merge/MergeProgressOverlay";
import { CommitDiffModal } from "./merge/CommitDiffModal";
import { ConflictDetailModal } from "./merge/ConflictDetailModal";
import { MergeFormSection } from "./merge/MergeFormSection";

export type { MergePanelProps } from "./merge/types";

export function MergePanel({ config, onOpenDirectory }: MergePanelProps) {
  const m = useMergePanel(config, onOpenDirectory);

  return (
    <div className="merge-panel">
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
        tagAfterMerge={m.tagAfterMerge}
        tagName={m.tagName}
        tagMessage={m.tagMessage}
        defaultTagName={m.defaultTagName}
        defaultTagMessage={m.autoTagMessage}
        useQuickMerge={m.useQuickMerge}
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
        onTagAfterMergeChange={m.handleTagAfterMergeChange}
        onUseQuickMergeChange={m.setUseQuickMerge}
        onTagNameChange={m.setTagName}
        onTagMessageChange={m.setTagMessage}
        onCheck={m.handleCheck}
        onMerge={m.handleMerge}
        onLoadConflictDiff={m.loadConflictDiff}
        onSelectAuthor={m.setSelectedAuthor}
        onDiffCommitSearchChange={m.setDiffCommitSearch}
        onOpenCommitDiff={m.openCommitDiffModal}
      />
    </div>
  );
}
