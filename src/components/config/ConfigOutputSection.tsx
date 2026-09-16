import { open } from "@tauri-apps/plugin-dialog";
import { Button, Group, Paper, Stack, TextInput } from "@mantine/core";
import { Archive } from "lucide-react";
import type { HarborConfig } from "../../types";
import { isTauriRuntime } from "../../types";
import type { ConfigFieldChange } from "./types";
import { browseButtonProps, panelPaperProps } from "./configUi";

interface ConfigOutputSectionProps {
  config: HarborConfig;
  onConfigChange: ConfigFieldChange;
}

export function ConfigOutputSection({ config, onConfigChange }: ConfigOutputSectionProps) {
  return (
    <Paper {...panelPaperProps}>
      <Stack gap="md">
        <TextInput
          label={
            <Group gap={6}>
              <Archive size={14} />
              <span>打包产物目录</span>
            </Group>
          }
          value={config.artifact_output_dir}
          onChange={(e) => onConfigChange("artifact_output_dir", e.currentTarget.value)}
          placeholder="默认: 桌面"
          description="打包产物将自动复制到此目录，留空则不复制"
          rightSectionWidth={90}
          rightSection={
            <Button
              {...browseButtonProps}
              onClick={async () => {
                if (!isTauriRuntime()) {
                  return;
                }
                try {
                  const selected = await open({
                    multiple: false,
                    directory: true,
                    recursive: false,
                    title: "选择打包产物输出目录",
                  });
                  if (selected) {
                    onConfigChange("artifact_output_dir", selected as string);
                  }
                } catch (e) {
                  console.error("选择目录失败:", e);
                }
              }}
            >
              选择
            </Button>
          }
        />
      </Stack>
    </Paper>
  );
}
