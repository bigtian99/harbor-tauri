import { useState, useEffect } from "react";
import { Modal, Button, Progress, Text, Stack, Group, Anchor } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 与 Rust updater.rs 中 UpdateInfo 一一对应 */
export interface UpdateInfo {
  needs_update: boolean;
  current_version: string;
  latest_version: string;
  download_url: string;
  file_size: number;
}

interface DownloadProgress {
  phase: string;
  percent: number;
  message: string;
}

interface UpdateModalProps {
  opened: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function UpdateModal({ opened, onClose, updateInfo }: UpdateModalProps) {
  const [phase, setPhase] = useState<"confirm" | "downloading" | "installing" | "error">("confirm");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 监听 Rust 后端发来的下载/安装进度事件
  useEffect(() => {
    if (!opened || !updateInfo) return;

    const unlisten = listen<DownloadProgress>("update-progress", (event) => {
      const { phase: p, percent } = event.payload;
      setProgress(percent);
      if (p === "downloading") setPhase("downloading");
      else if (p === "installing") setPhase("installing");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [opened, updateInfo]);

  // 重置状态，每次打开 Modal 都是新流程
  useEffect(() => {
    if (opened) {
      setPhase("confirm");
      setProgress(0);
      setError("");
      setBusy(false);
    }
  }, [opened]);

  const handleInstall = async () => {
    if (!updateInfo || busy) return;
    setBusy(true);
    try {
      await invoke("download_and_install", { downloadUrl: updateInfo.download_url });
      // 成功后进程会退出，不会走到这里
    } catch (e) {
      setError(String(e));
      setPhase("error");
      setBusy(false);
    }
  };

  const isLocked = phase === "downloading" || phase === "installing";

  return (
    <Modal
      opened={opened}
      onClose={isLocked ? () => {} : onClose}
      title="发现新版本"
      closeOnClickOutside={!isLocked}
      closeOnEscape={!isLocked}
    >
      {/* 确认阶段 */}
      {phase === "confirm" && updateInfo && (
        <Stack>
          <Text size="sm">
            当前版本: <strong>{updateInfo.current_version}</strong>
          </Text>
          <Text size="sm">
            最新版本: <strong>{updateInfo.latest_version}</strong>
          </Text>
          <Text size="sm" c="dimmed">
            文件大小: {formatSize(updateInfo.file_size)}
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>稍后</Button>
            <Button onClick={handleInstall} loading={busy}>立即更新</Button>
          </Group>
        </Stack>
      )}

      {/* 下载/安装阶段 */}
      {(phase === "downloading" || phase === "installing") && (
        <Stack>
          <Progress
            value={phase === "installing" ? 100 : progress}
            animated={phase === "downloading"}
            striped={phase === "installing"}
          />
          <Text size="sm" c="dimmed" ta="center">
            {phase === "downloading" ? `正在下载... ${progress}%` : "正在安装，即将重启..."}
          </Text>
        </Stack>
      )}

      {/* 错误阶段 */}
      {phase === "error" && (
        <Stack>
          <Text size="sm" c="red">
            更新失败: {error}
          </Text>
          <Anchor
            href="https://github.com/daijunxiong/jarporter/releases/latest"
            target="_blank"
            size="sm"
          >
            手动下载最新版本 →
          </Anchor>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>关闭</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
