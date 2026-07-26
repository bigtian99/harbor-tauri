import { useState, useMemo, useEffect } from "react";
import {
  History, CheckCircle, Copy, Trash2, RefreshCw, Search,
  FolderOpen, FileText, BookOpen, BookMarked, Folder,
  Coffee, Package, Wrench, ChevronRight, Clock, Rocket, Loader2,
  XCircle, Eye, EyeOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { BuildRecord } from "../types";
import { getProjectName, isTauriRuntime } from "../types";
import { HoverTip } from "./HoverTip";
import { avatarColor, avatarInitials } from "../avatarUrl";
import { historyCanPushJar } from "../historyJarPush.ts";

async function confirmDanger(message: string, title: string): Promise<boolean> {
  if (isTauriRuntime()) {
    return ask(message, { title, kind: "warning" });
  }
  return window.confirm(message);
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

export function HistoryPanel({
  buildHistory, isLoadingHistory, expandedRecordId, collapsedProjects, historySearch,
  isBuilding = false, showPushProgress = false, pushingRecordId = null,
  progress = 0, progressMessage = "", log = "", showBuildLog = false,
  onLoadHistory, onClearHistory, onDeleteRecord, onOpenArtifact, onCopyImage, onPushJar,
  onCancelBuild, setShowBuildLog, renderLog,
}: HistoryPanelProps) {
  const [search, setSearch] = useState(historySearch);
  const [expandedId, setExpandedId] = useState<string | null>(expandedRecordId);
  // collapsedProjects 保留用于接口兼容性
  const [_collapsedProjects] = useState<Set<string>>(collapsedProjects);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // 使用 _collapsedProjects 避免未使用警告
  void _collapsedProjects;

  // 按项目分组
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

  // 搜索过滤
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
    <div className="history-panel-new">
      {/* 左侧项目列表 */}
      <div className="history-sidebar">
        <div className="history-sidebar-header">
          <h3>
            <Folder size={16} />
            项目列表
          </h3>
          <span className="history-sidebar-count">{sortedProjects.length}</span>
        </div>

        <div className="history-sidebar-search">
          <Search size={14} className="history-sidebar-search-icon" />
          <input
            type="text"
            className="history-sidebar-search-input"
            placeholder="搜索项目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="history-sidebar-search-clear"
              onClick={() => setSearch("")}
              title="清除搜索"
            >
              ✕
            </button>
          )}
        </div>

        <div className="history-sidebar-list">
          {isLoadingHistory ? (
            <div className="history-sidebar-loading">加载中...</div>
          ) : sortedProjects.length === 0 ? (
            <div className="history-sidebar-empty">暂无项目</div>
          ) : (
            sortedProjects.map(([projectName, { records }]) => (
              <div
                key={projectName}
                className={`history-sidebar-item ${selectedProject === projectName ? 'active' : ''}`}
                onClick={() => setSelectedProject(projectName)}
              >
                <div className="history-sidebar-item-icon">
                  <Folder size={16} />
                </div>
                <div className="history-sidebar-item-content">
                  <div className="history-sidebar-item-name">{projectName}</div>
                  <div className="history-sidebar-item-meta">{records.length} 条记录</div>
                </div>
                <ChevronRight size={14} className="history-sidebar-item-arrow" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧打包记录 */}
      <div className="history-content">
        {showPushProgress && (isBuilding || Boolean(log)) && (
          <div className="history-push-progress">
            {isBuilding && (
              <div className="progress-section">
                <div className="progress-info">
                  <span className="progress-message">{progressMessage || "推送中..."}</span>
                  <span className="progress-percent">{progress}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            {isBuilding && onCancelBuild && (
              <button type="button" className="cancel-btn" onClick={onCancelBuild}>
                <XCircle size={16} /> 取消推送
              </button>
            )}
            {log && setShowBuildLog && renderLog && (
              <div className="log-section">
                <button
                  type="button"
                  className="log-toggle-btn"
                  onClick={() => setShowBuildLog(!showBuildLog)}
                  title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                >
                  {showBuildLog ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                </button>
                {showBuildLog && (
                  <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                    {renderLog(log)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {!selectedProject ? (
          <div className="history-content-empty">
            <div className="history-content-empty-icon">
              <History size={48} />
            </div>
            <h3>选择项目查看打包记录</h3>
            <p>从左侧项目列表中选择一个项目</p>
          </div>
        ) : selectedProjectData ? (
          <div className="history-content-body">
            <div className="history-content-header">
              <div className="history-content-header-info">
                <h2>
                  <Folder size={20} />
                  {selectedProject}
                </h2>
                <HoverTip tip={selectedProjectData.repoPath} className="history-content-header-path-wrap">
                  <span className="history-content-header-path">
                    {selectedProjectData.repoPath}
                  </span>
                </HoverTip>
              </div>
              <div className="history-content-header-actions">
                {buildHistory.length > 0 && (
                  <button
                    className="history-action-btn danger"
                    onClick={() => {
                      void (async () => {
                        const ok = await confirmDanger(
                          "确定要清空所有打包历史吗？\n\n删除后将同时清理产物文件，且不可恢复。",
                          "清空历史",
                        );
                        if (ok) onClearHistory();
                      })();
                    }}
                  >
                    <Trash2 size={14} />
                    清空历史
                  </button>
                )}
                <button className="history-action-btn" onClick={onLoadHistory}>
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
            </div>

            <div className="history-content-records">
              {selectedProjectData.records.map((record) => (
                <div key={record.id} className={`history-record-card ${record.status}`}>
                  <div className="history-record-header">
                    <div className="history-record-status">
                      {record.status === 'success' || record.status === 'pushed' ? (
                        <CheckCircle size={18} />
                      ) : (
                        <span className="history-record-status-failed">✗</span>
                      )}
                    </div>
                    {record.author && (
                      <span
                        className="history-record-avatar"
                        style={{ background: avatarColor(record.email || record.author) }}
                        title={record.author}
                        aria-hidden
                      >
                        {avatarInitials(record.author || record.email || "?")}
                      </span>
                    )}
                    <div className="history-record-info">
                      <div className="history-record-meta">
                        <span className="history-record-time">
                          <Clock size={12} />
                          {record.timestamp}
                        </span>
                        <span className="history-record-branch">{record.branch}</span>
                        <span className={`history-record-type ${record.project_type.toLowerCase()}`}>
                          {record.project_type.toLowerCase() === 'maven' ? '后端' : record.package_with_backend ? '前端+后端' : '前端'}
                        </span>
                        <span className="history-record-duration">耗时: {(record.duration_ms / 1000).toFixed(1)}s</span>
                        {record.project_type.toLowerCase() !== 'maven' && record.package_manager && (
                          <span className="history-record-config" title="包管理器">
                            <Package size={12} /> {record.package_manager}
                          </span>
                        )}
                        {(record.project_type.toLowerCase() === 'maven' || record.package_with_backend) && record.spring_profile && (
                          <span className="history-record-config" title="Spring Profile">
                            <Coffee size={12} /> {record.spring_profile}
                          </span>
                        )}
                        {record.package_with_backend && (
                          <span className="history-record-config" title="包含后端">
                            <Wrench size={12} /> 含后端
                          </span>
                        )}
                        {record.project_type.toLowerCase() !== 'maven' && record.frontend_dir && (
                          <span className="history-record-config" title="前端目录">
                            <Folder size={12} /> {record.frontend_dir}
                          </span>
                        )}
                      </div>
                      {record.image_tag && (
                        <HoverTip tip={record.image_tag} className="history-record-image-wrap">
                          <div className="history-record-image">
                            <span className="history-record-image-text">{record.image_tag}</span>
                            <button
                              className="history-record-copy-btn"
                              title="复制镜像地址"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCopyImage(record.image_tag!);
                              }}
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </HoverTip>
                      )}
                    </div>
                    <div className="history-record-actions">
                      {onPushJar && historyCanPushJar(record) && (
                        <button
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
                        </button>
                      )}
                      <button
                        className="history-record-action"
                        onClick={() => onOpenArtifact(record.artifact_path)}
                        title="打开产物目录"
                      >
                        <FolderOpen size={14} />
                      </button>
                      {record.backend_artifact_path && (
                        <button
                          className="history-record-action"
                          onClick={() => onOpenArtifact(record.backend_artifact_path!)}
                          title="打开后端产物"
                        >
                          <FileText size={14} />
                        </button>
                      )}
                      <button
                        className="history-record-action"
                        onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                        title={expandedId === record.id ? "收起日志" : "展开日志"}
                      >
                        {expandedId === record.id ? <BookMarked size={14} /> : <BookOpen size={14} />}
                      </button>
                      <button
                        className="history-record-action danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void (async () => {
                            const ok = await confirmDanger(
                              `确定要删除这条打包记录吗？\n\n分支：${record.branch}\n产物将一并清理，删除后不可恢复。`,
                              "删除记录",
                            );
                            if (ok) onDeleteRecord(record);
                          })();
                        }}
                        title="删除记录"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="history-record-paths">
                    <div className="history-record-path">
                      <span className="history-record-path-label">{record.project_type.toLowerCase() === 'maven' ? '后端' : record.package_with_backend ? '前端+后端' : '前端'}</span>
                      <HoverTip tip={record.artifact_path} className="history-record-path-link-wrap">
                        <button
                          className="history-record-path-link"
                          onClick={() => onOpenArtifact(record.artifact_path)}
                        >
                          {record.artifact_path}
                        </button>
                      </HoverTip>
                      <button
                        className="history-record-path-open"
                        onClick={() => onOpenArtifact(record.artifact_path)}
                        title="打开目录"
                      >
                        <FolderOpen size={12} />
                      </button>
                    </div>
                    {record.backend_artifact_path && (
                      <div className="history-record-path">
                        <span className="history-record-path-label">后端</span>
                        <HoverTip tip={record.backend_artifact_path!} className="history-record-path-link-wrap">
                          <button
                            className="history-record-path-link"
                            onClick={() => onOpenArtifact(record.backend_artifact_path!)}
                          >
                            {record.backend_artifact_path}
                          </button>
                        </HoverTip>
                        <button
                          className="history-record-path-open"
                          onClick={() => onOpenArtifact(record.backend_artifact_path!)}
                          title="打开目录"
                        >
                          <FolderOpen size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  {expandedId === record.id && (
                    <div className="history-record-log">
                      <div className="history-record-log-content">{record.full_log}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="history-content-empty">
            <div className="history-content-empty-icon">
              <History size={48} />
            </div>
            <h3>暂无打包记录</h3>
            <p>该项目还没有打包记录</p>
          </div>
        )}
      </div>
    </div>
  );
}
