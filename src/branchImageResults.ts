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

export function shouldShowBranchResults(
  isBuilding: boolean,
  artifactPath: string,
  /** 并行推送中某一侧已成功时立刻展示 */
  hasImageResults = false,
) {
  if (!artifactPath.trim()) return false;
  if (hasImageResults) return true;
  return !isBuilding;
}

export function shouldShowBranchProgress(isBuilding: boolean, _log: string, _progress: number) {
  return isBuilding;
}
