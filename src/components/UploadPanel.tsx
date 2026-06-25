import {
  Rocket, Package, FileText,
  Loader2, Eye, EyeOff, XCircle
} from "lucide-react";
import type { ArtifactType } from "../types";
import { getPathName } from "../types";

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
  onArtifactTypeChange, onSelectFile, onBuildAndPush, onCancelBuild,
  onDragOver, onDragLeave, onDrop,
  setImageName, setImageTag, setExposePort, setShowImageConfig, setShowBuildLog,
  renderLog,
}: UploadPanelProps) {
  return (
    <div className="upload-panel">
      <div className="artifact-type-selector">
        <button
          type="button"
          className={`artifact-type ${artifactType === "jar" ? "active" : ""}`}
          onClick={() => onArtifactTypeChange("jar")}
        >
          <FileText size={16} /> JAR 应用
        </button>
        <button
          type="button"
          className={`artifact-type ${artifactType === "frontend_dist" ? "active" : ""}`}
          onClick={() => onArtifactTypeChange("frontend_dist")}
        >
          <Package size={16} /> 前端 dist
        </button>
      </div>

      <div
        className={`drop-zone ${isDragOver ? "drag-over" : ""} ${artifactPath ? "has-file" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onSelectFile}
      >
        {artifactPath ? (
          <div className="file-info">
            {artifactType === "jar" ? (
              <FileText size={40} strokeWidth={1.5} className="file-icon" />
            ) : (
              <Package size={40} strokeWidth={1.5} className="file-icon" />
            )}
            <span className="file-name">
              {getPathName(artifactPath)}
            </span>
            <span className="file-path">{artifactPath}</span>
          </div>
        ) : (
          <div className="drop-hint">
            <Package size={64} strokeWidth={1.5} className="drop-icon" />
            <p>{artifactType === "jar" ? "拖拽JAR文件到这里" : "拖拽前端 dist 目录到这里"}</p>
            <p className="drop-sub">{artifactType === "jar" ? "或点击选择文件" : "或点击选择目录"}</p>
          </div>
        )}
      </div>

      <div className="advanced-settings">
        <div
          className="advanced-settings-header"
          onClick={() => setShowImageConfig(!showImageConfig)}
        >
          <span>{showImageConfig ? '▼' : '▶'}</span>
          <span>镜像配置</span>
          <span className="template-hint" style={{ marginLeft: '8px' }}>可选：自定义镜像名称和标签</span>
        </div>
        {showImageConfig && (
          <>
            <div className="form-group">
              <label>镜像名称</label>
              <input
                type="text"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                placeholder="例如: my-app"
              />
            </div>
            <div className="form-group">
              <label>镜像标签</label>
              <input
                type="text"
                value={imageTag}
                onChange={(e) => setImageTag(e.target.value)}
                placeholder="留空则自动生成 v.YY.MM.DD.HH.MM"
              />
            </div>
            {artifactType === "jar" && (
              <div className="form-group">
                <label>JAR 暴露端口</label>
                <input
                  type="text"
                  value={exposePort}
                  onChange={(e) => setExposePort(e.target.value)}
                  placeholder="默认: 8181"
                />
                <p className="template-hint">留空则使用配置中的默认端口</p>
              </div>
            )}
          </>
        )}
      </div>

      <button
        className="build-btn"
        onClick={onBuildAndPush}
        disabled={isBuilding || !artifactPath}
      >
        {isBuilding ? (
          <>
            <Loader2 size={18} className="spin" /> 构建推送中...
          </>
        ) : (
          <>
            <Rocket size={18} /> 构建并推送到Harbor
          </>
        )}
      </button>

      {isBuilding && (
        <div className="progress-section">
          <div className="progress-info">
            <span className="progress-message">{progressMessage}</span>
            <span className="progress-percent">{progress}%</span>
          </div>
          <div className="progress-track">
            <div
              className="progress-bar"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {isBuilding && (
        <button className="cancel-btn" onClick={onCancelBuild}>
          <XCircle size={16} /> 取消构建
        </button>
      )}

      {log && (
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
  );
}
