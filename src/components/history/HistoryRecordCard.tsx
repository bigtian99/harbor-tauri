import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import {
  CheckCircle, Copy, Trash2, FolderOpen, FileText, BookOpen, BookMarked, Folder,
  Coffee, Package, ChevronDown, ChevronUp, Clock, Rocket, Loader2, XCircle,
} from "lucide-react";
import type { BuildRecord } from "../../types";
import { HoverTip } from "../HoverTip";
import { BaotaIcon, DockerIcon } from "../icons/BrandIcons";
import { avatarColor, avatarInitials } from "../../avatarUrl";
import { historyCanPushJar } from "../../historyJarPush.ts";
import { parseHistoryImageTags } from "../../branchImageResults";
import type { useConfirmDialog } from "../../hooks/useConfirmDialog";

const badgeBase = {
  root: {
    textTransform: "none" as const,
    height: 18,
    paddingInline: 6,
    fontSize: 10,
    fontWeight: 500,
  },
} as const;

const badgeStatus = {
  root: {
    ...badgeBase.root,
    fontWeight: 600,
  },
} as const;

function recordTypeLabel(record: BuildRecord): string {
  if (record.project_type.toLowerCase() === "maven") return "后端";
  return record.package_with_backend ? "前端+后端" : "前端";
}

export interface HistoryRecordCardProps {
  record: BuildRecord;
  expandedId: string | null;
  isBuilding: boolean;
  pushingRecordId: string | null;
  onPushJar?: (record: BuildRecord) => void;
  onOpenArtifact: (path: string) => void;
  onCopyImage: (url: string) => void;
  setExpandedId: (id: string | null) => void;
  onDeleteRecord: (record: BuildRecord) => void;
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
}

export function HistoryRecordCard({
  record,
  expandedId,
  isBuilding,
  pushingRecordId,
  onPushJar,
  onOpenArtifact,
  onCopyImage,
  setExpandedId,
  onDeleteRecord,
  confirm,
}: HistoryRecordCardProps) {
  const typeLabel = recordTypeLabel(record);
  const isSuccess = record.status === "success" || record.status === "pushed";
  const statusColor = isSuccess ? "green" : "red";
  const statusLabel =
    record.status === "pushed" ? "已推送" : isSuccess ? "成功" : "失败";
  const images = record.image_tag ? parseHistoryImageTags(record.image_tag) : [];
  const labeled = record.package_with_backend && images.length > 1;
  const isMaven = record.project_type.toLowerCase() === "maven";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const DETAIL_PREVIEW = 2;

  const imageRows = images.map((img, i) => (
    <HoverTip tip={img} key={`img-${img}-${i}`} className="history-record-image-wrap">
      <div className="history-record-image history-record-detail-row">
        <span
          className="history-record-brand-icon history-record-brand-icon--docker"
          title={labeled ? (i === 0 ? "前端镜像" : "后端镜像") : "Docker 镜像"}
        >
          <DockerIcon size={14} />
        </span>
        <span className="history-record-image-text">
          {labeled ? `${i === 0 ? "前端" : "后端"}: ${img}` : img}
        </span>
        <button
          type="button"
          className="history-record-copy-btn"
          title={labeled ? (i === 0 ? "复制前端镜像" : "复制后端镜像") : "复制镜像地址"}
          onClick={(e) => {
            e.stopPropagation();
            onCopyImage(img);
          }}
        >
          <Copy size={12} />
        </button>
      </div>
    </HoverTip>
  ));

  const pathRows = [
    <div key="path-artifact" className="history-record-path history-record-detail-row">
      {isMaven && !record.backend_artifact_path ? (
        <span className="history-record-brand-icon history-record-brand-icon--baota" title="产物 (JAR)">
          <BaotaIcon size={14} />
        </span>
      ) : (
        <span className="history-record-brand-icon" title={record.backend_artifact_path ? "前端产物" : "产物"}>
          <Folder size={14} />
        </span>
      )}
      <HoverTip tip={record.artifact_path} className="history-record-path-link-wrap">
        <button
          type="button"
          className="history-record-path-link"
          onClick={() => onOpenArtifact(record.artifact_path)}
        >
          {record.artifact_path}
        </button>
      </HoverTip>
      <button
        type="button"
        className="history-record-path-open"
        onClick={() => onOpenArtifact(record.artifact_path)}
        title="打开目录"
      >
        <FolderOpen size={12} />
      </button>
    </div>,
  ];
  if (record.backend_artifact_path) {
    pathRows.push(
      <div key="path-backend" className="history-record-path history-record-detail-row">
        <span
          className="history-record-brand-icon history-record-brand-icon--baota"
          title="后端产物 (JAR) · 宝塔可部署"
        >
          <BaotaIcon size={14} />
        </span>
        <HoverTip tip={record.backend_artifact_path} className="history-record-path-link-wrap">
          <button
            type="button"
            className="history-record-path-link"
            onClick={() => onOpenArtifact(record.backend_artifact_path!)}
          >
            {record.backend_artifact_path}
          </button>
        </HoverTip>
        <button
          type="button"
          className="history-record-path-open"
          onClick={() => onOpenArtifact(record.backend_artifact_path!)}
          title="打开目录"
        >
          <FolderOpen size={12} />
        </button>
      </div>,
    );
  }

  const detailRows = [...imageRows, ...pathRows];
  const hiddenCount = Math.max(0, detailRows.length - DETAIL_PREVIEW);
  const visibleRows = detailsOpen ? detailRows : detailRows.slice(0, DETAIL_PREVIEW);

  return (
    <Paper
      p={10}
      radius="md"
      className={`history-record-card ${record.status}`}
      styles={{
        root: {
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        },
      }}
    >
      <Group align="flex-start" wrap="nowrap" gap={8} mb={6}>
        <Box pt={1} className="history-record-status">
          {isSuccess ? (
            <CheckCircle size={14} color="var(--color-success)" />
          ) : (
            <XCircle size={14} color="var(--color-error)" />
          )}
        </Box>
        {record.author && (
          <Box
            className="history-record-avatar"
            style={{
              background: avatarColor(record.email || record.author),
              width: 22,
              height: 22,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 600,
              color: "var(--color-on-primary)",
              flexShrink: 0,
            }}
            title={record.author}
            aria-hidden
          >
            {avatarInitials(record.author || record.email || "?")}
          </Box>
        )}
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap="wrap" className="history-record-meta-badges">
            <Badge
              variant="light"
              color={statusColor}
              size="xs"
              styles={badgeStatus}
            >
              {statusLabel}
            </Badge>
            <Badge
              variant="light"
              color="gray"
              size="xs"
              leftSection={<Clock size={8} />}
              styles={badgeBase}
            >
              {record.timestamp}
            </Badge>
            <Badge variant="light" color="gray" size="xs" styles={badgeBase} title="分支">
              {record.branch}
            </Badge>
            <Badge
              variant="light"
              color="gray"
              size="xs"
              className={`history-record-type ${record.project_type.toLowerCase()}`}
              styles={badgeBase}
            >
              {typeLabel}
            </Badge>
            <Badge variant="light" color="gray" size="xs" styles={badgeBase} title="耗时">
              {(record.duration_ms / 1000).toFixed(1)}s
            </Badge>
            {!isMaven && record.package_manager && (
              <Badge
                variant="light"
                color="gray"
                size="xs"
                leftSection={<Package size={8} />}
                title="包管理器"
                styles={badgeBase}
              >
                {record.package_manager}
              </Badge>
            )}
            {(isMaven || record.package_with_backend) && record.spring_profile && (
              <Badge
                variant="light"
                color="gray"
                size="xs"
                leftSection={<Coffee size={8} />}
                title="Spring Profile"
                styles={badgeBase}
              >
                {record.spring_profile}
              </Badge>
            )}
            {!isMaven && record.frontend_dir && (
              <Badge
                variant="light"
                color="gray"
                size="xs"
                leftSection={<Folder size={8} />}
                title="前端目录"
                styles={badgeBase}
              >
                {record.frontend_dir}
              </Badge>
            )}
          </Group>
          {detailRows.length > 0 && (
            <div className="history-record-details">
              <div className="history-record-images">{visibleRows}</div>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="history-record-details-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailsOpen((open) => !open);
                  }}
                  title={detailsOpen ? "收起" : `还有 ${hiddenCount} 条`}
                  aria-expanded={detailsOpen}
                >
                  {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{detailsOpen ? "收起" : `+${hiddenCount}`}</span>
                </button>
              )}
            </div>
          )}
        </Stack>
        <Group gap={2} wrap="nowrap" className="history-record-actions">
          {onPushJar && historyCanPushJar(record) && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              className="history-record-action history-record-action-push"
              disabled={isBuilding}
              onClick={(e) => {
                e.stopPropagation();
                onPushJar(record);
              }}
              title="推送 JAR 到 Harbor"
            >
              {pushingRecordId === record.id ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Rocket size={14} />
              )}
            </ActionIcon>
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            className="history-record-action"
            onClick={() => onOpenArtifact(record.artifact_path)}
            title="打开产物目录"
          >
            <FolderOpen size={14} />
          </ActionIcon>
          {record.backend_artifact_path && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              className="history-record-action"
              onClick={() => onOpenArtifact(record.backend_artifact_path!)}
              title="打开后端产物"
            >
              <FileText size={14} />
            </ActionIcon>
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            className="history-record-action"
            onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
            title={expandedId === record.id ? "收起日志" : "展开日志"}
          >
            {expandedId === record.id ? <BookMarked size={14} /> : <BookOpen size={14} />}
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            className="history-record-action danger"
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                const ok = await confirm({
                  title: "删除记录",
                  message: "确定要删除这条打包记录吗？产物将一并清理，删除后不可恢复。",
                  details: [`分支：${record.branch}`],
                  variant: "danger",
                  confirmLabel: "删除",
                });
                if (ok) onDeleteRecord(record);
              })();
            }}
            title="删除记录"
          >
            <Trash2 size={14} />
          </ActionIcon>
        </Group>
      </Group>

      {expandedId === record.id && (
        <Paper
          p="sm"
          radius="sm"
          mt="sm"
          className="history-record-log"
          styles={{
            root: {
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
            },
          }}
        >
          <Text
            size="xs"
            component="pre"
            className="history-record-log-content"
            style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", margin: 0, color: "var(--color-text)" }}
          >
            {record.full_log}
          </Text>
        </Paper>
      )}
    </Paper>
  );
}
