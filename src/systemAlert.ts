import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./types";

function diagLog(msg: string) {
  invoke("write_diagnostic_log", { module: "app", message: msg }).catch(() => {});
}

/**
 * 系统通知栏（macOS Notification Center / Windows 操作中心 Toast）。
 * 发不出去只记诊断日志，不降级成 dialog 弹窗。
 */
export async function showSystemAlert(
  title: string,
  body: string,
  _kind: "info" | "warning" | "error" = "info",
): Promise<void> {
  const safeTitle = title.trim() || "JarPorter";
  const safeBody = body.trim() || "任务已完成";

  diagLog(`showSystemAlert called: title="${safeTitle}" body="${safeBody}" isTauri=${isTauriRuntime()}`);

  if (!isTauriRuntime()) {
    diagLog("showSystemAlert: not tauri runtime, using browser Notification");
    if ("Notification" in window) {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if (Notification.permission === "granted") {
        new Notification(safeTitle, { body: safeBody });
      }
    }
    return;
  }

  try {
    let granted = false;
    try {
      granted = await isPermissionGranted();
      diagLog(`showSystemAlert: isPermissionGranted=${granted}`);
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === "granted";
        diagLog(`showSystemAlert: requestPermission result="${perm}" granted=${granted}`);
      }
    } catch (e) {
      granted = false;
      diagLog(`showSystemAlert: permission check threw error: ${e}`);
    }

    if (!granted) {
      diagLog("showSystemAlert: not granted, skip");
      return;
    }

    diagLog("showSystemAlert: calling sendNotification...");
    await sendNotification({ title: safeTitle, body: safeBody });
    diagLog("showSystemAlert: sendNotification ok");
  } catch (e) {
    diagLog(`showSystemAlert: error: ${e}`);
  }
}
