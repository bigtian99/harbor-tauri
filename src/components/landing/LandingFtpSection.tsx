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
    <Paper p="sm" withBorder>
      <Group justify="space-between" mb={4}>
        <Text size="sm">{progressMessage}</Text>
        <Text size="sm" fw={600}>{progress}%</Text>
      </Group>
      <Progress value={progress} animated color="blue" size="sm" />
    </Paper>
  );
}
