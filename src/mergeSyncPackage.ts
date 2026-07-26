/** 合并成功后是否同步推 Harbor：目标分支名字面包含 rc-master */
export function shouldPushHarborAfterMerge(targetBranch: string): boolean {
  return targetBranch.includes("rc-master");
}

/** 合并确认框追加提示 */
export function mergeSyncPackageConfirmHint(targetBranch: string): string {
  return shouldPushHarborAfterMerge(targetBranch)
    ? "合并成功后将打包目标分支并推送 Harbor"
    : "合并成功后将打包目标分支（不推送 Harbor）";
}
