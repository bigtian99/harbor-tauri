import { memo, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { Badge, Button, Group, Paper, Stack, Table, Text } from "@mantine/core";
import { Loader2, StopCircle, Upload, XCircle } from "lucide-react";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { displayBtUpdatedAt, setBtLastUpload } from "../utils/btLastUpload";
import {
  BT_PANEL_ROW_ATTR,
  btDiag,
  btRowKey,
  useBtDeployProgress,
  useBtListPanel,
  useBtWindowDragDrop,
} from "../hooks/useBtListPanel";
import { isTauriRuntime } from "../types";
import { PanelPageHeader } from "./PanelPageHeader";
import {
  BtPanelAutoRefreshControls,
  BtPanelDropBanner,
  BtPanelPaginationBar,
  BtPanelProgressCard,
  BtPanelSearchInput,
} from "./bt/BtPanelChrome";

export interface BtPhpSiteInfo {
  id: string;
  name: string;
  path: string;
  status: string;
  status_text: string;
  php_version: string;
  ps: string;
  updated_at: string;
}

function pathsLookLikeJarOnly(paths: string[] | undefined): boolean {
  if (!paths?.length) return false;
  return paths.every((p) => p.toLowerCase().endsWith(".jar"));
}

function diag(message: string) {
  btDiag("bt_php", message);
}

const phpSearchFields = (row: BtPhpSiteInfo) => [
  row.name,
  row.path,
  row.php_version,
  row.ps,
  row.id,
  row.updated_at,
];

interface BtPhpTableProps {
  pageRows: BtPhpSiteInfo[];
  loading: boolean;
  rowsEmpty: boolean;
  busyKey: string | null;
  fileDragActive: boolean;
  dragOverKey: string | null;
  uploadDisplayTick: number;
  onStop: (row: BtPhpSiteInfo) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

const BtPhpSitesTable = memo(function BtPhpSitesTable({
  pageRows,
  loading,
  rowsEmpty,
  busyKey,
  fileDragActive,
  dragOverKey,
  uploadDisplayTick: _uploadDisplayTick,
  onStop,
  onCancel,
}: BtPhpTableProps) {
  return (
    <Paper withBorder radius="md" className="bt-panel-table-wrap">
      <Table striped highlightOnHover stickyHeader className="bt-panel-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th className="bt-panel-cell-name">域名</Table.Th>
            <Table.Th className="bt-panel-cell-status">状态</Table.Th>
            <Table.Th className="bt-panel-cell-port">PHP</Table.Th>
            <Table.Th className="bt-panel-cell-path">路径</Table.Th>
            <Table.Th className="bt-panel-cell-path">备注</Table.Th>
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
                    {waiting ? (
                      <Badge color="yellow" variant="outline" leftSection={<Loader2 size={10} className="spin" />}>
                        上传中
                      </Badge>
                    ) : (
                      <Badge color={row.status === "1" ? "teal" : "red"} variant="light">
                        {row.status_text}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-port">{row.php_version || "-"}</Table.Td>
                  <Table.Td className="bt-panel-cell-path">
                    <Text size="sm" lineClamp={2} title={row.path || undefined}>
                      {row.path || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-path">
                    <Text size="sm" lineClamp={2} title={row.ps || undefined}>
                      {row.ps || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-time">
                    <Text size="sm" c="dimmed">
                      {displayBtUpdatedAt("php", row.id, row.updated_at)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-panel-cell-actions">
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
                      <Group gap={6} justify="center" wrap="nowrap">
                        <Text size="xs" c="dimmed">拖入上传</Text>
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

export function BtPhpSitesPanel() {
  const { confirm } = useConfirmDialog();

  const fetchRows = useCallback(async (): Promise<BtPhpSiteInfo[]> => {
    return invoke<BtPhpSiteInfo[]>("list_bt_php_sites");
  }, []);

  const panel = useBtListPanel<BtPhpSiteInfo>({
    fetchRows,
    loadErrorTitle: "拉取 PHP 站点失败",
    busyRefreshMessage: "上传完成前请勿刷新列表",
    searchFields: phpSearchFields,
  });

  const {
    rows,
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

  const [busyMode, setBusyMode] = useState<"upload" | "stop">("upload");

  useBtDeployProgress({
    eventName: "bt-php-deploy-progress",
    bumpBar,
    setProgressMessage,
  });

  const stopSite = useCallback(async (row: BtPhpSiteInfo) => {
    if (!isTauriRuntime()) return;
    const ok = await confirm({
      title: "停止 PHP 站点",
      message: `确认停止 Nginx 站点「${row.name}」？`,
      details: row.path ? [row.path] : undefined,
      confirmLabel: "确认停止",
      variant: "danger",
    });
    if (!ok) return;
    const key = btRowKey(row);
    setBusyMode("stop");
    setBusyKey(key);
    setProgressMessage(`正在停止 ${row.name}…`);
    diag(`开始停止站点 ${row.name} id=${row.id}`);
    try {
      const msg = await invoke<string>("stop_bt_php_site", {
        siteName: row.name,
        siteId: row.id,
      });
      setProgressMessage(msg);
      diag(msg);
      notifications.show({ title: "已停止", message: msg, color: "blue", autoClose: 2500 });
      setBusyKey(null);
      await load({ resetPage: false });
    } catch (e) {
      const msg = String(e);
      notifications.show({ title: "停止失败", message: msg, color: "red" });
      setProgressMessage(`停止失败：${msg}`);
      diag(`停止站点失败 ${row.name}: ${msg}`);
    } finally {
      setBusyKey(null);
    }
  }, [confirm, load, setBusyKey, setProgressMessage]);

  const cancelTask = useCallback(async () => {
    userCancelledRef.current = true;
    pollCancelRef.current += 1;
    setProgressMessage("正在取消…");
    diag("正在取消上传");
    try {
      if (isTauriRuntime()) {
        await invoke("cancel_bt_php_deploy");
      }
    } catch (e) {
      console.error(e);
      diag(`取消请求失败：${String(e)}`);
    }
    setBusyKey(null);
    setProgressMessage("已取消");
    diag("已取消");
    notifications.show({
      title: "已取消",
      message: "上传已中断",
      color: "yellow",
    });
  }, [userCancelledRef, pollCancelRef, setBusyKey, setProgressMessage]);

  const uploadToSite = useCallback(async (row: BtPhpSiteInfo, localPaths: string[]) => {
    if (!isTauriRuntime()) return;
    const key = btRowKey(row);
    userCancelledRef.current = false;
    pollCancelRef.current += 1;
    setBusyMode("upload");
    setBusyKey(key);
    setBar(0);
    setProgressMessage(`正在连接 FTP · ${row.name}…`);
    diag(`准备上传到 ${row.name} local=${localPaths.join(", ")} remote=${row.path}`);

    try {
      const uploaded = await invoke<string>("upload_bt_php_site", {
        localPaths,
        siteName: row.name,
        siteId: row.id,
        sitePath: row.path,
      });
      if (userCancelledRef.current) {
        diag(`上传已完成但用户已取消 name=${row.name}`);
        setProgressMessage("已取消（文件可能已上传）");
        return;
      }
      bumpBar(100);
      setProgressMessage(uploaded);
      diag(uploaded);
      setBtLastUpload("php", row.id);
      setUploadDisplayTick((n) => n + 1);
      notifications.show({
        title: "上传完成",
        message: uploaded,
        color: "blue",
        autoClose: 3000,
      });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("已取消") || userCancelledRef.current) {
        setProgressMessage("已取消");
        diag("上传已取消");
        return;
      }
      notifications.show({ title: "上传失败", message: msg, color: "red" });
      setProgressMessage(`失败：${msg}`);
      diag(`上传失败：${msg}`);
    } finally {
      setBusyKey(null);
    }
  }, [
    bumpBar,
    setBar,
    userCancelledRef,
    pollCancelRef,
    setBusyKey,
    setProgressMessage,
    setUploadDisplayTick,
  ]);

  const validateDropPaths = useCallback((paths: string[]) => {
    if (pathsLookLikeJarOnly(paths)) {
      return {
        title: "这是 JAR",
        message: "PHP 站点请拖入目录、zip 或站点文件；JAR 请到 Java 项目页",
      };
    }
    if (!paths.length) {
      return {
        title: "没有文件",
        message: "请拖入目录、.zip 或站点文件",
      };
    }
    return null;
  }, []);

  const onDrop = useCallback((row: BtPhpSiteInfo, paths: string[]) => {
    void uploadToSite(row, paths);
  }, [uploadToSite]);

  useBtWindowDragDrop({
    rowsRef,
    busyRef,
    setFileDragActive,
    setDragOverKey,
    isDragEnterActive: (paths) => paths.length > 0,
    busyDropMessage: "当前有上传任务进行中",
    missRowTitle: "请对准站点行",
    missRowMessage: "把文件拖到具体某一行上（行会高亮并显示「松开上传」）",
    validateDropPaths,
    onDrop,
  });

  return (
    <Stack gap="md">
      <PanelPageHeader
        eyebrow="DIST → BAOTA PHP"
        title="PHP 项目"
        sub="把目录 / zip / 站点文件拖到某一行上，松开即 FTP 覆盖到该站点路径（无需重启）"
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
        alignedSuffix="站点"
        missHint="请继续拖到具体站点行上，对准后该行会高亮"
      />

      {showProgress && (
        <BtPanelProgressCard
          busyKey={busyKey}
          barPercent={barPercent}
          displayPercent={displayPercent}
          progressMessage={progressMessage}
          fallbackMessage={
            busyKey !== null
              ? (busyMode === "stop" ? "正在停止…" : "正在上传…")
              : ""
          }
          showCancel={busyKey !== null && busyMode === "upload"}
          onCancel={() => void cancelTask()}
        />
      )}

      <BtPanelSearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索域名 / 路径 / PHP 版本 / 备注 / 时间…"
      />

      <BtPhpSitesTable
        pageRows={pageRows}
        loading={loading}
        rowsEmpty={rows.length === 0}
        busyKey={busyKey}
        fileDragActive={fileDragActive}
        dragOverKey={dragOverKey}
        uploadDisplayTick={uploadDisplayTick}
        onStop={stopSite}
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
