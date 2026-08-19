import type { TabType } from "../types";

/** 只有真正依赖本地 HTTP 预览的页面才保活预览服务。 */
export function shouldKeepPreviewServer(
  tab: TabType | null | undefined,
): boolean {
  return tab === "landing" || tab === "privacy";
}
