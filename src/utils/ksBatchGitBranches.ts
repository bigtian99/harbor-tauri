import { invoke } from "@tauri-apps/api/core";
import type { GitBranchOption } from "../types";
import { isTauriRuntime } from "../types";
import {
  collectKsBatchRepoPaths,
  type KsBatchDeployItem,
} from "./ksBatchPackPublish";
import type { HarborConfig } from "../types";

export interface KsBatchGitBranchLoadResult {
  branches: string[];
  repoPaths: string[];
  missingRepos: string[];
  error?: string;
}

/** 从本地仓库 git fetch 后读取分支列表（多仓库取并集） */
export async function fetchGitBranchesForRepoPaths(
  repoPaths: string[],
): Promise<string[]> {
  if (!isTauriRuntime() || repoPaths.length === 0) return [];
  const names = new Set<string>();
  await Promise.all(
    repoPaths.map(async (repoPath) => {
      const opts = await invoke<GitBranchOption[]>("list_git_branches", { repoPath });
      for (const o of opts) {
        const name = o.name?.trim();
        if (name) names.add(name);
      }
    }),
  );
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** 批量弹框：解析仓库路径并拉取 git 分支 */
export async function loadKsBatchGitBranches(
  config: HarborConfig,
  envId: string,
  namespace: string,
  deployments: KsBatchDeployItem[],
): Promise<KsBatchGitBranchLoadResult> {
  const { repoPaths, missing } = await collectKsBatchRepoPaths(
    config,
    envId,
    namespace,
    deployments,
  );
  if (repoPaths.length === 0) {
    return {
      branches: [],
      repoPaths: [],
      missingRepos: missing,
      error: missing[0] ?? "未找到可打包的本地仓库",
    };
  }
  try {
    const branches = await fetchGitBranchesForRepoPaths(repoPaths);
    return { branches, repoPaths, missingRepos: missing };
  } catch (e) {
    return {
      branches: [],
      repoPaths,
      missingRepos: missing,
      error: String(e),
    };
  }
}

export interface KsBatchBranchOptionGroup {
  group: string;
  items: string[];
}

/**
 * 下拉分组：最近使用 + 仓库分支（git 列表里已有的不再重复进「最近使用」）。
 */
export function buildKsBatchBranchOptionGroups(
  gitBranches: string[],
  recentHistory: string[],
): KsBatchBranchOptionGroup[] {
  const gitSet = new Set(gitBranches);
  const recentOnly = recentHistory
    .map((b) => b.trim())
    .filter((b) => b && !gitSet.has(b));
  const groups: KsBatchBranchOptionGroup[] = [];
  if (recentOnly.length > 0) {
    groups.push({ group: "最近使用", items: recentOnly });
  }
  if (gitBranches.length > 0) {
    groups.push({ group: "仓库分支（git fetch）", items: gitBranches });
  }
  return groups;
}

export function normalizeKsBatchBranchOptionGroups(
  input: unknown,
): KsBatchBranchOptionGroup[] {
  if (!Array.isArray(input)) return [];
  const groups: KsBatchBranchOptionGroup[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const group = (entry as KsBatchBranchOptionGroup).group;
    const items = (entry as KsBatchBranchOptionGroup).items;
    if (typeof group !== "string" || !Array.isArray(items)) continue;
    const cleaned = items
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    if (cleaned.length > 0) groups.push({ group, items: cleaned });
  }
  return groups;
}

/** 展平分组下拉为分支名列表（去重，保持组内顺序） */
export function flattenKsBatchBranchOptions(
  groups: KsBatchBranchOptionGroup[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const item of g.items ?? []) {
      const name = item.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
