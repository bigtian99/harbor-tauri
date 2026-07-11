/** 把路径加入历史记录最前（去重，上限 20）；路径为空时仅去重返回 */
export function prependPathHistory(history: string[] | undefined, path: string): string[] {
  const trimmed = path.trim();
  const rest = (history || []).filter((p) => p !== trimmed);
  return trimmed ? [trimmed, ...rest].slice(0, 20) : rest;
}
