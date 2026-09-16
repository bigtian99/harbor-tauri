import { useState, useMemo, useEffect } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  History, Trash2, RefreshCw, Search,
  Folder, ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";
import type { BuildRecord } from "../types";
import { getProjectName } from "../types";
import { HoverTip } from "./HoverTip";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { PanelPageHeader } from "./PanelPageHeader";
import { BuildProgressBlock, BUILD_LOG_LABELS } from "./BuildProgressBlock";
import { HistoryRecordCard } from "./history/HistoryRecordCard";

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

interface HistoryPanelProps {
  buildHistory: BuildRecord[];
  isLoadingHistory: boolean;
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

export function HistoryPanel({
  buildHistory, isLoadingHistory,
  isBuilding = false, showPushProgress = false, pushingRecordId = null,
  progress = 0, progressMessage = "", log = "", showBuildLog = false,
  onLoadHistory, onClearHistory, onDeleteRecord, onOpenArtifact, onCopyImage, onPushJar,
  onCancelBuild, setShowBuildLog, renderLog,
}: HistoryPanelProps) {
  const { confirm } = useConfirmDialog();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

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
    <Stack gap="sm" className="history-panel-shell" style={{ flex: 1, minHeight: 0 }}>
      <PanelPageHeader
        eyebrow="BUILD HISTORY → REPUSH"
        title="历史记录"
        sub="按项目浏览本机构建产物与镜像，支持再次推送 Harbor"
      />
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
            styles={{ input: { textTransform: "none" } }}
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
        {showPushProgress && (isBuilding || Boolean(log)) && setShowBuildLog && renderLog && (
          <Paper p="md" radius={0} className="history-push-progress" styles={{
            root: {
              background: "var(--color-bg-surface)",
              borderBottom: "1px solid var(--color-border)",
            },
          }}>
            <Stack gap="sm">
              <BuildProgressBlock
                showProgress={isBuilding}
                progress={progress}
                progressMessage={progressMessage}
                progressMessageFallback="推送中..."
                progressTextSize="sm"
                progressPercentTone="history"
                progressLayout="stack"
                showCancel={Boolean(isBuilding && onCancelBuild)}
                onCancel={onCancelBuild}
                cancelLabel="取消推送"
                cancelPlacement="below"
                cancelVariant="light-gray"
                cancelClassName="cancel-btn"
                log={log}
                showBuildLog={showBuildLog}
                setShowBuildLog={setShowBuildLog}
                renderLog={renderLog}
                logLabels={BUILD_LOG_LABELS}
                logExpandMode="toggle"
              />
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
                  <HistoryRecordCard
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
    </Stack>
  );
}
