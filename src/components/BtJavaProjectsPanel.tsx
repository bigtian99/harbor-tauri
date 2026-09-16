import { memo, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { Badge, Button, Group, Paper, Stack, Table, Text } from "@mantine/core";
import { Loader2, RotateCcw, StopCircle, Upload, XCircle } from "lucide-react";
import { displayBtUpdatedAt, setBtLastUpload } from "../utils/btLastUpload";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import {
  BT_PANEL_ROW_ATTR,
  btDiag,
  btRowKey,
  useBtDeployProgress,
  useBtListPanel,
  useBtWindowDragDrop,
} from "../hooks/useBtListPanel";
import { isTauriRuntime } from "../types";
import { showSystemAlert } from "../systemAlert";
import { PanelPageHeader } from "./PanelPageHeader";
import {
  BtPanelAutoRefreshControls,
  BtPanelDropBanner,
  BtPanelPaginationBar,
  BtPanelProgressCard,
  BtPanelSearchInput,
} from "./bt/BtPanelChrome";

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

/** 重启后轮询间隔 */
const RESTART_POLL_INTERVAL_MS = 3000;
/** 最多轮询次数 */
const RESTART_POLL_MAX_ATTEMPTS = 20;

type BusyMode = "restart" | "upload" | "stop";
/** 列表行上展示的固定阶段文案（不含百分比，避免进度条刷新带动整表闪动） */
type BusyPhase = "upload" | "restart" | "wait_port" | "stop";

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

function pathsLookLikeJar(paths: string[] | undefined): boolean {
  return Boolean(paths?.some((p) => p.toLowerCase().endsWith(".jar")));
}

function diag(message: string) {
  btDiag("bt_java", message);
}

function busyPhaseLabel(phase: BusyPhase): string {
  if (phase === "upload") return "上传中";
  if (phase === "wait_port") return "等待端口";
  if (phase === "stop") return "停止中";
  return "重启中";
}

const javaSearchFields = (row: BtJavaProjectInfo) => [
  row.name,
  row.path,
  row.project_jar,
  row.port,
  row.id,
  row.updated_at,
];

interface BtJavaTableProps {
  pageRows: BtJavaProjectInfo[];
  loading: boolean;
  rowsEmpty: boolean;
  busyKey: string | null;
  busyPhase: BusyPhase | null;
  fileDragActive: boolean;
  dragOverKey: string | null;
  uploadDisplayTick: number;
  onRestart: (row: BtJavaProjectInfo) => void | Promise<void>;
  onStop: (row: BtJavaProjectInfo) => void | Promise<void>;
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
  uploadDisplayTick: _uploadDisplayTick,
  onRestart,
  onStop,
  onCancel,
}: BtJavaTableProps) {
  return (
    <Paper withBorder radius="md" className="bt-panel-table-wrap">
      <Table striped highlightOnHover stickyHeader className="bt-panel-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th className="bt-panel-cell-name">名称</Table.Th>
            <Table.Th className="bt-panel-cell-status">状态</Table.Th>
            <Table.Th className="bt-panel-cell-port">端口</Table.Th>
            <Table.Th className="bt-panel-cell-path">JAR</Table.Th>
            <Table.Th className="bt-panel-cell-path">路径</Table.Th>
            <Table.Th className="bt-panel-cell-time">更新时间</Table.Th>
            <Table.Th className="bt-panel-cell-actions">操作</Table.Th>
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
              const key = btRowKey(row);
              const waiting = busyKey === key;
              const isDropTarget = dragOverKey === key;
              const rowClass = [
                "bt-panel-row",
                fileDragActive ? "bt-panel-row--drag-active" : "",
                isDropTarget ? "bt-panel-row--drop-target" : "",
              ].filter(Boolean).join(" ");
              return (
                <Table.Tr
                  key={`${row.id}-${row.name}`}
                  {...{ [BT_PANEL_ROW_ATTR]: key }}
                  className={rowClass}
                >
                  <Table.Td className="bt-panel-cell-name">
                    <Text fw={500} lineClamp={1}>{row.name}</Text>
                    <Text size="xs" c="dimmed">ID {row.id || "-"}</Text>
                    {!waiting && fileDragActive && (
                      <span className="bt-panel-row-hint">
                        <Upload size={11} />
                        {isDropTarget ? "松开上传" : "拖到此处"}
                      </span>
                    )}
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-status">
                    {waiting && busyPhase ? (
                      <Badge color="yellow" variant="outline" leftSection={<Loader2 size={10} className="spin" />}>
                        {busyPhaseLabel(busyPhase)}
                      </Badge>
                    ) : (
                      <Badge color={row.status === "1" ? "teal" : row.status === "0" ? "red" : "orange"} variant="light">
                        {row.status_text}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-port">{row.port || "-"}</Table.Td>
                  <Table.Td className="bt-panel-cell-path">
                    <Text size="sm" lineClamp={2} title={row.project_jar || undefined}>
                      {row.project_jar || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-path">
                    <Text size="sm" lineClamp={2} title={row.path || undefined}>
                      {row.path || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-time">
                    <Text size="sm" c="dimmed">
                      {displayBtUpdatedAt("java", row.id, row.updated_at)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-actions">
                    {waiting ? (
                      busyPhase === "upload" ? (
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
                        <Text size="xs" c="dimmed">{busyPhase ? busyPhaseLabel(busyPhase) : "处理中"}</Text>
                      )
                    ) : (
                      <Group gap={6} justify="center" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<RotateCcw size={14} />}
                          disabled={busyKey !== null}
                          onClick={() => { void onRestart(row); }}
                        >
                          重启
                        </Button>
                        {row.status === "1" && (
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            leftSection={<StopCircle size={14} />}
                            disabled={busyKey !== null}
                            onClick={() => { void onStop(row); }}
                          >
                            停止
                          </Button>
                        )}
                      </Group>
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
  const { confirm } = useConfirmDialog();
  const [busyMode, setBusyMode] = useState<BusyMode>("restart");
  const [pollAttempt, setPollAttempt] = useState(0);

  const fetchRows = useCallback(async (): Promise<BtJavaProjectInfo[]> => {
    return invoke<BtJavaProjectInfo[]>("list_bt_java_projects");
  }, []);

  const panel = useBtListPanel<BtJavaProjectInfo>({
    fetchRows,
    loadErrorTitle: "拉取 Java 项目失败",
    busyRefreshMessage: "上传/重启完成前请勿刷新列表",
    searchFields: javaSearchFields,
  });

  const {
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
    barPercent,
    displayPercent,
    bumpBar,
    setBar,
    setPage,
  } = panel;

  useBtDeployProgress({
    eventName: "bt-java-deploy-progress",
    bumpBar,
    setProgressMessage,
    onExtraStage: (stage) => {
      if (stage === "upload" || stage === "upload_done") {
        setBusyMode((m) => (m === "upload" ? m : "upload"));
        return true;
      }
      if (stage === "restart" || stage === "wait_port") {
        bumpBar(100);
        setBusyMode((m) => (m === "restart" ? m : "restart"));
        return false; // 仍走默认 message 处理
      }
      return false;
    },
  });

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
      diag(`${row.name} ${waitMsg}`);
      bumpBar(100);

      await sleep(attempt === 1 ? 2000 : RESTART_POLL_INTERVAL_MS);
      if (token !== pollCancelRef.current) return false;

      try {
        const list = await fetchRows();
        if (token !== pollCancelRef.current) return false;
        const latest = findProject(list, row);
        if (latest) {
          const key = btRowKey(row);
          setRows((prev) => {
            const idx = prev.findIndex((r) => btRowKey(r) === key);
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
          diag(okMsg);
          bumpBar(100);
          return true;
        }
      } catch (e) {
        console.error(e);
        diag(`${row.name} 轮询列表失败：${String(e)}`);
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
    diag(`${row.name} ${timeoutMsg}`);
    return false;
  }, [fetchRows, bumpBar, pollCancelRef, setProgressMessage, setRows]);

  const cancelTask = useCallback(async () => {
    userCancelledRef.current = true;
    pollCancelRef.current += 1;
    setProgressMessage("正在取消…");
    diag("正在取消上传/等待");
    try {
      if (isTauriRuntime()) {
        await invoke("cancel_bt_java_deploy");
      }
    } catch (e) {
      console.error(e);
      diag(`取消请求失败：${String(e)}`);
    }
    setBusyKey(null);
    setPollAttempt(0);
    setBusyMode("restart");
    setProgressMessage("已取消");
    diag("已取消");
    notifications.show({
      title: "已取消",
      message: "上传/等待已中断",
      color: "yellow",
    });
  }, [userCancelledRef, pollCancelRef, setProgressMessage, setBusyKey]);

  const stop = useCallback(async (row: BtJavaProjectInfo) => {
    if (!isTauriRuntime()) return;
    const ok = await confirm({
      title: "停止 Java 项目",
      message: `确认停止「${row.name}」？`,
      details: row.project_jar ? [row.project_jar] : undefined,
      confirmLabel: "确认停止",
      variant: "danger",
    });
    if (!ok) return;
    const key = btRowKey(row);
    userCancelledRef.current = false;
    setBusyKey(key);
    setBusyMode("stop");
    setPollAttempt(0);
    setBar(0);
    setProgressMessage(`正在停止 ${row.name}…`);
    diag(`开始停止 ${row.name} id=${row.id}`);
    try {
      const msg = await invoke<string>("stop_bt_java_project", {
        projectName: row.name,
        projectId: row.id,
      });

      bumpBar(100);
      notifications.show({
        title: "已下发停止",
        message: `${msg}，正在刷新状态…`,
        color: "blue",
        autoClose: 2500,
      });
      setProgressMessage("已下发停止，正在确认已停止…");

      let stopped = false;
      for (let attempt = 1; attempt <= RESTART_POLL_MAX_ATTEMPTS; attempt++) {
        setProgressMessage(`确认已停止 ${attempt}/${RESTART_POLL_MAX_ATTEMPTS}…`);
        diag(`${row.name} 确认停止 attempt=${attempt}`);
        await sleep(attempt === 1 ? 2000 : RESTART_POLL_INTERVAL_MS);

        const list = await fetchRows();
        const latest = findProject(list, row);
        if (latest) {
          setRows((prev) => {
            const key2 = btRowKey(row);
            const idx = prev.findIndex((r) => btRowKey(r) === key2);
            if (idx < 0) return prev;
            const cur = prev[idx];
            const next = prev.slice();
            next[idx] = { ...cur, ...latest };
            return next;
          });
          if (latest.status !== "1") {
            stopped = true;
            break;
          }
        }
      }

      if (stopped) {
        await showSystemAlert("停止完成", `${row.name} 已停止`);
        setProgressMessage("已停止");
      } else {
        setProgressMessage("停止已下发，但确认超时（可手动刷新）");
      }
    } catch (e) {
      const msg = String(e);
      notifications.show({ title: "停止失败", message: msg, color: "red" });
      diag(`停止失败 ${row.name}: ${msg}`);
      setProgressMessage(`停止失败：${msg}`);
    } finally {
      setBusyKey(null);
      setPollAttempt(0);
      await load({ resetPage: false });
    }
  }, [confirm, load, fetchRows, bumpBar, setBar, userCancelledRef, setBusyKey, setProgressMessage, setRows]);

  const restart = useCallback(async (row: BtJavaProjectInfo) => {
    if (!isTauriRuntime()) return;
    const ok = await confirm({
      title: "重启 Java 项目",
      message: `确认重启「${row.name}」？`,
      details: row.project_jar ? [row.project_jar] : undefined,
      confirmLabel: "确认重启",
      variant: "danger",
    });
    if (!ok) return;
    const key = btRowKey(row);
    userCancelledRef.current = false;
    const token = ++pollCancelRef.current;
    setBusyKey(key);
    setBusyMode("restart");
    setPollAttempt(0);
    setBar(0);
    setProgressMessage(`正在重启 ${row.name}…`);
    diag(`开始重启 ${row.name} id=${row.id}`);
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
        color: "blue",
        autoClose: 2500,
      });
      setProgressMessage("已下发重启，等待端口出现…");
      diag(`${msg}，等待端口出现…`);
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
        diag("重启已取消");
        return;
      }
      notifications.show({ title: "重启失败", message: msg, color: "red" });
      setProgressMessage(`重启失败：${msg}`);
      diag(`重启失败：${msg}`);
    } finally {
      if (token === pollCancelRef.current || userCancelledRef.current) {
        setBusyKey(null);
        setPollAttempt(0);
      }
    }
  }, [confirm, waitForPort, bumpBar, setBar, userCancelledRef, pollCancelRef, setBusyKey, setProgressMessage]);

  const markJavaUploaded = useCallback((id: string) => {
    setBtLastUpload("java", id);
    setUploadDisplayTick((n) => n + 1);
  }, [setUploadDisplayTick]);

  const uploadAndRestart = useCallback(async (row: BtJavaProjectInfo, localJar: string) => {
    if (!isTauriRuntime()) return;
    const key = btRowKey(row);
    userCancelledRef.current = false;
    const token = ++pollCancelRef.current;
    setBusyKey(key);
    setBusyMode("upload");
    setPollAttempt(0);
    setBar(0);
    setProgressMessage(`正在连接 FTP · ${row.name}…`);
    diag(`准备上传到 ${row.name} local=${localJar} remote=${row.project_jar || row.path}`);
    const hadPortBefore = Boolean(row.port?.trim());

    try {
      const uploaded = await invoke<string>("upload_bt_java_jar", {
        localJar,
        projectName: row.name,
        projectId: row.id,
        remoteJar: row.project_jar,
        projectPath: row.path,
      });

      markJavaUploaded(row.id);

      if (userCancelledRef.current) {
        diag(`上传已完成但用户已取消，跳过重启 name=${row.name}`);
        setProgressMessage("已取消（文件已上传）");
        return;
      }

      bumpBar(100);
      setProgressMessage(`${uploaded}，正在重启…`);
      diag(`${uploaded}；开始重启 ${row.name} id=${row.id}`);
      setBusyMode("restart");

      const restarted = await invoke<string>("restart_bt_java_project", {
        projectName: row.name,
        projectId: row.id,
      });
      diag(`${restarted}`);

      if (userCancelledRef.current) {
        setProgressMessage(`${restarted}（已取消等待端口）`);
        return;
      }

      setProgressMessage("已重启，等待端口出现…");
      bumpBar(100);

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
        diag("上传/重启已取消");
        return;
      }
      notifications.show({ title: "上传/重启失败", message: msg, color: "red" });
      setProgressMessage(`失败：${msg}`);
      diag(`上传/重启失败：${msg}`);
    } finally {
      setBusyKey(null);
      setPollAttempt(0);
    }
  }, [waitForPort, bumpBar, setBar, markJavaUploaded, userCancelledRef, pollCancelRef, setBusyKey, setProgressMessage]);

  const validateDropPaths = useCallback((paths: string[]) => {
    const jar = paths.find((p) => p.toLowerCase().endsWith(".jar"));
    if (!jar) {
      return { title: "请拖入 JAR", message: "只支持 .jar 文件" };
    }
    return null;
  }, []);

  const onDrop = useCallback((row: BtJavaProjectInfo, paths: string[]) => {
    const jar = paths.find((p) => p.toLowerCase().endsWith(".jar"));
    if (jar) void uploadAndRestart(row, jar);
  }, [uploadAndRestart]);

  useBtWindowDragDrop({
    rowsRef,
    busyRef,
    setFileDragActive,
    setDragOverKey,
    isDragEnterActive: (paths) => pathsLookLikeJar(paths) || paths.length > 0,
    busyDropMessage: "当前有上传或重启任务进行中",
    missRowTitle: "请对准项目行",
    missRowMessage: "把 JAR 拖到具体某一行上（行会高亮并显示「松开上传」）",
    validateDropPaths,
    onDrop,
  });

  const isPolling = busyKey !== null && pollAttempt > 0;
  const busyPhase: BusyPhase | null = busyKey == null
    ? null
    : (pollAttempt > 0 ? "wait_port" : busyMode);

  const progressFallback = isPolling
    ? `等待端口出现 ${pollAttempt}/${RESTART_POLL_MAX_ATTEMPTS}`
    : busyMode === "upload"
      ? "正在上传…"
      : busyMode === "stop"
        ? "正在停止…"
        : "处理中…";

  return (
    <Stack gap="md">
      <PanelPageHeader
        eyebrow="JAR → BAOTA JAVA"
        title="Java 项目"
        sub={`把 JAR 拖到某一行上（行内有「拖入 JAR」提示），松开即上传并重启${
          isPolling ? ` · 等待端口出现 ${pollAttempt}/${RESTART_POLL_MAX_ATTEMPTS}` : ""
        }`}
      >
        <BtPanelAutoRefreshControls
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          refreshSec={refreshSec}
          setRefreshSec={setRefreshSec}
          loading={loading}
          busyKey={busyKey}
          onRefresh={() => void load({ resetPage: true })}
        />
      </PanelPageHeader>

      <BtPanelDropBanner
        active={fileDragActive}
        dragOverKey={dragOverKey}
        rows={rows}
        alignedSuffix="项目"
        missHint="请继续拖到具体项目行上，对准后该行会高亮"
      />

      {showProgress && (
        <BtPanelProgressCard
          busyKey={busyKey}
          barPercent={barPercent}
          displayPercent={displayPercent}
          progressMessage={progressMessage}
          fallbackMessage={progressFallback}
          showCancel={busyKey !== null && busyMode === "upload"}
          onCancel={() => void cancelTask()}
        />
      )}

      <BtPanelSearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索名称 / 路径 / JAR / 端口…"
      />

      <BtJavaProjectsTable
        pageRows={pageRows}
        loading={loading}
        rowsEmpty={rows.length === 0}
        busyKey={busyKey}
        busyPhase={busyPhase}
        fileDragActive={fileDragActive}
        dragOverKey={dragOverKey}
        uploadDisplayTick={uploadDisplayTick}
        onRestart={restart}
        onStop={stop}
        onCancel={cancelTask}
      />

      <BtPanelPaginationBar
        filteredLength={filtered.length}
        totalLength={rows.length}
        searchActive={Boolean(search.trim())}
        safePage={safePage}
        pageSize={pageSize}
        totalPages={totalPages}
        setPage={setPage}
        setPageSize={setPageSize}
      />
    </Stack>
  );
}
