import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import { isTauriRuntime } from "../types";

export const BT_PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;
export const BT_AUTO_REFRESH_OPTIONS = ["10", "30", "60"] as const;

/** 行命中用的统一 data 属性（Java / PHP 共用） */
export const BT_PANEL_ROW_ATTR = "data-bt-panel-key";

export type BtListRow = { id: string; name: string };

export interface BtDeployProgressPayload {
  percent?: number;
  message?: string;
  stage?: string;
  project_id?: string;
  project_name?: string;
  site_id?: string;
  site_name?: string;
}

export function btRowKey(row: Pick<BtListRow, "id" | "name">): string {
  return row.id || row.name;
}

export function btDiag(prefix: string, message: string) {
  if (!isTauriRuntime()) return;
  const text = message.trim();
  if (!text) return;
  void invoke("write_diagnostic_log", {
    module: "build",
    message: `${prefix} ${text}`,
  }).catch(() => {
    /* 诊断写入失败不打断主流程 */
  });
}

export function clientPointFromDragPosition(
  position: { x?: number; y?: number } | null | undefined,
  factor: number,
): { clientX: number; clientY: number } {
  const raw = position as { x?: number; y?: number; Physical?: { x: number; y: number } } | null;
  const x = raw?.x ?? raw?.Physical?.x ?? 0;
  const y = raw?.y ?? raw?.Physical?.y ?? 0;
  const scale = factor > 0 ? factor : 1;
  return { clientX: x / scale, clientY: y / scale };
}

export function findBtRowAtPoint<T extends BtListRow>(
  clientX: number,
  clientY: number,
  rows: T[],
  getKey: (row: T) => string = btRowKey,
): T | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[${BT_PANEL_ROW_ATTR}]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      const key = node.dataset.btPanelKey;
      if (!key) continue;
      const hit = rows.find((r) => getKey(r) === key);
      if (hit) return hit;
    }
  }
  return null;
}

/** 进度条：只增不减的目标值 + rAF 缓动展示值 */
export function useBtProgressBar() {
  const [barPercent, setBarPercent] = useState(0);
  const [displayPercent, setDisplayPercent] = useState(0);
  const displayPercentRef = useRef(0);
  const barAnimRafRef = useRef(0);

  const bumpBar = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setBarPercent((prev) => Math.max(prev, clamped));
  }, []);

  /** 强制设定进度（新任务开始时可归零）；归零时展示值立刻对齐，避免倒着滚 */
  const setBar = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setBarPercent(clamped);
    if (clamped === 0) {
      displayPercentRef.current = 0;
      setDisplayPercent(0);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      const target = barPercent;
      const cur = displayPercentRef.current;
      const diff = target - cur;
      if (Math.abs(diff) < 0.2) {
        displayPercentRef.current = target;
        setDisplayPercent(target);
        barAnimRafRef.current = 0;
        return;
      }
      const next = cur + diff * 0.2;
      displayPercentRef.current = next;
      setDisplayPercent(Math.round(next));
      barAnimRafRef.current = requestAnimationFrame(tick);
    };
    if (barAnimRafRef.current) cancelAnimationFrame(barAnimRafRef.current);
    barAnimRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (barAnimRafRef.current) {
        cancelAnimationFrame(barAnimRafRef.current);
        barAnimRafRef.current = 0;
      }
    };
  }, [barPercent]);

  return { barPercent, displayPercent, bumpBar, setBar };
}

export interface UseBtListPanelOptions<T extends BtListRow> {
  fetchRows: () => Promise<T[]>;
  loadErrorTitle: string;
  /** 任务进行中禁止刷新时的提示文案 */
  busyRefreshMessage: string;
  searchFields: (row: T) => string[];
  warmupFtp?: boolean;
}

/** 列表 / 搜索 / 分页 / 自动刷新 / busyKey / 进度条基础状态 */
export function useBtListPanel<T extends BtListRow>(opts: UseBtListPanelOptions<T>) {
  const { fetchRows, loadErrorTitle, busyRefreshMessage, searchFields, warmupFtp = true } = opts;

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshSec, setRefreshSec] = useState("30");
  const [uploadDisplayTick, setUploadDisplayTick] = useState(0);

  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCancelRef = useRef(0);
  const userCancelledRef = useRef(false);
  const rowsRef = useRef(rows);
  const busyRef = useRef(false);

  const progress = useBtProgressBar();

  rowsRef.current = rows;
  busyRef.current = busyKey !== null;

  const load = useCallback(async (loadOpts?: { resetPage?: boolean }) => {
    if (!isTauriRuntime()) {
      notifications.show({ title: "请在桌面端操作", message: "浏览器模式无法直连宝塔面板", color: "yellow" });
      return;
    }
    if (busyRef.current) {
      notifications.show({
        title: "任务进行中",
        message: busyRefreshMessage,
        color: "yellow",
      });
      return;
    }
    setLoading(true);
    try {
      const list = await fetchRows();
      setRows(list);
      if (loadOpts?.resetPage) setPage(1);
    } catch (e) {
      notifications.show({ title: loadErrorTitle, message: String(e), color: "red" });
    } finally {
      setLoading(false);
    }
  }, [fetchRows, loadErrorTitle, busyRefreshMessage]);

  useEffect(() => {
    void load({ resetPage: true });
    if (warmupFtp && isTauriRuntime()) {
      void invoke("warmup_bt_ftp").catch((e) => {
        console.error("warmup_bt_ftp", e);
      });
    }
    // 注意：不要在 cleanup 里 ++pollCancelRef。
    // 否则列表重挂载/依赖变化会把「上传成功后的重启」直接跳过。
    return undefined;
  }, [load, warmupFtp]);

  useEffect(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (autoRefresh && !busyRef.current) {
      autoTimerRef.current = setInterval(() => {
        if (!busyRef.current) {
          void fetchRows().then((list) => setRows(list)).catch(() => {});
        }
      }, Number(refreshSec) * 1000);
    }
    return () => {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    };
  }, [autoRefresh, refreshSec, fetchRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      searchFields(r).some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [rows, search, searchFields]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const showProgress = busyKey !== null || Boolean(progressMessage);

  return {
    rows,
    setRows,
    loading,
    load,
    busyKey,
    setBusyKey,
    dragOverKey,
    setDragOverKey,
    fileDragActive,
    setFileDragActive,
    progressMessage,
    setProgressMessage,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    autoRefresh,
    setAutoRefresh,
    refreshSec,
    setRefreshSec,
    uploadDisplayTick,
    setUploadDisplayTick,
    pollCancelRef,
    userCancelledRef,
    rowsRef,
    busyRef,
    filtered,
    totalPages,
    safePage,
    pageRows,
    showProgress,
    ...progress,
  };
}

export interface UseBtDeployProgressOptions {
  eventName: string;
  bumpBar: (next: number) => void;
  setProgressMessage: (msg: string) => void;
  /** 上传以外的 stage；返回 true 表示已处理 */
  onExtraStage?: (stage: string, payload: BtDeployProgressPayload) => boolean;
}

/** 上传进度事件：MB 文案只增不减 */
export function useBtDeployProgress(opts: UseBtDeployProgressOptions) {
  const { eventName, bumpBar, setProgressMessage, onExtraStage } = opts;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let lastUploadPct = 0;
    void listen<BtDeployProgressPayload>(eventName, (event) => {
      if (disposed) return;
      const p = event.payload;
      const pct = typeof p.percent === "number" ? p.percent : 0;
      const stage = p.stage || "";
      if (stage === "upload") {
        const isByteProgress = Boolean(p.message?.includes(" MB)"));
        if (isByteProgress) {
          if (pct + 1e-6 < lastUploadPct) return;
          lastUploadPct = pct;
          bumpBar(pct);
          if (p.message) setProgressMessage(p.message);
        } else {
          if (p.message?.includes("开始上传")) {
            lastUploadPct = 0;
          }
          if (p.message) setProgressMessage(p.message);
        }
        onExtraStage?.(stage, p);
      } else if (stage === "upload_done") {
        lastUploadPct = 100;
        bumpBar(100);
        setProgressMessage(p.message?.trim() || "上传完成");
        onExtraStage?.(stage, p);
      } else if (onExtraStage?.(stage, p)) {
        /* handled */
      } else if (stage === "error" || stage === "cancelled") {
        if (p.message) setProgressMessage(p.message);
      } else if (p.message) {
        setProgressMessage(p.message);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [eventName, bumpBar, setProgressMessage, onExtraStage]);
}

export interface UseBtWindowDragDropOptions<T extends BtListRow> {
  rowsRef: React.MutableRefObject<T[]>;
  busyRef: React.MutableRefObject<boolean>;
  setFileDragActive: (active: boolean) => void;
  setDragOverKey: (key: string | null) => void;
  getKey?: (row: T) => string;
  /** enter 时是否点亮拖入态；默认 paths.length > 0 */
  isDragEnterActive?: (paths: string[]) => boolean;
  busyDropMessage: string;
  missRowTitle: string;
  missRowMessage: string;
  /** 校验失败时返回提示；成功返回 null */
  validateDropPaths: (paths: string[]) => { title: string; message: string } | null;
  onDrop: (row: T, paths: string[]) => void;
}

/** 窗口级拖放：按坐标命中表格行 */
export function useBtWindowDragDrop<T extends BtListRow>(opts: UseBtWindowDragDropOptions<T>) {
  const {
    rowsRef,
    busyRef,
    setFileDragActive,
    setDragOverKey,
    getKey = btRowKey,
    isDragEnterActive,
    busyDropMessage,
    missRowTitle,
    missRowMessage,
    validateDropPaths,
    onDrop,
  } = opts;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let overRaf = 0;
    let pendingOver: { x?: number; y?: number } | null = null;

    void (async () => {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      if (disposed) return;

      const resolveOver = (position: { x?: number; y?: number } | null | undefined) => {
        if (busyRef.current) {
          setDragOverKey(null);
          return null;
        }
        const { clientX, clientY } = clientPointFromDragPosition(position, factor);
        const hit = findBtRowAtPoint(clientX, clientY, rowsRef.current, getKey);
        setDragOverKey(hit ? getKey(hit) : null);
        return hit;
      };

      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter") {
          const active = isDragEnterActive
            ? isDragEnterActive(payload.paths)
            : payload.paths.length > 0;
          setFileDragActive(active);
          resolveOver(payload.position);
          return;
        }

        if (payload.type === "over") {
          setFileDragActive(true);
          pendingOver = payload.position;
          if (!overRaf) {
            overRaf = requestAnimationFrame(() => {
              overRaf = 0;
              const pos = pendingOver;
              pendingOver = null;
              if (pos) resolveOver(pos);
            });
          }
          return;
        }

        if (payload.type === "leave") {
          if (overRaf) {
            cancelAnimationFrame(overRaf);
            overRaf = 0;
          }
          pendingOver = null;
          setFileDragActive(false);
          setDragOverKey(null);
          return;
        }

        if (payload.type === "drop") {
          if (overRaf) {
            cancelAnimationFrame(overRaf);
            overRaf = 0;
          }
          pendingOver = null;
          const hit = resolveOver(payload.position);
          setFileDragActive(false);
          setDragOverKey(null);
          if (busyRef.current) {
            notifications.show({
              title: "请稍候",
              message: busyDropMessage,
              color: "yellow",
            });
            return;
          }
          const invalid = validateDropPaths(payload.paths);
          if (invalid) {
            notifications.show({
              title: invalid.title,
              message: invalid.message,
              color: "yellow",
            });
            return;
          }
          if (!hit) {
            notifications.show({
              title: missRowTitle,
              message: missRowMessage,
              color: "yellow",
              autoClose: 5000,
            });
            return;
          }
          onDrop(hit, payload.paths);
        }
      });
    })();

    return () => {
      disposed = true;
      if (overRaf) cancelAnimationFrame(overRaf);
      unlisten?.();
    };
  }, [
    rowsRef,
    busyRef,
    setFileDragActive,
    setDragOverKey,
    getKey,
    isDragEnterActive,
    busyDropMessage,
    missRowTitle,
    missRowMessage,
    validateDropPaths,
    onDrop,
  ]);
}
