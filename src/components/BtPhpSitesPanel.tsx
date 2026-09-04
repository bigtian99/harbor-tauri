import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import {
  Badge,
  Button,
  Checkbox,
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
import { Globe, Loader2, RefreshCw, Search, StopCircle, Upload, XCircle } from "lucide-react";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { displayBtUpdatedAt, setBtLastUpload } from "../utils/btLastUpload";
import { isTauriRuntime } from "../types";

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

interface BtPhpDeployProgress {
  site_id?: string;
  site_name?: string;
  percent?: number;
  message?: string;
  stage?: string;
}

const PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;
const AUTO_REFRESH_OPTIONS = ["10", "30", "60"] as const;

function siteKey(row: Pick<BtPhpSiteInfo, "id" | "name">): string {
  return row.id || row.name;
}

function findRowAtPoint(
  clientX: number,
  clientY: number,
  rows: BtPhpSiteInfo[],
): BtPhpSiteInfo | null {
  const nodes = document.querySelectorAll<HTMLElement>("[data-bt-php-key]");
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      const key = node.dataset.btPhpKey;
      if (!key) continue;
      const hit = rows.find((r) => siteKey(r) === key);
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

function pathsLookLikeJarOnly(paths: string[] | undefined): boolean {
  if (!paths?.length) return false;
  return paths.every((p) => p.toLowerCase().endsWith(".jar"));
}

function diagBuild(message: string) {
  if (!isTauriRuntime()) return;
  const text = message.trim();
  if (!text) return;
  void invoke("write_diagnostic_log", {
    module: "build",
    message: `bt_php ${text}`,
  }).catch(() => {
    /* 诊断写入失败不打断主流程 */
  });
}

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
    <Paper withBorder radius="md" className="bt-java-table-wrap">
      <Table striped highlightOnHover stickyHeader className="bt-java-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th className="bt-java-cell-name">域名</Table.Th>
            <Table.Th className="bt-java-cell-status">状态</Table.Th>
            <Table.Th className="bt-java-cell-port">PHP</Table.Th>
            <Table.Th className="bt-java-cell-path">路径</Table.Th>
            <Table.Th className="bt-java-cell-path">备注</Table.Th>
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
              const key = siteKey(row);
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
                  data-bt-php-key={key}
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
                  <Table.Td className="bt-java-cell-port">{row.php_version || "-"}</Table.Td>
                  <Table.Td className="bt-java-cell-path">
                    <Text size="sm" lineClamp={2} title={row.path || undefined}>
                      {row.path || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-java-cell-path">
                    <Text size="sm" lineClamp={2} title={row.ps || undefined}>
                      {row.ps || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="bt-java-cell-time">
                    <Text size="sm" c="dimmed">
                      {displayBtUpdatedAt("php", row.id, row.updated_at)}
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
  const [rows, setRows] = useState<BtPhpSiteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [barPercent, setBarPercent] = useState(0);
  const [displayPercent, setDisplayPercent] = useState(0);
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
  const displayPercentRef = useRef(0);
  const barAnimRafRef = useRef(0);

  rowsRef.current = rows;
  busyRef.current = busyKey !== null;

  const bumpBar = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setBarPercent((prev) => Math.max(prev, clamped));
  }, []);

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

  const load = useCallback(async (opts?: { resetPage?: boolean }) => {
    if (!isTauriRuntime()) {
      notifications.show({ title: "请在桌面端操作", message: "浏览器模式无法直连宝塔面板", color: "yellow" });
      return;
    }
    if (busyRef.current) {
      notifications.show({
        title: "任务进行中",
        message: "上传完成前请勿刷新列表",
        color: "yellow",
      });
      return;
    }
    setLoading(true);
    try {
      const list = await invoke<BtPhpSiteInfo[]>("list_bt_php_sites");
      setRows(list);
      if (opts?.resetPage) setPage(1);
    } catch (e) {
      notifications.show({ title: "拉取 PHP 站点失败", message: String(e), color: "red" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ resetPage: true });
    if (isTauriRuntime()) {
      void invoke("warmup_bt_ftp").catch((e) => {
        console.error("warmup_bt_ftp", e);
      });
    }
    return undefined;
  }, [load]);

  // 自动刷新
  useEffect(() => {
    if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null; }
    if (autoRefresh && !busyRef.current) {
      autoTimerRef.current = setInterval(() => {
        if (!busyRef.current) void invoke<BtPhpSiteInfo[]>("list_bt_php_sites").then((list) => setRows(list)).catch(() => {});
      }, Number(refreshSec) * 1000);
    }
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [autoRefresh, refreshSec]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let lastUploadPct = 0;
    void listen<BtPhpDeployProgress>("bt-php-deploy-progress", (event) => {
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
      } else if (stage === "upload_done") {
        lastUploadPct = 100;
        bumpBar(100);
        setProgressMessage(p.message?.trim() || "上传完成");
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
    const key = siteKey(row);
    setBusyKey(key);
    setProgressMessage(`正在停止 ${row.name}…`);
    diagBuild(`开始停止站点 ${row.name} id=${row.id}`);
    try {
      const msg = await invoke<string>("stop_bt_php_site", {
        siteName: row.name,
        siteId: row.id,
      });
      setProgressMessage(msg);
      diagBuild(msg);
      notifications.show({ title: "已停止", message: msg, color: "blue", autoClose: 2500 });
      setBusyKey(null);
      await load({ resetPage: false });
    } catch (e) {
      const msg = String(e);
      notifications.show({ title: "停止失败", message: msg, color: "red" });
      setProgressMessage(`停止失败：${msg}`);
      diagBuild(`停止站点失败 ${row.name}: ${msg}`);
    } finally {
      setBusyKey(null);
    }
  }, [confirm, load]);

  const cancelTask = useCallback(async () => {
    userCancelledRef.current = true;
    pollCancelRef.current += 1;
    setProgressMessage("正在取消…");
    diagBuild("正在取消上传");
    try {
      if (isTauriRuntime()) {
        await invoke("cancel_bt_php_deploy");
      }
    } catch (e) {
      console.error(e);
      diagBuild(`取消请求失败：${String(e)}`);
    }
    setBusyKey(null);
    setProgressMessage("已取消");
    diagBuild("已取消");
    notifications.show({
      title: "已取消",
      message: "上传已中断",
      color: "yellow",
    });
  }, []);

  const uploadToSite = useCallback(async (row: BtPhpSiteInfo, localPaths: string[]) => {
    if (!isTauriRuntime()) return;
    const key = siteKey(row);
    userCancelledRef.current = false;
    pollCancelRef.current += 1;
    setBusyKey(key);
    setBar(0);
    setProgressMessage(`正在连接 FTP · ${row.name}…`);
    diagBuild(`准备上传到 ${row.name} local=${localPaths.join(", ")} remote=${row.path}`);

    try {
      const uploaded = await invoke<string>("upload_bt_php_site", {
        localPaths,
        siteName: row.name,
        siteId: row.id,
        sitePath: row.path,
      });
      if (userCancelledRef.current) {
        diagBuild(`上传已完成但用户已取消 name=${row.name}`);
        setProgressMessage("已取消（文件可能已上传）");
        return;
      }
      bumpBar(100);
      setProgressMessage(uploaded);
      diagBuild(uploaded);
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
        diagBuild("上传已取消");
        return;
      }
      notifications.show({ title: "上传失败", message: msg, color: "red" });
      setProgressMessage(`失败：${msg}`);
      diagBuild(`上传失败：${msg}`);
    } finally {
      setBusyKey(null);
    }
  }, [bumpBar, setBar]);

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
        setDragOverKey(hit ? siteKey(hit) : null);
        return hit;
      };

      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter") {
          setFileDragActive(payload.paths.length > 0);
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
              message: "当前有上传任务进行中",
              color: "yellow",
            });
            return;
          }
          if (pathsLookLikeJarOnly(payload.paths)) {
            notifications.show({
              title: "这是 JAR",
              message: "PHP 站点请拖入目录、zip 或站点文件；JAR 请到 Java 项目页",
              color: "yellow",
            });
            return;
          }
          if (!payload.paths.length) {
            notifications.show({
              title: "没有文件",
              message: "请拖入目录、.zip 或站点文件",
              color: "yellow",
            });
            return;
          }
          if (!hit) {
            notifications.show({
              title: "请对准站点行",
              message: "把文件拖到具体某一行上（行会高亮并显示「松开上传」）",
              color: "yellow",
              autoClose: 5000,
            });
            return;
          }
          void uploadToSite(hit, payload.paths);
        }
      });
    })();

    return () => {
      disposed = true;
      if (overRaf) cancelAnimationFrame(overRaf);
      unlisten?.();
    };
  }, [uploadToSite]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.path, r.php_version, r.ps, r.id, r.updated_at].some((v) => v.toLowerCase().includes(q)),
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

  const showProgress = busyKey !== null || Boolean(progressMessage);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="xs" mb={4}>
            <Globe size={20} />
            <Title order={3}>PHP 项目</Title>
          </Group>
          <Text size="sm" c="dimmed">
            把目录 / zip / 站点文件拖到某一行上，松开即 FTP 覆盖到该站点路径（无需重启）
          </Text>
        </div>
        <Group gap="sm" align="center">
          <Checkbox
            label="自动刷新"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            size="xs"
          />
          {autoRefresh && (
            <Select
              data={AUTO_REFRESH_OPTIONS.map((v) => ({ value: v, label: `${v}s` }))}
              value={refreshSec}
              onChange={(v) => v && setRefreshSec(v)}
              size="xs"
              w={72}
            />
          )}
          <Button
            leftSection={loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            onClick={() => void load({ resetPage: true })}
            disabled={loading || busyKey !== null}
            variant="filled"
            color="blue"
          >
            刷新
          </Button>
        </Group>
      </Group>

      {fileDragActive && (
        <div className="bt-java-drop-banner">
          <Upload size={16} />
          {dragOverKey
            ? `对准了「${rows.find((r) => siteKey(r) === dragOverKey)?.name ?? "站点"}」— 松开鼠标即可上传`
            : "请继续拖到具体站点行上，对准后该行会高亮"}
        </div>
      )}

      {showProgress && (
        <Paper withBorder p="sm" radius="md" style={{ borderColor: "var(--color-primary-muted)" }}>
          <Group justify="space-between" mb={6} wrap="nowrap">
            <Text size="sm" fw={500}>
              {busyKey !== null ? "任务进度" : "最近任务"}
            </Text>
            <Text size="sm" c="blue" style={{ flexShrink: 0 }}>
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
            {progressMessage || (busyKey !== null ? "正在上传…" : "")}
          </Text>
        </Paper>
      )}

      <TextInput
        type="search"
        placeholder="搜索域名 / 路径 / PHP 版本 / 备注 / 时间…"
        leftSection={<Search size={14} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        styles={{ input: { textTransform: "none" } }}
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
