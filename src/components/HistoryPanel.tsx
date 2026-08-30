import { useState, useMemo, useEffect } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  History, CheckCircle, Copy, Trash2, RefreshCw, Search,
  FolderOpen, FileText, BookOpen, BookMarked, Folder,
  Coffee, Package, Wrench, ChevronRight, Clock, Rocket, Loader2,
  XCircle, Eye, EyeOff,
} from "lucide-react";
import type { ReactNode } from "react";
import type { BuildRecord } from "../types";
import { getProjectName } from "../types";
import { HoverTip } from "./HoverTip";
import { BaotaIcon, DockerIcon } from "./icons/BrandIcons";
import { avatarColor, avatarInitials } from "../avatarUrl";
import { historyCanPushJar } from "../historyJarPush.ts";
import { parseHistoryImageTags } from "../branchImageResults";
import { useConfirmDialog } from "../hooks/useConfirmDialog";

const inputStyles = {
  input: {
    height: 34,
    minHeight: 34,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text)",
    fontSize: "var(--font-size-sm)",
  },
} as const;

const sidebarPaperStyles = {
  root: {
    background: "var(--color-bg-surface)",
    borderRight: "1px solid var(--color-border)",
    borderRadius: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    minHeight: 0,
  },
} as const;

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

function typeBadgeColor(label: string): string {
  if (label === "后端") return "orange";
  if (label === "前端+后端") return "grape";
  return "teal"; // 前端
}

interface HistoryPanelProps {
  buildHistory: BuildRecord[];
  isLoadingHistory: boolean;
  expandedRecordId: string | null;
  collapsedProjects: Set<string>;
  historySearch: string;
  isBuilding?: boolean;
  /** 仅历史页发起的推送会话才展示进度/日志（避免其它页残留 log） */
  showPushProgress?: boolean;
  pushingRecordId?: string | null;
  progress?: number;
  progressMessage?: string;
  log?: string;
  showBuildLog?: boolean;
  onLoadHistory: () => void;
  onClearHistory: () => void;
  onDeleteRecord: (record: BuildRecord) => void;
  onOpenArtifact: (path: string) => void;
  onCopyImage: (url: string) => void;
  onPushJar?: (record: BuildRecord) => void;
  onCancelBuild?: () => void;
  setShowBuildLog?: (show: boolean) => void;
  renderLog?: (text: string) => ReactNode;
}

function recordTypeLabel(record: BuildRecord): string {
  if (record.project_type.toLowerCase() === "maven") return "后端";
  return record.package_with_backend ? "前端+后端" : "前端";
}

function RecordCard({
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
}: {
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
}) {
  const typeLabel = recordTypeLabel(record);
  const isSuccess = record.status === "success" || record.status === "pushed";
  const statusColor = isSuccess ? "green" : "red";
  const statusLabel =
    record.status === "pushed" ? "已推送" : isSuccess ? "成功" : "失败";
  const images = record.image_tag ? parseHistoryImageTags(record.image_tag) : [];
  const labeled = record.package_with_backend && images.length > 1;
  const isMaven = record.project_type.toLowerCase() === "maven";

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
        <Box pt={1} className="history-record-status-icon">
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
              color: "#fff",
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
            <Badge variant="light" color="blue" size="xs" styles={badgeBase} title="分支">
              {record.branch}
            </Badge>
            <Badge
              variant="light"
              color={typeBadgeColor(typeLabel)}
              size="xs"
              className={`history-record-type ${record.project_type.toLowerCase()}`}
              styles={badgeBase}
            >
              {typeLabel}
            </Badge>
            <Badge variant="light" color="yellow" size="xs" styles={badgeBase} title="耗时">
              {(record.duration_ms / 1000).toFixed(1)}s
            </Badge>
            {!isMaven && record.package_manager && (
              <Badge
                variant="light"
                color="violet"
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
                color="cyan"
                size="xs"
                leftSection={<Coffee size={8} />}
                title="Spring Profile"
                styles={badgeBase}
              >
                {record.spring_profile}
              </Badge>
            )}
            {record.package_with_backend && (
              <Badge
                variant="light"
                color="orange"
                size="xs"
                leftSection={<Wrench size={8} />}
                title="包含后端"
                styles={badgeBase}
              >
                含后端
              </Badge>
            )}
            {!isMaven && record.frontend_dir && (
              <Badge
                variant="light"
                color="teal"
                size="xs"
                leftSection={<Folder size={8} />}
                title="前端目录"
                styles={badgeBase}
              >
                {record.frontend_dir}
              </Badge>
            )}
          </Group>
          {images.length > 0 && (
            <div className="history-record-images">
              {images.map((img, i) => (
                <HoverTip tip={img} key={`${img}-${i}`} className="history-record-image-wrap">
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
              ))}
            </div>
          )}
          <div className="history-record-paths">
            <div className="history-record-path history-record-detail-row">
              {isMaven && !record.backend_artifact_path ? (
                <span className="history-record-brand-icon history-record-brand-icon--baota" title="产物 (JAR)">
                  <BaotaIcon size={14} />
                </span>
              ) : record.backend_artifact_path ? (
                <span className="history-record-brand-icon" title="前端产物">
                  <Folder size={14} />
                </span>
              ) : (
                <span className="history-record-brand-icon" title="产物">
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
            </div>
            {record.backend_artifact_path && (
              <div className="history-record-path history-record-detail-row">
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
              </div>
            )}
          </div>
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

export function HistoryPanel({
  buildHistory, isLoadingHistory, expandedRecordId, collapsedProjects, historySearch,
  isBuilding = false, showPushProgress = false, pushingRecordId = null,
  progress = 0, progressMessage = "", log = "", showBuildLog = false,
  onLoadHistory, onClearHistory, onDeleteRecord, onOpenArtifact, onCopyImage, onPushJar,
  onCancelBuild, setShowBuildLog, renderLog,
}: HistoryPanelProps) {
  const { confirm } = useConfirmDialog();
  const [search, setSearch] = useState(historySearch);
  const [expandedId, setExpandedId] = useState<string | null>(expandedRecordId);
  const [_collapsedProjects] = useState<Set<string>>(collapsedProjects);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  void _collapsedProjects;

  const groupedRecords = useMemo(() => {
    return buildHistory.reduce((groups, record) => {
      const projectName = getProjectName(record.repo_path);
      if (!groups[projectName]) {
        groups[projectName] = {
          repoPath: record.repo_path,
          records: []
        };
      }
      groups[projectName].records.push(record);
      return groups;
    }, {} as Record<string, { repoPath: string; records: BuildRecord[] }>);
  }, [buildHistory]);

  const filteredGroupedRecords = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    if (!searchLower) return groupedRecords;

    const filtered: Record<string, { repoPath: string; records: BuildRecord[] }> = {};
    for (const [projectName, group] of Object.entries(groupedRecords)) {
      const matchedRecords = group.records.filter(r =>
        r.image_tag?.toLowerCase().includes(searchLower) ||
        r.image_name?.toLowerCase().includes(searchLower) ||
        r.branch.toLowerCase().includes(searchLower) ||
        r.repo_path.toLowerCase().includes(searchLower) ||
        r.artifact_path.toLowerCase().includes(searchLower) ||
        r.backend_artifact_path?.toLowerCase().includes(searchLower) ||
        projectName.toLowerCase().includes(searchLower)
      );
      if (matchedRecords.length > 0) {
        filtered[projectName] = { ...group, records: matchedRecords };
      }
    }
    return filtered;
  }, [groupedRecords, search]);

  const sortedProjects = Object.entries(filteredGroupedRecords).sort(([a], [b]) => a.localeCompare(b));
  const selectedProjectData = selectedProject ? filteredGroupedRecords[selectedProject] : null;

  useEffect(() => {
    if (sortedProjects.length === 1 && !selectedProject) {
      setSelectedProject(sortedProjects[0][0]);
    }
  }, [sortedProjects, selectedProject]);

  return (
    <Group align="stretch" gap={0} wrap="nowrap" className="history-panel-new" style={{ flex: 1, minHeight: 0 }}>
      <Paper w={200} styles={sidebarPaperStyles} className="history-sidebar">
        <Group justify="space-between" px="sm" pt="sm" pb={8} className="history-sidebar-header">
          <Group gap={6}>
            <Folder size={14} color="var(--color-text-muted)" />
            <Title order={5} c="var(--color-text)" fw={600} style={{ fontSize: 13 }}>
              项目列表
            </Title>
          </Group>
          <Badge variant="light" color="blue" size="xs" className="history-sidebar-count" styles={badgeBase}>
            {sortedProjects.length}
          </Badge>
        </Group>

        <Box px="xs" pb={6} className="history-sidebar-search-wrap">
          <TextInput
            size="sm"
            placeholder="搜索项目..."
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            leftSection={<Search size={14} />}
            rightSection={
              search ? (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => setSearch("")}
                  title="清除搜索"
                  aria-label="清除搜索"
                >
                  ✕
                </ActionIcon>
              ) : null
            }
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            styles={{ ...inputStyles, input: { ...inputStyles.input, textTransform: "none" } }}
            className="history-sidebar-search"
          />
        </Box>

        <ScrollArea flex={1} type="auto" className="history-sidebar-list">
          {isLoadingHistory ? (
            <Stack align="center" justify="center" py="xl" gap="xs" className="history-sidebar-loading">
              <Text ta="center" c="var(--color-text-muted)" size="sm">
                加载中...
              </Text>
            </Stack>
          ) : sortedProjects.length === 0 ? (
            <Stack align="center" justify="center" py="xl" gap={8} className="history-sidebar-empty">
              <Box className="history-empty-icon-circle">
                <Folder size={20} color="var(--color-text-muted)" />
              </Box>
              <Text ta="center" c="var(--color-text-muted)" size="xs">
                暂无项目
              </Text>
            </Stack>
          ) : (
            <Stack gap={2} p="xs">
              {sortedProjects.map(([projectName, { records }]) => {
                const isActive = selectedProject === projectName;
                return (
                  <UnstyledButton
                    key={projectName}
                    onClick={() => setSelectedProject(projectName)}
                    className={`history-sidebar-item ${isActive ? "active" : ""}`}
                  >
                    <Box className="history-sidebar-item-icon">
                      <Folder size={16} />
                    </Box>
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        size="sm"
                        fw={isActive ? 600 : 500}
                        truncate
                        className="history-sidebar-item-name"
                      >
                        {projectName}
                      </Text>
                      <Text size="xs" c="var(--color-text-muted)" className="history-sidebar-item-meta">
                        {records.length} 条记录
                      </Text>
                    </Stack>
                    <ChevronRight
                      size={14}
                      className="history-sidebar-item-arrow"
                    />
                  </UnstyledButton>
                );
              })}
            </Stack>
          )}
        </ScrollArea>
      </Paper>

      <Stack flex={1} gap={0} className="history-content" style={{ minWidth: 0, minHeight: 0 }}>
        {showPushProgress && (isBuilding || Boolean(log)) && (
          <Paper p="md" radius={0} className="history-push-progress" styles={{
            root: {
              background: "var(--color-bg-surface)",
              borderBottom: "1px solid var(--color-border)",
            },
          }}>
            <Stack gap="sm">
              {isBuilding && (
                <Stack gap="xs" className="progress-section">
                  <Group justify="space-between">
                    <Text size="sm" c="var(--color-text)">{progressMessage || "推送中..."}</Text>
                    <Text size="sm" c="var(--color-text-muted)" fw={600}>{progress}%</Text>
                  </Group>
                  <Progress value={progress} color="cyan" size="sm" radius="xl" />
                </Stack>
              )}
              {isBuilding && onCancelBuild && (
                <Button
                  variant="light"
                  color="gray"
                  className="cancel-btn"
                  onClick={onCancelBuild}
                  leftSection={<XCircle size={16} />}
                >
                  取消推送
                </Button>
              )}
              {log && setShowBuildLog && renderLog && (
                <Stack gap="xs" className="log-section">
                  <Button
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    className="log-toggle-btn"
                    onClick={() => setShowBuildLog(!showBuildLog)}
                    title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                    leftSection={showBuildLog ? <EyeOff size={14} /> : <Eye size={14} />}
                  >
                    {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                  </Button>
                  {showBuildLog && (
                    <ScrollArea.Autosize mah={300} type="auto">
                      <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                        {renderLog(log)}
                      </div>
                    </ScrollArea.Autosize>
                  )}
                </Stack>
              )}
            </Stack>
          </Paper>
        )}

        {!selectedProject ? (
          <Stack align="center" justify="center" flex={1} gap={8} className="history-content-empty">
            <Box className="history-empty-icon-circle history-content-empty-icon-wrap">
              <History size={22} color="var(--color-text-muted)" className="history-content-empty-icon" />
            </Box>
            <Title order={4} c="var(--color-text)" fw={600} style={{ fontSize: 14 }}>
              选择项目
            </Title>
            <Text size="xs" c="var(--color-text-muted)">
              从左侧列表查看打包记录
            </Text>
          </Stack>
        ) : selectedProjectData ? (
          <Stack flex={1} gap={0} className="history-content-body" style={{ minHeight: 0 }}>
            <Group
              justify="space-between"
              align="flex-start"
              px="md"
              py="sm"
              wrap="wrap"
              className="history-content-header"
              styles={{ root: { borderBottom: "1px solid var(--color-border)" } }}
            >
              <Stack gap={2} className="history-content-header-info">
                <Group gap={6}>
                  <Folder size={16} color="var(--color-text-muted)" />
                  <Title order={2} c="var(--color-text)" style={{ fontSize: 16 }}>
                    {selectedProject}
                  </Title>
                </Group>
                <HoverTip tip={selectedProjectData.repoPath} className="history-content-header-path-wrap">
                  <Text size="xs" c="var(--color-text-muted)" truncate className="history-content-header-path">
                    {selectedProjectData.repoPath}
                  </Text>
                </HoverTip>
              </Stack>
              <Group gap={6} className="history-content-header-actions">
                {buildHistory.length > 0 && (
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-sm"
                    className="history-action-btn danger"
                    leftSection={<Trash2 size={13} />}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: "清空历史",
                          message: "确定要清空所有打包历史吗？删除后将同时清理产物文件，且不可恢复。",
                          variant: "danger",
                          confirmLabel: "清空",
                        });
                        if (ok) onClearHistory();
                      })();
                    }}
                  >
                    清空
                  </Button>
                )}
                <Button
                  variant="default"
                  color="gray"
                  size="compact-sm"
                  className="history-action-btn"
                  leftSection={<RefreshCw size={13} />}
                  onClick={onLoadHistory}
                >
                  刷新
                </Button>
              </Group>
            </Group>

            <ScrollArea flex={1} type="auto" p="sm" className="history-content-records">
              <Stack gap="sm" className="history-content-records-stack">
                {selectedProjectData.records.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    expandedId={expandedId}
                    isBuilding={isBuilding}
                    pushingRecordId={pushingRecordId}
                    onPushJar={onPushJar}
                    onOpenArtifact={onOpenArtifact}
                    onCopyImage={onCopyImage}
                    setExpandedId={setExpandedId}
                    onDeleteRecord={onDeleteRecord}
                    confirm={confirm}
                  />
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        ) : (
          <Stack align="center" justify="center" flex={1} gap={8} className="history-content-empty">
            <Box className="history-empty-icon-circle history-content-empty-icon-wrap">
              <History size={22} color="var(--color-text-muted)" className="history-content-empty-icon" />
            </Box>
            <Title order={4} c="var(--color-text)" fw={600} style={{ fontSize: 14 }}>
              暂无记录
            </Title>
            <Text size="xs" c="var(--color-text-muted)">
              该项目还没有打包历史
            </Text>
          </Stack>
        )}
      </Stack>
    </Group>
  );
}
