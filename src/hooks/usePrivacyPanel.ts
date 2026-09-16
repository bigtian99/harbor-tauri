import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import { isTauriRuntime } from "../types";
import { useConfirmDialog } from "./useConfirmDialog";
import type {
  PrivacyTarget,
  PrivacyUploadRecord,
  PrivacyUploadResult,
} from "../components/privacy/types";

export type {
  PrivacyTarget,
  PrivacyUploadRecord,
  PrivacyUploadResult,
} from "../components/privacy/types";

export function usePrivacyPanel() {
  const { confirm } = useConfirmDialog();
  const [history, setHistory] = useState<PrivacyUploadRecord[]>([]);
  const [lastResults, setLastResults] = useState<PrivacyUploadResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [parsed, setParsed] = useState<PrivacyTarget | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [ftpPreviewUrl, setFtpPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const isOverwrite = targetUrl.trim().length > 0;

  const loadHistory = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setIsLoadingHistory(true);
    try {
      const rows = await invoke<PrivacyUploadRecord[]>("list_privacy_uploads");
      setHistory(rows);
      setSelectedIds(new Set());
    } catch (e) {
      notifications.show({ title: "加载历史失败", message: String(e), color: "red" });
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const refreshParse = useCallback(async () => {
    const raw = targetUrl.trim();
    if (!raw) {
      setParsed(null);
      setParseError(null);
      return;
    }
    if (!isTauriRuntime()) return;
    try {
      const t = await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw });
      setParsed(t);
      setParseError(null);
    } catch (e) {
      setParsed(null);
      setParseError(String(e));
    }
  }, [targetUrl]);

  const setTargetUrlAndClearPreview = useCallback((value: string) => {
    setTargetUrl(value);
    setFtpPreviewUrl(null);
  }, []);

  const handlePreview = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端操作", color: "yellow" });
      return;
    }
    const raw = targetUrl.trim();
    if (!raw) {
      notifications.show({ message: "请先填写覆盖目标 URL", color: "orange" });
      return;
    }
    setIsPreviewing(true);
    try {
      // 从 FTP 拉取远端 index.html，经本地预览服务展示（不是打开公网链接）
      const result = await invoke<{ preview_url: string; remote_dir: string }>(
        "preview_privacy_ftp",
        { targetUrl: raw },
      );
      setFtpPreviewUrl(result.preview_url);
      if (!parsed) {
        try {
          const t = await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw });
          setParsed(t);
          setParseError(null);
        } catch {
          /* 预览已成功，解析展示失败可忽略 */
        }
      }
      notifications.show({
        message: `已从 FTP 加载预览：${result.remote_dir}`,
        color: "blue",
        autoClose: 2000,
      });
    } catch (e) {
      setFtpPreviewUrl(null);
      notifications.show({ title: "FTP 预览失败", message: String(e), color: "red" });
    } finally {
      setIsPreviewing(false);
    }
  }, [targetUrl, parsed]);

  const handleDownload = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端操作", color: "yellow" });
      return;
    }
    const raw = targetUrl.trim();
    if (!raw) {
      notifications.show({ message: "请先填写覆盖目标 URL", color: "orange" });
      return;
    }

    let remoteLeaf = "index";
    try {
      const t = parsed ?? (await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw }));
      setParsed(t);
      setParseError(null);
      remoteLeaf = t.remote_dir.split("/").filter(Boolean).pop() || "index";
    } catch (e) {
      const msg = String(e);
      setParseError(msg);
      notifications.show({ title: "目标地址无效", message: msg, color: "red" });
      return;
    }

    const dest = await save({
      defaultPath: `${remoteLeaf}.html`,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!dest) return;

    setIsDownloading(true);
    try {
      const result = await invoke<{ local_path: string; remote_dir: string }>(
        "download_privacy_ftp",
        { targetUrl: raw, localPath: dest },
      );
      notifications.show({
        id: "privacy-ftp-download-done",
        title: "下载完成（点击打开所在目录）",
        message: result.local_path,
        color: "blue",
        autoClose: 8000,
        onClick: () => {
          void invoke("open_directory", { path: result.local_path }).catch((e) => {
            notifications.show({
              title: "打开目录失败",
              message: String(e),
              color: "red",
            });
          });
        },
        style: { cursor: "pointer" },
      });
    } catch (e) {
      notifications.show({ title: "FTP 下载失败", message: String(e), color: "red" });
    } finally {
      setIsDownloading(false);
    }
  }, [targetUrl, parsed]);

  const handleUpload = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端操作", color: "yellow" });
      return;
    }
    const raw = targetUrl.trim();
    if (raw) {
      let target = parsed;
      if (!target) {
        try {
          target = await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw });
          setParsed(target);
          setParseError(null);
        } catch (e) {
          const msg = String(e);
          setParseError(msg);
          notifications.show({ title: "目标地址无效", message: msg, color: "red" });
          return;
        }
      }
      const ok = await confirm({
        title: "覆盖远端目录",
        message: "确认覆盖远端目录？此操作会替换该目录下的 index.html。",
        details: [target.remote_dir],
        variant: "danger",
        confirmLabel: "覆盖",
      });
      if (!ok) return;
    }

    const selected = await open({
      multiple: !raw,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    if (raw && paths.length !== 1) {
      notifications.show({ message: "覆盖模式仅支持单个 HTML", color: "orange" });
      return;
    }

    setIsUploading(true);
    try {
      const results = await invoke<PrivacyUploadResult[]>("upload_privacy_html", {
        paths,
        targetUrl: raw ? raw : null,
      });
      setLastResults(results);
      const ok = results.filter((r) => r.status === "success").length;
      const fail = results.length - ok;
      notifications.show({
        message: `上传完成：成功 ${ok}，失败 ${fail}`,
        color: fail > 0 ? "orange" : "teal",
      });
      await loadHistory();
    } catch (e) {
      notifications.show({ title: "上传失败", message: String(e), color: "red" });
    } finally {
      setIsUploading(false);
    }
  }, [loadHistory, targetUrl, parsed, confirm]);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notifications.show({ message: "已复制链接", color: "blue", autoClose: 1500 });
    } catch {
      notifications.show({ message: "复制失败", color: "red" });
    }
  }, []);

  const openPrivacyUrl = useCallback(async (url: string) => {
    await copyUrl(url);
    try {
      await openUrl(url);
    } catch (e) {
      notifications.show({ title: "打开失败", message: String(e), color: "red" });
    }
  }, [copyUrl]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = history.length > 0 && selectedIds.size === history.length;

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (history.length > 0 && prev.size === history.length) return new Set();
      return new Set(history.map((r) => r.id));
    });
  }, [history]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: "删除记录",
      message: `确认删除所选 ${selectedIds.size} 条本地记录？不会删除服务器文件。`,
      variant: "danger",
      confirmLabel: "删除",
    });
    if (!ok) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("delete_privacy_uploads", { ids: Array.from(selectedIds) });
      notifications.show({ message: "已删除所选记录", color: "blue" });
      await loadHistory();
    } catch (e) {
      notifications.show({ title: "删除失败", message: String(e), color: "red" });
    }
  }, [selectedIds, confirm, loadHistory]);

  const handleClear = useCallback(async () => {
    if (history.length === 0) return;
    const ok = await confirm({
      title: "清空记录",
      message: "确认清空全部本地上传记录？不会删除服务器文件。",
      variant: "danger",
      confirmLabel: "清空",
    });
    if (!ok) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("clear_privacy_uploads");
      notifications.show({ message: "已清空本地记录", color: "blue" });
      await loadHistory();
    } catch (e) {
      notifications.show({ title: "清空失败", message: String(e), color: "red" });
    }
  }, [history.length, confirm, loadHistory]);

  return {
    history,
    lastResults,
    selectedIds,
    isUploading,
    isLoadingHistory,
    targetUrl,
    setTargetUrl: setTargetUrlAndClearPreview,
    parsed,
    parseError,
    ftpPreviewUrl,
    isPreviewing,
    isDownloading,
    isOverwrite,
    allSelected,
    refreshParse,
    handlePreview,
    handleDownload,
    handleUpload,
    copyUrl,
    openPrivacyUrl,
    toggleOne,
    toggleAll,
    handleDeleteSelected,
    handleClear,
  };
}
