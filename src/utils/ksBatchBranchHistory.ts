const STORAGE_KEY = "jarporter.ks-batch-branch-history";
const MAX_HISTORY = 10;

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 批量打包分支历史（最近使用在前） */
export function loadKsBatchBranchHistory(): string[] {
  return readRaw().slice(0, MAX_HISTORY);
}

/** 写入一条分支记录，返回最新列表 */
export function rememberKsBatchBranch(branch: string): string[] {
  const name = branch.trim();
  if (!name) return loadKsBatchBranchHistory();
  const next = [name, ...readRaw().filter((b) => b !== name)].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 配额满等忽略 */
  }
  return next;
}

/** 初始值：批量历史优先，否则用分支打包页上次分支 */
export function defaultKsBatchBranch(lastBranch?: string): string {
  return loadKsBatchBranchHistory()[0] || lastBranch?.trim() || "";
}
