import {
  Button, Card, Group, Pagination, ScrollArea, Select, Table, Text, Title, Tooltip,
} from "@mantine/core";
import { Copy, Plus } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "./types";
import { KsRefreshIcon } from "./KsRefreshIcon";
import type { KsConfigMapsApi } from "./useKsConfigMaps";

export function KsConfigMapTab(p: KsConfigMapsApi) {
  return (
    <Card shadow="sm" radius="md" withBorder>
      <Group justify="space-between" mb="xs">
        <Group gap={8}>
          <Title order={5}>🗂 ConfigMap</Title>
          <Text size="xs" c="dimmed">共 {p.cms.length} 个</Text>
        </Group>
        <Group gap="sm">
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<KsRefreshIcon spinning={p.cmLoading} />}
            disabled={p.cmLoading}
            onClick={() => void p.loadCms()}
          >
            刷新
          </Button>
          <Button
            size="xs"
            variant="light"
            color="blue"
            leftSection={<Plus size={13} />}
            onClick={p.openCmCreate}
          >
            新建 ConfigMap
          </Button>
        </Group>
      </Group>
      <ScrollArea className="ks-cms-scroll" mah="min(68vh, 640px)" type="auto" offsetScrollbars>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr><Table.Th>名称</Table.Th><Table.Th>别名</Table.Th><Table.Th>键数</Table.Th><Table.Th>键</Table.Th><Table.Th>操作</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {p.cmPageRows.length === 0 && <Table.Tr><Table.Td colSpan={5} align="center" c="dimmed">暂无 ConfigMap</Table.Td></Table.Tr>}
            {p.cmPageRows.map((cm) => (
              <Table.Tr key={cm.name}>
                <Table.Td fw={600}>{cm.name}</Table.Td>
                <Table.Td>{cm.alias || "-"}</Table.Td>
                <Table.Td>{cm.dataSize}</Table.Td>
                <Table.Td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Tooltip label={cm.keys.join(", ")}><span>{cm.keys.join(", ")}</span></Tooltip>
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="subtle" color="blue" leftSection={<Copy size={12} />} onClick={() => void p.copyCmFrom(cm)}>
                    复制创建
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <div className="ks-list-pager">
        <Text size="sm" c="dimmed">
          共 {p.cms.length} 条
          {p.cms.length > 0
            ? ` · 第 ${(p.cmSafePage - 1) * p.cmPageSize + 1}-${Math.min(p.cmSafePage * p.cmPageSize, p.cms.length)} 条`
            : ""}
        </Text>
        <Group gap="sm" wrap="nowrap">
          <Select
            size="xs"
            w={100}
            data={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
            value={String(p.cmPageSize)}
            onChange={(v) => p.setCmPageSize(Number(v || 20))}
            allowDeselect={false}
          />
          <Pagination
            value={p.cmSafePage}
            onChange={p.setCmPage}
            total={p.cmTotalPages}
            size="sm"
            disabled={p.cms.length === 0}
          />
        </Group>
      </div>
    </Card>
  );
}
