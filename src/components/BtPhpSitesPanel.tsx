import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { Globe, Loader2, RefreshCw, Search } from "lucide-react";
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

const PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;

export function BtPhpSitesPanel() {
  const [rows, setRows] = useState<BtPhpSiteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ title: "请在桌面端操作", message: "浏览器模式无法直连宝塔面板", color: "yellow" });
      return;
    }
    setLoading(true);
    try {
      const list = await invoke<BtPhpSiteInfo[]>("list_bt_php_sites");
      setRows(list);
      setPage(1);
    } catch (e) {
      notifications.show({ title: "拉取 PHP 站点失败", message: String(e), color: "red" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="xs" mb={4}>
            <Globe size={20} />
            <Title order={3}>PHP 项目</Title>
          </Group>
          <Text size="sm" c="dimmed">
            直连宝塔 sites 表并过滤静态站，与面板 PHP 项目列表保持一致
          </Text>
        </div>
        <Button
          leftSection={loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          onClick={() => void load()}
          disabled={loading}
          variant="light"
        >
          刷新
        </Button>
      </Group>

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

      <Paper withBorder radius="md" style={{ overflow: "auto" }}>
        <Table striped highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>域名</Table.Th>
              <Table.Th>状态</Table.Th>
              <Table.Th>PHP</Table.Th>
              <Table.Th>路径</Table.Th>
              <Table.Th>备注</Table.Th>
              <Table.Th>更新时间</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading && rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="lg">加载中…</Text>
                </Table.Td>
              </Table.Tr>
            ) : pageRows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="lg">
                    {rows.length === 0 ? "暂无数据，请先在设置中配置宝塔面板密钥" : "无匹配项"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pageRows.map((row) => (
                <Table.Tr key={`${row.id}-${row.name}`}>
                  <Table.Td>
                    <Text fw={500}>{row.name}</Text>
                    <Text size="xs" c="dimmed">ID {row.id || "-"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={row.status === "1" ? "teal" : "gray"} variant="outline">
                      {row.status_text}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{row.php_version || "-"}</Table.Td>
                  <Table.Td>
                    <Text size="sm" style={{ wordBreak: "break-all" }}>
                      {row.path || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td>{row.ps || "-"}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      {row.updated_at || "-"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Paper>

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
