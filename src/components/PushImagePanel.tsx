import { useMemo, useState } from "react";
import {
  Rocket, Loader2, Eye, EyeOff, XCircle, CheckCircle, Copy, RefreshCw, Box, Search, Trash2, Lock, Tag, Container, Package, X
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
  copied: string | null;
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

/** 按名称生成稳定色相，卡片一眼可区分 */
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return h % 360;
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
    const list = !q
      ? localImageOptions
      : localImageOptions.filter((img) => img.reference.toLowerCase().includes(q));
    // 可推送的排前面，占用中沉底——选镜像时更直观
    return [...list].sort((a, b) => Number(a.in_use) - Number(b.in_use));
  }, [localImageOptions, query]);

  const readyCount = useMemo(
    () => filteredImages.filter((img) => !img.in_use).length,
    [filteredImages],
  );
  const busyCount = filteredImages.length - readyCount;

  const handleQueryChange = (value: string) => {
    setQuery(value);
  };

  const commitTypedReference = () => {
    const v = query.trim();
    if (!v) return;
    setLocalImage(v);
    setQuery("");
  };

  const handleSelectCard = (img: string) => {
    setLocalImage(img);
    setQuery("");
  };

  const clearSelection = () => {
    setLocalImage("");
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
      {/* 本地镜像引用 */}
      <div className="form-group image-picker">
        <div className="image-picker-label-row">
          <div className="image-picker-title">
            <Container size={15} aria-hidden />
            <label>本地镜像引用</label>
          </div>
          {!isLoadingImages && localImageOptions.length > 0 && (
            <div className="image-picker-stats" aria-label="镜像统计">
              <span className="image-picker-stat ready" title="可删除 / 空闲">
                <Package size={11} aria-hidden />
                {readyCount}
              </span>
              {busyCount > 0 && (
                <span className="image-picker-stat busy" title="容器占用中">
                  <Lock size={11} aria-hidden />
                  {busyCount}
                </span>
              )}
              <span className="image-picker-count" title="当前列表数量">
                {query.trim()
                  ? `${filteredImages.length}/${localImageOptions.length}`
                  : localImageOptions.length}
              </span>
            </div>
          )}
        </div>
        <div className="path-picker-row">
          <div className="image-picker-search">
            <Search size={14} className="image-picker-search-icon" aria-hidden />
            <input
              type="text"
              className="image-picker-search-input"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTypedReference();
                }
              }}
              placeholder={
                isLoadingImages
                  ? "加载中..."
                  : localImage
                    ? "搜索过滤，或输入新引用后回车"
                    : localImageOptions.length === 0
                      ? "输入镜像引用后回车…"
                      : "搜索本地镜像，或手输引用后回车"
              }
              disabled={isLoadingImages}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {query.trim() && (
              <button
                type="button"
                className="image-picker-clear-query"
                title="清空搜索"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="path-picker-btn image-picker-refresh"
            onClick={onRefreshImages}
            disabled={isLoadingImages}
          >
            {isLoadingImages ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{" "}
            {isLoadingImages ? "加载中" : "刷新"}
          </button>
        </div>

        <div className="image-picker-shell">
          {isLoadingImages ? (
            <div className="image-card-empty">
              <Loader2 size={22} className="spin" />
              <div className="image-card-empty-copy">
                <strong>读取本地 Docker</strong>
                <span>正在拉取镜像列表…</span>
              </div>
            </div>
          ) : filteredImages.length > 0 ? (
            <div className="image-card-grid" role="listbox" aria-label="本地镜像列表">
              {filteredImages.map((img) => {
                const { repo, tag } = parseImageDisplay(img.reference);
                const selected = img.reference === localImage;
                const isRemoving = removing === img.reference;
                const shortName = repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
                const repoPath = repo.includes("/") ? repo.slice(0, repo.lastIndexOf("/")) : "";
                const initial = (shortName || repo || "?").charAt(0).toUpperCase();
                const hue = nameHue(shortName || repo);
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
                    style={{ ["--card-hue" as string]: String(hue) }}
                    onClick={() => !isRemoving && handleSelectCard(img.reference)}
                    title={
                      img.in_use
                        ? `${img.reference}\n（有容器占用，不可删除）`
                        : img.reference
                    }
                  >
                    <div className="image-card-main">
                      <span className="image-card-avatar" aria-hidden>
                        <span className="image-card-avatar-letter">{initial}</span>
                        <Box size={12} className="image-card-avatar-glyph" />
                      </span>
                      <div className="image-card-text">
                        {repoPath ? (
                          <span className="image-card-path">{repoPath}/</span>
                        ) : (
                          <span className="image-card-path image-card-path-local">local</span>
                        )}
                        <span className="image-card-name">{shortName || repo}</span>
                        <span className="image-card-meta">
                          <span className="image-card-tag">
                            <Tag size={10} aria-hidden />
                            {tag}
                          </span>
                          {img.in_use ? (
                            <span className="image-card-badge-in-use" title="有容器正在使用此镜像">
                              <Lock size={10} aria-hidden />
                              使用中
                            </span>
                          ) : (
                            <span className="image-card-badge-ready">可推送</span>
                          )}
                        </span>
                      </div>
                      <div className="image-card-actions">
                        {selected && !isRemoving && (
                          <span className="image-card-check" aria-hidden>
                            <CheckCircle size={16} />
                          </span>
                        )}
                        {!img.in_use && (
                          <button
                            type="button"
                            className="image-card-delete"
                            title={`删除 ${img.reference}`}
                            aria-label={`删除镜像 ${img.reference}`}
                            disabled={isRemoving || isBuilding}
                            onClick={(e) => void handleRemove(e, img)}
                          >
                            {isRemoving ? (
                              <Loader2 size={13} className="spin" />
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : localImageOptions.length === 0 ? (
            <div className="image-card-empty">
              <Box size={22} />
              <div className="image-card-empty-copy">
                <strong>暂无本地镜像</strong>
                <span>可在上方手动输入引用后推送</span>
              </div>
            </div>
          ) : (
            <div className="image-card-empty">
              <Search size={22} />
              <div className="image-card-empty-copy">
                <strong>无匹配结果</strong>
                <span>回车可用手输引用：{query.trim() || "…"}</span>
              </div>
            </div>
          )}
        </div>

        {localImage ? (
          <div className="image-selected-bar" title={localImage}>
            <span className="image-selected-icon" aria-hidden>
              <CheckCircle size={14} />
            </span>
            <div className="image-selected-body">
              <span className="image-selected-label">当前选中</span>
              <code className="image-selected-ref">{localImage}</code>
            </div>
            <button
              type="button"
              className="image-selected-clear"
              title="清除选中"
              aria-label="清除选中镜像"
              onClick={clearSelection}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="template-hint image-picker-hint">
            点选卡片推送 · 搜索只过滤 · 手输引用请回车确认
          </p>
        )}
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
          <div className={`path-link-item image-url-row ${copied === fullImage ? "copied" : ""}`}>
            <span className="path-link-label">🐳 完整镜像:</span>
            <span className="image-url-value">
              <span style={{ display: "block" }} title={fullImage}>{fullImage}</span>
            </span>
            <button
              className={`copy-btn ${copied === fullImage ? "copied" : ""}`}
              onClick={() => onCopyImage(fullImage)}
              title="复制镜像地址"
            >
              {copied === fullImage ? (
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
