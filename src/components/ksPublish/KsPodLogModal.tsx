import {
  ActionIcon, Box, Button, Checkbox, Divider, Group, Loader, Modal, ScrollArea, Select, Stack, Text, TextInput, Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ChevronDown, ChevronUp, Copy, Download, Maximize2, Minimize2, ScrollText, Search,
} from "lucide-react";
import {
  findNextLevelIndex,
  POD_LOG_LEVEL_LABEL,
  POD_LOG_LEVELS,
} from "../../utils/podLogLevels";
import { KsRefreshIcon } from "./KsRefreshIcon";
import type { KsPodLogsApi } from "./useKsPodLogs";

export function KsPodLogModal(p: KsPodLogsApi & { containers: string[] }) {
  const closePodLogs = () => {
    p.setPodLogOpen(false);
    p.setPodLogAutoRefresh(false);
    p.setPodLogFullscreen(false);
    p.setPodLogQuery("");
  };
  return (
    <Modal
      opened={p.podLogOpen}
      onClose={closePodLogs}
      centered={!p.podLogFullscreen}
      fullScreen={p.podLogFullscreen}
      size="xl"
      title={(
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ScrollText size={16} />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={700} size="sm">Pod 日志</Text>
            <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }} truncate>
              {p.podLogPod || "—"}
            </Text>
          </Stack>
        </Group>
      )}
      classNames={{
        content: p.podLogFullscreen ? "ks-pod-log-modal ks-pod-log-modal--full" : "ks-pod-log-modal",
        body: "ks-pod-log-body",
      }}
    >
      <Box className="ks-pod-log-toolbar-wrap">
        <Box className="ks-pod-log-controls">
          <Group gap={8} wrap="wrap" align="center" className="ks-pod-log-controls-row">
            <Text size="xs" c="dimmed" className="ks-pod-log-field-label">容器</Text>
            <Select
              size="xs"
              w={200}
              data={p.containers.map((c) => ({ value: c, label: c }))}
              value={p.podLogContainer}
              onChange={(v) => {
                p.setPodLogContainer(v);
                if (p.podLogPod) void p.loadPodLogs(p.podLogPod, v, p.podLogPrevious);
              }}
              allowDeselect={false}
              searchable
              aria-label="容器"
            />
            <Checkbox
              label="上一崩溃"
              size="xs"
              checked={p.podLogPrevious}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                p.setPodLogPrevious(on);
                if (p.podLogPod) void p.loadPodLogs(p.podLogPod, p.podLogContainer, on);
              }}
            />
            <Divider orientation="vertical" visibleFrom="sm" className="ks-pod-log-vdiv" />
            <Checkbox
              label="定时刷新"
              size="xs"
              checked={p.podLogAutoRefresh}
              onChange={(e) => p.setPodLogAutoRefresh(e.currentTarget.checked)}
            />
            <Select
              size="xs"
              w={84}
              data={[
                { value: "3", label: "3秒" },
                { value: "5", label: "5秒" },
                { value: "10", label: "10秒" },
                { value: "30", label: "30秒" },
              ]}
              value={p.podLogRefreshSec}
              onChange={(v) => p.setPodLogRefreshSec(v ?? "5")}
              disabled={!p.podLogAutoRefresh}
              allowDeselect={false}
              aria-label="刷新间隔"
            />
            <Group gap={6} wrap="nowrap" ml="auto">
              <Button
                size="xs"
                variant="default"
                leftSection={<KsRefreshIcon spinning={p.podLogLoading} />}
                disabled={p.podLogLoading}
                onClick={() => {
                  if (p.podLogPod) void p.loadPodLogs(p.podLogPod, p.podLogContainer, p.podLogPrevious);
                }}
              >
                刷新
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<Copy size={13} />}
                disabled={!p.podLogText}
                onClick={() => {
                  void navigator.clipboard.writeText(p.podLogText).then(() => {
                    notifications.show({ color: "blue", message: "日志已复制", autoClose: 2000 });
                  });
                }}
              >
                复制
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<Download size={13} />}
                disabled={!p.podLogText}
                onClick={() => void p.downloadPodLogs()}
              >
                下载
              </Button>
            </Group>
          </Group>
          <TextInput
            size="xs"
            placeholder="搜索日志内容…"
            leftSection={<Search size={13} />}
            value={p.podLogQuery}
            onChange={(e) => {
              p.setPodLogQuery(e.currentTarget.value);
              p.setPodLogActiveIdx(-1);
            }}
            rightSection={
              p.podLogQuery ? (
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="清除搜索"
                  onClick={() => {
                    p.setPodLogQuery("");
                    p.setPodLogActiveIdx(-1);
                  }}
                >
                  ×
                </ActionIcon>
              ) : null
            }
          />
          <Group gap={6} wrap="wrap" align="center" className="ks-pod-log-levels">
            {POD_LOG_LEVELS.map((lv) => {
              const n = p.podLogView.counts[lv];
              const active = p.podLogJumpLevel === lv;
              return (
                <Button
                  key={lv}
                  size="compact-xs"
                  variant={active ? "filled" : "light"}
                  color={
                    lv === "fatal" || lv === "error"
                      ? "red"
                      : lv === "warn"
                        ? "orange"
                        : lv === "info"
                          ? "cyan"
                          : lv === "debug"
                            ? "gray"
                            : "violet"
                  }
                  className={`ks-pod-log-level-chip ks-pod-log-level-chip--${lv}`}
                  disabled={n === 0}
                  onClick={() => {
                    p.setPodLogJumpLevel(lv);
                    const idx = findNextLevelIndex(p.podLogView.lines, lv, -1);
                    if (idx >= 0) {
                      p.podLogStickBottomRef.current = false;
                      p.setPodLogActiveIdx(idx);
                    }
                  }}
                >
                  {POD_LOG_LEVEL_LABEL[lv]} {n}
                </Button>
              );
            })}
            <Group gap={4} wrap="nowrap" ml={4} align="center" className="ks-pod-log-nav">
              <Tooltip label={`上一个 ${POD_LOG_LEVEL_LABEL[p.podLogJumpLevel]}`}>
                <ActionIcon
                  size="sm"
                  variant="default"
                  aria-label="上一个级别"
                  disabled={p.podLogJumpPos.total === 0}
                  onClick={() => p.jumpPodLogLevel("prev")}
                >
                  <ChevronUp size={14} />
                </ActionIcon>
              </Tooltip>
              <Text size="xs" className="ks-pod-log-nav-pos" title={POD_LOG_LEVEL_LABEL[p.podLogJumpLevel]}>
                {p.podLogJumpPos.total === 0
                  ? "0/0"
                  : `${p.podLogJumpPos.current > 0 ? p.podLogJumpPos.current : "—"}/${p.podLogJumpPos.total}`}
              </Text>
              <Tooltip label={`下一个 ${POD_LOG_LEVEL_LABEL[p.podLogJumpLevel]}`}>
                <ActionIcon
                  size="sm"
                  variant="default"
                  aria-label="下一个级别"
                  disabled={p.podLogJumpPos.total === 0}
                  onClick={() => p.jumpPodLogLevel("next")}
                >
                  <ChevronDown size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Box>

        <Box className="ks-pod-log-frame">
          <Tooltip label={p.podLogFullscreen ? "退出全屏" : "全屏"}>
            <ActionIcon
              className="ks-pod-log-fullscreen-btn"
              variant="filled"
              color="dark"
              size="sm"
              radius="sm"
              aria-label={p.podLogFullscreen ? "退出全屏" : "全屏"}
              onClick={() => p.setPodLogFullscreen((v) => !v)}
            >
              {p.podLogFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </ActionIcon>
          </Tooltip>
          <ScrollArea
            type="auto"
            offsetScrollbars={false}
            scrollbarSize={8}
            className="ks-pod-log-scroll"
            viewportRef={p.podLogViewportRef}
          >
            {p.podLogLoading && !p.podLogText ? (
              <Group gap={8} p="md">
                <Loader size={14} />
                <Text size="xs" c="dimmed">正在拉取日志…</Text>
              </Group>
            ) : p.podLogView.lines.length === 0 ? (
              <Text size="xs" c="dimmed" p="md">
                {p.podLogQuery.trim() ? "（无匹配行）" : "（暂无内容）"}
              </Text>
            ) : (
              <div className="ks-pod-log-lines">
                {p.podLogView.lines.map((line, i) => (
                  <div
                    key={`${line.index}-${i}`}
                    data-log-idx={i}
                    className={[
                      "ks-pod-log-line",
                      line.level ? `ks-pod-log-line--${line.level}` : "ks-pod-log-line--plain",
                      i === p.podLogActiveIdx ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (line.level) p.setPodLogJumpLevel(line.level);
                      p.podLogStickBottomRef.current = false;
                      p.setPodLogActiveIdx(i);
                    }}
                  >
                    {line.text || " "}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </Box>
        <Group justify="space-between" className="ks-pod-log-footer">
          <Text size="xs" c="dimmed">
            尾部约 500 行 · 共 {p.podLogView.total} 行
            {p.podLogQuery.trim()
              ? ` · 搜索命中 ${p.podLogView.matched}`
              : ""}
            {p.podLogView.counts[p.podLogJumpLevel] > 0
              ? ` · ${POD_LOG_LEVEL_LABEL[p.podLogJumpLevel]} ${p.podLogJumpPos.current > 0 ? `${p.podLogJumpPos.current}/` : ""}${p.podLogView.counts[p.podLogJumpLevel]}`
              : ""}
            {p.podLogAutoRefresh ? ` · 每 ${p.podLogRefreshSec}s 自动刷新` : " · 已关闭定时刷新"}
          </Text>
          {p.podLogLoading && p.podLogText ? (
            <Text size="xs" c="dimmed">刷新中…</Text>
          ) : null}
        </Group>
      </Box>
    </Modal>
  );
}
