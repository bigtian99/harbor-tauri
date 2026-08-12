/**
 * 将 git 分支引用压成 Docker tag / 镜像名可用的安全片段。
 * 去掉 origin/ 等远程前缀，避免出现 origin-rc-master。
 */
export function sanitizeBranchForImageRef(branch: string): string {
  let name = branch.trim();
  if (!name) return "local";

  name = name
    .replace(/^refs\/remotes\/[^/]+\//, "")
    .replace(/^remotes\/[^/]+\//, "")
    .replace(/^refs\/heads\//, "")
    .replace(/^origin\//, "");

  return name.replace(/[^a-zA-Z0-9._-]/g, "-") || "local";
}
