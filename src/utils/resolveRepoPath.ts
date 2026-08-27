import { invoke } from "@tauri-apps/api/core";
import type { HarborConfig } from "../types";
import { normalizeGitUrl } from "./ksPublishMap";
import {
  collectCandidateRepoPaths,
  expectedDirsForGitUrl,
  guessRepoPathSync,
} from "./resolveRepoPathGuess";

export {
  collectCandidateRepoPaths,
  expectedDirsForGitUrl,
  guessRepoPathSync,
} from "./resolveRepoPathGuess";

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

/** 从历史路径收集父目录候选（含上一级），避免只猜 last_repo 同级目录 */
function collectParentCandidates(config: HarborConfig): string[] {
  const history = collectCandidateRepoPaths(config);
  const parents = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t) parents.add(t);
  };
  for (const path of history) {
    const p1 = parentDir(path);
    add(p1);
    if (p1) add(parentDir(p1));
  }
  const lp = config.last_repo_path?.trim() ?? "";
  if (lp) {
    const p1 = parentDir(lp);
    add(p1);
    if (p1) add(parentDir(p1));
  }
  return [...parents];
}

/** 会话内缓存：normalizeGitUrl → 本地路径（避免重复 git） */
const repoPathCache = new Map<string, string>();

const PROBE_PATH_CAP = 48;

interface GitRepoPathMatch {
  path: string;
  remote_url: string;
}

export function clearRepoPathCache(): void {
  repoPathCache.clear();
}

/** 单次 IPC 批量匹配路径 → remote（Rust 侧顺序 git，无 N 次往返） */
async function matchGitRepoPaths(paths: string[]): Promise<Map<string, string>> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  if (unique.length === 0) return new Map();

  const rows = await invoke<GitRepoPathMatch[]>("match_git_repo_paths", { paths: unique });
  const out = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeGitUrl(row.remote_url);
    if (!key || out.has(key)) continue;
    out.set(key, row.path);
  }
  return out;
}

function mergeMatchesIntoIndex(
  matches: Map<string, string>,
  needed: Set<string>,
  index: Map<string, string>,
): void {
  for (const [key, path] of matches) {
    if (index.has(key)) continue;
    index.set(key, path);
    repoPathCache.set(key, path);
    needed.delete(key);
  }
}

/**
 * 仅对「同步猜不到」的少量路径做 git 探测。
 * needed：本批真正用到的 gitUrl 列表。
 */
export async function buildGitUrlRepoPathIndex(
  config: HarborConfig,
  neededGitUrls?: string[],
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const history = collectCandidateRepoPaths(config);
  const parentCandidates = collectParentCandidates(config);

  const urls = (neededGitUrls ?? [])
    .map((u) => normalizeGitUrl(u))
    .filter(Boolean);

  for (const key of urls) {
    const hit = repoPathCache.get(key);
    if (hit) index.set(key, hit);
  }

  const needed = new Set(urls.filter((k) => !index.has(k)));

  const guessPaths: string[] = [];
  const seenGuess = new Set<string>();
  for (const key of needed) {
    const guessed = guessRepoPathSync(key, config);
    if (!guessed || seenGuess.has(guessed)) continue;
    seenGuess.add(guessed);
    guessPaths.push(guessed);
  }
  if (guessPaths.length > 0) {
    mergeMatchesIntoIndex(await matchGitRepoPaths(guessPaths), needed, index);
  }

  if (needed.size === 0) return index;

  const probePaths: string[] = [];
  const seenProbe = new Set<string>();
  const addProbe = (p: string) => {
    if (probePaths.length >= PROBE_PATH_CAP) return;
    const t = p.trim();
    if (!t || seenProbe.has(t)) return;
    seenProbe.add(t);
    probePaths.push(t);
  };

  for (const key of needed) {
    for (const dir of expectedDirsForGitUrl(key)) {
      for (const path of history) {
        if (basenamePath(path).toLowerCase() === dir.toLowerCase()) addProbe(path);
      }
      for (const parent of parentCandidates) {
        addProbe(joinPath(parent, dir));
      }
    }
  }
  for (const path of history.slice(0, 8)) addProbe(path);

  if (probePaths.length > 0) {
    mergeMatchesIntoIndex(await matchGitRepoPaths(probePaths), needed, index);
  }

  return index;
}

export function resolveRepoPathFromIndex(
  gitUrl: string,
  _config: HarborConfig,
  index: Map<string, string>,
  _deploymentHint?: string,
): string | null {
  const key = normalizeGitUrl(gitUrl);
  if (!key) return null;
  return index.get(key) ?? null;
}

export async function resolveRepoPathForGitUrl(
  gitUrl: string,
  config: HarborConfig,
  deploymentHint?: string,
): Promise<string | null> {
  const key = normalizeGitUrl(gitUrl);
  if (!key) return null;
  const cached = repoPathCache.get(key);
  if (cached) return cached;
  const index = await buildGitUrlRepoPathIndex(config, [gitUrl]);
  return resolveRepoPathFromIndex(gitUrl, config, index, deploymentHint);
}
