import {
  Rocket, Package, FileText,
  Loader2, Eye, EyeOff, XCircle, CheckCircle, Copy, ChevronDown,
} from "lucide-react";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { ArtifactType } from "../types";
import { getPathName } from "../types";
import { isCopyHighlighted, normalizeCopyText } from "../copyImage";
import { panelSegmentedStyles } from "../theme/panelStyles";

interface UploadPanelProps {
  artifactType: ArtifactType;
  artifactPath: string;
  imageName: string;
  imageTag: string;
  exposePort: string;
  isDragOver: boolean;
  isBuilding: boolean;
  showImageConfig: boolean;
  showBuildLog: boolean;
  progress: number;
  progressMessage: string;
  log: string;
  // 推送成功后的镜像地址（独立展示，不依赖日志折叠框）
  fullImage: string;
  copied: string | null;
  onCopyImage: (imageUrl: string) => void;
  onArtifactTypeChange: (type: ArtifactType) => void;
  onSelectFile: () => void;
  onBuildAndPush: () => void;
  onCancelBuild: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  setImageName: (name: string) => void;
  setImageTag: (tag: string) => void;
  setExposePort: (port: string) => void;
  setShowImageConfig: (show: boolean) => void;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => React.ReactNode;
}

export function UploadPanel({
  artifactType, artifactPath, imageName, imageTag, exposePort,
  isDragOver, isBuilding, showImageConfig, showBuildLog,
  progress, progressMessage, log,
  fullImage, copied, onCopyImage,
  onArtifactTypeChange, onSelectFile, onBuildAndPush, onCancelBuild,
  onDragOver, onDragLeave, onDrop,
  setImageName, setImageTag, setExposePort, setShowImageConfig, setShowBuildLog,
  renderLog,
}: UploadPanelProps) {
  const fullImageCopied = fullImage ? isCopyHighlighted(copied, fullImage) : false;
  const fullImageCopyText = fullImage ? normalizeCopyText(fullImage) : "";

  return (
    <Stack gap="sm" className="upload-panel">
      <SegmentedControl
        size="sm"
        value={artifactType}
        onChange={(v) => onArtifactTypeChange(v as ArtifactType)}
        data={[
          {
            value: "jar",
            label: (
              <Group gap={6} justify="center" wrap="nowrap">
                <FileText size={13} />
                <span>JAR 应用</span>
              </Group>
            ),
          },
          {
            value: "frontend_dist",
            label: (
              <Group gap={6} justify="center" wrap="nowrap">
                <Package size={13} />
                <span>前端 dist</span>
              </Group>
            ),
          },
        ]}
        styles={panelSegmentedStyles}
      />

      <Paper
        component="div"
        className={`drop-zone ${isDragOver ? "drag-over" : ""} ${artifactPath ? "has-file" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onSelectFile}
        style={{ cursor: "pointer" }}
      >
        {artifactPath ? (
          <div className="file-info">
            {artifactType === "jar" ? (
              <FileText size={28} strokeWidth={1.5} className="file-icon" />
            ) : (
              <Package size={28} strokeWidth={1.5} className="file-icon" />
            )}
            <span className="file-name">
              {getPathName(artifactPath)}
            </span>
            <span className="file-path">{artifactPath}</span>
          </div>
        ) : (
          <div className="drop-hint">
            <Package size={32} strokeWidth={1.5} className="drop-icon" />
            <p>{artifactType === "jar" ? "拖拽 JAR 文件到这里" : "拖拽前端 dist 目录到这里"}</p>
            <p className="drop-sub">{artifactType === "jar" ? "或点击选择文件" : "或点击选择目录"}</p>
          </div>
        )}
      </Paper>

      <Paper withBorder p="sm" radius="md">
        <UnstyledButton
          onClick={() => setShowImageConfig(!showImageConfig)}
          w="100%"
        >
          <Group gap="xs" wrap="nowrap">
            <ChevronDown
              size={14}
              style={{
                color: "var(--color-text-muted)",
                transform: showImageConfig ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 0.2s ease",
                flexShrink: 0,
              }}
            />
            <Text size="sm" fw={600} c="var(--color-text)">镜像配置</Text>
            <Text size="xs" c="dimmed">可选</Text>
          </Group>
        </UnstyledButton>
        <Collapse expanded={showImageConfig}>
          <Stack gap="sm" mt="sm">
            <TextInput
              size="sm"
              label="镜像名称"
              value={imageName}
              onChange={(e) => setImageName(e.currentTarget.value)}
              placeholder="例如: my-app（不含 Harbor 项目名）"
              description="Harbor 项目名在配置中填写，推送时自动拼接"
            />
            <TextInput
              size="sm"
              label="镜像标签"
              value={imageTag}
              onChange={(e) => setImageTag(e.currentTarget.value)}
              placeholder="留空则自动生成 v.YY.MM.DD.HH.MM"
            />
            {artifactType === "jar" && (
              <TextInput
                size="sm"
                label="JAR 暴露端口"
                value={exposePort}
                onChange={(e) => setExposePort(e.currentTarget.value)}
                placeholder="默认: 8181"
                description="留空则使用配置中的默认端口"
              />
            )}
          </Stack>
        </Collapse>
      </Paper>

      <Button
        variant="filled"
        color="cyan"
        size="md"
        fullWidth
        onClick={onBuildAndPush}
        disabled={isBuilding || !artifactPath}
        leftSection={
          isBuilding
            ? <Loader2 size={16} className="spin" />
            : <Rocket size={16} />
        }
      >
        {isBuilding ? "构建推送中..." : "构建并推送"}
      </Button>

      {isBuilding && (
        <Paper p="sm" radius="md" withBorder className="upload-progress">
          <Stack gap={6}>
            <Group justify="space-between" gap="xs">
              <Text size="xs" c="var(--color-text-muted)">{progressMessage}</Text>
              <Text size="xs" fw={600} c="var(--color-text-muted)">{progress}%</Text>
            </Group>
            <Progress value={progress} />
            <Button
              variant="subtle"
              color="red"
              size="compact-xs"
              onClick={onCancelBuild}
              leftSection={<XCircle size={12} />}
              style={{ alignSelf: "flex-start" }}
            >
              取消构建
            </Button>
          </Stack>
        </Paper>
      )}

      {fullImage && (
        <div className={`image-url-row image-url-row--primary ${fullImageCopied ? "copied" : ""}`}>
          <Group className="image-url-row-head" wrap="nowrap">
            <Text className="image-url-title">
              <Package size={14} className="image-url-title-icon" />
              完整镜像
            </Text>
            <Button
              size="compact-sm"
              variant={fullImageCopied ? "filled" : "light"}
              color={fullImageCopied ? "teal" : "cyan"}
              className={`copy-btn ${fullImageCopied ? "copied" : ""}`}
              onClick={() => onCopyImage(fullImageCopyText)}
              title="复制镜像地址"
              leftSection={
                fullImageCopied
                  ? <CheckCircle size={14} />
                  : <Copy size={14} />
              }
            >
              {fullImageCopied ? "已复制" : "复制"}
            </Button>
          </Group>
          <Text size="sm" className="image-url-value" c="var(--color-text)" style={{ wordBreak: "break-all", lineHeight: 1.45 }}>
            {fullImage.split("\n").map((line, i) => (
              <span key={i} style={{ display: "block" }} title={line}>{line}</span>
            ))}
          </Text>
        </div>
      )}

      {log && (
        <Stack gap={4} className="log-section">
          <Button
            type="button"
            variant="light"
            color="cyan"
            size="sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setShowBuildLog(!showBuildLog)}
            title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
            leftSection={showBuildLog ? <EyeOff size={15} /> : <Eye size={15} />}
          >
            {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
          </Button>
          <Collapse expanded={showBuildLog}>
            <Paper
              className={`log-panel upload-log ${log.includes("✅") ? "success" : ""}`}
              p="xs"
              radius="md"
            >
              {renderLog(log)}
            </Paper>
          </Collapse>
        </Stack>
      )}
    </Stack>
  );
}
