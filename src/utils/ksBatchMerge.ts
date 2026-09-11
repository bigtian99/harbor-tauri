/**
 * KS 批量：可选「先合并再打包」——并行冲突预检 + 串行合并。
 * 预检不自动触发，由 UI 显式调用。
 */
import { invoke } from "@tauri-apps/api/core";
import type { LocalMergeCheck } from "../types";
import { getPathName } from "../types";
import { isTauriRuntime } from "../types";

export type KsBatchMergeRowStatus =
  | "idle"
  | "checking"
  | "ok"
  | "conflict"
  | "error"
  | "merging"
  | "merged";

export interface KsBatchMergeRow {
  repoPath: string;
  name: string;
  status: KsBatchMergeRowStatus;
  message: string;
  conflictFiles: string[];
}

export function ksBatchMergeRepoLabel(repoPath: string): string {
  return getPathName(repoPath.trim()) || repoPath.trim() || "—";
}

export function buildIdleKsBatchMergeRows(repoPaths: string[]): KsBatchMergeRow[] {
  return repoPaths.map((repoPath) => ({
    repoPath,
    name: ksBatchMergeRepoLabel(repoPath),
    status: "idle" as const,
    message: "尚未检查",
    conflictFiles: [],
  }));
}

/** 限并发并行执行（默认 4） */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => runOne()));
  return results;
}

export async function checkOneRepoMerge(
  repoPath: string,
  source: string,
  target: string,
): Promise<KsBatchMergeRow> {
  const name = ksBatchMergeRepoLabel(repoPath);
  if (!isTauriRuntime()) {
    return {
      repoPath,
      name,
      status: "error",
      message: "请在桌面端检查",
      conflictFiles: [],
    };
  }
  if (source.trim() === target.trim()) {
    return {
      repoPath,
      name,
      status: "error",
      message: "源分支与目标分支相同",
      conflictFiles: [],
    };
  }
  try {
    const result = await invoke<LocalMergeCheck>("check_remote_merge", {
      repoPath,
      source: source.trim(),
      target: target.trim(),
    });
    if (result.canMerge) {
      return {
        repoPath,
        name,
        status: "ok",
        message: result.message || "可合并",
        conflictFiles: [],
      };
    }
    const files = result.conflictFiles ?? [];
    // 后端仅在 exit=1（真冲突）时返回 canMerge:false；其它 Git 错误会 throw
    return {
      repoPath,
      name,
      status: "conflict",
      message: result.message
        || (files.length > 0 ? `冲突 ${files.length} 个文件` : "存在冲突"),
      conflictFiles: files,
    };
  } catch (e) {
    return {
      repoPath,
      name,
      status: "error",
      message: String(e),
      conflictFiles: [],
    };
  }
}

/** 并行预检；onUpdate 每次有行状态变化时回调（含 checking） */
export async function checkKsBatchMergesParallel(
  repoPaths: string[],
  source: string,
  target: string,
  opts?: {
    concurrency?: number;
    signal?: { cancelled: boolean };
    onUpdate?: (rows: KsBatchMergeRow[]) => void;
  },
): Promise<KsBatchMergeRow[]> {
  const rows = buildIdleKsBatchMergeRows(repoPaths);
  const emit = () => opts?.onUpdate?.(rows.map((r) => ({ ...r, conflictFiles: [...r.conflictFiles] })));
  emit();

  await mapPool(repoPaths, opts?.concurrency ?? 4, async (repoPath, index) => {
    if (opts?.signal?.cancelled) return;
    rows[index] = {
      ...rows[index],
      status: "checking",
      message: "检查中…",
      conflictFiles: [],
    };
    emit();
    const result = await checkOneRepoMerge(repoPath, source, target);
    if (opts?.signal?.cancelled) return;
    rows[index] = result;
    emit();
  });

  return rows.map((r) => ({ ...r, conflictFiles: [...r.conflictFiles] }));
}

export interface KsBatchMergeRunOpts {
  push?: boolean;
  appendLog?: (line: string) => void;
  onProgress?: (percent: number, message: string) => void;
  /** 某仓合并失败时；返回 true 表示中止整批 */
  onRepoFailed?: (row: KsBatchMergeRow, error: string) => boolean | Promise<boolean>;
}

/** 按仓库串行合并；全部成功返回 ok */
export async function mergeKsBatchReposSequential(
  repoPaths: string[],
  source: string,
  target: string,
  opts: KsBatchMergeRunOpts = {},
): Promise<{ ok: boolean; error?: string }> {
  const push = opts.push ?? true;
  const total = Math.max(1, repoPaths.length);
  const src = source.trim();
  const tgt = target.trim();

  for (let i = 0; i < repoPaths.length; i++) {
    const repoPath = repoPaths[i];
    const name = ksBatchMergeRepoLabel(repoPath);
    const pct = Math.round((i / total) * 40);
    opts.onProgress?.(pct, `合并中 (${i + 1}/${repoPaths.length})：${name}`);
    opts.appendLog?.(`[合并 ${i + 1}/${repoPaths.length}] ${name} ← ${src} → ${tgt}`);
    try {
      const summary = await invoke<string>("merge_remote_branches", {
        repoPath,
        source: src,
        target: tgt,
        push,
        tag: "",
        tagMessage: "",
      });
      opts.appendLog?.(summary.trim() || `${name} 合并成功`);
    } catch (e) {
      const err = String(e);
      opts.appendLog?.(`❌ ${name} 合并失败：${err}`);
      const stop = await opts.onRepoFailed?.(
        {
          repoPath,
          name,
          status: "error",
          message: err,
          conflictFiles: [],
        },
        err,
      );
      if (stop !== false) {
        return { ok: false, error: `${name}：${err}` };
      }
    }
  }

  opts.onProgress?.(42, "合并完成，开始打包发布…");
  return { ok: true };
}
