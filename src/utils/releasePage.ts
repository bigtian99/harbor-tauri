import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriRuntime } from "../types";

export const RELEASE_PAGE_URL = "https://github.com/bigtian99/harbor-tauri/releases";
export const RELEASE_LATEST_URL = `${RELEASE_PAGE_URL}/latest`;

/** Tauri 内不能用普通 <a>，需走系统浏览器 */
export async function openReleasePage(url: string = RELEASE_PAGE_URL): Promise<void> {
  if (isTauriRuntime()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
