import { useEffect, useRef } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  CheckCircle2,
  GitBranch,
  Layers3,
  Package,
  Rocket,
  Server,
  SkipForward,
  Terminal,
  XCircle,
} from "lucide-react";

export interface KsBatchMeta {
  branch: string;
  namespace: string;
  envName: string;
  deployNames: string[];
}

export interface KsBatchSummary {
  success: number;
  failed: number;
  skipped: number;
}

interface KsBatchConfirmModalProps {
  opened: boolean;
  meta: KsBatchMeta | null;
  /** 0 = 自动 */
  concurrencyPref: number;
  recommendedConcurrency: number;
  cpuCores: number;
  onConcurrencyPrefChange: (n: number) => void;
  onClose: () => void;
  onStart: () => void;
}

export function KsBatchConfirmModal({
  opened,
  meta,
  concurrencyPref,
  recommendedConcurrency,
  cpuCores,
  onConcurrencyPrefChange,
  onClose,
  onStart,
}: KsBatchConfirmModalProps) {
  const count = meta?.deployNames.length ?? 0;
  const effective =
    concurrencyPref > 0
      ? Math.min(concurrencyPref, Math.max(1, count))
      : recommendedConcurrency;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      padding="lg"
      radius="md"
      overlayProps={{ backgroundOpacity: 0.55 }}
      lockScroll={false}
      transitionProps={{ duration: 120 }}
      title={(
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon size={36} radius="md" variant="light" color="cyan">
            <Package size={18} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text fw={700} size="lg" lh={1.2}>
              批量打包并发布
            </Text>
            <Text size="xs" c="dimmed">
              并行打包 → 推送 Harbor → 更新 K8s 部署镜像
            </Text>
          </Stack>
        </Group>
      )}
      classNames={{ content: "ks-batch-confirm-modal" }}
    >
      <Stack gap="md">
        <Paper withBorder radius="md" p="md" className="ks-batch-meta-panel">
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
            <Stack gap={4}>
              <Group gap={6}>
                <GitBranch size={14} className="ks-batch-meta-icon" />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  目标分支
                </Text>
              </Group>
              <Text size="sm" fw={600} className="ks-batch-meta-value">
                {meta?.branch ?? "—"}
              </Text>
            </Stack>
            <Stack gap={4}>
              <Group gap={6}>
                <Layers3 size={14} className="ks-batch-meta-icon" />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  命名空间
                </Text>
              </Group>
              <Text size="sm" fw={600} className="ks-batch-meta-value">
                {meta?.namespace ?? "—"}
              </Text>
            </Stack>
            <Stack gap={4}>
              <Group gap={6}>
                <Server size={14} className="ks-batch-meta-icon" />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  环境
                </Text>
              </Group>
              <Text size="sm" fw={600} className="ks-batch-meta-value">
                {meta?.envName ?? "—"}
              </Text>
            </Stack>
          </SimpleGrid>
        </Paper>

        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>
              待发布部署
            </Text>
            <Badge variant="light" color="cyan" size="sm">
              {count} 项
            </Badge>
          </Group>
          <ScrollArea mah={180} type="auto" offsetScrollbars className="ks-batch-deploy-scroll">
            <Group gap={8}>
              {(meta?.deployNames ?? []).map((name) => (
                <Badge
                  key={name}
                  variant="outline"
                  color="gray"
                  size="md"
                  radius="sm"
                  className="ks-batch-deploy-chip"
                >
                  {name}
                </Badge>
              ))}
            </Group>
          </ScrollArea>
        </Stack>

        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Stack gap={2}>
            <Text size="sm" fw={600}>
              并行数
            </Text>
            <Text size="xs" c="dimmed">
              自动按 CPU≈{cpuCores} 核、选中 {count} 项估算 → {recommendedConcurrency}
              （同仓库仍串行）
            </Text>
          </Stack>
          <SegmentedControl
            size="xs"
            value={String(concurrencyPref)}
            onChange={(v) => onConcurrencyPrefChange(Number(v))}
            data={[
              { label: `自动(${recommendedConcurrency})`, value: "0" },
              { label: "1", value: "1" },
              { label: "2", value: "2" },
              { label: "3", value: "3" },
              { label: "4", value: "4" },
            ]}
          />
        </Group>

        <Text size="xs" c="dimmed" lh={1.55}>
          本次将按并发 {effective} 执行；日志可能交错显示。
        </Text>

        <Group justify="flex-end" gap="sm" mt={4}>
          <Button variant="default" onClick={onClose}>
            取消
          </Button>
          <Button
            leftSection={<Rocket size={16} />}
            color="cyan"
            onClick={onStart}
            disabled={count === 0}
          >
            开始执行 ({count})
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

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
              <ThemeIcon size={34} radius="md" variant="gradient" gradient={{ from: "cyan", to: "teal", deg: 135 }}>
                <Rocket size={16} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fw={700} size="md" lh={1.2}>
                  批量打包并发布
                </Text>
                <Group gap="xs">
                  <Badge variant="dot" color={statusColor} size="sm">
                    {statusLabel}
                  </Badge>
                  {meta && (
                    <>
                      <Text size="xs" c="dimmed">
                        {meta.branch}
                      </Text>
                      <Text size="xs" c="dimmed">
                        ·
                      </Text>
                      <Text size="xs" c="dimmed">
                        {meta.namespace}
                      </Text>
                      <Text size="xs" c="dimmed">
                        ·
                      </Text>
                      <Text size="xs" c="dimmed">
                        {meta.deployNames.length} 个部署
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
                  color="teal"
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
                    color="gray"
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
            <Progress
              value={progress}
              size="sm"
              radius="xl"
              color="cyan"
              animated={running && progress < 100}
              striped={running && progress < 100}
              className="ks-batch-progress-bar-mantine"
            />
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
          {running && (
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
