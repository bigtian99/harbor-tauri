/** 把路径加入历史记录最前（去重，上限 20）；路径为空时仅去重返回 */
export function prependPathHistory(history: string[] | undefined, path: string): string[] {
  const trimmed = path.trim();
  const rest = (history || []).filter((p) => p !== trimmed);
  return trimmed ? [trimmed, ...rest].slice(0, 20) : rest;
}

/** 历史无需落盘时返回 null（空路径或已是第一条且顺序未变） */
export function nextRepoPathHistory(history: string[] | undefined, path: string): string[] | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const next = prependPathHistory(history, trimmed);
  const prev = history || [];
  if (prev.length === next.length && prev.every((p, i) => p === next[i])) return null;
  return next;
}

export function shouldApplyLoadSeq(seq: number, latest: number): boolean {
  return seq === latest;
}
