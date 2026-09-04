import { memo } from "react";
import { Table, Badge, ActionIcon, Checkbox, Group, Text, Tooltip } from "@mantine/core";
import { Pencil } from "lucide-react";
import type { DeployInfo } from "./types";
import { STATUS_DOT, STATUS_COLOR } from "./types";

export const DeployRow = memo(function DeployRow({
  d,
  selected,
  checked,
  onSelect,
  onToggleCheck,
  onEdit,
}: {
  d: DeployInfo;
  selected: boolean;
  checked: boolean;
  onSelect: (d: DeployInfo) => void;
  onToggleCheck: (name: string, checked: boolean) => void;
  onEdit: (d: DeployInfo) => void;
}) {
  const s = d.status;
  return (
    <Table.Tr
      className={selected ? "ks-row-sel" : checked ? "ks-row-checked" : undefined}
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(d)}
    >
      <Table.Td onClick={(e) => e.stopPropagation()}>
        <Checkbox
          aria-label={`选择 ${d.name}`}
          checked={checked}
          onChange={(e) => onToggleCheck(d.name, e.currentTarget.checked)}
        />
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[s.state] ?? "var(--color-text-muted)", display: "inline-block" }} />
          <Badge color={STATUS_COLOR[s.state] ?? "gray"} variant="light" size="xs">{s.label}</Badge>
        </Group>
      </Table.Td>
      <Table.Td fw={700}>{d.name}</Table.Td>
      <Table.Td>{d.alias?.trim() || "-"}</Table.Td>
      <Table.Td>{d.containers.join(", ") || "-"}</Table.Td>
      <Table.Td style={{ fontFamily: "monospace", fontSize: 12 }}>
        {(d.ports ?? []).length ? d.ports.join(", ") : "-"}
      </Table.Td>
      <Table.Td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.image}>
        {d.image || "-"}
      </Table.Td>
      <Table.Td>{s.detail.split(" · ")[0]}{s.old && <Text span size="xs" c="dimmed">{s.old}</Text>}</Table.Td>
      <Table.Td>{d.revision}</Table.Td>
      <Table.Td onClick={(e) => e.stopPropagation()}>
        <Tooltip label="修改镜像" withArrow openDelay={300}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`修改 ${d.name}`}
            onClick={() => onEdit(d)}
          >
            <Pencil size={14} />
          </ActionIcon>
        </Tooltip>
      </Table.Td>
    </Table.Tr>
  );
});
