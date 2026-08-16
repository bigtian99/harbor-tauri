import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauriRuntime } from "./types";

/**
 * 系统通知栏（macOS Notification Center / Windows 操作中心 Toast）。
 * 非应用内 Mantine toast，也非点 OK 的模态弹框。
 * Windows：正式安装包显示应用名；dev 下可能显示为 PowerShell（Tauri 限制）。
 */
async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    return granted;
  } catch (e) {
    console.error("notification permission check failed:", e);
    // Windows 部分环境 isPermissionGranted 会抛错，仍尝试发送
    return true;
  }
}

export async function showSystemAlert(
  title: string,
  body: string,
  _kind: "info" | "warning" | "error" = "info",
): Promise<void> {
  const safeTitle = title.trim() || "JarPorter";
  const safeBody = body.trim() || "任务已完成";

  if (!isTauriRuntime()) {
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
    if (!(await ensureNotificationPermission())) {
      console.error("showSystemAlert: notification permission denied");
      return;
    }
    // macOS 右上角横幅 + Windows Toast，同一 API
    sendNotification({ title: safeTitle, body: safeBody });
  } catch (e) {
    console.error("showSystemAlert failed:", e);
  }
}
