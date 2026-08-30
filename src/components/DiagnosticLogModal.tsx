import { useMemo } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Download, FolderOpen, ScrollText, Search, X, CalendarDays } from "lucide-react";

export interface DiagnosticLogModalProps {
  opened: boolean;
  logContent: string;
  logSearch: string;
  logDay: string | null;
  logDates: { date: string; size: number; lines: number }[];
  onClose: () => void;
  onSearchChange: (q: string) => void;
  onSelectDay: (day: string | null) => void;
  onRevealFile: () => void;
  onDownload: () => void;
}

const LAST_3_DAYS_VALUE = "__last3__";

const modalStyles = {
  content: {
    background: "var(--color-bg-base)",
    border: "1px solid var(--color-border)",
  },
  header: {
    background: "var(--color-bg-base)",
    borderBottom: "1px solid var(--color-border)",
  },
  body: {
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
} as const;

function highlightLogContent(raw: string, search: string): string {
  const content = raw || "（无日志内容）";
  if (!search.trim()) return content;

  const lines = content.split("\n");
  const q = search.toLowerCase();
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return lines
    .map((line) => {
      const lower = line.toLowerCase();
      if (!lower.includes(q)) return null;
      const parts = line.split(new RegExp(`(${escaped})`, "gi"));
      return parts
        .map((p) =>
          p.toLowerCase() === q
            ? `<mark style="background:rgba(94,234,212,0.35);color:var(--color-primary-hover);border-radius:2px;padding:0 1px">${p}</mark>`
            : p,
        )
        .join("");
    })
    .filter(Boolean)
    .join("\n");
}

export function DiagnosticLogModal({
  opened,
  logContent,
  logSearch,
  logDay,
  logDates,
  onClose,
  onSearchChange,
  onSelectDay,
  onRevealFile,
  onDownload,
}: DiagnosticLogModalProps) {
  const dayOptions = useMemo(() => {
    const options = [
      { value: LAST_3_DAYS_VALUE, label: "最近 3 天 · 合并视图 · 新日志在前" },
      ...logDates.map((d) => ({
        value: d.date,
        label: `${d.date} · ${d.lines} 行 · ${(d.size / 1024).toFixed(1)} KB`,
      })),
    ];
    return options;
  }, [logDates]);

  const highlightedHtml = useMemo(
    () => highlightLogContent(logContent, logSearch),
    [logContent, logSearch],
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      centered
      padding={0}
      styles={modalStyles}
      title={
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <ScrollText size={18} style={{ color: "var(--color-primary-hover)" }} />
          <Text fw={600} size="sm" c="var(--color-text)">
            系统诊断日志
          </Text>
        </Group>
      }
    >
      <Stack gap={0} style={{ height: "min(70vh, 640px)" }}>
        <Group
          gap="sm"
          p="md"
          wrap="wrap"
          style={{ borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}
        >
          <Select
            aria-label="切换日志日期"
            data={dayOptions}
            value={logDay ?? LAST_3_DAYS_VALUE}
            onChange={(value) =>
              onSelectDay(value === LAST_3_DAYS_VALUE || value == null ? null : value)
            }
            leftSection={<CalendarDays size={14} />}
            w={220}
            comboboxProps={{ withinPortal: true }}
            styles={{
              input: {
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              },
            }}
          />
          <TextInput
            flex={1}
            miw={180}
            placeholder="搜索日志..."
            value={logSearch}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            leftSection={<Search size={14} />}
            rightSection={
              logSearch ? (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label="清除搜索"
                  onClick={() => onSearchChange("")}
                >
                  <X size={12} />
                </ActionIcon>
              ) : null
            }
            styles={{
              input: {
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              },
            }}
          />
          <Button
            variant="default"
            size="sm"
            leftSection={<FolderOpen size={16} />}
            onClick={onRevealFile}
            styles={{
              root: {
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              },
            }}
          >
            目录
          </Button>
          <Button
            variant="default"
            size="sm"
            leftSection={<Download size={16} />}
            onClick={onDownload}
            styles={{
              root: {
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              },
            }}
          >
            下载
          </Button>
        </Group>

        <ScrollArea flex={1} type="auto" offsetScrollbars>
          <pre
            style={{
              margin: 0,
              padding: "16px 20px",
              background: "var(--color-bg-base)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--mantine-font-family-monospace)",
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
