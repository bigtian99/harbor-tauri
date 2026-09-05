import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { SearchableDropdown } from "../SearchableDropdown";
import type { HarborConfig } from "../../types";

interface QuickMergeConfigModalProps {
  config: HarborConfig;
  /** 写盘前取最新整表，避免闭包 config 覆盖其它字段 */
  getConfigSnapshot?: () => HarborConfig;
  branchNames: string[];
  initialSource: string;
  initialTarget: string;
  onClose: () => void;
  onSaved: (source: string, target: string) => void;
}

const modalStyles = {
  content: {
    background: "var(--color-bg-surface)",
    border: "1px solid var(--color-border)",
  },
  header: { background: "var(--color-bg-surface)" },
  title: { color: "var(--color-text)", fontWeight: 600 },
} as const;

export function QuickMergeConfigModal({
  config,
  getConfigSnapshot,
  branchNames,
  initialSource,
  initialTarget,
  onClose,
  onSaved,
}: QuickMergeConfigModalProps) {
  const [sourceBranch, setSourceBranch] = useState(initialSource || "origin/rc-master");
  const [targetBranch, setTargetBranch] = useState(initialTarget || "origin/master");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!sourceBranch.trim() || !targetBranch.trim()) {
      notifications.show({ message: "源分支和目标分支不能为空", color: "red", autoClose: 3000 });
      return;
    }
    if (sourceBranch === targetBranch) {
      notifications.show({ message: "源分支和目标分支不能相同", color: "red", autoClose: 3000 });
      return;
    }
    setIsSaving(true);
    try {
      const source = sourceBranch.trim();
      const target = targetBranch.trim();
      onSaved(source, target);
      await invoke("save_config", {
        config: getConfigSnapshot?.() ?? {
          ...config,
          quick_merge_source: source,
          quick_merge_target: target,
        },
      });
      notifications.show({ message: "快捷模式配置已保存", color: "green", autoClose: 2000 });
      onClose();
    } catch (e) {
      notifications.show({ title: "保存失败", message: String(e), color: "red", autoClose: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  const sourceOptions = branchNames.filter((n) => n !== targetBranch);
  const targetOptions = branchNames.filter((n) => n !== sourceBranch);
  const hasLoadedBranches = branchNames.length > 0;

  return (
    <Modal
      opened
      onClose={onClose}
      title="配置预设分支"
      size="lg"
      centered
      styles={modalStyles}
    >
      <Stack gap="md">
        <Group align="flex-end" grow wrap="wrap">
          <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
            <Text size="sm" fw={600} c="var(--color-text)">源分支（被合并）</Text>
            <SearchableDropdown
              value={sourceBranch}
              options={sourceOptions}
              onChange={setSourceBranch}
              placeholder={hasLoadedBranches ? "选择或输入源分支..." : "输入源分支（如 origin/rc-master）"}
              disabled={false}
              commitOnInput={false}
              allowCustomValue
            />
          </Stack>
          <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
            <Text size="sm" fw={600} c="var(--color-text)">目标分支（合并到此）</Text>
            <SearchableDropdown
              value={targetBranch}
              options={targetOptions}
              onChange={setTargetBranch}
              placeholder={hasLoadedBranches ? "选择或输入目标分支..." : "输入目标分支（如 origin/master）"}
              disabled={false}
              commitOnInput={false}
              allowCustomValue
            />
          </Stack>
        </Group>
        <Text size="xs" c="var(--color-text-muted)">
          {hasLoadedBranches
            ? "勾选「预设分支」后，加载分支时会自动选择这两个分支，并自动开启打 tag。配置全局生效。"
            : "请手动输入分支名（如 origin/rc-master），或先在合并面板加载分支后再从下拉选择。"}
        </Text>
        <Button variant="filled" color="blue" fullWidth onClick={handleSave} loading={isSaving}>
          保存配置
        </Button>
      </Stack>
    </Modal>
  );
}
