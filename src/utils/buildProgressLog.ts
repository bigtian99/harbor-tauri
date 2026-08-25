/** 与 useBuildProgress 一致：累积 build-progress 日志，FTP 百分比行原地更新 */
export function appendBuildProgressLog(prev: string, message: string): string {
  const msg = message.trim();
  if (!msg) return prev;
  const isFtpPct = /^📤 FTP 上传 .+ \d+% \(/.test(msg);
  if (!prev) return msg;
  if (isFtpPct) {
    const lines = prev.split("\n");
    const last = lines[lines.length - 1] ?? "";
    if (/^📤 FTP 上传 .+ \d+% \(/.test(last) || last.startsWith("📤 FTP 上传 ")) {
      lines[lines.length - 1] = msg;
      return lines.join("\n");
    }
  }
  if (prev.split("\n").pop() === msg) return prev;
  return `${prev}\n${msg}`;
}

export function parseBatchStepLabel(label: string): { index: number; total: number } {
  const m = label.match(/^\[(\d+)\/(\d+)\]/);
  if (!m) return { index: 0, total: 1 };
  return { index: Math.max(0, Number(m[1]) - 1), total: Math.max(1, Number(m[2])) };
}

/** 将单次 build-progress 0–100 映射到批量任务整体进度 */
export function scaleBatchBuildPercent(
  itemIndex: number,
  itemTotal: number,
  buildPercent: number,
): number {
  if (itemTotal <= 0) return buildPercent;
  const base = (itemIndex / itemTotal) * 100;
  return Math.min(99, Math.round(base + buildPercent / itemTotal));
}

/** 仅 trim。分支列表是 `origin/xxx`（远程跟踪引用），必须原样传给 git。 */
export function normalizeBatchBranchInput(branch: string): string {
  return branch.trim();
}
