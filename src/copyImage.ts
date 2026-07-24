/** 多行展示文本 → 剪贴板与高亮比对用的 copy 值 */
export function normalizeCopyText(display: string): string {
  return display.includes("\n") ? display.replace(/\n/g, "  ") : display;
}

/** 判断当前行是否应显示「已复制」高亮 */
export function isCopyHighlighted(copied: string | null, display: string): boolean {
  if (copied == null) return false;
  return copied === normalizeCopyText(display);
}
