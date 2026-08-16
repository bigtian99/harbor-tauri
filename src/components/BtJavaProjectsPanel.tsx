import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import {
  Badge,
  Button,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Coffee, Loader2, RefreshCw, RotateCcw, Search, Upload, XCircle } from "lucide-react";
import { isTauriRuntime } from "../types";
import { showSystemAlert } from "../systemAlert";

export interface BtJavaProjectInfo {
  id: string;
  name: string;
  status: string;
  status_text: string;
  port: string;
  project_jar: string;
  path: string;
  updated_at: string;
}

interface BtJavaDeployProgress {
  project_id?: string;
  project_name?: string;
  percent?: number;
  message?: string;
  stage?: string;
}

const PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;
/** 重启后轮询间隔 */
const RESTART_POLL_INTERVAL_MS = 3000;
/** 最多轮询次数 */
const RESTART_POLL_MAX_ATTEMPTS = 20;

type BusyMode = "restart" | "upload";
/** 列表行上展示的固定阶段文案（不含百分比，避免进度条刷新带动整表闪动） */
type BusyPhase = "upload" | "restart" | "wait_port";

function projectKey(row: Pick<BtJavaProjectInfo, "id" | "name">): string {
  return row.id || row.name;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findProject(
  list: BtJavaProjectInfo[],
  target: Pick<BtJavaProjectInfo, "id" | "name">,
): BtJavaProjectInfo | undefined {
  return list.find(
    (p) =>
      (target.id && p.id === target.id) ||
      (target.name && p.name === target.name),
  );
}

function findRowAtPoint(
  clientX: number,
  clientY: number,
  rows: BtJavaProjectInfo[],
): BtJavaProjectInfo | null {
  const nodes = document.querySelectorAll<HTMLElement>("[data-bt-java-key]");
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      const key = node.dataset.btJavaKey;
      if (!key) continue;
      const hit = rows.find((r) => projectKey(r) === key);
      if (hit) return hit;
    }
  }
  return null;
}

function clientPointFromDragPosition(
  position: { x?: number; y?: number } | null | undefined,
  factor: number,
): { clientX: number; clientY: number } {
  const raw = position as { x?: number; y?: number; Physical?: { x: number; y: number } } | null;
  const x = raw?.x ?? raw?.Physical?.x ?? 0;
  const y = raw?.y ?? raw?.Physical?.y ?? 0;
  const scale = factor > 0 ? factor : 1;
  return { clientX: x / scale, clientY: y / scale };
}

function pathsLookLikeJar(paths: string[] | undefined): boolean {
  return Boolean(paths?.some((p) => p.toLowerCase().endsWith(".jar")));
}

/** 写入侧栏「系统日志」（[build]），便于事后排查上传/重启 */
function diagBuild(message: string) {
  if (!isTauriRuntime()) return;
  const text = message.trim();
  if (!text) return;
  void invoke("write_diagnostic_log", {
    module: "build",
    message: `bt_java ${text}`,
  }).catch(() => {
    /* 诊断写入失败不打断主流程 */
  });
}

function busyPhaseLabel(phase: BusyPhase): string {
  if (phase === "upload") return "上传中";
  if (phase === "wait_port") return "等待端口";
  return "重启中";
}

interface BtJavaTableProps {
  pageRows: BtJavaProjectInfo[];
  loading: boolean;
  rowsEmpty: boolean;
  busyKey: string | null;
  busyPhase: BusyPhase | null;
  fileDragActive: boolean;
  dragOverKey: string | null;
  onRestart: (row: BtJavaProjectInfo) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

/** 与进度条状态解耦：进度百分比变化时不重绘整表 */
const BtJavaProjectsTable = memo(function BtJavaProjectsTable({
  pageRows,
  loading,
  rowsEmpty,
  busyKey,
  busyPhase,
  fileDragActive,
  dragOverKey,
  onRestart,
  onCancel,
}: BtJavaTableProps) {
  return (
    <Paper withBorder radius="md" className="bt-java-table-wrap">
      <Table striped highlightOnHover stickyHeader className="bt-java-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th className="bt-java-cell-name">名称</Table.Th>
            <Table.Th className="bt-java-cell-status">状态</Table.Th>
            <Table.Th className="bt-java-cell-port">端口</Table.Th>
            <Table.Th className="bt-java-cell-path">JAR</Table.Th>
            <Table.Th className="bt-java-cell-path">路径</Table.Th>
            <Table.Th className="bt-java-cell-time">更新时间</Table.Th>
            <Table.Th className="bt-java-cell-actions">操作</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading && rowsEmpty ? (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text c="dimmed" ta="center" py="lg">加载中…</Text>
              </Table.Td>
            </Table.Tr>
          ) : pageRows.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text c="dimmed" ta="center" py="lg">
                  {rowsEmpty ? "暂无数据，请先在设置中配置宝塔面板密钥" : "无匹配项"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            pageRows.map((row) => {
              const key = projectKey(row);
              const waiting = busyKey === key;
              const isDropTarget = dragOverKey === key;
              const rowClass = [
                "bt-java-row",
                fileDragActive ? "bt-java-row--drag-active" : "",
                isDropTarget ? "bt-java-row--drop-target" : "",
              ].filter(Boolean).join(" ");
              return (
                <Table.Tr
                  key={`${row.id}-${row.name}`}
                  data-bt-java-key={key}
                  className={rowClass}
                >
                  <Table.Td className="bt-java-cell-name">
                    <Text fw={500} lineClamp={1}>{row.name}</Text>
                    <Text size="xs" c="dimmed">ID {row.id || "-"}</Text>
                    {!waiting && fileDragActive && (
                      <span className="bt-java-row-hint">
                        <Upload size={11} />
                        {isDropTarget ? "松开上传" : "拖到此处"}
                      </span>
                    )}
                  </Table.Td>
                  <Table.Td className="bt-java-cell-status">
                    {waiting && busyPhase ? (
                      <Badge color="yellow" variant="outline" leftSection={<Loader2 size={10} className="spin" />}>
                        {busyPhaseLabel(busyPhase)}
                      </Badge>
                    ) : (
                      <Badge color={row.status === "1" ? "teal" : "gray"} variant="outline">
                        {row.status_text}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td className="bt-java-cell-port">{row.port || "-"}</Table.Td>
                  <Table.Td className="bt-java-cell-path">
                    <Text size="sm" lineClamp={2} title={row.project_jar || undefined}>
                      {row.project_jar || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-java-cell-path">
                    <Text size="sm" lineClamp={2} title={row.path || undefined}>
                      {row.path || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-java-cell-time">
                    <Text size="sm" c="dimmed">
                      {row.updated_at || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-java-cell-actions">
                    {waiting ? (
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        leftSection={<XCircle size={14} />}
                        onClick={() => { void onCancel(); }}
                      >
                        取消
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<RotateCcw size={14} />}
                        disabled={busyKey !== null}
                        onClick={() => { void onRestart(row); }}
                      >
                        重启
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })
          )}
        </Table.Tbody>
      </Table>
    </Paper>
  );
});

export function BtJavaProjectsPanel() {
  const [rows, setRows] = useState<BtJavaProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyMode, setBusyMode] = useState<BusyMode>("restart");
  const [pollAttempt, setPollAttempt] = useState(0);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  /** 进度条目标值（只增不减，新任务可归零） */
  const [barPercent, setBarPercent] = useState(0);
  /** 展示用百分比：向 barPercent 缓动，跟条子动画同步 */
  const [displayPercent, setDisplayPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pollCancelRef = useRef(0);
  /** 仅用户点「取消」时为 true；上传成功后仍应重启，不被面板刷新/重挂载打断 */
  const userCancelledRef = useRef(false);
  const rowsRef = useRef(rows);
  const busyRef = useRef(false);
  const displayPercentRef = useRef(0);
  const barAnimRafRef = useRef(0);

  rowsRef.current = rows;
  busyRef.current = busyKey !== null;

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

  // 右侧数字缓动追 barPercent，和 CSS width 过渡一起看会更顺
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

  const fetchRows = useCallback(async (): Promise<BtJavaProjectInfo[]> => {
    return invoke<BtJavaProjectInfo[]>("list_bt_java_projects");
  }, []);

  const load = useCallback(async (opts?: { resetPage?: boolean }) => {
    if (!isTauriRuntime()) {
      notifications.show({ title: "请在桌面端操作", message: "浏览器模式无法直连宝塔面板", color: "yellow" });
      return;
    }
    // 上传中绝不拉列表；等端口轮询走 waitForPort，不走这里
    if (busyRef.current) {
      notifications.show({
        title: "任务进行中",
        message: "上传/重启完成前请勿刷新列表",
        color: "yellow",
      });
      return;
    }
    setLoading(true);
    try {
      const list = await fetchRows();
      setRows(list);
      if (opts?.resetPage) setPage(1);
    } catch (e) {
      notifications.show({ title: "拉取 Java 项目失败", message: String(e), color: "red" });
    } finally {
      setLoading(false);
    }
  }, [fetchRows]);

  useEffect(() => {
    void load({ resetPage: true });
    // 进页即预连 FTP，拖入时跳过握手等待
    if (isTauriRuntime()) {
      void invoke("warmup_bt_ftp").catch((e) => {
        console.error("warmup_bt_ftp", e);
      });
    }
    // 注意：不要在 cleanup 里 ++pollCancelRef。
    // 否则列表重挂载/依赖变化会把「上传成功后的重启」直接跳过。
    return undefined;
  }, [load]);

  // 上传/重启进度：上传 MB 文案只增不减，避免重试把已传大小打回去
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let lastUploadPct = 0;
    void listen<BtJavaDeployProgress>("bt-java-deploy-progress", (event) => {
      if (disposed) return;
      const p = event.payload;
      const pct = typeof p.percent === "number" ? p.percent : 0;
      const stage = p.stage || "";
      if (stage === "upload") {
        // 状态文案（连接中/进目录）允许更新；带 MB 的进度只接受不回退的 percent
        const isByteProgress = Boolean(p.message?.includes(" MB)"));
        if (isByteProgress) {
          if (pct + 1e-6 < lastUploadPct) return;
          lastUploadPct = pct;
          bumpBar(pct);
          if (p.message) setProgressMessage(p.message);
        } else {
          // 仅「开始上传」表示新任务；连接/重试阶段不要清水位，否则已传 MB 会往回跳
          if (p.message?.includes("开始上传")) {
            lastUploadPct = 0;
          }
          if (p.message) setProgressMessage(p.message);
        }
        setBusyMode((m) => (m === "upload" ? m : "upload"));
      } else if (stage === "upload_done") {
        lastUploadPct = 100;
        bumpBar(100);
        setBusyMode((m) => (m === "upload" ? m : "upload"));
        setProgressMessage(p.message?.trim() || "上传完成");
      } else if (stage === "restart") {
        bumpBar(100);
        setBusyMode((m) => (m === "restart" ? m : "restart"));
        if (p.message) setProgressMessage(p.message);
      } else if (stage === "wait_port") {
        bumpBar(100);
        setBusyMode((m) => (m === "restart" ? m : "restart"));
        if (p.message) setProgressMessage(p.message);
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
  }, [bumpBar]);

  const waitForPort = useCallback(async (
    row: BtJavaProjectInfo,
    token: number,
    hadPortBefore: boolean,
  ): Promise<boolean> => {
    let last: BtJavaProjectInfo | undefined;
    let sawMissingPort = !hadPortBefore;

    for (let attempt = 1; attempt <= RESTART_POLL_MAX_ATTEMPTS; attempt++) {
      if (token !== pollCancelRef.current) return false;
      setPollAttempt(attempt);
      const waitMsg = `等待端口出现 ${attempt}/${RESTART_POLL_MAX_ATTEMPTS}…`;
      setProgressMessage(waitMsg);
      diagBuild(`${row.name} ${waitMsg}`);
      // 上传已到 100% 后保持满格；右侧也继续显示同一 barPercent，次数只写在文案里
      bumpBar(100);

      await sleep(attempt === 1 ? 2000 : RESTART_POLL_INTERVAL_MS);
      if (token !== pollCancelRef.current) return false;

      try {
        const list = await fetchRows();
        if (token !== pollCancelRef.current) return false;
        // 只合并当前项目，避免整表状态/端口随轮询一起跳动
        const latest = findProject(list, row);
        if (latest) {
          const key = projectKey(row);
          setRows((prev) => {
            const idx = prev.findIndex((r) => projectKey(r) === key);
            if (idx < 0) return prev;
            const cur = prev[idx];
            if (
              cur.port === latest.port
              && cur.status === latest.status
              && cur.status_text === latest.status_text
              && cur.updated_at === latest.updated_at
            ) {
              return prev;
            }
            const next = prev.slice();
            next[idx] = { ...cur, ...latest };
            return next;
          });
          last = latest;
        }
        const port = last?.port?.trim() ?? "";
        if (!port || port === "0") {
          sawMissingPort = true;
          continue;
        }
        if (sawMissingPort) {
          const okMsg = `${row.name} 端口 ${port} 已出现`;
          setProgressMessage(okMsg);
          diagBuild(okMsg);
          bumpBar(100);
          return true;
        }
      } catch (e) {
        console.error(e);
        diagBuild(`${row.name} 轮询列表失败：${String(e)}`);
      }
    }

    notifications.show({
      title: "启动超时",
      message: last
        ? `${row.name} 状态「${last.status_text}」· 端口 ${last.port?.trim() || "未出现"}，已轮询 ${RESTART_POLL_MAX_ATTEMPTS} 次`
        : `${row.name} 未确认到端口（已轮询 ${RESTART_POLL_MAX_ATTEMPTS} 次）`,
      color: "orange",
      autoClose: 8000,
    });
    const timeoutMsg = last
      ? `启动超时：端口 ${last.port?.trim() || "未出现"}`
      : "启动超时：未确认到端口";
    setProgressMessage(timeoutMsg);
    diagBuild(`${row.name} ${timeoutMsg}`);
    return false;
  }, [fetchRows, bumpBar]);

  const cancelTask = useCallback(async () => {
    userCancelledRef.current = true;
    pollCancelRef.current += 1;
    setProgressMessage("正在取消…");
    diagBuild("正在取消上传/等待");
    try {
      if (isTauriRuntime()) {
        await invoke("cancel_bt_java_deploy");
      }
    } catch (e) {
      console.error(e);
      diagBuild(`取消请求失败：${String(e)}`);
    }
    setBusyKey(null);
    setPollAttempt(0);
    setBusyMode("restart");
    setProgressMessage("已取消");
    diagBuild("已取消");
    notifications.show({
      title: "已取消",
      message: "上传/等待已中断",
      color: "yellow",
    });
  }, []);

  const restart = useCallback(async (row: BtJavaProjectInfo) => {
    if (!isTauriRuntime()) return;
    const key = projectKey(row);
    userCancelledRef.current = false;
    const token = ++pollCancelRef.current;
    setBusyKey(key);
    setBusyMode("restart");
    setPollAttempt(0);
    setBar(0);
    setProgressMessage(`正在重启 ${row.name}…`);
    diagBuild(`开始重启 ${row.name} id=${row.id}`);
    bumpBar(20);
    const hadPortBefore = Boolean(row.port?.trim());

    try {
      const msg = await invoke<string>("restart_bt_java_project", {
        projectName: row.name,
        projectId: row.id,
      });
      if (userCancelledRef.current || token !== pollCancelRef.current) return;

      notifications.show({
        title: "已下发重启",
        message: `${msg}，正在等待端口出现…`,
        color: "teal",
        autoClose: 2500,
      });
      setProgressMessage("已下发重启，等待端口出现…");
      diagBuild(`${msg}，等待端口出现…`);
      bumpBar(100);
      const portOk = await waitForPort(row, token, hadPortBefore);
      if (token === pollCancelRef.current) bumpBar(100);
      if (portOk && !userCancelledRef.current) {
        await showSystemAlert("重启完成", `${row.name} 已重启，端口已出现`);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("已取消") || userCancelledRef.current || token !== pollCancelRef.current) {
        setProgressMessage("已取消");
        diagBuild("重启已取消");
        return;
      }
      notifications.show({ title: "重启失败", message: msg, color: "red" });
      setProgressMessage(`重启失败：${msg}`);
      diagBuild(`重启失败：${msg}`);
    } finally {
      if (token === pollCancelRef.current || userCancelledRef.current) {
        setBusyKey(null);
        setPollAttempt(0);
      }
    }
  }, [waitForPort, bumpBar, setBar]);

  const uploadAndRestart = useCallback(async (row: BtJavaProjectInfo, localJar: string) => {
    if (!isTauriRuntime()) return;
    const key = projectKey(row);
    userCancelledRef.current = false;
    const token = ++pollCancelRef.current;
    setBusyKey(key);
    setBusyMode("upload");
    setPollAttempt(0);
    setBar(0);
    setProgressMessage(`正在连接 FTP · ${row.name}…`);
    diagBuild(`准备上传到 ${row.name} local=${localJar} remote=${row.project_jar || row.path}`);
    const hadPortBefore = Boolean(row.port?.trim());

    try {
      // 1) 仅上传 —— 此阶段禁止拉列表
      const uploaded = await invoke<string>("upload_bt_java_jar", {
        localJar,
        projectName: row.name,
        projectId: row.id,
        remoteJar: row.project_jar,
        projectPath: row.path,
      });

      // 上传已落盘成功：除非用户点了取消，否则必须继续重启（勿被 token/重挂载跳过）
      if (userCancelledRef.current) {
        diagBuild(`上传已完成但用户已取消，跳过重启 name=${row.name}`);
        setProgressMessage("已取消（文件已上传）");
        return;
      }

      bumpBar(100);
      setProgressMessage(`${uploaded}，正在重启…`);
      diagBuild(`${uploaded}；开始重启 ${row.name} id=${row.id}`);
      setBusyMode("restart");

      // 2) 上传完成后再重启
      const restarted = await invoke<string>("restart_bt_java_project", {
        projectName: row.name,
        projectId: row.id,
      });
      diagBuild(`${restarted}`);

      if (userCancelledRef.current) {
        setProgressMessage(`${restarted}（已取消等待端口）`);
        return;
      }

      setProgressMessage("已重启，等待端口出现…");
      bumpBar(100);

      // 3) 仅在此之后轮询列表等端口（可被取消）
      if (token === pollCancelRef.current && !userCancelledRef.current) {
        const portOk = await waitForPort(row, token, hadPortBefore);
        if (token === pollCancelRef.current) bumpBar(100);
        if (portOk && !userCancelledRef.current) {
          await showSystemAlert(
            "上传完成",
            `${row.name} JAR 已上传并重启，端口已出现`,
          );
        }
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("已取消") || userCancelledRef.current) {
        setProgressMessage("已取消");
        diagBuild("上传/重启已取消");
        return;
      }
      notifications.show({ title: "上传/重启失败", message: msg, color: "red" });
      setProgressMessage(`失败：${msg}`);
      diagBuild(`上传/重启失败：${msg}`);
    } finally {
      setBusyKey(null);
      setPollAttempt(0);
    }
  }, [waitForPort, bumpBar, setBar]);

  // 窗口级拖放：按坐标命中表格行，并给每行投放提示
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
        const hit = findRowAtPoint(clientX, clientY, rowsRef.current);
        setDragOverKey(hit ? projectKey(hit) : null);
        return hit;
      };

      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter") {
          setFileDragActive(pathsLookLikeJar(payload.paths) || payload.paths.length > 0);
          resolveOver(payload.position);
          return;
        }

        if (payload.type === "over") {
          setFileDragActive(true);
          // 拖动中 over 极频繁：合并到下一帧，避免主线程卡顿拖慢松手后的上传启动
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
              message: "当前有上传或重启任务进行中",
              color: "yellow",
            });
            return;
          }

          const jar = payload.paths.find((p) => p.toLowerCase().endsWith(".jar"));
          if (!jar) {
            notifications.show({
              title: "请拖入 JAR",
              message: "只支持 .jar 文件",
              color: "yellow",
            });
            return;
          }
          if (!hit) {
            notifications.show({
              title: "请对准项目行",
              message: "把 JAR 拖到具体某一行上（行会高亮并显示「松开上传」）",
              color: "yellow",
              autoClose: 5000,
            });
            return;
          }
          void uploadAndRestart(hit, jar);
        }
      });
    })();

    return () => {
      disposed = true;
      if (overRaf) cancelAnimationFrame(overRaf);
      unlisten?.();
    };
  }, [uploadAndRestart]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.path, r.project_jar, r.port, r.id, r.updated_at].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const isPolling = busyKey !== null && pollAttempt > 0;
  const showProgress = busyKey !== null || Boolean(progressMessage);
  const busyPhase: BusyPhase | null = busyKey == null
    ? null
    : (pollAttempt > 0 ? "wait_port" : busyMode);

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="xs" mb={4}>
            <Coffee size={20} />
            <Title order={3}>Java 项目</Title>
          </Group>
          <Text size="sm" c="dimmed">
            把 JAR 拖到某一行上（行内有「拖入 JAR」提示），松开即上传并重启
            {isPolling
              ? ` · 等待端口出现 ${pollAttempt}/${RESTART_POLL_MAX_ATTEMPTS}`
              : ""}
          </Text>
        </div>
        <Button
          leftSection={loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          onClick={() => void load({ resetPage: true })}
          disabled={loading || busyKey !== null}
          variant="light"
        >
          刷新
        </Button>
      </Group>

      {fileDragActive && (
        <div className="bt-java-drop-banner">
          <Upload size={16} />
          {dragOverKey
            ? `对准了「${rows.find((r) => projectKey(r) === dragOverKey)?.name ?? "项目"}」— 松开鼠标即可上传`
            : "请继续拖到具体项目行上，对准后该行会高亮"}
        </div>
      )}

      {showProgress && (
        <Paper withBorder p="sm" radius="md" style={{ borderColor: "rgba(100, 255, 218, 0.35)" }}>
          <Group justify="space-between" mb={6} wrap="nowrap">
            <Text size="sm" fw={500}>
              {busyKey !== null ? "任务进度" : "最近任务"}
            </Text>
            <Text size="sm" c="teal" style={{ flexShrink: 0 }}>
              {displayPercent}%
            </Text>
          </Group>
          <Group gap="sm" align="center" wrap="nowrap">
            <div
              className="bt-java-progress-track"
              role="progressbar"
              aria-valuenow={barPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ flex: 1, minWidth: 0 }}
            >
              <div
                className={`bt-java-progress-bar${busyKey !== null ? " bt-java-progress-bar--active" : ""}`}
                style={{ width: `${Math.max(0, Math.min(100, barPercent))}%` }}
              />
            </div>
            {busyKey !== null && (
              <Button
                size="xs"
                color="red"
                variant="light"
                leftSection={<XCircle size={14} />}
                onClick={() => void cancelTask()}
                style={{ flexShrink: 0 }}
              >
                取消
              </Button>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={8} style={{ wordBreak: "break-all" }}>
            {progressMessage
              || (isPolling
                ? `等待端口出现 ${pollAttempt}/${RESTART_POLL_MAX_ATTEMPTS}`
                : busyMode === "upload"
                  ? "正在上传…"
                  : "处理中…")}
          </Text>
        </Paper>
      )}

      <TextInput
        type="search"
        placeholder="搜索名称 / 路径 / JAR / 端口…"
        leftSection={<Search size={14} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        styles={{ input: { textTransform: "none" } }}
      />

      <BtJavaProjectsTable
        pageRows={pageRows}
        loading={loading}
        rowsEmpty={rows.length === 0}
        busyKey={busyKey}
        busyPhase={busyPhase}
        fileDragActive={fileDragActive}
        dragOverKey={dragOverKey}
        onRestart={restart}
        onCancel={cancelTask}
      />

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          共 {filtered.length} 条
          {search.trim() ? `（筛选自 ${rows.length}）` : ""}
          {filtered.length > 0
            ? ` · 第 ${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filtered.length)} 条`
            : ""}
        </Text>
        <Group gap="sm">
          <Select
            size="xs"
            w={100}
            data={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
            value={String(pageSize)}
            onChange={(v) => setPageSize(Number(v || 20))}
            allowDeselect={false}
          />
          <Pagination
            value={safePage}
            onChange={setPage}
            total={totalPages}
            size="sm"
            disabled={filtered.length === 0}
          />
        </Group>
      </Group>
    </Stack>
  );
}
