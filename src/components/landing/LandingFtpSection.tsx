import { Group, Text, Progress, Paper } from "@mantine/core";

interface LandingFtpSectionProps {
  isUploadingToFtp: boolean;
  progress: number;
  progressMessage: string;
}

export function LandingFtpSection({
  isUploadingToFtp,
  progress,
  progressMessage,
}: LandingFtpSectionProps) {
  if (!isUploadingToFtp) return null;

  return (
    <Paper p="sm" radius="md">
      <Group justify="space-between" mb={4}>
        <Text size="sm" c="var(--color-text)">
          {progressMessage}
        </Text>
        <Text size="sm" fw={600} c="var(--color-text)">
          {progress}%
        </Text>
      </Group>
      <Progress value={progress} />
    </Paper>
  );
}
