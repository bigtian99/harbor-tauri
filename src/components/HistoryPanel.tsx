import { useState } from "react";
import {
  History, CheckCircle, Copy, Trash2, RefreshCw, Search,
  FolderOpen, FileText, BookOpen, BookMarked, Folder,
  Coffee, Package, Wrench
} from "lucide-react";
import type { BuildRecord } from "../types";
import { getProjectName } from "../types";

interface HistoryPanelProps {
  buildHistory: BuildRecord[];
  isLoadingHistory: boolean;
  expandedRecordId: string | null;
  collapsedProjects: Set<string>;
  historySearch: string;
  onLoadHistory: () => void;
  onClearHistory: () => void;
  onDeleteRecord: (record: BuildRecord) => void;
  onOpenArtifact: (path: string) => void;
  onCopyImage: (url: string) => void;
}

export function HistoryPanel({
  buildHistory, isLoadingHistory, expandedRecordId, collapsedProjects, historySearch,
  onLoadHistory, onClearHistory, onDeleteRecord, onOpenArtifact, onCopyImage,
}: HistoryPanelProps) {
  const [search, setSearch] = useState(historySearch);
  const [expandedId, setExpandedId] = useState<string | null>(expandedRecordId);
  const [collapsed, setCollapsed] = useState<Set<string>>(collapsedProjects);

  function toggleProjectCollapse(projectName: string) {
    setCollapsed(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectName)) {
        newSet.delete(projectName);
      } else {
        newSet.add(projectName);
      }
      return newSet;
    });
  }

  // 按项目分组
  let groupedRecords = buildHistory.reduce((groups, record) => {
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

  const searchLower = search.trim().toLowerCase();
  if (searchLower) {
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
    groupedRecords = filtered;
  }

  const sortedProjects = Object.entries(groupedRecords).sort(([a], [b]) => a.localeCompare(b));
  const isSearching = searchLower.length > 0;

  return (
    <div className="history-panel">
      <div className="history-header">
        <h2><History size={20} /> 历史打包记录</h2>
        <div className="history-header-actions">
          {buildHistory.length > 0 && (
            <button
              className="modal-trigger-btn"
              onClick={() => {
                if (confirm('确定要清空所有打包历史吗？删除后将同时清理产物文件。')) {
                  onClearHistory();
                }
              }}
            >
              <Trash2 size={14} />
              清空历史
            </button>
          )}
          <button className="modal-trigger-btn" onClick={onLoadHistory}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {isLoadingHistory ? (
        <div className="modal-loading">加载中...</div>
      ) : buildHistory.length === 0 ? (
        <div className="modal-empty">暂无打包记录</div>
      ) : (
        <>
          <div className="history-search-bar">
            <Search size={14} className="history-search-icon" />
            <input
              type="text"
              className="history-search-input"
              placeholder="搜索 Docker 镜像地址 / 分支名 / 项目名..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="history-search-clear"
                onClick={() => setSearch("")}
                title="清除搜索"
              >
                ✕
              </button>
            )}
          </div>
          <div className="modal-list">
            {sortedProjects.map(([projectName, { repoPath, records }]) => (
              <div key={projectName} className="project-group">
                <div
                  className="project-group-header"
                  onClick={() => toggleProjectCollapse(projectName)}
                >
                  <span className={`project-group-arrow ${collapsed.has(projectName) ? 'collapsed' : ''}`}>
                    ▼
                  </span>
                  <span className="project-group-name">{projectName}</span>
                  <span className="project-group-count">({records.length} 条记录)</span>
                  <span className="project-group-path" title={repoPath}>{repoPath}</span>
                </div>
                {(!collapsed.has(projectName) || isSearching) && (
                  <div className="project-group-items">
                    {records.map((record) => (
                      <div key={record.id} className={`modal-history-item ${record.status}`}>
                        <div className="modal-history-item-header">
                          <span className={`history-status ${record.status}`}>
                            {record.status === 'success' || record.status === 'pushed' ? <CheckCircle size={16} /> : <span>✗</span>}
                          </span>
                          <div className="modal-history-item-info">
                            <div className="modal-history-item-row">
                              <span className="history-time">{record.timestamp}</span>
                              <span className="history-branch">{record.branch}</span>
                              <span className={`history-project-type ${record.project_type.toLowerCase()}`}>
                                {record.project_type.toLowerCase() === 'maven' ? '后端' : record.package_with_backend ? '前端+后端' : '前端'}
                              </span>
                              <span className="history-meta">耗时: {(record.duration_ms / 1000).toFixed(1)}s</span>
                              {record.project_type.toLowerCase() !== 'maven' && record.package_manager && (
                                <span className="history-config-tag" title="包管理器">
                                  <Package size={12} /> {record.package_manager}
                                </span>
                              )}
                              {(record.project_type.toLowerCase() === 'maven' || record.package_with_backend) && record.spring_profile && (
                                <span className="history-config-tag" title="Spring Profile">
                                  <Coffee size={12} /> {record.spring_profile}
                                </span>
                              )}
                              {record.package_with_backend && (
                                <span className="history-config-tag" title="包含后端">
                                  <Wrench size={12} /> 含后端
                                </span>
                              )}
                              {record.project_type.toLowerCase() !== 'maven' && record.frontend_dir && (
                                <span className="history-config-tag" title="前端目录">
                                  <Folder size={12} /> {record.frontend_dir}
                                </span>
                              )}
                              {record.image_tag && (
                                <span className="history-image">
                                  <span className="history-image-text">{record.image_tag}</span>
                                  <button
                                    className="history-copy-btn"
                                    title="复制镜像地址"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCopyImage(record.image_tag!);
                                    }}
                                  >
                                    <Copy size={12} />
                                  </button>
                                </span>
                              )}
                            </div>
                            <div className="modal-history-item-path">
                              <div className="path-item">
                                <span className="path-label">{record.project_type.toLowerCase() === 'maven' ? '后端' : record.package_with_backend ? '前端+后端' : '前端'}</span>
                                <button
                                  className="path-link-btn"
                                  onClick={() => onOpenArtifact(record.artifact_path)}
                                  title={record.artifact_path}
                                >
                                  {record.artifact_path}
                                </button>
                                <button
                                  className="path-open-btn"
                                  onClick={() => onOpenArtifact(record.artifact_path)}
                                  title="打开目录"
                                >
                                  <FolderOpen size={12} />
                                </button>
                              </div>
                              {record.backend_artifact_path && (
                                <div className="path-item">
                                  <span className="path-label">后端</span>
                                  <button
                                    className="path-link-btn"
                                    onClick={() => onOpenArtifact(record.backend_artifact_path!)}
                                    title={record.backend_artifact_path}
                                  >
                                    {record.backend_artifact_path}
                                  </button>
                                  <button
                                    className="path-open-btn"
                                    onClick={() => onOpenArtifact(record.backend_artifact_path!)}
                                    title="打开目录"
                                  >
                                    <FolderOpen size={12} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="modal-history-item-actions">
                            <button
                              className="history-action-btn"
                              onClick={() => onOpenArtifact(record.artifact_path)}
                              title="打开产物目录"
                            >
                              <Folder size={14} />
                            </button>
                            {record.backend_artifact_path && (
                              <button
                                className="history-action-btn"
                                onClick={() => onOpenArtifact(record.backend_artifact_path!)}
                                title="打开后端产物"
                              >
                                <FileText size={14} />
                              </button>
                            )}
                            <button
                              className="history-action-btn"
                              onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                              title={expandedId === record.id ? "收起日志" : "展开日志"}
                            >
                              {expandedId === record.id ? <BookMarked size={14} /> : <BookOpen size={14} />}
                            </button>
                            <button
                              className="history-action-btn delete"
                              onClick={() => {
                                if (confirm('确定要删除这条记录吗？删除后将同时清理产物文件。')) {
                                  onDeleteRecord(record);
                                }
                              }}
                              title="删除记录"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {expandedId === record.id && (
                          <div className="modal-history-log">
                            <div className="log-content">{record.full_log}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
