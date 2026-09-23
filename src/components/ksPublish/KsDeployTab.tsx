import { useCallback, useDeferredValue, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button, Card, Checkbox, Divider, Group, Pagination, ScrollArea,
  Select, SimpleGrid, Stack, Table, Text, TextInput, Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ClipboardList, Download, Search, Plus, Copy, Package } from "lucide-react";
import { isTauriRuntime } from "../../types";
import { panelAccentButtonStyles, panelPrimaryButtonStyles } from "../../theme/panelStyles";
import {
  type DeployInfo,
  BAD_STATES,
  PAGE_SIZE_OPTIONS,
} from "./types";
import { DeployRow } from "./DeployRow";
import { KsRefreshIcon } from "./KsRefreshIcon";
import { KsDeployDetail, type KsDeployDetailMutations } from "./KsDeployDetail";
import type { KsDeployMutationsApi } from "./useKsDeployMutations";

export function KsDeployTab({
  deploys,
  sel,
  setSel,
  checkedNames,
  setCheckedNames,
  toggleDeployCheck,
  connected,
  connecting,
  namespace,
  loading,
  lastRefresh,
  autoRefresh,
  setAutoRefresh,
  refreshSec,
  setRefreshSec,
  handleRefreshOrReconnect,
  batch,
  deploy,
  openPodLogs,
}: {
  deploys: DeployInfo[];
  sel: DeployInfo | null;
  setSel: (d: DeployInfo | null) => void;
  checkedNames: Set<string>;
  setCheckedNames: Dispatch<SetStateAction<Set<string>>>;
  toggleDeployCheck: (name: string, on: boolean) => void;
  connected: boolean;
  connecting: boolean;
  namespace: string | null;
  loading: boolean;
  lastRefresh: string | null;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  refreshSec: string;
  setRefreshSec: (v: string) => void;
  handleRefreshOrReconnect: () => void;
  batch: {
    batchRunning: boolean;
    cloneRunning: boolean;
    beginBatchPack: () => void;
    beginBatchClone: () => void;
  };
  deploy: KsDeployMutationsApi;
  openPodLogs: (podName: string) => void;
}) {
  const detailDeploy: KsDeployDetailMutations = {
    beginEdit: deploy.beginEdit,
    image: deploy.image,
    setImage: deploy.setImage,
    submitting: deploy.submitting,
    submitImageOnly: deploy.submitImageOnly,
    revisions: deploy.revisions,
    revsLoading: deploy.revsLoading,
    loadRevisions: deploy.loadRevisions,
    revPageRows: deploy.revPageRows,
    revDurationMap: deploy.revDurationMap,
    revSafePage: deploy.revSafePage,
    revPageSize: deploy.revPageSize,
    setRevPageSize: deploy.setRevPageSize,
    setRevPage: deploy.setRevPage,
    revTotalPages: deploy.revTotalPages,
    rollback: deploy.rollback,
    selContainer: deploy.selContainer,
  };
  const [filterDeploy, setFilterDeploy] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>("all");
  const [filterImage, setFilterImage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 命名空间切换时重置筛选（与原先 panel 行为一致）
  useEffect(() => {
    setFilterDeploy(null);
    setFilterStatus("all");
    setFilterImage("");
    setPage(1);
  }, [namespace]);

  const deferredImage = useDeferredValue(filterImage);
  const deployOptions = useMemo(
    () =>
      [...deploys]
        .map((d) => ({
          value: d.name,
          label: d.alias?.trim() ? `${d.name}（${d.alias}）` : d.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    [deploys],
  );
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of deploys) {
      if (!seen.has(d.status.state)) seen.set(d.status.state, d.status.label);
    }
    return [
      { value: "all", label: "全部状态" },
      { value: "bad", label: "只看异常" },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "zh-CN"))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [deploys]);
  const filtered = useMemo(() => {
    let list = deploys;
    if (filterDeploy) list = list.filter((d) => d.name === filterDeploy);
    if (filterStatus === "bad") {
      list = list.filter((d) => BAD_STATES.includes(d.status.state));
    } else if (filterStatus && filterStatus !== "all") {
      list = list.filter((d) => d.status.state === filterStatus);
    }
    const q = deferredImage.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const tag = d.image.split(":").pop() ?? d.image;
        return d.image.toLowerCase().includes(q) || tag.toLowerCase().includes(q);
      });
    }
    return list;
  }, [deploys, filterDeploy, filterStatus, deferredImage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const pageAllChecked =
    pageRows.length > 0 && pageRows.every((d) => checkedNames.has(d.name));
  const pageSomeChecked =
    pageRows.some((d) => checkedNames.has(d.name)) && !pageAllChecked;

  const togglePageChecks = (on: boolean) => {
    setCheckedNames((prev) => {
      const next = new Set(prev);
      for (const d of pageRows) {
        if (on) next.add(d.name);
        else next.delete(d.name);
      }
      return next;
    });
  };

  useEffect(() => {
    setPage(1);
  }, [filterDeploy, filterStatus, deferredImage, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const exportCsv = useCallback(async () => {
    if (filtered.length === 0) {
      notifications.show({ color: "yellow", message: "当前无数据可导出" });
      return;
    }
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["状态", "部署", "别名", "容器", "端口", "镜像", "就绪", "版本"].map(esc).join(","),
      ...filtered.map((d) => {
        return [d.status.label, d.name, d.alias ?? "", d.containers.join("/"), (d.ports ?? []).join("/"), d.image, d.status.detail.split(" · ")[0], d.revision].map(esc).join(",");
      }),
    ].join("\r\n");
    const content = `\ufeff${rows}`;
    const defaultName = `deployments-status-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;

    if (!isTauriRuntime()) {
      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      notifications.show({ color: "blue", message: `已下载 ${defaultName}`, autoClose: 2500 });
      return;
    }

    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;

    try {
      const saved = await invoke<string>("write_text_file", { path, content });
      notifications.show({
        color: "blue",
        title: "导出完成",
        message: saved,
        autoClose: 4000,
        onClick: () => {
          void invoke("open_directory", { path: saved }).catch(() => {});
        },
        style: { cursor: "pointer" },
      });
    } catch (e) {
      notifications.show({ color: "red", title: "导出 CSV 失败", message: String(e) });
    }
  }, [filtered]);

  const {
    beginCreate, beginEdit,
  } = deploy;

  return (
    <Stack gap="md">
      <Card shadow="sm" radius="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Group gap={8}>
              <Group gap={6}>
                <ClipboardList size={16} aria-hidden="true" />
                <Title order={5}>全部部署状态</Title>
              </Group>
              {lastRefresh && <Text size="xs" c="dimmed">最近刷新 {lastRefresh}</Text>}
            </Group>
            <Group gap="sm" wrap="wrap" className="ks-publish-actions">
              <Group gap={6} wrap="wrap" className="ks-publish-actions-util">
                <Checkbox label="自动刷新" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} size="xs" />
                <Select
                  value={refreshSec}
                  onChange={(v) => setRefreshSec(v ?? "30")}
                  data={["10", "30", "60"]}
                  w={76}
                  size="xs"
                  disabled={!autoRefresh}
                />
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<KsRefreshIcon spinning={loading} />}
                  disabled={loading || connecting}
                  onClick={handleRefreshOrReconnect}
                >
                  {connected ? "刷新" : "重新连接"}
                </Button>
                <Button size="xs" variant="light" color="blue" leftSection={<Plus size={13} />} onClick={beginCreate}>
                  创建部署
                </Button>
                <Button size="xs" variant="subtle" color="gray" leftSection={<Download size={13} />} onClick={() => void exportCsv()}>
                  导出 CSV
                </Button>
              </Group>
              <Divider orientation="vertical" className="ks-publish-actions-divider" />
              <Group gap={6} wrap="wrap" className="ks-publish-actions-batch">
                <Button
                  size="xs"
                  variant="filled"
                  color="blue"
                  className="ks-btn-batch-primary"
                  leftSection={<Package size={13} />}
                  disabled={
                    checkedNames.size === 0
                    || batch.batchRunning
                    || batch.cloneRunning
                  }
                  loading={batch.batchRunning}
                  onClick={batch.beginBatchPack}
                  styles={panelPrimaryButtonStyles}
                >
                  批量打包并发布{checkedNames.size > 0 ? ` (${checkedNames.size})` : ""}
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  color="green"
                  className="ks-btn-batch-clone"
                  leftSection={<Copy size={13} />}
                  disabled={
                    !connected
                    || !namespace
                    || checkedNames.size === 0
                    || batch.batchRunning
                    || batch.cloneRunning
                  }
                  loading={batch.cloneRunning}
                  onClick={batch.beginBatchClone}
                  styles={panelAccentButtonStyles}
                >
                  复制到其他环境{checkedNames.size > 0 ? ` (${checkedNames.size})` : ""}
                </Button>
              </Group>
            </Group>
          </Group>
          {checkedNames.size > 0 && (
            <Text size="xs" c="blue">
              已选 {checkedNames.size} 个部署
              {" · "}
              点击「批量打包并发布」在弹框中填写分支与构建脚本
              {" · "}
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => setCheckedNames(new Set())}
              >
                清空选择
              </Button>
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <Select
              label="部署"
              placeholder="全部部署"
              data={deployOptions}
              value={filterDeploy}
              onChange={(v) => {
                setFilterDeploy(v);
                if (v) {
                  const hit = deploys.find((d) => d.name === v);
                  if (hit) setSel(hit);
                }
              }}
              searchable
              clearable
              nothingFoundMessage="无匹配部署"
              size="sm"
            />
            <Select
              label="状态"
              placeholder="全部状态"
              data={statusOptions}
              value={filterStatus}
              onChange={(v) => setFilterStatus(v ?? "all")}
              allowDeselect={false}
              size="sm"
            />
            <TextInput
              label="镜像"
              type="search"
              placeholder="按镜像地址 / tag 过滤"
              leftSection={<Search size={14} />}
              value={filterImage}
              onChange={(e) => setFilterImage(e.currentTarget.value)}
              size="sm"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </SimpleGrid>
        </Stack>
        <ScrollArea className="ks-deploys-scroll" mah="min(72vh, 720px)" type="auto" offsetScrollbars mt="sm">
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="全选当前页"
                    checked={pageAllChecked}
                    indeterminate={pageSomeChecked}
                    onChange={(e) => togglePageChecks(e.currentTarget.checked)}
                  />
                </Table.Th>
                <Table.Th>状态</Table.Th><Table.Th>部署</Table.Th><Table.Th>别名</Table.Th><Table.Th>容器</Table.Th>
                <Table.Th>端口</Table.Th><Table.Th>镜像地址</Table.Th><Table.Th>就绪</Table.Th><Table.Th>版本</Table.Th>
                <Table.Th>操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageRows.length === 0 && (
                <Table.Tr><Table.Td colSpan={10} align="center" c="dimmed">没有匹配的部署</Table.Td></Table.Tr>
              )}
              {pageRows.map((d) => (
                <DeployRow
                  key={d.name}
                  d={d}
                  selected={sel?.name === d.name}
                  checked={checkedNames.has(d.name)}
                  onSelect={setSel}
                  onToggleCheck={toggleDeployCheck}
                  onEdit={beginEdit}
                />
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <div className="ks-list-pager">
          <Text size="sm" c="dimmed">
            共 {filtered.length} 条
            {filterDeploy || (filterStatus && filterStatus !== "all") || filterImage.trim()
              ? `（筛选自 ${deploys.length}）`
              : ""}
            {filtered.length > 0
              ? ` · 第 ${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filtered.length)} 条`
              : ""}
          </Text>
          <Group gap="sm" wrap="nowrap">
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
        </div>
      </Card>

      {sel && (
        <KsDeployDetail
          sel={sel}
          openPodLogs={openPodLogs}
          deploy={detailDeploy}
        />
      )}
    </Stack>
  );
}
