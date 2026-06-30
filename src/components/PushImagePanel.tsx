import {
  Rocket, Loader2, Eye, EyeOff, XCircle, CheckCircle, Copy, RefreshCw
} from "lucide-react";
import { SearchableDropdown } from "./SearchableDropdown";

interface PushImagePanelProps {
  localImage: string;
  localImageOptions: string[];
  isLoadingImages: boolean;
  imageName: string;
  imageTag: string;
  isBuilding: boolean;
  showImageConfig: boolean;
  showBuildLog: boolean;
  progress: number;
  progressMessage: string;
  log: string;
  fullImage: string;
  copied: boolean;
  onCopyImage: (imageUrl: string) => void;
  onPushImage: () => void;
  onCancelBuild: () => void;
  onRefreshImages: () => void;
  setLocalImage: (value: string) => void;
  setImageName: (value: string) => void;
  setImageTag: (value: string) => void;
  setShowImageConfig: (show: boolean) => void;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => React.ReactNode;
}

export function PushImagePanel({
  localImage, localImageOptions, isLoadingImages,
  imageName, imageTag,
  isBuilding, showImageConfig, showBuildLog,
  progress, progressMessage, log,
  fullImage, copied, onCopyImage,
  onPushImage, onCancelBuild, onRefreshImages,
  setLocalImage, setImageName, setImageTag,
  setShowImageConfig, setShowBuildLog,
  renderLog,
}: PushImagePanelProps) {
  return (
    <div className="upload-panel">
      {/* 本地镜像引用选择（可搜索下拉框 + 刷新按钮） */}
      <div className="form-group">
        <label>本地镜像引用</label>
        <div className="path-picker-row">
          <div className="searchable-dropdown-wrapper">
            <SearchableDropdown
              value={localImage}
              options={localImageOptions}
              onChange={setLocalImage}
              placeholder={isLoadingImages ? "加载中..." : localImageOptions.length === 0 ? "搜索或输入镜像名称..." : "搜索本地镜像或手动输入..."}
              disabled={isLoadingImages}
              loading={isLoadingImages}
            />
          </div>
          <button
            type="button"
            className="path-picker-btn"
            onClick={onRefreshImages}
            disabled={isLoadingImages}
          >
            {isLoadingImages ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} {isLoadingImages ? "加载中" : "刷新"}
          </button>
        </div>
        <p className="template-hint">
          {localImage
            ? `已选择: ${localImage}`
            : "选择本地已有镜像或手动输入镜像引用（如 my-app:latest、nginx:alpine）"}
        </p>
      </div>

      {/* 镜像配置：目标镜像名称和标签 */}
      <div className="advanced-settings">
        <div
          className="advanced-settings-header"
          onClick={() => setShowImageConfig(!showImageConfig)}
        >
          <span>{showImageConfig ? '▼' : '▶'}</span>
          <span>镜像配置</span>
          <span className="template-hint" style={{ marginLeft: '8px' }}>可选：自定义目标镜像名称和标签</span>
        </div>
        {showImageConfig && (
          <>
            <div className="form-group">
              <label>目标镜像名称</label>
              <input
                type="text"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                placeholder="例如: my-app（不含 Harbor 项目名）"
              />
            </div>
            <div className="form-group">
              <label>目标镜像标签</label>
              <input
                type="text"
                value={imageTag}
                onChange={(e) => setImageTag(e.target.value)}
                placeholder="留空则自动生成 v.YY.MM.DD.HH.MM"
              />
            </div>
          </>
        )}
      </div>

      {/* 推送按钮 */}
      <button
        className="build-btn"
        onClick={onPushImage}
        disabled={isBuilding || !localImage.trim()}
      >
        {isBuilding ? (
          <>
            <Loader2 size={18} className="spin" /> 推送中...
          </>
        ) : (
          <>
            <Rocket size={18} /> 推送到 Harbor
          </>
        )}
      </button>

      {/* 进度条 */}
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

      {/* 取消按钮 */}
      {isBuilding && (
        <button className="cancel-btn" onClick={onCancelBuild}>
          <XCircle size={16} /> 取消推送
        </button>
      )}

      {/* 推送成功后的镜像地址 */}
      {fullImage && (
        <div
          className="path-links"
          style={{ marginTop: 10, border: 'none', background: 'transparent', padding: 0 }}
        >
          <div className="path-link-item image-url-row">
            <span className="path-link-label">🐳 完整镜像:</span>
            <span className="image-url-value">
              <span style={{ display: 'block' }} title={fullImage}>{fullImage}</span>
            </span>
            <button
              className={`copy-btn ${copied ? "copied" : ""}`}
              onClick={() => onCopyImage(fullImage)}
              title="复制镜像地址"
            >
              {copied ? (
                <>
                  <CheckCircle size={14} /> 已复制
                </>
              ) : (
                <>
                  <Copy size={14} /> 复制
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 日志区域 */}
      {log && (
        <div className="log-section">
          <button
            type="button"
            className="log-toggle-btn"
            onClick={() => setShowBuildLog(!showBuildLog)}
            title={showBuildLog ? "隐藏推送日志" : "展开推送日志"}
          >
            {showBuildLog ? <EyeOff size={14} /> : <Eye size={14} />}
            {showBuildLog ? "隐藏推送日志" : "展开推送日志"}
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
