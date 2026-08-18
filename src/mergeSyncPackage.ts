/** 合并成功后是否同步推 Harbor：目标分支名字面包含 rc-master */
export function shouldPushHarborAfterMerge(targetBranch: string): boolean {
  return targetBranch.includes("rc-master");
}

/**
 * 合并后同步打包的 Spring Profile：
 * 合到含 rc-master 的目标分支时强制 prod；否则强制 test。
 */
export function springProfileAfterMerge(targetBranch: string): string {
  return shouldPushHarborAfterMerge(targetBranch) ? "prod" : "test";
}

/**
 * 按 Spring Profile 决定是否默认推 Harbor：
 * - test → 关闭
 * - prod / production → 开启
 * - 其它 → 不强制（返回 null，保留当前勾选）
 */
export function autoPushHarborForSpringProfile(profile: string): boolean | null {
  const p = profile.trim().toLowerCase();
  if (p === "test") return false;
  if (p === "prod" || p === "production") return true;
  return null;
}

/**
 * 合并后同步打包的 npm 构建脚本：
 * 合到含 rc-master 的目标分支时强制 build:prod；否则强制 build:test。
 */
export function buildScriptAfterMerge(targetBranch: string): string {
  return shouldPushHarborAfterMerge(targetBranch) ? "build:prod" : "build:test";
}

/**
 * 按目标分支挑选 npm 构建脚本：rc-master → build:prod，其它 → build:test。
 * 首选脚本不存在时才回退当前值或通用 build。
 */
export function preferNpmBuildScript(
  branch: string,
  scripts: string[],
  current = "",
): string {
  const preferred = buildScriptAfterMerge(branch);
  if (scripts.includes(preferred)) return preferred;
  if (current && scripts.includes(current)) return current;
  const generic = ["build", "compile", "dist"];
  return generic.find((s) => scripts.includes(s)) || scripts[0] || current || preferred;
}

/** 合并确认框追加提示 */
export function mergeSyncPackageConfirmHint(targetBranch: string): string {
  return shouldPushHarborAfterMerge(targetBranch)
    ? "合并成功后将以 prod（build:prod / Spring Profile=prod）打包目标分支并推送 Harbor"
    : "合并成功后将以测试（build:test / Spring Profile=test）打包目标分支（不推送 Harbor）";
}
