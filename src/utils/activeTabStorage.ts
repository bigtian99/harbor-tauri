import type { TabType } from "../types";

const STORAGE_KEY = "jarporter.activeTab";

const VALID_TABS: ReadonlySet<string> = new Set<TabType>([
  "upload",
  "push",
  "branch",
  "config",
  "history",
  "landing",
  "merge",
  "settlement",
  "packSpeed",
  "privacy",
  "btJava",
  "btPhp",
  "ksPublish",
]);

export function readStoredActiveTab(fallback: TabType = "upload"): TabType {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_TABS.has(raw)) {
      return raw as TabType;
    }
  } catch {
    /* private mode / 无 storage */
  }
  return fallback;
}

export function writeStoredActiveTab(tab: TabType): void {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
}
