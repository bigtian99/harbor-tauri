import { Button, Group, Modal, Progress, Stack, Text, ThemeIcon } from "@mantine/core";
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import type { MergeOverlayPhase } from "./types";

interface MergeProgressOverlayProps {
  phase: MergeOverlayPhase;
  sourceBranch: string;
  targetBranch: string;
  progress: number;
  progressMessage: string;
  resultMessage: string;
  onClose: () => void;
}

const modalStyles = {
  content: {
    background: "var(--color-bg-surface)",
    border: "1px solid var(--color-border)",
  },
  header: { background: "var(--color-bg-surface)" },
  body: { padding: "28px 24px 24px" },
} as const;

export function MergeProgressOverlay({
  phase,
  sourceBranch,
  targetBranch,
  progress,
  progressMessage,
  resultMessage,
  onClose,
}: MergeProgressOverlayProps) {
  const isRunning = phase === "running";

  return (
    <Modal
      opened={phase !== "idle"}
      onClose={isRunning ? () => {} : onClose}
      withCloseButton={false}
      closeOnClickOutside={!isRunning}
      closeOnEscape={!isRunning}
      centered
      size="sm"
      padding="md"
      styles={modalStyles}
      title={null}
    >
      <Stack align="center" gap="sm" ta="center">
        {phase === "running" && (
          <>
            <ThemeIcon size={52} radius="xl" variant="light" color="cyan">
              <Loader2 size={28} className="spin" />
            </ThemeIcon>
            <Text fw={700} size="md" c="var(--color-text)">正在合并分支</Text>
            <Text size="xs" c="var(--color-text-muted)" ff="monospace">
              {sourceBranch} → {targetBranch}
            </Text>
            <Text size="sm" c="var(--color-text-muted)">
              {progressMessage || "处理中..."}
            </Text>
            <Progress
              value={Math.max(progress, 8)}
              color="cyan"
              size="sm"
              radius="xl"
              w="100%"
              mt="xs"
            />
            <Text size="sm" fw={700} c="var(--color-primary)">{progress}%</Text>
          </>
        )}
        {phase === "success" && (
          <>
            <ThemeIcon size={52} radius="xl" variant="light" color="teal">
              <CheckCircle size={28} />
            </ThemeIcon>
            <Text fw={700} size="md" c="var(--color-text)">合并成功</Text>
            <Text size="sm" c="var(--color-text-muted)" maw={340}>
              {resultMessage}
            </Text>
            <Button variant="filled" color="teal" onClick={onClose} mt="xs">完成</Button>
          </>
        )}
        {phase === "error" && (
          <>
            <ThemeIcon size={52} radius="xl" variant="light" color="red">
              <AlertTriangle size={28} />
            </ThemeIcon>
            <Text fw={700} size="md" c="var(--color-text)">合并失败</Text>
            <Text size="sm" c="var(--color-text-muted)" maw={340}>
              {resultMessage}
            </Text>
            <Group justify="center" mt="xs">
              <Button color="cyan" variant="light" onClick={onClose}>关闭</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
