import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import { isTauriRuntime } from "../types";

export type BtTempLoginResult = {
  url: string;
  ttlSecs: number;
  message: string;
};

/** 拉取宝塔临时登录链接并在系统浏览器打开 */
export async function openBtTempLogin(): Promise<boolean> {
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
    await openUrl(result.url);
    const mins = Math.max(1, Math.round((result.ttlSecs || 600) / 60));
    notifications.show({
      title: "已打开临时登录",
      message: result.message || `链接约 ${mins} 分钟内有效，用后即失效`,
      color: "teal",
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
