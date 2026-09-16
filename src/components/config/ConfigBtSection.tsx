import { useState } from "react";
import {
  Button,
  Checkbox,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import type { HarborConfig } from "../../types";
import {
  fetchBtTempLogin,
  loadBtTempLoginOpenPref,
  saveBtTempLoginOpenPref,
} from "../../utils/btTempLogin";
import type { ConfigFieldChange } from "./types";
import { panelPaperProps } from "./configUi";

interface ConfigBtSectionProps {
  config: HarborConfig;
  showPassword: boolean;
  onConfigChange: ConfigFieldChange;
  onTogglePassword: () => void;
}

export function ConfigBtSection({
  config,
  showPassword,
  onConfigChange,
  onTogglePassword,
}: ConfigBtSectionProps) {
  const [tempLoginLoading, setTempLoginLoading] = useState(false);
  const [tempLoginOpenInBrowser, setTempLoginOpenInBrowser] = useState(
    () => loadBtTempLoginOpenPref(),
  );

  return (
    <Paper {...panelPaperProps}>
      <Stack gap="md">
        <TextInput
          label="面板地址"
          value={config.bt_panel_url ?? ""}
          onChange={(e) => onConfigChange("bt_panel_url", e.currentTarget.value)}
          placeholder="https://面板地址:端口"
        />
        <PasswordInput
          label="面板 API 密钥"
          value={config.bt_panel_secret ?? ""}
          onChange={(e) => onConfigChange("bt_panel_secret", e.currentTarget.value)}
          placeholder="面板设置 → API 接口密钥"
          visible={showPassword}
          onVisibilityChange={() => onTogglePassword()}
        />
        <Stack gap="xs">
          <Text size="sm" fw={500} c="var(--color-text)">
            宝塔自动部署
          </Text>
          <Text size="sm" c="var(--color-text-muted)">
            匹配下方 Profile 时：Maven 打包 FTP 覆盖 JAR 并重启；npm 在对应 Profile 或 build:{"{profile}"} 时上传 dist
          </Text>
          <Checkbox
            label="启用打包后自动部署"
            checked={config.bt_auto_deploy_test !== false}
            onChange={(e) => onConfigChange("bt_auto_deploy_test", e.currentTarget.checked)}
            color="cyan"
          />
          <TextInput
            id="bt-auto-deploy-profile"
            label="自动部署 Profile"
            value={config.bt_auto_deploy_profile ?? "test"}
            placeholder="test"
            disabled={config.bt_auto_deploy_test === false}
            onChange={(e) => onConfigChange("bt_auto_deploy_profile", e.currentTarget.value.trim())}
          />
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={500} c="var(--color-text)">
            临时登录
          </Text>
          <Group gap="md" wrap="wrap">
            <Button
              size="sm"
              variant="default"
              disabled={
                tempLoginLoading
                || !(config.bt_panel_url ?? "").trim()
                || !(config.bt_panel_secret ?? "").trim()
              }
              leftSection={
                tempLoginLoading
                  ? <Loader2 size={14} className="spin" />
                  : tempLoginOpenInBrowser
                    ? <ExternalLink size={14} />
                    : <Copy size={14} />
              }
              onClick={() => {
                setTempLoginLoading(true);
                void fetchBtTempLogin(tempLoginOpenInBrowser ? "open" : "copy")
                  .finally(() => setTempLoginLoading(false));
              }}
              title={
                tempLoginOpenInBrowser
                  ? "生成临时登录链接并在浏览器打开（约 10 分钟有效）"
                  : "生成临时登录链接并复制到剪贴板（约 10 分钟有效）"
              }
            >
              {tempLoginOpenInBrowser ? "打开临时登录" : "复制临时登录"}
            </Button>
            <Checkbox
              label="默认打开"
              checked={tempLoginOpenInBrowser}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                setTempLoginOpenInBrowser(on);
                saveBtTempLoginOpenPref(on);
              }}
              color="cyan"
            />
          </Group>
          <Text size="sm" c="var(--color-text-muted)">
            勾选「默认打开」则在浏览器打开；取消勾选则复制链接到剪贴板。约 10 分钟有效，用后失效。请先保存配置再点。
          </Text>
        </Stack>
        <TextInput
          label="前端 dist 上传目录"
          value={config.bt_frontend_remote_dir ?? ""}
          onChange={(e) => onConfigChange("bt_frontend_remote_dir", e.currentTarget.value)}
          placeholder="/www/wwwroot/example.com"
          description="上传 dist 内文件（不套一层 dist 目录）"
        />
        <Checkbox
          label="跳过面板 TLS 证书校验（自签证书）"
          checked={config.bt_panel_insecure !== false}
          onChange={(e) => onConfigChange("bt_panel_insecure", e.currentTarget.checked)}
          color="cyan"
        />
        <TextInput
          label="FTP 主机"
          value={config.bt_ftp_host ?? ""}
          onChange={(e) => onConfigChange("bt_ftp_host", e.currentTarget.value)}
          placeholder="FTP 主机"
        />
        <TextInput
          label="FTP 用户"
          value={config.bt_ftp_user ?? ""}
          onChange={(e) => onConfigChange("bt_ftp_user", e.currentTarget.value)}
          placeholder="admin"
        />
        <PasswordInput
          label="FTP 密码"
          value={config.bt_ftp_pass ?? ""}
          onChange={(e) => onConfigChange("bt_ftp_pass", e.currentTarget.value)}
          placeholder="FTP 密码"
          visible={showPassword}
          onVisibilityChange={() => onTogglePassword()}
        />
        <Textarea
          label="JAR → 项目 ID 映射"
          value={Object.entries(config.bt_jar_project_ids ?? {})
            .map(([jar, id]) => `${jar}=${id}`)
            .join("\n")}
          onChange={(e) => {
            const map: Record<string, string> = {};
            for (const line of e.currentTarget.value.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("#")) continue;
              const eq = trimmed.indexOf("=");
              if (eq <= 0) continue;
              const jar = trimmed.slice(0, eq).trim();
              const id = trimmed.slice(eq + 1).trim();
              if (jar && id) map[jar] = id;
            }
            onConfigChange("bt_jar_project_ids", map);
          }}
          spellCheck={false}
          autosize
          minRows={4}
          maxRows={12}
          resize="vertical"
          placeholder={"tksy-backend-1.0.0.jar=19"}
          description={
            <>
              每行 <code>jar文件名=项目id</code>。同名 JAR 多项目时按此强制部署（如 tksy-backend → 19）
            </>
          }
          styles={{
            input: { fontFamily: "var(--mantine-font-family-monospace)" },
          }}
        />
      </Stack>
    </Paper>
  );
}
