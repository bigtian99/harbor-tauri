import { Paper, Stack, Textarea, TextInput } from "@mantine/core";
import type { HarborConfig } from "../../types";
import type { ConfigFieldChange } from "./types";
import { panelPaperProps } from "./configUi";

interface ConfigFrontendSectionProps {
  config: HarborConfig;
  onConfigChange: ConfigFieldChange;
}

export function ConfigFrontendSection({ config, onConfigChange }: ConfigFrontendSectionProps) {
  return (
    <Paper {...panelPaperProps}>
      <Stack gap="md">
        <TextInput
          label="前端基础镜像"
          value={config.frontend_base_image}
          onChange={(e) => onConfigChange("frontend_base_image", e.currentTarget.value)}
          placeholder="例如: nginx:alpine"
        />
        <TextInput
          label="前端暴露端口"
          value={config.frontend_expose_port}
          onChange={(e) => onConfigChange("frontend_expose_port", e.currentTarget.value)}
          placeholder="例如: 80"
        />
        <Textarea
          label="前端 Dockerfile 模板"
          value={config.frontend_dockerfile_template}
          onChange={(e) => onConfigChange("frontend_dockerfile_template", e.currentTarget.value)}
          spellCheck={false}
          autosize
          minRows={10}
          maxRows={24}
          resize="vertical"
          description={
            <>
              可用变量：{"{{BASE_IMAGE}}"}、{"{{EXPOSE_PORT}}"}、{"{{NGINX_CONF_PATH}}"}、{"{{DIST_DIR}}"}、
              {"{{IMAGE_NAME}}"}、{"{{IMAGE_TAG}}"}、{"{{FULL_IMAGE}}"}
            </>
          }
          styles={{
            input: { fontFamily: "var(--mantine-font-family-monospace)" },
          }}
        />
        <Textarea
          label="nginx.conf 模板"
          value={config.frontend_nginx_template}
          onChange={(e) => onConfigChange("frontend_nginx_template", e.currentTarget.value)}
          spellCheck={false}
          autosize
          minRows={14}
          maxRows={28}
          resize="vertical"
          styles={{
            input: { fontFamily: "var(--mantine-font-family-monospace)" },
          }}
        />
      </Stack>
    </Paper>
  );
}
