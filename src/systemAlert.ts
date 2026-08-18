import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { message } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./types";

function diagLog(msg: string) {
  invoke("write_diagnostic_log", { module: "app", message: msg }).catch(() => {});
}

/**
 * 系统通知栏（macOS Notification Center / Windows 操作中心 Toast）。
 *
 * 打包安装后走 macOS 通知中心 / Windows Toast。
 * dev 模式下 macOS 无法注册通知（系统找不到 App），
 * 自动降级为 Tauri dialog message 弹窗。
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

  const isDev = import.meta.env.DEV;
  diagLog(`showSystemAlert: isDev=${isDev}`);

  // dev 模式下 macOS sendNotification 虽然不报错，但系统会静默丢弃通知，
  // 因为进程不是正式 .app bundle。直接走 dialog 弹窗保证可见。
  if (isDev) {
    diagLog("showSystemAlert: dev mode, using dialog message");
    try {
      await message(safeBody, { title: safeTitle, kind: "info" });
      diagLog("showSystemAlert: dialog message shown");
    } catch (e) {
      diagLog(`showSystemAlert: dialog failed: ${e}`);
    }
    return;
  }

  // 生产模式：走系统通知中心
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

    if (granted) {
      diagLog("showSystemAlert: calling sendNotification...");
      await sendNotification({ title: safeTitle, body: safeBody });
      diagLog("showSystemAlert: sendNotification ok");
    } else {
      diagLog("showSystemAlert: not granted, fallback to dialog");
      await message(safeBody, { title: safeTitle, kind: "info" });
    }
  } catch (e) {
    diagLog(`showSystemAlert: error: ${e}, fallback to dialog`);
    try {
      await message(safeBody, { title: safeTitle, kind: "info" });
    } catch { /* ignore */ }
  }
}
