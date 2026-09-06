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

/** 下拉展示名：短名无碰撞用短名，有碰撞用完整 ref */
export function branchDropdownLabel(name: string, all: string[]): string {
  const short = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  const collisions = all.filter((n) => {
    const s = n.includes("/") ? n.slice(n.indexOf("/") + 1) : n;
    return s === short;
  });
  return collisions.length > 1 ? name : short;
}
