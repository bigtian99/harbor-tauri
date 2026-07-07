import type { TabType } from "./types";

export const OPS_TABS: readonly TabType[] = ["landing", "settlement", "packSpeed"];

export function isOpsTab(tab: TabType): boolean {
  return OPS_TABS.includes(tab);
}

export function resolveOpsInitialTab(tab: TabType): TabType {
  return isOpsTab(tab) ? tab : "landing";
}

export function resolveTabForOpsMode(tab: TabType, opsMode: boolean): TabType {
  return opsMode ? resolveOpsInitialTab(tab) : tab;
}
