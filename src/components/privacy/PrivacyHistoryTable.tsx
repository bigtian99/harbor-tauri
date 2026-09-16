import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { Copy, Loader2, Trash2 } from "lucide-react";
import type { PrivacyUploadRecord } from "./types";

export interface PrivacyHistoryTableProps {
  history: PrivacyUploadRecord[];
  selectedIds: Set<string>;
  isLoadingHistory: boolean;
  allSelected: boolean;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
  onOpenUrl: (url: string) => void;
  onCopyUrl: (url: string) => void;
}

export function PrivacyHistoryTable({
  history,
  selectedIds,
  isLoadingHistory,
  allSelected,
  onToggleOne,
  onToggleAll,
  onDeleteSelected,
  onClear,
  onOpenUrl,
  onCopyUrl,
}: PrivacyHistoryTableProps) {
  return (
    <Paper
      p="md"
      radius="md"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border-strong)",
      }}
    >
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600} c="var(--color-text)">
            上传记录
          </Text>
          {isLoadingHistory && <Loader2 size={14} className="spin" />}
          <Badge variant="light" color="blue" size="sm">
            {history.length}
          </Badge>
        </Group>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<Trash2 size={14} />}
            disabled={selectedIds.size === 0}
            onClick={onDeleteSelected}
            className="privacy-btn-danger"
          >
            删除所选
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={onClear}
            disabled={history.length === 0}
            className="privacy-btn-secondary"
          >
            清空
          </Button>
        </Group>
      </Group>

      {history.length === 0 ? (
        <Text c="var(--color-text-muted)" size="sm" ta="center" py="md">
          暂无上传记录
        </Text>
      ) : (
        <Table striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 40 }}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedIds.size > 0 && !allSelected}
                  onChange={onToggleAll}
                />
              </Table.Th>
              <Table.Th>时间</Table.Th>
              <Table.Th>文件名</Table.Th>
              <Table.Th>访问地址</Table.Th>
              <Table.Th style={{ width: 64 }}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Checkbox checked={selectedIds.has(r.id)} onChange={() => onToggleOne(r.id)} />
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="var(--color-text-muted)">
                    {r.uploaded_at}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="var(--color-text)">
                    {r.source_name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Anchor
                    size="sm"
                    c="var(--color-primary-hover)"
                    style={{ wordBreak: "break-all" }}
                    onClick={() => onOpenUrl(r.url)}
                  >
                    {r.url}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Tooltip label="复制">
                    <ActionIcon variant="subtle" color="gray" onClick={() => onCopyUrl(r.url)}>
                      <Copy size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}
