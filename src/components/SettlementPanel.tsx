import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  CheckCircle,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Play,
} from "lucide-react";

import type { SettlementGenerateResult } from "../types";
import { isTauriRuntime } from "../types";

type PathPickerProps = {
  label: string;
  value: string;
  placeholder: string;
  directory?: boolean;
  onChange: (value: string) => void;
};

type SettlementProgress = {
  percent: number;
  message: string;
  current: number;
  total: number;
};

function PathPicker({ label, value, placeholder, directory, onChange }: PathPickerProps) {
  async function handleSelect() {
    if (!isTauriRuntime()) return;
    const selected = await open({
      multiple: false,
      directory: Boolean(directory),
      filters: directory ? undefined : [{ name: "Excel 文件", extensions: ["xlsx", "xls"] }],
    });
    if (typeof selected === "string") {
      onChange(selected);
    }
  }

  return (
    <TextInput
      label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      autoCapitalize="none"
      rightSectionWidth={96}
      rightSection={
        <Button
          size="compact-sm"
          variant="subtle"
          color="teal"
          leftSection={<FolderOpen size={14} />}
          onClick={handleSelect}
        >
          选择
        </Button>
      }
    />
  );
}

export function SettlementPanel() {
  const [sourcePath, setSourcePath] = useState("");
  const [settlementPath, setSettlementPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<SettlementGenerateResult | null>(null);
  const [progress, setProgress] = useState<SettlementProgress>({
    percent: 0,
    message: "",
    current: 0,
    total: 0,
  });

  const canGenerate = sourcePath && settlementPath && outputDir && !isGenerating;

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .listen<SettlementProgress>("settlement-progress", (event) => {
        setProgress(event.payload);
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  async function handleGenerate() {
    if (!canGenerate) return;
    setIsGenerating(true);
    setResult(null);
    setProgress({ percent: 1, message: "准备生成结算单...", current: 0, total: 0 });
    try {
      const generated = await invoke<SettlementGenerateResult>("generate_settlement_statements", {
        sourcePath,
        settlementPath,
        outputDir,
      });
      setResult(generated);
      setProgress({
        percent: 100,
        message: "结算单生成完成",
        current: generated.created,
        total: generated.accounts,
      });
      notifications.show({
        message: `已生成 ${generated.created} 个结算单`,
        color: "teal",
        autoClose: 3000,
      });
    } catch (e) {
      setProgress((prev) => ({ ...prev, message: "生成失败" }));
      notifications.show({
        title: "生成失败",
        message: String(e),
        color: "red",
        autoClose: 6000,
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleOpenOutput() {
    const path = result?.output_dir || outputDir;
    if (!path) return;
    try {
      await invoke("open_directory", { path });
    } catch (e) {
      notifications.show({ title: "打开失败", message: String(e), color: "red", autoClose: 4000 });
    }
  }

  return (
    <Box className="settlement-panel" style={{ padding: "32px 40px" }}>
      <Stack gap="md">
        <Group gap="xs">
          <FileText size={22} />
          <Title order={3}>结算单</Title>
        </Group>

        <Paper p="md" withBorder radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">模板</Text>
              <Badge color="gray" variant="light">默认模板</Badge>
            </Group>
            <PathPicker
              label="渠道打款信息表"
              value={sourcePath}
              placeholder="选择 渠道打款信息表.xlsx"
              onChange={setSourcePath}
            />
            <PathPicker
              label="结算数据"
              value={settlementPath}
              placeholder="选择 jiesuandan.xlsx"
              onChange={setSettlementPath}
            />
            <PathPicker
              label="输出目录"
              value={outputDir}
              placeholder="选择结算单输出目录"
              directory
              onChange={setOutputDir}
            />

            <Group gap="sm">
              <Button
                leftSection={isGenerating ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                disabled={!canGenerate}
                onClick={handleGenerate}
                variant="gradient"
                gradient={{ from: "teal", to: "cyan" }}
              >
                生成结算单
              </Button>
              <Button
                leftSection={<ExternalLink size={14} />}
                disabled={!result && !outputDir}
                onClick={handleOpenOutput}
                variant="light"
                color="gray"
              >
                打开目录
              </Button>
            </Group>

            {isGenerating && (
              <Paper p="sm" withBorder radius="md">
                <Stack gap={6}>
                  <Group justify="space-between" gap="sm">
                    <Text size="sm">{progress.message || "处理中..."}</Text>
                    <Text size="sm" fw={600}>{progress.percent}%</Text>
                  </Group>
                  <Progress value={progress.percent} animated color="teal" size="sm" />
                  {progress.total > 0 && (
                    <Text size="xs" c="dimmed">
                      账号进度 {progress.current}/{progress.total}
                    </Text>
                  )}
                </Stack>
              </Paper>
            )}
          </Stack>
        </Paper>

        {result && (
          <Paper p="md" withBorder radius="md">
            <Stack gap="sm">
              <Group gap="xs">
                <CheckCircle size={18} color="#35d07f" />
                <Text fw={600}>生成完成</Text>
                <Badge color="teal" variant="light">{result.created} 个文件</Badge>
                <Badge color="blue" variant="light">{result.channels} 个渠道</Badge>
              </Group>
              <Stack gap={6}>
                {result.files.map((file) => (
                  <Text key={file} size="sm" c="dimmed" style={{ wordBreak: "break-all" }}>
                    {file}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}
