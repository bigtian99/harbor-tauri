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
