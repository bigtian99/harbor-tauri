import { useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { showSystemAlert } from "../../systemAlert";
import type { HarborConfig, KsEnvironment } from "../../types";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { createKsEnvironment, resolveKsEnvironments } from "../../utils/ksEnvironments";
import { KsPublishMapEditor } from "../KsPublishMapEditor";
import type { ConfigFieldChange } from "./types";
import { panelPaperProps, sectionCardStyle } from "./configUi";

interface ConfigKsSectionProps {
  config: HarborConfig;
  onConfigChange: ConfigFieldChange;
  onSaveConfig: () => void;
  onRegisterFlush: (flush: (() => void) | null) => void;
}

export function ConfigKsSection({
  config,
  onConfigChange,
  onSaveConfig,
  onRegisterFlush,
}: ConfigKsSectionProps) {
  const { confirm } = useConfirmDialog();
  const [envEditor, setEnvEditor] = useState<{ mode: "add" | "edit"; draft: KsEnvironment } | null>(null);
  const [envEditorPassword, setEnvEditorPassword] = useState(false);

  const ksEnvs = resolveKsEnvironments(config);

  const setKsEnvs = (next: KsEnvironment[]) => {
    onConfigChange("ks_environments", next);
    if (next.length === 0) {
      onConfigChange("ks_console", "");
      onConfigChange("ks_username", "");
      onConfigChange("ks_password", "");
      onConfigChange("ks_last_env_id", "");
      return;
    }
    if (config.ks_last_env_id && !next.some((env) => env.id === config.ks_last_env_id)) {
      onConfigChange("ks_last_env_id", next[0].id);
    }
  };

  const openAddKsEnv = () => {
    setEnvEditorPassword(false);
    setEnvEditor({ mode: "add", draft: createKsEnvironment(ksEnvs) });
  };

  const openEditKsEnv = (env: KsEnvironment) => {
    setEnvEditorPassword(false);
    setEnvEditor({ mode: "edit", draft: { ...env } });
  };

  const closeKsEnvEditor = () => {
    setEnvEditor(null);
    setEnvEditorPassword(false);
  };

  const saveKsEnvEditor = () => {
    if (!envEditor) return;
    const draft = {
      ...envEditor.draft,
      name: envEditor.draft.name.trim() || envEditor.draft.name,
      console: envEditor.draft.console.trim(),
      username: envEditor.draft.username.trim(),
      password: envEditor.draft.password ?? "",
    };
    if (!draft.name.trim() || !draft.console.trim() || !draft.username.trim() || !draft.password) {
      void showSystemAlert("无法保存环境", "请填写环境名、控制台地址、用户名和密码");
      return;
    }
    const nextEnvs =
      envEditor.mode === "add"
        ? [...ksEnvs, draft]
        : ksEnvs.map((env) => (env.id === draft.id ? draft : env));
    setKsEnvs(nextEnvs);
    closeKsEnvEditor();
    // 立刻落盘（configRef 已由 onConfigChange 同步更新，含密码）
    onSaveConfig();
  };

  const removeKsEnv = async (env: KsEnvironment) => {
    const ok = await confirm({
      title: "删除环境",
      message: `确定删除「${env.name || env.id}」？发布页将无法再选择该环境。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (ok) {
      setKsEnvs(ksEnvs.filter((item) => item.id !== env.id));
      onSaveConfig();
    }
  };

  return (
    <>
      <Stack gap="md">
        <Paper {...panelPaperProps}>
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Text size="sm" c="var(--color-text-muted)">
                配置多个 KubeSphere 环境，发布页按环境切换连接
              </Text>
              <Button
                size="xs"
                variant="default"
                leftSection={<Plus size={14} />}
                onClick={openAddKsEnv}
                style={{ flexShrink: 0 }}
              >
                添加环境
              </Button>
            </Group>
            {ksEnvs.length === 0 && (
              <Text size="sm" c="var(--color-text-muted)">
                还没有环境，点击「添加环境」开始配置
              </Text>
            )}
            {ksEnvs.length > 0 && (
              <Stack gap="sm">
                {ksEnvs.map((env) => (
                  <Paper
                    key={env.id}
                    p="sm"
                    radius="md"
                    withBorder
                    style={sectionCardStyle}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                        <Text size="sm" fw={600} c="var(--color-text)" truncate>
                          {env.name || env.id}
                        </Text>
                        <Text size="xs" c="var(--color-text-muted)" truncate>
                          {env.console || "未填地址"}
                        </Text>
                        <Text size="xs" c="var(--color-text-muted)" truncate>
                          {env.username || "未填用户"} · {env.password ? "已设密码" : "未设密码"}
                        </Text>
                      </Stack>
                      <Group gap={6} style={{ flexShrink: 0 }}>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          title="编辑"
                          onClick={() => openEditKsEnv(env)}
                        >
                          <Pencil size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          title="删除"
                          onClick={() => void removeKsEnv(env)}
                        >
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>
        </Paper>

        <Paper {...panelPaperProps}>
          <KsPublishMapEditor
            config={config}
            onMapsChange={(updater) =>
              onConfigChange("ks_publish_maps", (prev) => {
                const current = (Array.isArray(prev) ? prev : []) as NonNullable<
                  HarborConfig["ks_publish_maps"]
                >;
                return typeof updater === "function" ? updater(current) : updater;
              })}
            onRegisterFlush={(flush) => {
              onRegisterFlush(flush);
            }}
          />
        </Paper>
      </Stack>

      <Modal
        opened={!!envEditor}
        onClose={closeKsEnvEditor}
        title={envEditor?.mode === "add" ? "添加环境" : "编辑环境"}
        size="sm"
        styles={{
          content: { background: "var(--color-bg-surface)" },
          header: { background: "var(--color-bg-surface)" },
          title: { color: "var(--color-text)", fontWeight: 600 },
        }}
      >
        {envEditor && (
          <Stack gap="md">
            <TextInput
              label="环境名"
              value={envEditor.draft.name}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, name: e.currentTarget.value },
              })}
              placeholder="dev / test / prod"
            />
            <TextInput
              label="控制台地址"
              value={envEditor.draft.console}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, console: e.currentTarget.value },
              })}
              placeholder="例如: http://kubesphere:30880"
            />
            <TextInput
              label="用户名"
              value={envEditor.draft.username}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, username: e.currentTarget.value },
              })}
              placeholder="KubeSphere 登录用户名"
            />
            <PasswordInput
              label="密码"
              value={envEditor.draft.password}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, password: e.currentTarget.value },
              })}
              placeholder="KubeSphere 登录密码"
              visible={envEditorPassword}
              onVisibilityChange={(visible) => setEnvEditorPassword(visible)}
            />
            <Group justify="flex-end" gap="sm" mt="xs">
              <Button variant="default" onClick={closeKsEnvEditor}>
                取消
              </Button>
              <Button
                variant="filled"
                color="blue"
                disabled={
                  !envEditor.draft.name.trim()
                  || !envEditor.draft.console.trim()
                  || !envEditor.draft.username.trim()
                  || !envEditor.draft.password
                }
                onClick={saveKsEnvEditor}
              >
                {envEditor.mode === "add" ? "添加" : "保存"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
