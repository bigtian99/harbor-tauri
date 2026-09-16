import {
  Rocket, Package, FileText, UploadCloud, RefreshCw,
  Loader2, CheckCircle, Copy, ChevronDown,
} from "lucide-react";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { ArtifactType } from "../types";
import { getPathName } from "../types";
import { isCopyHighlighted, normalizeCopyText } from "../copyImage";
import { PanelPageHeader } from "./PanelPageHeader";
import { BuildProgressBlock, BUILD_LOG_LABELS } from "./BuildProgressBlock";

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
  onSelectFile: (type?: ArtifactType) => void;
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
  fullImage, copied, onCopyImage, onSelectFile, onBuildAndPush, onCancelBuild,
  onDragOver, onDragLeave, onDrop,
  setImageName, setImageTag, setExposePort, setShowImageConfig, setShowBuildLog,
  renderLog,
}: UploadPanelProps) {
  const fullImageCopied = fullImage ? isCopyHighlighted(copied, fullImage) : false;
  const fullImageCopyText = fullImage ? normalizeCopyText(fullImage) : "";
  const hasArtifact = Boolean(artifactPath);

  return (
    <div className="upload-shell">
      <PanelPageHeader
        eyebrow="JAR / DIST → DOCKER → HARBOR"
        title="上传推送"
        sub="选择构建产物，按需调整镜像参数，一键打包并推送到 Harbor 仓库"
      >
        <ol className="upload-steps" aria-label="构建流程">
          <li className={`upload-step ${hasArtifact ? "done" : "active"}`}>
            <span className="upload-step-num">{hasArtifact ? "✓" : "1"}</span>
            <span className="upload-step-label">选择产物</span>
          </li>
          <li className="upload-step-line" aria-hidden />
          <li className={`upload-step ${isBuilding || fullImage ? "done" : hasArtifact ? "active" : ""}`}>
            <span className="upload-step-num">2</span>
            <span className="upload-step-label">构建推送</span>
          </li>
        </ol>
      </PanelPageHeader>

      <div
        className={`drop-zone ${isDragOver ? "drag-over" : ""} ${hasArtifact ? "has-file" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={hasArtifact ? () => onSelectFile(artifactType) : undefined}
      >
        {hasArtifact ? (
          <div className="file-info">
            <div className="file-badge">
              {artifactType === "jar" ? (
                <FileText size={24} strokeWidth={1.6} />
              ) : (
                <Package size={24} strokeWidth={1.6} />
              )}
            </div>
            <div className="file-meta">
              <span className="file-name">{getPathName(artifactPath)}</span>
              <span className="file-path">{artifactPath}</span>
            </div>
            <span className="file-replace">
              <RefreshCw size={12} />
              点击更换
            </span>
          </div>
        ) : isDragOver ? (
          <div className="drop-hint">
            <div className="drop-badge drop-badge--active">
              <UploadCloud size={30} strokeWidth={1.6} />
            </div>
            <p>松开鼠标，选择该产物</p>
          </div>
        ) : (
          <div className="drop-hint">
            <div className="drop-badge">
              <UploadCloud size={30} strokeWidth={1.6} />
            </div>
            <p>拖入 JAR 文件或前端 dist 目录</p>
            <p className="drop-sub">
              或点选
              {" "}
              <button type="button" className="drop-link" onClick={() => onSelectFile("jar")}>
                JAR 文件
              </button>
              {" / "}
              <button type="button" className="drop-link" onClick={() => onSelectFile("frontend_dist")}>
                dist 目录
              </button>
            </p>
            <div className="drop-chips">
              <span className="drop-chip">*.jar</span>
              <span className="drop-chip">dist/</span>
            </div>
          </div>
        )}
      </div>

      <Paper withBorder p="sm" radius="md" className="upload-config">
        <UnstyledButton
          onClick={() => setShowImageConfig(!showImageConfig)}
          w="100%"
          className="upload-config-toggle"
        >
          <Group gap="xs" wrap="nowrap">
            <ChevronDown
              size={14}
              className={`upload-config-chevron ${showImageConfig ? "open" : ""}`}
            />
            <Text size="sm" fw={600} c="var(--color-text)">镜像配置</Text>
            <Text size="xs" c="dimmed">可选，留空走默认</Text>
          </Group>
        </UnstyledButton>
        <Collapse expanded={showImageConfig}>
          <Stack gap="sm" mt="sm" className="upload-config-fields">
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
        className="build-cta"
        onClick={onBuildAndPush}
        disabled={isBuilding || !artifactPath}
        leftSection={
          isBuilding
            ? <Loader2 size={17} className="spin" />
            : <Rocket size={17} />
        }
      >
        {isBuilding ? "构建推送中..." : "构建并推送"}
      </Button>

      <BuildProgressBlock
        showProgress={isBuilding}
        progress={progress}
        progressMessage={progressMessage}
        progressTextSize="xs"
        progressPercentTone="muted"
        progressLayout="paper"
        progressClassName="upload-progress"
        showCancel={isBuilding}
        onCancel={onCancelBuild}
        cancelLabel="取消构建"
        cancelPlacement="inside"
        cancelVariant="subtle-red"
        log=""
        showBuildLog={showBuildLog}
        setShowBuildLog={setShowBuildLog}
        renderLog={renderLog}
      />

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

      <BuildProgressBlock
        progress={progress}
        progressMessage={progressMessage}
        log={log}
        showBuildLog={showBuildLog}
        setShowBuildLog={setShowBuildLog}
        renderLog={renderLog}
        logLabels={BUILD_LOG_LABELS}
        logExpandMode="collapse"
        logPaperPadding="xs"
        logPanelClassName="upload-log"
      />
    </div>
  );
}
