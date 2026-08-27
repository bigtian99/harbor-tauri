/** Pod 日志级别识别与统计（Spring / log4j / 常见英文级别） */

export type PodLogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export const POD_LOG_LEVELS: PodLogLevel[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];

export const POD_LOG_LEVEL_LABEL: Record<PodLogLevel, string> = {
  fatal: "FATAL",
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
  trace: "TRACE",
};

/** 按行识别级别；无法识别返回 null */
export function detectPodLogLevel(line: string): PodLogLevel | null {
  if (!line) return null;
  // 优先匹配带边界的级别词，避免误伤
  const m = line.match(
    /(?:^|[^\w])(?:\[)?(FATAL|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|SEVERE|FINE(?:R|ST)?)(?:\])?(?:[^\w]|$)/i,
  );
  if (!m) return null;
  const raw = m[1].toUpperCase();
  if (raw === "FATAL" || raw === "SEVERE") return "fatal";
  if (raw === "ERROR") return "error";
  if (raw === "WARN" || raw === "WARNING") return "warn";
  if (raw === "INFO") return "info";
  if (raw === "DEBUG" || raw === "FINE" || raw === "FINER" || raw === "FINEST") return "debug";
  if (raw === "TRACE") return "trace";
  return null;
}

export interface PodLogLineView {
  index: number;
  text: string;
  level: PodLogLevel | null;
}

export function buildPodLogLines(raw: string, query: string): {
  lines: PodLogLineView[];
  counts: Record<PodLogLevel, number>;
  matched: number;
  total: number;
} {
  const all = raw ? raw.split("\n") : [];
  const counts: Record<PodLogLevel, number> = {
    fatal: 0,
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
    trace: 0,
  };
  const q = query.trim().toLowerCase();
  const lines: PodLogLineView[] = [];
  all.forEach((text, index) => {
    if (q && !text.toLowerCase().includes(q)) return;
    const level = detectPodLogLevel(text);
    if (level) counts[level] += 1;
    lines.push({ index, text, level });
  });
  return {
    lines,
    counts,
    matched: q ? lines.length : 0,
    total: all.length,
  };
}

/** 在 lines 中找下一条指定级别（含当前之后循环） */
export function findNextLevelIndex(
  lines: PodLogLineView[],
  level: PodLogLevel,
  fromExclusive: number,
): number {
  if (lines.length === 0) return -1;
  const start = fromExclusive < 0 ? -1 : fromExclusive;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].level === level) return i;
  }
  for (let i = 0; i <= start; i++) {
    if (lines[i].level === level) return i;
  }
  return -1;
}

export function findPrevLevelIndex(
  lines: PodLogLineView[],
  level: PodLogLevel,
  fromExclusive: number,
): number {
  if (lines.length === 0) return -1;
  const start = fromExclusive < 0 ? lines.length : fromExclusive;
  for (let i = start - 1; i >= 0; i--) {
    if (lines[i].level === level) return i;
  }
  for (let i = lines.length - 1; i >= start; i--) {
    if (lines[i].level === level) return i;
  }
  return -1;
}
