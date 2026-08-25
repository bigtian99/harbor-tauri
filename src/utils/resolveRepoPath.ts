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

/** 会话内缓存：normalizeGitUrl → 本地路径（避免重复 git） */
const repoPathCache = new Map<string, string>();

export function clearRepoPathCache(): void {
  repoPathCache.clear();
}

async function probeGitUrl(path: string): Promise<string> {
  try {
    const remote = await invoke<string>("get_git_remote_url", {
      repoPath: path,
      remote: null,
    });
    return normalizeGitUrl(remote);
  } catch {
    return "";
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
  const parent = parentDir(config.last_repo_path ?? "")
    || parentDir(history[0] ?? "");

  const urls = (neededGitUrls ?? [])
    .map((u) => normalizeGitUrl(u))
    .filter(Boolean);

  for (const key of urls) {
    const hit = repoPathCache.get(key);
    if (hit) index.set(key, hit);
  }

  for (const key of urls) {
    if (index.has(key)) continue;
    const guessed = guessRepoPathSync(key, config);
    if (guessed) {
      index.set(key, guessed);
      repoPathCache.set(key, guessed);
    }
  }

  const stillMissing = urls.filter((k) => !index.has(k));
  if (stillMissing.length === 0) return index;

  const probePaths: string[] = [];
  const seenProbe = new Set<string>();
  const addProbe = (p: string) => {
    const t = p.trim();
    if (!t || seenProbe.has(t)) return;
    seenProbe.add(t);
    probePaths.push(t);
  };

  for (const key of stillMissing) {
    for (const dir of expectedDirsForGitUrl(key)) {
      for (const path of history) {
        if (basenamePath(path).toLowerCase() === dir.toLowerCase()) addProbe(path);
      }
      if (parent) addProbe(joinPath(parent, dir));
    }
  }
  for (const path of history.slice(0, 8)) addProbe(path);

  const results = await Promise.all(
    probePaths.map(async (path) => {
      const key = await probeGitUrl(path);
      return { path, key };
    }),
  );
  for (const { path, key } of results) {
    if (!key) continue;
    if (!index.has(key)) {
      index.set(key, path);
      repoPathCache.set(key, path);
    }
  }

  return index;
}

export function resolveRepoPathFromIndex(
  gitUrl: string,
  config: HarborConfig,
  index: Map<string, string>,
  deploymentHint?: string,
): string | null {
  const key = normalizeGitUrl(gitUrl);
  if (!key) return null;
  if (index.has(key)) return index.get(key)!;

  const guessed = guessRepoPathSync(gitUrl, config, deploymentHint);
  if (guessed) {
    index.set(key, guessed);
    repoPathCache.set(key, guessed);
    return guessed;
  }
  return null;
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
  const guessed = guessRepoPathSync(gitUrl, config, deploymentHint);
  if (guessed) {
    repoPathCache.set(key, guessed);
    return guessed;
  }
  const index = await buildGitUrlRepoPathIndex(config, [gitUrl]);
  return resolveRepoPathFromIndex(gitUrl, config, index, deploymentHint);
}
