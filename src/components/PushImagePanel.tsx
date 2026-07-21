import { useMemo, useState } from "react";
import {
  Rocket, Loader2, Eye, EyeOff, XCircle, CheckCircle, Copy, RefreshCw, Box, Search, Trash2, Lock
} from "lucide-react";
import type { LocalImageInfo } from "../hooks/useUploadPush";

interface PushImagePanelProps {
  localImage: string;
  localImageOptions: LocalImageInfo[];
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
  onRemoveImage: (image: string) => void | Promise<void>;
  setLocalImage: (value: string) => void;
  setImageName: (value: string) => void;
  setImageTag: (value: string) => void;
  setShowImageConfig: (show: boolean) => void;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => React.ReactNode;
}

/** 展示用：拆出仓库路径与 tag（不裁成短名） */
function parseImageDisplay(ref: string): { repo: string; tag: string } {
  const t = ref.trim();
  if (!t) return { repo: "", tag: "" };
  if (t.startsWith("sha256:")) {
    return { repo: `${t.slice(0, 19)}…`, tag: "digest" };
  }
  const lastColon = t.lastIndexOf(":");
  const lastSlash = t.lastIndexOf("/");
  if (lastColon > lastSlash && lastColon > 0) {
    return { repo: t.slice(0, lastColon), tag: t.slice(lastColon + 1) || "latest" };
  }
  return { repo: t, tag: "latest" };
}

export function PushImagePanel({
  localImage, localImageOptions, isLoadingImages,
  imageName, imageTag,
  isBuilding, showImageConfig, showBuildLog,
  progress, progressMessage, log,
  fullImage, copied, onCopyImage,
  onPushImage, onCancelBuild, onRefreshImages, onRemoveImage,
  setLocalImage, setImageName, setImageTag,
  setShowImageConfig, setShowBuildLog,
  renderLog,
}: PushImagePanelProps) {
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const filteredImages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return localImageOptions;
    return localImageOptions.filter((img) => img.reference.toLowerCase().includes(q));
  }, [localImageOptions, query]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setLocalImage(value);
  };

  const handleSelectCard = (img: string) => {
    setLocalImage(img);
    setQuery("");
  };

  const handleRemove = async (e: React.MouseEvent, img: LocalImageInfo) => {
    e.stopPropagation();
    e.preventDefault();
    if (img.in_use) return;
    setRemoving(img.reference);
    try {
      await onRemoveImage(img.reference);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="upload-panel">
      {/* 本地镜像引用：搜索 + card 网格 */}
      <div className="form-group">
        <label>本地镜像引用</label>
        <div className="path-picker-row">
          <div className="image-picker-search">
            <Search size={14} className="image-picker-search-icon" aria-hidden />
            <input
              type="text"
              className="image-picker-search-input"
              value={query || localImage}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={
                isLoadingImages
                  ? "加载中..."
                  : localImageOptions.length === 0
                    ? "搜索或输入镜像名称..."
                    : "搜索本地镜像或手动输入..."
              }
              disabled={isLoadingImages}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="path-picker-btn"
            onClick={onRefreshImages}
            disabled={isLoadingImages}
          >
            {isLoadingImages ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{" "}
            {isLoadingImages ? "加载中" : "刷新"}
          </button>
        </div>

        {isLoadingImages ? (
          <div className="image-card-empty">
            <Loader2 size={18} className="spin" />
            <span>正在读取本地 Docker 镜像…</span>
          </div>
        ) : filteredImages.length > 0 ? (
          <div className="image-card-grid" role="listbox" aria-label="本地镜像列表">
            {filteredImages.map((img) => {
              const { repo, tag } = parseImageDisplay(img.reference);
              const selected = img.reference === localImage;
              const isRemoving = removing === img.reference;
              return (
                <div
                  key={img.reference}
                  role="option"
                  aria-selected={selected}
                  className={[
                    "image-card",
                    selected ? "selected" : "",
                    img.in_use ? "in-use" : "",
                    isRemoving ? "removing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => !isRemoving && handleSelectCard(img.reference)}
                  title={
                    img.in_use
                      ? `${img.reference}\n（有容器占用，不可删除）`
                      : img.reference
                  }
                >
                  <span className="image-card-icon" aria-hidden>
                    <Box size={18} />
                  </span>
                  <span className="image-card-body">
                    <span className="image-card-repo">{repo}</span>
                    <span className="image-card-meta">
                      <span className="image-card-tag">{tag}</span>
                      {img.in_use && (
                        <span className="image-card-badge-in-use" title="有容器正在使用此镜像">
                          <Lock size={10} aria-hidden />
                          使用中
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="image-card-actions">
                    {selected && !isRemoving && (
                      <span className="image-card-check" aria-hidden>
                        <CheckCircle size={16} />
                      </span>
                    )}
                    <button
                      type="button"
                      className="image-card-delete"
                      title={
                        img.in_use
                          ? "有容器占用，不可删除"
                          : `删除 ${img.reference}`
                      }
                      aria-label={
                        img.in_use
                          ? `镜像 ${img.reference} 使用中，不可删除`
                          : `删除镜像 ${img.reference}`
                      }
                      disabled={isRemoving || isBuilding || img.in_use}
                      onClick={(e) => void handleRemove(e, img)}
                    >
                      {isRemoving ? (
                        <Loader2 size={14} className="spin" />
                      ) : img.in_use ? (
                        <Lock size={14} />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : localImageOptions.length === 0 ? (
          <div className="image-card-empty">
            <Box size={18} />
            <span>暂无本地镜像，可手动输入引用后推送</span>
          </div>
        ) : (
          <div className="image-card-empty">
            <Search size={18} />
            <span>无匹配镜像，回车使用手输引用即可</span>
          </div>
        )}

        <p className="template-hint">
          {localImage
            ? `已选择: ${localImage}`
            : "点选卡片推送；带「使用中」标记的镜像有容器占用，不可删除"}
        </p>
      </div>

      {/* 镜像配置：目标镜像名称和标签 */}
      <div className="advanced-settings">
        <div
          className="advanced-settings-header"
          onClick={() => setShowImageConfig(!showImageConfig)}
        >
          <span>{showImageConfig ? "▼" : "▶"}</span>
          <span>镜像配置</span>
          <span className="template-hint" style={{ marginLeft: "8px" }}>
            可选：自定义目标镜像名称和标签
          </span>
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
          style={{ marginTop: 10, border: "none", background: "transparent", padding: 0 }}
        >
          <div className="path-link-item image-url-row">
            <span className="path-link-label">🐳 完整镜像:</span>
            <span className="image-url-value">
              <span style={{ display: "block" }} title={fullImage}>{fullImage}</span>
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
