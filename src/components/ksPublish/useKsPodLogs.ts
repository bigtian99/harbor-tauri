import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { isTauriRuntime } from "../../types";
import {
  buildPodLogLines,
  findNextLevelIndex,
  findPrevLevelIndex,
  POD_LOG_LEVEL_LABEL,
  type PodLogLevel,
} from "../../utils/podLogLevels";

export function useKsPodLogs(opts: {
  namespace: string | null;
  /** sel?.containers[0] ?? "" */
  defaultContainer: string;
}) {
  const { namespace, defaultContainer } = opts;

  const [podLogOpen, setPodLogOpen] = useState(false);
  const [podLogPod, setPodLogPod] = useState("");
  const [podLogContainer, setPodLogContainer] = useState<string | null>(null);
  const [podLogPrevious, setPodLogPrevious] = useState(false);
  const [podLogText, setPodLogText] = useState("");
  const [podLogLoading, setPodLogLoading] = useState(false);
  const [podLogAutoRefresh, setPodLogAutoRefresh] = useState(true);
  const [podLogRefreshSec, setPodLogRefreshSec] = useState("5");
  const [podLogFullscreen, setPodLogFullscreen] = useState(false);
  const [podLogQuery, setPodLogQuery] = useState("");
  const [podLogJumpLevel, setPodLogJumpLevel] = useState<PodLogLevel>("error");
  const [podLogActiveIdx, setPodLogActiveIdx] = useState(-1);
  const podLogViewportRef = useRef<HTMLDivElement>(null);
  const podLogStickBottomRef = useRef(true);
  const podLogInFlightRef = useRef(false);

  const loadPodLogs = useCallback(async (
    podName: string,
    container: string | null,
    previous: boolean,
    opts?: { silent?: boolean },
  ) => {
    if (!namespace || !podName.trim()) return;
    if (!isTauriRuntime()) {
      notifications.show({ color: "yellow", message: "请在 Tauri 桌面窗口中操作" });
      return;
    }
    if (podLogInFlightRef.current) return;
    podLogInFlightRef.current = true;
    if (!opts?.silent) setPodLogLoading(true);
    try {
      const text = await invoke<string>("ks_get_pod_logs", {
        namespace,
        pod: podName.trim(),
        container: container?.trim() || null,
        tailLines: 500,
        previous,
      });
      setPodLogText(text || "（无日志内容）");
      podLogStickBottomRef.current = true;
      setPodLogActiveIdx(-1);
    } catch (e) {
      if (!opts?.silent) {
        setPodLogText("");
        notifications.show({
          color: "red",
          title: "拉取日志失败",
          message: String(e),
          autoClose: 8000,
        });
      }
    } finally {
      podLogInFlightRef.current = false;
      if (!opts?.silent) setPodLogLoading(false);
    }
  }, [namespace]);

  const openPodLogs = (podName: string) => {
    const c = defaultContainer || null;
    setPodLogPod(podName);
    setPodLogContainer(c);
    setPodLogPrevious(false);
    setPodLogText("");
    setPodLogAutoRefresh(true);
    setPodLogFullscreen(false);
    setPodLogQuery("");
    setPodLogJumpLevel("error");
    setPodLogActiveIdx(-1);
    podLogStickBottomRef.current = true;
    setPodLogOpen(true);
    void loadPodLogs(podName, c, false);
  };

  useEffect(() => {
    if (!podLogOpen || !podLogAutoRefresh || !podLogPod) return;
    const sec = Number(podLogRefreshSec) || 5;
    const id = setInterval(() => {
      void loadPodLogs(podLogPod, podLogContainer, podLogPrevious, { silent: true });
    }, Math.max(3, sec) * 1000);
    return () => clearInterval(id);
  }, [
    podLogOpen,
    podLogAutoRefresh,
    podLogRefreshSec,
    podLogPod,
    podLogContainer,
    podLogPrevious,
    loadPodLogs,
  ]);

  const podLogView = useMemo(
    () => buildPodLogLines(podLogText, podLogQuery),
    [podLogText, podLogQuery],
  );

  useEffect(() => {
    if (!podLogOpen) return;
    const id = window.setTimeout(() => {
      const root = podLogViewportRef.current;
      if (!root) return;
      if (podLogActiveIdx >= 0) {
        const el = root.querySelector(`[data-log-idx="${podLogActiveIdx}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (podLogStickBottomRef.current) {
        root.scrollTop = root.scrollHeight;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [podLogOpen, podLogView.lines, podLogActiveIdx]);

  const jumpPodLogLevel = (dir: "next" | "prev") => {
    const idx = dir === "next"
      ? findNextLevelIndex(podLogView.lines, podLogJumpLevel, podLogActiveIdx)
      : findPrevLevelIndex(podLogView.lines, podLogJumpLevel, podLogActiveIdx);
    if (idx < 0) {
      notifications.show({
        color: "yellow",
        message: `当前没有 ${POD_LOG_LEVEL_LABEL[podLogJumpLevel]} 日志`,
        autoClose: 2000,
      });
      return;
    }
    podLogStickBottomRef.current = false;
    setPodLogActiveIdx(idx);
  };

  const podLogJumpPos = useMemo(() => {
    const total = podLogView.counts[podLogJumpLevel];
    if (total <= 0) return { current: 0, total: 0 };
    const hits = podLogView.lines
      .map((line, i) => (line.level === podLogJumpLevel ? i : -1))
      .filter((i) => i >= 0);
    const at = hits.indexOf(podLogActiveIdx);
    return {
      current: at >= 0 ? at + 1 : 0,
      total,
    };
  }, [podLogView.lines, podLogView.counts, podLogJumpLevel, podLogActiveIdx]);

  const downloadPodLogs = async () => {
    const content = podLogText.trim() ? podLogText : "";
    if (!content) {
      notifications.show({ color: "yellow", message: "暂无日志可下载" });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safePod = (podLogPod || "pod").replace(/[^\w.-]+/g, "_");
    const safeCtr = (podLogContainer || "container").replace(/[^\w.-]+/g, "_");
    const filename = `${safePod}-${safeCtr}-${stamp}.log`;
    try {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notifications.show({ color: "blue", message: `已下载 ${filename}`, autoClose: 2500 });
    } catch (e) {
      notifications.show({ color: "red", message: `下载失败：${String(e)}` });
    }
  };

  return {
    openPodLogs,
    loadPodLogs,
    downloadPodLogs,
    jumpPodLogLevel,
    podLogOpen,
    setPodLogOpen,
    podLogPod,
    podLogContainer,
    setPodLogContainer,
    podLogPrevious,
    setPodLogPrevious,
    podLogText,
    podLogLoading,
    podLogAutoRefresh,
    setPodLogAutoRefresh,
    podLogRefreshSec,
    setPodLogRefreshSec,
    podLogFullscreen,
    setPodLogFullscreen,
    podLogQuery,
    setPodLogQuery,
    podLogJumpLevel,
    setPodLogJumpLevel,
    podLogActiveIdx,
    setPodLogActiveIdx,
    podLogViewportRef,
    podLogStickBottomRef,
    podLogView,
    podLogJumpPos,
  };
}

export type KsPodLogsApi = ReturnType<typeof useKsPodLogs>;
