import {
  Button,
  Checkbox,
  Group,
  Pagination,
  Paper,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { Loader2, RefreshCw, Search, Upload, XCircle } from "lucide-react";
import {
  BT_AUTO_REFRESH_OPTIONS,
  BT_PAGE_SIZE_OPTIONS,
  btRowKey,
  type BtListRow,
} from "../../hooks/useBtListPanel";

export function BtPanelAutoRefreshControls(props: {
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  refreshSec: string;
  setRefreshSec: (v: string) => void;
  loading: boolean;
  busyKey: string | null;
  onRefresh: () => void;
}) {
  const {
    autoRefresh,
    setAutoRefresh,
    refreshSec,
    setRefreshSec,
    loading,
    busyKey,
    onRefresh,
  } = props;

  return (
    <Group gap="sm" align="center">
      <Checkbox
        label="自动刷新"
        checked={autoRefresh}
        onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
        size="xs"
      />
      {autoRefresh && (
        <Select
          data={BT_AUTO_REFRESH_OPTIONS.map((v) => ({ value: v, label: `${v}s` }))}
          value={refreshSec}
          onChange={(v) => v && setRefreshSec(v)}
          size="xs"
          w={72}
        />
      )}
      <Button
        leftSection={loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        onClick={onRefresh}
        disabled={loading || busyKey !== null}
        variant="filled"
        color="blue"
      >
        刷新
      </Button>
    </Group>
  );
}

export function BtPanelDropBanner(props: {
  active: boolean;
  dragOverKey: string | null;
  rows: BtListRow[];
  alignedSuffix?: string;
  missHint: string;
}) {
  const { active, dragOverKey, rows, alignedSuffix = "项目", missHint } = props;
  if (!active) return null;
  const name = dragOverKey
    ? (rows.find((r) => btRowKey(r) === dragOverKey)?.name ?? alignedSuffix)
    : null;
  return (
    <div className="bt-panel-drop-banner">
      <Upload size={16} />
      {name
        ? `对准了「${name}」— 松开鼠标即可上传`
        : missHint}
    </div>
  );
}

export function BtPanelProgressCard(props: {
  busyKey: string | null;
  barPercent: number;
  displayPercent: number;
  progressMessage: string;
  fallbackMessage: string;
  showCancel: boolean;
  onCancel: () => void;
}) {
  const {
    busyKey,
    barPercent,
    displayPercent,
    progressMessage,
    fallbackMessage,
    showCancel,
    onCancel,
  } = props;

  return (
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
          className="bt-panel-progress-track"
          role="progressbar"
          aria-valuenow={barPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ flex: 1, minWidth: 0 }}
        >
          <div
            className={`bt-panel-progress-bar${busyKey !== null ? " bt-panel-progress-bar--active" : ""}`}
            style={{ width: `${Math.max(0, Math.min(100, barPercent))}%` }}
          />
        </div>
        {showCancel && (
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<XCircle size={14} />}
            onClick={onCancel}
            style={{ flexShrink: 0 }}
          >
            取消
          </Button>
        )}
      </Group>
      <Text size="xs" c="dimmed" mt={8} style={{ wordBreak: "break-all" }}>
        {progressMessage || fallbackMessage}
      </Text>
    </Paper>
  );
}

export function BtPanelSearchInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      type="search"
      placeholder={props.placeholder}
      leftSection={<Search size={14} />}
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      styles={{ input: { textTransform: "none" } }}
    />
  );
}

export function BtPanelPaginationBar(props: {
  filteredLength: number;
  totalLength: number;
  searchActive: boolean;
  safePage: number;
  pageSize: number;
  totalPages: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}) {
  const {
    filteredLength,
    totalLength,
    searchActive,
    safePage,
    pageSize,
    totalPages,
    setPage,
    setPageSize,
  } = props;

  return (
    <Group justify="space-between" align="center">
      <Text size="sm" c="dimmed">
        共 {filteredLength} 条
        {searchActive ? `（筛选自 ${totalLength}）` : ""}
        {filteredLength > 0
          ? ` · 第 ${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filteredLength)} 条`
          : ""}
      </Text>
      <Group gap="sm">
        <Select
          size="xs"
          w={100}
          data={BT_PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
          value={String(pageSize)}
          onChange={(v) => setPageSize(Number(v || 20))}
          allowDeselect={false}
        />
        <Pagination
          value={safePage}
          onChange={setPage}
          total={totalPages}
          size="sm"
          disabled={filteredLength === 0}
        />
      </Group>
    </Group>
  );
}
