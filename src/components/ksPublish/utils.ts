import type { DeployInfo, DeployRevision } from "./types";
import { RFC1123_NAME } from "./types";

export function isRfc1123Name(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 253 && RFC1123_NAME.test(n);
}

/** 仅当已有 SW_AGENT_NAME 行时，将其值同步为 ConfigMap 名称；没有则不新增 */
export function syncSwAgentNameIfPresent(data: string, cmName: string): string {
  const name = cmName.trim();
  if (!name) return data;
  const lines = data.split("\n");
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "SW_AGENT_NAME") return line;
    found = true;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    return `${indent}SW_AGENT_NAME=${name}`;
  });
  return found ? next.join("\n") : data;
}

export function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(/\//g, "-");
}

/** 轻量指纹：静默刷新无变化时跳过 setState，避免整表重渲染卡顿 */
export function deployListFingerprint(list: DeployInfo[]): string {
  let s = String(list.length);
  for (const d of list) {
    const headNew = d.pods.new[0];
    const headOld = d.pods.old[0];
    s += `|${d.name}:${d.alias ?? ""}:${d.revision}:${d.image}:${d.status.state}:${d.status.detail}:${d.ports.join(",")}:${d.pods.new.length}:${d.pods.old.length}:${headNew?.reason ?? headNew?.state ?? ""}:${headOld?.reason ?? headOld?.state ?? ""}`;
  }
  return s;
}

/** 毫秒 → 中文可读时长（如 2 天 3 小时） */
export function fmtDurationMs(ms: number): string {
  if (ms <= 0) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hour = Math.floor(min / 60);
  const rmin = min % 60;
  if (hour < 24) return rmin > 0 ? `${hour} 小时 ${rmin} 分` : `${hour} 小时`;
  const day = Math.floor(hour / 24);
  const rhour = hour % 24;
  if (day < 30) return rhour > 0 ? `${day} 天 ${rhour} 小时` : `${day} 天`;
  const month = Math.floor(day / 30);
  const rday = day % 30;
  return rday > 0 ? `${month} 个月 ${rday} 天` : `${month} 个月`;
}

/** 按 revision 时间线推算各版本运行时长：当前版至今，历史版至下一 revision 创建 */
export function buildRevisionDurationMap(
  revisions: DeployRevision[],
  nowMs: number,
): Map<string, { label: string; ongoing: boolean }> {
  const map = new Map<string, { label: string; ongoing: boolean }>();
  if (revisions.length === 0) return map;
  const sorted = [...revisions].sort((a, b) => {
    const ra = Number.parseInt(a.revision, 10) || 0;
    const rb = Number.parseInt(b.revision, 10) || 0;
    return ra - rb;
  });
  for (let i = 0; i < sorted.length; i++) {
    const rev = sorted[i];
    const start = new Date(rev.createdAt).getTime();
    if (Number.isNaN(start)) continue;
    const ongoing = rev.isCurrent;
    const nextStart = sorted[i + 1] ? new Date(sorted[i + 1].createdAt).getTime() : NaN;
    const end = ongoing ? nowMs : nextStart;
    if (Number.isNaN(end) || end <= start) continue;
    map.set(rev.revision, { label: fmtDurationMs(end - start), ongoing });
  }
  return map;
}
