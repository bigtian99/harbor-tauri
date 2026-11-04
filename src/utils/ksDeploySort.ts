import type { DeployInfo } from "../components/ksPublish/types";

/** 部署列表排序用的更新时间戳（毫秒）；无法解析返回 NaN */
function updatedMs(d: DeployInfo): number {
  const raw = (d.updatedAt ?? "").trim();
  if (!raw) return NaN;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * 部署列表按更新时间倒序（最新发布在最前）。
 * 无时间/时间非法的项排在最后，同时间按部署名升序，保证列表稳定不跳动。
 */
export function sortDeploysByUpdatedDesc(list: DeployInfo[]): DeployInfo[] {
  return [...list].sort((a, b) => {
    const ta = updatedMs(a);
    const tb = updatedMs(b);
    const aMissing = Number.isNaN(ta);
    const bMissing = Number.isNaN(tb);
    if (aMissing && bMissing) return a.name.localeCompare(b.name);
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name);
  });
}
