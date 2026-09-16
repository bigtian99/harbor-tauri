import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Group, Paper, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { Plug } from "lucide-react";
import type { HarborConfig } from "../../types";
import { isTauriRuntime } from "../../types";
import type { ConfigFieldChange } from "./types";
import { panelPaperProps } from "./configUi";

interface ConfigHarborSectionProps {
  config: HarborConfig;
  showPassword: boolean;
  onConfigChange: ConfigFieldChange;
  onTogglePassword: () => void;
}

export function ConfigHarborSection({
  config,
  showPassword,
  onConfigChange,
  onTogglePassword,
}: ConfigHarborSectionProps) {
  const [harborLoginTesting, setHarborLoginTesting] = useState(false);
  const [harborLoginMsg, setHarborLoginMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handleTestHarborLogin = async () => {
    if (!isTauriRuntime()) {
      setHarborLoginMsg({ type: "err", text: "请在桌面端测试登录" });
      return;
    }
    setHarborLoginTesting(true);
    setHarborLoginMsg(null);
    try {
      const msg = await invoke<string>("test_harbor_connection", {
        harborUrl: config.harbor_url,
        username: config.username,
        password: config.password,
      });
      setHarborLoginMsg({ type: "ok", text: msg });
    } catch (e) {
      setHarborLoginMsg({ type: "err", text: String(e) });
    } finally {
      setHarborLoginTesting(false);
    }
  };

  return (
    <>
      <Paper {...panelPaperProps}>
        <Stack gap="md">
          <TextInput
            label="Harbor 地址"
            value={config.harbor_url}
            onChange={(e) => onConfigChange("harbor_url", e.currentTarget.value)}
            placeholder="例如: harbor.example.com"
          />
          <TextInput
            label="用户名"
            value={config.username}
            onChange={(e) => onConfigChange("username", e.currentTarget.value)}
            placeholder="Harbor 登录用户名"
          />
          <PasswordInput
            label="密码"
            value={config.password}
            onChange={(e) => onConfigChange("password", e.currentTarget.value)}
            placeholder="Harbor 登录密码"
            visible={showPassword}
            onVisibilityChange={() => onTogglePassword()}
          />
          <Group justify="flex-end" align="center" gap="sm">
            {harborLoginMsg && (
              <Text
                size="sm"
                c={harborLoginMsg.type === "ok" ? "var(--color-success)" : "var(--color-error)"}
                style={{ flex: 1 }}
              >
                {harborLoginMsg.text}
              </Text>
            )}
            <Button
              variant="default"
              size="compact-sm"
              loading={harborLoginTesting}
              leftSection={<Plug size={14} />}
              onClick={() => { void handleTestHarborLogin(); }}
            >
              测试连接
            </Button>
          </Group>
          <TextInput
            label="Harbor 项目"
            value={config.project}
            onChange={(e) => onConfigChange("project", e.currentTarget.value)}
            placeholder="例如: my-project"
            description="推送时自动拼在镜像名前，最终地址为 harbor地址/项目名/镜像名:标签"
          />
        </Stack>
      </Paper>
      <Paper {...panelPaperProps} mt="md">
        <Stack gap="md">
          <Text size="sm" fw={600} c="var(--color-text)">
            落地页 / 隐私协议 FTP
          </Text>
          <Text size="xs" c="var(--color-text-muted)">
            账号密码不再写进程序。落地页上传与隐私协议共用用户/密码；隐私主机可单独填写。
          </Text>
          <TextInput
            label="落地页 FTP 主机"
            value={config.landing_ftp_host ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_host", e.currentTarget.value)}
            placeholder="FTP 主机 IP 或域名"
          />
          <TextInput
            label="落地页 FTP 用户"
            value={config.landing_ftp_user ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_user", e.currentTarget.value)}
            placeholder="FTP 用户名"
          />
          <PasswordInput
            label="落地页 FTP 密码"
            value={config.landing_ftp_pass ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_pass", e.currentTarget.value)}
            placeholder="FTP 密码"
            visible={showPassword}
            onVisibilityChange={() => onTogglePassword()}
          />
          <TextInput
            label="落地页站点根目录"
            value={config.landing_ftp_base_dir ?? ""}
            onChange={(e) => onConfigChange("landing_ftp_base_dir", e.currentTarget.value)}
            placeholder="例如: common.example.com（可留空）"
            description="上传后公开 URL 用此主机名拼 https://根目录/渠道/"
          />
          <TextInput
            label="隐私协议 FTP 主机"
            value={config.privacy_ftp_host ?? ""}
            onChange={(e) => onConfigChange("privacy_ftp_host", e.currentTarget.value)}
            placeholder="与落地页不同机时填写"
            description="用户/密码复用上方落地页 FTP 账号"
          />
        </Stack>
      </Paper>
    </>
  );
}
