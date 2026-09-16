import type { ReactNode } from "react";
import { Eye, EyeOff, XCircle } from "lucide-react";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { isCompactSuccessLog } from "../hooks/useBuildProgress";

export interface BuildProgressLogLabels {
  expand: string;
  collapse: string;
  expandTitle: string;
  collapseTitle: string;
}

export const BUILD_LOG_LABELS: BuildProgressLogLabels = {
  expand: "展开构建日志",
  collapse: "隐藏构建日志",
  expandTitle: "展开构建日志",
  collapseTitle: "隐藏构建日志",
};

export const PUSH_LOG_LABELS: BuildProgressLogLabels = {
  expand: "展开推送日志",
  collapse: "隐藏推送日志",
  expandTitle: "展开推送日志",
  collapseTitle: "隐藏推送日志",
};

export interface BuildProgressBlockProps {
  showProgress?: boolean;
  progress: number;
  progressMessage: string;
  /** progressMessage 为空时的占位（如 History 推送中） */
  progressMessageFallback?: string;
  /** xs：Upload/Push；sm：Branch/History */
  progressTextSize?: "xs" | "sm";
  /** 百分比文字配色：branch 用 primary-hover，history 用 muted */
  progressPercentTone?: "branch" | "history" | "muted";
  /** paper：Upload/Push 带边框卡片；stack：Branch/History 进度区块 */
  progressLayout?: "paper" | "stack";
  progressClassName?: string;
  showCancel?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  /** inside：取消按钮嵌在进度块内；below：进度块下方独立按钮 */
  cancelPlacement?: "inside" | "below";
  cancelVariant?: "subtle-red" | "default-gray" | "light-red" | "light-gray";
  cancelClassName?: string;
  log?: string;
  showBuildLog: boolean;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => ReactNode;
  logLabels?: BuildProgressLogLabels;
  /** collapse：Mantine Collapse；toggle：条件渲染 div */
  logExpandMode?: "collapse" | "toggle";
  logSectionClassName?: string;
  logPanelClassName?: string;
  logPaperPadding?: "xs" | "sm";
}

function progressMessageColor(size: "xs" | "sm"): string {
  return size === "xs" ? "var(--color-text-muted)" : "var(--color-text)";
}

function progressPercentColor(tone: BuildProgressBlockProps["progressPercentTone"], size: "xs" | "sm"): string {
  if (tone === "branch") return "var(--color-primary-hover)";
  if (tone === "history") return "var(--color-text-muted)";
  return size === "xs" ? "var(--color-text-muted)" : "var(--color-primary-hover)";
}

function CancelButton({
  label,
  variant,
  className,
  onCancel,
}: {
  label: string;
  variant: NonNullable<BuildProgressBlockProps["cancelVariant"]>;
  className?: string;
  onCancel?: () => void;
}) {
  if (variant === "subtle-red") {
    return (
      <Button
        variant="subtle"
        color="red"
        size="compact-xs"
        onClick={onCancel}
        leftSection={<XCircle size={12} />}
        style={{ alignSelf: "flex-start" }}
        className={className}
      >
        {label}
      </Button>
    );
  }
  if (variant === "light-red") {
    return (
      <Button
        variant="light"
        color="red"
        size="sm"
        onClick={onCancel}
        leftSection={<XCircle size={16} />}
        className={className}
      >
        {label}
      </Button>
    );
  }
  if (variant === "light-gray") {
    return (
      <Button
        variant="light"
        color="gray"
        size="sm"
        onClick={onCancel}
        leftSection={<XCircle size={16} />}
        className={className}
      >
        {label}
      </Button>
    );
  }
  return (
    <Button
      variant="default"
      color="gray"
      size="sm"
      onClick={onCancel}
      leftSection={<XCircle size={16} />}
      className={className}
    >
      {label}
    </Button>
  );
}

function ProgressContent({
  message,
  percent,
  textSize,
  percentTone,
  showCancel,
  cancelPlacement,
  cancelLabel,
  cancelVariant,
  cancelClassName,
  onCancel,
}: {
  message: string;
  percent: number;
  textSize: "xs" | "sm";
  percentTone: BuildProgressBlockProps["progressPercentTone"];
  showCancel?: boolean;
  cancelPlacement?: "inside" | "below";
  cancelLabel?: string;
  cancelVariant?: BuildProgressBlockProps["cancelVariant"];
  cancelClassName?: string;
  onCancel?: () => void;
}) {
  return (
    <>
      <Group justify="space-between" gap="xs" mb={textSize === "xs" && cancelPlacement === "inside" ? undefined : textSize === "xs" ? 6 : undefined}>
        <Text size={textSize} c={progressMessageColor(textSize)}>
          {message}
        </Text>
        <Text size={textSize} fw={600} c={progressPercentColor(percentTone, textSize)}>
          {percent}%
        </Text>
      </Group>
      <Progress value={percent} />
      {showCancel && cancelPlacement === "inside" && cancelLabel && cancelVariant && (
        <CancelButton
          label={cancelLabel}
          variant={cancelVariant}
          className={cancelClassName}
          onCancel={onCancel}
        />
      )}
    </>
  );
}

function LogSection({
  log,
  showBuildLog,
  setShowBuildLog,
  renderLog,
  logLabels,
  logExpandMode,
  logSectionClassName,
  logPanelClassName,
  logPaperPadding,
}: Required<Pick<
  BuildProgressBlockProps,
  "log" | "showBuildLog" | "setShowBuildLog" | "renderLog" | "logLabels" | "logExpandMode"
>> & Pick<BuildProgressBlockProps, "logSectionClassName" | "logPanelClassName" | "logPaperPadding">) {
  const panelClass = `log-panel ${isCompactSuccessLog(log) ? "success" : ""}${logPanelClassName ? ` ${logPanelClassName}` : ""}`;
  const toggleBtn = (
    <Button
      type="button"
      variant="light"
      color="cyan"
      size="sm"
      style={{ alignSelf: "flex-start" }}
      onClick={() => setShowBuildLog(!showBuildLog)}
      title={showBuildLog ? logLabels.collapseTitle : logLabels.expandTitle}
      leftSection={showBuildLog ? <EyeOff size={15} /> : <Eye size={15} />}
    >
      {showBuildLog ? logLabels.collapse : logLabels.expand}
    </Button>
  );

  const logBody = renderLog(log);

  if (logExpandMode === "collapse") {
    return (
      <Stack gap={logPaperPadding === "xs" ? 4 : "xs"} className={logSectionClassName ?? "log-section"}>
        {toggleBtn}
        <Collapse expanded={showBuildLog}>
          <Paper className={panelClass} p={logPaperPadding ?? "sm"} radius="md">
            {logBody}
          </Paper>
        </Collapse>
      </Stack>
    );
  }

  return (
    <Stack gap="xs" className={logSectionClassName ?? "log-section"}>
      {toggleBtn}
      {showBuildLog && (
        <div className={panelClass}>
          {logBody}
        </div>
      )}
    </Stack>
  );
}

/** 构建/推送进度条 + 取消 + 可折叠日志（Upload / Push / Branch / History 共用） */
export function BuildProgressBlock({
  showProgress = false,
  progress,
  progressMessage,
  progressMessageFallback = "",
  progressTextSize = "sm",
  progressPercentTone = "muted",
  progressLayout = "stack",
  progressClassName,
  showCancel = false,
  onCancel,
  cancelLabel = "取消构建",
  cancelPlacement = "below",
  cancelVariant = "light-red",
  cancelClassName,
  log = "",
  showBuildLog,
  setShowBuildLog,
  renderLog,
  logLabels = BUILD_LOG_LABELS,
  logExpandMode = "toggle",
  logSectionClassName,
  logPanelClassName,
  logPaperPadding,
}: BuildProgressBlockProps) {
  const message = progressMessage || progressMessageFallback;
  const hasLog = Boolean(log);
  const showCancelBelow = showCancel && cancelPlacement === "below";

  if (!showProgress && !hasLog && !showCancelBelow) {
    return null;
  }

  const progressInner = showProgress ? (
    <ProgressContent
      message={message}
      percent={progress}
      textSize={progressTextSize}
      percentTone={progressPercentTone}
      showCancel={showCancel}
      cancelPlacement={cancelPlacement}
      cancelLabel={cancelLabel}
      cancelVariant={cancelVariant}
      cancelClassName={cancelClassName}
      onCancel={onCancel}
    />
  ) : null;

  return (
    <>
      {showProgress && progressLayout === "paper" && (
        <Paper p="sm" radius="md" withBorder className={progressClassName}>
          <Stack gap={6}>
            {progressInner}
          </Stack>
        </Paper>
      )}
      {showProgress && progressLayout === "stack" && (
        <Stack gap="xs" className={progressClassName ?? "progress-section"}>
          {progressInner}
        </Stack>
      )}
      {showCancelBelow && (
        <CancelButton
          label={cancelLabel}
          variant={cancelVariant}
          className={cancelClassName}
          onCancel={onCancel}
        />
      )}
      {hasLog && (
        <LogSection
          log={log}
          showBuildLog={showBuildLog}
          setShowBuildLog={setShowBuildLog}
          renderLog={renderLog}
          logLabels={logLabels}
          logExpandMode={logExpandMode}
          logSectionClassName={logSectionClassName}
          logPanelClassName={logPanelClassName}
          logPaperPadding={logPaperPadding}
        />
      )}
    </>
  );
}
