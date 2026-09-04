import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import { isTauriRuntime } from "../types";

export type BtTempLoginResult = {
  url: string;
  ttlSecs: number;
  message: string;
};

const OPEN_PREF_KEY = "jarporter.bt-temp-login-open";

/** 默认勾选：打开浏览器；取消勾选则复制链接 */
export function loadBtTempLoginOpenPref(): boolean {
  try {
    const raw = localStorage.getItem(OPEN_PREF_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function saveBtTempLoginOpenPref(openInBrowser: boolean): void {
  try {
    localStorage.setItem(OPEN_PREF_KEY, openInBrowser ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export type BtTempLoginMode = "open" | "copy";

/** 拉取宝塔临时登录链接：打开浏览器，或复制到剪贴板 */
export async function fetchBtTempLogin(mode: BtTempLoginMode = "open"): Promise<boolean> {
  if (!isTauriRuntime()) {
    notifications.show({
      title: "请在桌面端操作",
      message: "浏览器模式无法直连宝塔面板",
      color: "yellow",
    });
    return false;
  }
  try {
    const result = await invoke<BtTempLoginResult>("get_bt_temp_login_url");
    const mins = Math.max(1, Math.round((result.ttlSecs || 600) / 60));
    const hint = result.message || `链接约 ${mins} 分钟内有效，用后即失效`;

    if (mode === "copy") {
      await navigator.clipboard.writeText(result.url);
      notifications.show({
        title: "已复制临时登录链接",
        message: hint,
        color: "blue",
        autoClose: 4500,
      });
      void invoke("write_diagnostic_log", {
        module: "build",
        message: `bt_temp_login copied ttl=${result.ttlSecs}`,
      }).catch(() => {});
      return true;
    }

    await openUrl(result.url);
    notifications.show({
      title: "已打开临时登录",
      message: hint,
      color: "blue",
      autoClose: 4500,
    });
    void invoke("write_diagnostic_log", {
      module: "build",
      message: `bt_temp_login opened ttl=${result.ttlSecs}`,
    }).catch(() => {});
    return true;
  } catch (e) {
    notifications.show({
      title: "获取临时登录失败",
      message: String(e),
      color: "red",
      autoClose: 8000,
    });
    return false;
  }
}

/** @deprecated 使用 fetchBtTempLogin("open") */
export async function openBtTempLogin(): Promise<boolean> {
  return fetchBtTempLogin("open");
}
