import { useEffect, useRef } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  CheckCircle2,
  Rocket,
  SkipForward,
  Terminal,
  XCircle,
} from "lucide-react";
import type { KsBatchMeta, KsBatchSummary } from "./ksBatchTypes";

interface KsBatchProgressModalProps {
  opened: boolean;
  meta: KsBatchMeta | null;
  running: boolean;
  progress: number;
  message: string;
  log: string;
  summary: KsBatchSummary | null;
  onClose: () => void;
  onCancelBuild: () => void;
  /** 默认「批量打包并发布」 */
  title?: string;
  /** 副标题行：分支 · 命名空间 · N 个部署；传 null 隐藏 */
  metaLine?: string | null;
  /** 运行中是否显示「取消构建」；默认 true */
  showCancel?: boolean;
}

export function KsBatchProgressModal({
  opened,
  meta,
  running,
  progress,
  message,
  log,
  summary,
  onClose,
  onCancelBuild,
  title = "批量打包并发布",
  metaLine,
  showCancel = true,
}: KsBatchProgressModalProps) {
  const logViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logViewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  const statusColor = running
    ? "cyan"
    : summary && summary.failed > 0
      ? "orange"
      : "teal";

  const statusLabel = running
    ? "执行中"
    : summary && summary.failed > 0
      ? "已完成（有失败）"
      : "已完成";

  return (
    <Modal
      opened={opened}
      onClose={() => { if (!running) onClose(); }}
      centered
      size="lg"
      padding={0}
      radius="md"
      withCloseButton={!running}
      closeOnClickOutside={!running}
      closeOnEscape={!running}
      overlayProps={{ backgroundOpacity: 0.55 }}
      lockScroll={false}
      transitionProps={{ duration: 120 }}
      classNames={{ content: "ks-batch-progress-modal", body: "ks-batch-progress-body" }}
      title={null}
    >
      <Box className="ks-batch-progress-shell">
        <Box className="ks-batch-progress-header">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={34} radius="md" variant="gradient" gradient={{ from: "blue", to: "cyan", deg: 135 }}>
                <Rocket size={16} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fw={700} size="md" lh={1.2}>
                  {title}
                </Text>
                <Group gap="xs">
                  <Badge variant="dot" color={statusColor} size="sm">
                    {statusLabel}
                  </Badge>
                  {(metaLine !== null) && (metaLine || meta) && (
                    <>
                      <Text size="xs" c="dimmed">
                        {metaLine
                          ?? `${meta?.branch ?? ""} · ${meta?.namespace ?? ""} · ${meta?.deployNames.length ?? 0} 个部署`}
                      </Text>
                    </>
                  )}
                </Group>
              </Stack>
            </Group>

            {!running && summary && (
              <Group gap="xs">
                <Badge
                  leftSection={<CheckCircle2 size={12} />}
                  variant="light"
                  color="blue"
                  size="lg"
                  radius="sm"
                >
                  成功 {summary.success}
                </Badge>
                {summary.failed > 0 && (
                  <Badge
                    leftSection={<XCircle size={12} />}
                    variant="light"
                    color="red"
                    size="lg"
                    radius="sm"
                  >
                    失败 {summary.failed}
                  </Badge>
                )}
                {summary.skipped > 0 && (
                  <Badge
                    leftSection={<SkipForward size={12} />}
                    variant="light"
                    color="yellow"
                    size="lg"
                    radius="sm"
                  >
                    跳过 {summary.skipped}
                  </Badge>
                )}
              </Group>
            )}
          </Group>

          <Stack gap={4} mt="sm">
            <Group justify="space-between" align="center" gap="sm">
              <Text size="xs" fw={500} className="ks-batch-progress-message" lineClamp={1}>
                {message || "等待开始…"}
              </Text>
              <Text size="xs" fw={700} c="cyan" className="ks-batch-progress-pct">
                {Math.round(progress)}%
              </Text>
            </Group>
            <Progress value={progress} />
          </Stack>
        </Box>

        <Box className="ks-batch-log-section">
          <Group gap={6} mb={6} className="ks-batch-log-title">
            <Terminal size={12} />
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              执行日志
            </Text>
          </Group>
          <ScrollArea
            className="ks-batch-log-scroll"
            viewportRef={logViewportRef}
            type="auto"
            offsetScrollbars
            mah={240}
          >
            <pre className="ks-batch-log-pre">
              {log || "（暂无日志，任务启动后将在此显示…）"}
            </pre>
          </ScrollArea>
        </Box>

        <Group justify="flex-end" gap="sm" className="ks-batch-progress-footer">
          {running && showCancel && (
            <Button
              size="sm"
              variant="light"
              color="red"
              onClick={onCancelBuild}
            >
              取消构建
            </Button>
          )}
          <Button
            size="sm"
            variant={running ? "default" : "filled"}
            color={running ? "gray" : "cyan"}
            disabled={running}
            onClick={onClose}
          >
            {running ? "执行中…" : "关闭"}
          </Button>
        </Group>
      </Box>
    </Modal>
  );
}
