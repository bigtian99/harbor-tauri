export type BranchImageRole = "frontend" | "backend";

export interface BranchImageResult {
  role: BranchImageRole;
  label: string;
  copyLabel: string;
  image: string;
}

export function getBranchImageLabel(role: BranchImageRole) {
  return role === "frontend" ? "前端镜像" : "后端镜像";
}

export function getBranchImageCopyLabel(role: BranchImageRole) {
  return role === "frontend" ? "复制前端" : "复制后端";
}

export function createBranchImageResult(role: BranchImageRole, image: string): BranchImageResult {
  return {
    role,
    label: getBranchImageLabel(role),
    copyLabel: getBranchImageCopyLabel(role),
    image,
  };
}

export function getBranchPushSummary(pushLogs: string[], hasBackend: boolean) {
  const frontendFailed = pushLogs.some((log) => log.startsWith("❌ 前端"));
  const backendFailed = pushLogs.some((log) => log.startsWith("❌ 后端"));

  if (frontendFailed && hasBackend && backendFailed) {
    return "❌ 前端和后端镜像推送失败";
  }
  if (frontendFailed && hasBackend) {
    return "⚠️ 前端推送失败，但后端推送成功";
  }
  if (frontendFailed) {
    return "❌ 前端镜像推送失败";
  }
  if (hasBackend && backendFailed) {
    return "⚠️ 前端推送成功，但后端推送失败";
  }
  return "✅ 分支打包并推送镜像完成";
}
