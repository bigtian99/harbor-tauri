/** 由 Maven Home 推导默认本地仓库：`{home}/repository` */
export function deriveMavenLocalRepo(mavenHome: string): string {
  const home = mavenHome.trim().replace(/[/\\]+$/, "");
  if (!home) return "";
  return `${home}/repository`;
}

/**
 * 判断当前本地仓库是否仍是「由某个 Home 自动带出」的默认值，
 * 以便更换 Home 时继续联动，而不是覆盖用户手改过的仓库路径。
 */
export function isDerivedMavenLocalRepo(
  mavenHome: string,
  localRepo: string,
): boolean {
  const repo = localRepo.trim().replace(/[/\\]+$/, "");
  if (!repo) return true;
  const home = mavenHome.trim().replace(/[/\\]+$/, "");
  if (!home) return false;
  return repo === `${home}/repository`;
}
