import type { HarborConfig } from "../types";
import { KLCJ_ZT_GIT_DEFAULTS } from "./klcjZtGitDefaults";
import { normalizeGitUrl } from "./ksPublishMap";

function basenamePath(p: string): string {
  const trimmed = p.trim().replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function parentDir(p: string): string {
  const trimmed = p.trim().replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : "";
}

function joinPath(parent: string, child: string): string {
  const p = parent.replace(/[/\\]+$/, "");
  const sep = p.includes("\\") ? "\\" : "/";
  return `${p}${sep}${child}`;
}

/** 去重合并历史仓库路径（最近使用的在前） */
export function collectCandidateRepoPaths(config: HarborConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  add(config.last_repo_path ?? "");
  for (const p of config.repo_path_history ?? []) add(p);
  return out;
}

/** 某 Git URL 对应的本地目录名候选（klcj 默认 + URL 末段） */
export function expectedDirsForGitUrl(gitUrl: string): string[] {
  const key = normalizeGitUrl(gitUrl);
  if (!key) return [];
  const dirs: string[] = [];
  const add = (d: string) => {
    const t = d.trim();
    if (!t) return;
    if (dirs.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    dirs.push(t);
  };
  for (const mod of KLCJ_ZT_GIT_DEFAULTS) {
    if (normalizeGitUrl(mod.git_url) === key) add(mod.dir);
  }
  const seg = key.split("/").pop() ?? "";
  add(seg);
  return dirs;
}

/**
 * 同步猜测本地仓库：历史 basename / 同父目录 / 部署名启发。
 * 不做 git 探测，批量开箱几乎瞬时。
 */
export function guessRepoPathSync(
  gitUrl: string,
  config: HarborConfig,
  deploymentHint?: string,
): string | null {
  const key = normalizeGitUrl(gitUrl);
  if (!key) return null;

  const history = collectCandidateRepoPaths(config);
  const dirs = expectedDirsForGitUrl(gitUrl);
  const parent = parentDir(config.last_repo_path ?? "")
    || parentDir(history[0] ?? "");

  for (const dir of dirs) {
    const want = dir.toLowerCase();
    for (const path of history) {
      if (basenamePath(path).toLowerCase() === want) return path;
    }
  }

  if (parent && dirs.length > 0) {
    return joinPath(parent, dirs[0]);
  }

  if (deploymentHint?.trim()) {
    const dep = deploymentHint.trim().toLowerCase();
    for (const path of history) {
      const base = basenamePath(path).toLowerCase();
      if (base === dep || base.includes(dep) || dep.includes(base)) return path;
    }
    if (parent) {
      const mod = KLCJ_ZT_GIT_DEFAULTS.find((m) =>
        m.keys.some((k) => dep.includes(k) || k.includes(dep)),
      );
      if (mod) return joinPath(parent, mod.dir);
    }
  }

  return null;
}
