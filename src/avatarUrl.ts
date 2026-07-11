/** 本地头像：纯样式首字母，不走 img/CSP。 */

export function avatarColor(name: string): string {
  const label = (name || "?").trim() || "?";
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (Math.imul(31, h) + label.charCodeAt(i)) | 0;
  }
  // 避开过暗底，保证白字可读
  const raw = Math.abs(h) % 0xffffff;
  const r = Math.max(40, (raw >> 16) & 0xff);
  const g = Math.max(40, (raw >> 8) & 0xff);
  const b = Math.max(40, raw & 0xff);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function avatarInitials(name: string): string {
  const label = (name || "?").trim() || "?";
  // 邮箱取 @ 前
  const base = label.includes("@") ? label.split("@")[0]! : label;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  // 中文等：取前 1–2 字
  return base.slice(0, 2).toUpperCase() || "?";
}
