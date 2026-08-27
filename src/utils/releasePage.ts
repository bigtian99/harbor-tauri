import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriRuntime } from "../types";

export const RELEASE_PAGE_URL = "https://github.com/bigtian99/harbor-tauri/releases";
export const RELEASE_LATEST_URL = `${RELEASE_PAGE_URL}/latest`;

/**
 * 打开发布页 / 下载链接。
 * 优先走后端 `open_external_url`（系统浏览器，不依赖 opener 权限），
 * 失败再回退 plugin-opener；都失败则抛错供 UI 提示。
 */
export async function openReleasePage(url: string = RELEASE_PAGE_URL): Promise<void> {
  const target = (url || RELEASE_PAGE_URL).trim();
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    throw new Error(`非法链接: ${target}`);
  }

  if (!isTauriRuntime()) {
    const opened = window.open(target, "_blank", "noopener,noreferrer");
    if (!opened) {
      throw new Error("浏览器拦截了弹窗，请允许后重试");
    }
    return;
  }

  try {
    await invoke("open_external_url", { url: target });
    return;
  } catch (e1) {
    console.error("[openReleasePage] open_external_url failed", e1);
  }

  try {
    await openUrl(target);
    return;
  } catch (e2) {
    console.error("[openReleasePage] openUrl failed", e2);
    throw new Error(
      `无法打开浏览器，请手动访问：${target}（${String(e2)}）`,
    );
  }
}
