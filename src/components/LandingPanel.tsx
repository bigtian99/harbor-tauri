import { useState, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Globe, Rocket, ExternalLink, Copy, Loader2, Eye,
  ChevronLeft, ChevronRight, FolderOpen, Trash2, Package, ChevronDown, X, Maximize2
} from "lucide-react";
import type { SubChannelData, LandingPageResult, FtpUploadResult, TemplateInfo } from "../types";
import { isTauriRuntime } from "../types";

interface LandingPanelProps {
  landingIds: string;
  landingPreviewData: SubChannelData[];
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  templateIndices: Record<string, number>;
  isFetchingPreview: boolean;
  isGenerating: boolean;
  isUploadingToFtp: boolean;
  progress: number;
  progressMessage: string;
  landingOutputDir: string;
  previewBaseUrl: string;
  setLandingIds: (value: string) => void;
  setTemplateIndices: (value: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  onPreview: () => void;
  onFtpUpload: () => void;
  onCopyAllLinks: () => void;
  showToast: (message: string, duration?: number) => void;
}

export function LandingPanel({
  landingIds,
  landingPreviewData, landingGenerated, ftpUploadResults,
  templateIndices, setTemplateIndices,
  isFetchingPreview, isGenerating, isUploadingToFtp,
  progress, progressMessage,
  landingOutputDir, previewBaseUrl,
  setLandingIds,
  onPreview, onFtpUpload, onCopyAllLinks,
  showToast,
}: LandingPanelProps) {
  const [animatingCards, setAnimatingCards] = useState<Record<string, string>>({});
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 模板管理状态
  const [templateInfos, setTemplateInfos] = useState<TemplateInfo[]>([]);
  const [templatesBaseDir, setTemplatesBaseDir] = useState("");
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // 预览浮层状态
  const [previewOverlay, setPreviewOverlay] = useState<{
    src: string;
    title: string;
  } | null>(null);

  // 按中文分类分组（来自各模板 index.html 预埋的 template-category），同一分类下的目录再排序
  const templateGroups = (() => {
    const groups: Record<string, string[]> = {};
    for (const info of templateInfos) {
      (groups[info.category] ||= []).push(info.dir);
    }
    return Object.entries(groups)
      .map(([category, dirs]) => ({ category, dirs: dirs.sort() }))
      .sort((a, b) => a.category.localeCompare(b.category, "zh-Hans-CN"));
  })();

  // 手风琴：一次只展开一个分组，切换时上一个自动关闭（卸载其 iframe，避免多页面同时渲染卡死）
  const toggleGroup = useCallback((category: string) => {
    setExpandedGroup(prev => (prev === category ? null : category));
  }, []);

  // 模板预览：优先走本地 HTTP 预览服务器（相对路径图片/字体能正常加载），兜底 asset 协议
  const getTemplatePreviewSrc = useCallback((dir: string) => {
    if (previewBaseUrl) {
      return `${previewBaseUrl}/__templates__/${encodeURIComponent(dir)}/index.html`;
    }
    if (templatesBaseDir) {
      return convertFileSrc(`${templatesBaseDir}/${dir}/index.html`);
    }
    return "";
  }, [previewBaseUrl, templatesBaseDir]);

  const loadTemplateInfos = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const infos = await invoke<TemplateInfo[]>("list_template_infos");
      setTemplateInfos(infos);
      if (!templatesBaseDir) {
        const base = await invoke<string>("get_bundled_templates_dir");
        setTemplatesBaseDir(base);
      }
    } catch { /* 忽略 */ }
  }, [templatesBaseDir]);

  // 打开模板管理时刷新列表
  const handleOpenTemplateManager = useCallback(() => {
    setShowTemplateManager(true);
    loadTemplateInfos();
  }, [loadTemplateInfos]);

  const handleUploadTemplateZip = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "ZIP 文件", extensions: ["zip"] }],
      });
      if (!selected) return;
      setIsUploadingTemplate(true);
      const results = await invoke<{ dir_name: string; file_count: number }[]>("upload_template_zip", {
        zipPath: selected as string,
      });
      const names = results.map((r) => r.dir_name).join(", ");
      showToast(`模板上传完成: ${names}`);
      await loadTemplateInfos();
    } catch (e) {
      showToast(`上传失败: ${e}`);
    } finally {
      setIsUploadingTemplate(false);
    }
  }, [loadTemplateInfos, showToast]);

  const handleDeleteTemplate = useCallback(async (dirName: string) => {
    if (!confirm(`确认删除模板 "${dirName}"？此操作不可撤销。`)) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("delete_template_dir", { dirName });
      showToast(`已删除模板: ${dirName}`);
      await loadTemplateInfos();
    } catch (e) {
      showToast(`删除失败: ${e}`);
    }
  }, [loadTemplateInfos, showToast]);

  const getTemplateIndex = useCallback((id: string) => {
    return templateIndices[id] || 0;
  }, [templateIndices]);

  const switchTemplate = useCallback((id: string, direction: 'prev' | 'next') => {
    const result = landingGenerated[id];
    if (!result || !result.template_dirs || result.template_dirs.length <= 1) return;

    // 清除之前的动画定时器
    if (animationTimerRef.current) {
      clearTimeout(animationTimerRef.current);
    }

    // 设置动画类名
    const animClass = direction === 'prev' ? 'animating-left' : 'animating-right';
    setAnimatingCards(prev => ({ ...prev, [id]: animClass }));

    setTemplateIndices(prev => {
      const currentIndex = prev[id] || 0;
      let newIndex: number;
      if (direction === 'prev') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : result.template_dirs.length - 1;
      } else {
        newIndex = currentIndex < result.template_dirs.length - 1 ? currentIndex + 1 : 0;
      }
      return { ...prev, [id]: newIndex };
    });

    // 动画完成后移除动画类名
    animationTimerRef.current = setTimeout(() => {
      setAnimatingCards(prev => ({ ...prev, [id]: '' }));
    }, 400);
  }, [landingGenerated]);

  const getTemplateIframeSrc = useCallback((genResult: LandingPageResult, templateIdx: number) => {
    const idx = genResult.template_dirs && genResult.template_dirs.length > 0 ? templateIdx : 0;
    // 优先走本地 HTTP 预览服务器：相对路径与 FTP 部署一致，本地图片/字体能正常加载
    // 额外校验 output_dir 在 base 之后紧跟 '/'，避免同前缀目录（如 ...pages2_x）误判
    const base = landingOutputDir;
    if (
      previewBaseUrl &&
      base &&
      genResult.output_dir.startsWith(base) &&
      genResult.output_dir[base.length] === "/"
    ) {
      let rel = genResult.output_dir.slice(base.length).replace(/^\/+|\/+$/g, "");
      const file = `${rel}/template_${idx}/index.html`;
      const encoded = file.split("/").map(encodeURIComponent).join("/");
      return `${previewBaseUrl}/${encoded}`;
    }
    // 兜底：预览服务未就绪时退回 asset 协议（旧逻辑）
    return convertFileSrc(`${genResult.output_dir}/template_${idx}/index.html`);
  }, [previewBaseUrl, landingOutputDir]);

  // 获取轮播中三个位置的模板索引
  const getCarouselIndices = useCallback((id: string, total: number) => {
    const current = getTemplateIndex(id);
    const indices: number[] = [];

    if (total === 1) {
      indices.push(0);
    } else if (total === 2) {
      indices.push(0, 1);
    } else {
      // 左边
      indices.push(current > 0 ? current - 1 : total - 1);
      // 中间
      indices.push(current);
      // 右边
      indices.push(current < total - 1 ? current + 1 : 0);
    }

    return indices;
  }, [getTemplateIndex]);

  // 在应用内打开模板预览浮层
  const openInAppPreview = useCallback((src: string, title: string) => {
    setPreviewOverlay({ src, title });
  }, []);

  // 关闭预览浮层
  const closePreviewOverlay = useCallback(() => {
    setPreviewOverlay(null);
  }, []);

  // 关闭模板管理弹窗
  const closeTemplateManager = useCallback(() => {
    setShowTemplateManager(false);
    setExpandedGroup(null);
  }, []);

  return (
    <div className="landing-panel">
      <h2><Globe size={20} /> 生成落地页</h2>

      <div className="form-group">
        <label>子渠道 IDs（逗号分隔）</label>
        <input
          type="text"
          className="form-input"
          value={landingIds}
          onChange={(e) => setLandingIds(e.target.value)}
          placeholder="例如: 154,155,156"
        />
      </div>

      <div className="landing-actions">
        {Object.keys(landingGenerated).length === 0 && (
          <button
            className="save-btn"
            disabled={!landingIds || isFetchingPreview || isGenerating}
            onClick={onPreview}
          >
            {isFetchingPreview || isGenerating ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Rocket size={14} />
            )}
            预览数据
          </button>
        )}
        {Object.keys(landingGenerated).length > 0 && !isGenerating && (
          <button
            className="save-btn"
            disabled={isUploadingToFtp}
            onClick={onFtpUpload}
          >
            {isUploadingToFtp ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <ExternalLink size={14} />
            )}
            上传到 FTP
          </button>
        )}
        {Object.keys(ftpUploadResults).length > 0 && !isGenerating && (
          <button className="save-btn" onClick={onCopyAllLinks}>
            <Copy size={14} />
            复制所有链接
          </button>
        )}
        {/* 管理模板按钮 — 更显眼 */}
        <button className="save-btn" onClick={handleOpenTemplateManager} style={{ marginLeft: 'auto' }}>
          <Package size={14} />
          管理模板
        </button>
      </div>

      {isUploadingToFtp && (
        <div className="build-progress">
          <div className="progress-info">
            <p className="progress-message">{progressMessage}</p>
            <span className="progress-percent">{progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {landingPreviewData.length > 0 && (
        <div className="landing-section">
          <div className="landing-table">
            <div className="landing-table-header">
              <span className="lt-col lt-col-logo"></span>
              <span className="lt-col lt-col-name">名称</span>
              <span className="lt-col lt-col-type">类型</span>
              <span className="lt-col lt-col-product">产品</span>
              <span className="lt-col lt-col-template">模板</span>
              <span className="lt-col lt-col-id">ID</span>
              <span className="lt-col lt-col-status">状态</span>
              <span className="lt-col lt-col-action">操作</span>
            </div>
            {landingPreviewData.map((item, idx) => {
              const genResult = landingGenerated[item.id];
              const ftpResult = ftpUploadResults[item.id];
              const currentTemplateIndex = getTemplateIndex(item.id);
              const hasMultipleTemplates = genResult?.template_dirs && genResult.template_dirs.length > 1;
              return (
                <div key={item.id || idx} className="landing-table-row">
                  <span className="lt-col lt-col-logo">
                    {item.subChannelLogo ? (
                      <img
                        src={item.subChannelLogo}
                        alt={item.subChannelName || ""}
                        className="lt-logo"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="lt-logo-placeholder">
                        {(item.subChannelName || "?").charAt(0)}
                      </div>
                    )}
                  </span>
                  <span className="lt-col lt-col-name" title={item.subChannelName || ""}>
                    {item.subChannelName || "(未命名)"}
                  </span>
                  <span className="lt-col lt-col-type">
                    <span className="item-badge">{item.typeCode || "-"}</span>
                  </span>
                  <span className="lt-col lt-col-product">
                    {item.productName && (
                      <span className="item-badge item-badge-product">{item.productName}</span>
                    )}
                  </span>
                  <span className="lt-col lt-col-template">
                    {genResult?.status === "success" ? (
                      <div className="lt-iframe-carousel">
                        {hasMultipleTemplates && (
                          <div className="lt-iframe-nav">
                            <button
                              className="lt-iframe-nav-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                switchTemplate(item.id, 'prev');
                              }}
                              title="上一个模板"
                            >
                              <ChevronLeft size={14} />
                            </button>
                          </div>
                        )}

                        {hasMultipleTemplates ? (
                          getCarouselIndices(item.id, genResult.template_dirs.length).map((tempIdx, pos) => {
                            const isCenter = pos === 1 || genResult.template_dirs.length < 3;
                            return (
                              <div
                                key={tempIdx}
                                className={`lt-iframe-card ${isCenter ? 'card-center' : 'card-side'} ${isCenter && animatingCards[item.id] ? animatingCards[item.id] : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openInAppPreview(
                                    getTemplateIframeSrc(genResult, tempIdx),
                                    `${item.subChannelName || ""} - 模板${tempIdx + 1}`
                                  );
                                }}
                                title={`模板 ${tempIdx + 1}`}
                              >
                                <div className="lt-iframe-wrapper">
                                  <iframe
                                    src={getTemplateIframeSrc(genResult, tempIdx)}
                                    className="lt-iframe"
                                    loading="lazy"
                                    title={`${item.subChannelName || ""} - 模板${tempIdx + 1}`}
                                  />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div
                            className="lt-iframe-card card-center"
                            onClick={() => {
                              openInAppPreview(
                                getTemplateIframeSrc(genResult, 0),
                                `${item.subChannelName || ""} - 模板`
                              );
                            }}
                            title="点击放大预览"
                          >
                            <div className="lt-iframe-wrapper">
                              <iframe
                                src={getTemplateIframeSrc(genResult, 0)}
                                className="lt-iframe"
                                loading="lazy"
                                title={item.subChannelName || ""}
                              />
                            </div>
                          </div>
                        )}

                        {hasMultipleTemplates && (
                          <div className="lt-iframe-nav">
                            <button
                              className="lt-iframe-nav-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                switchTemplate(item.id, 'next');
                              }}
                              title="下一个模板"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        )}

                        {hasMultipleTemplates && (
                          <span className="lt-iframe-nav-info">
                            {currentTemplateIndex + 1}/{genResult.template_dirs.length}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="lt-iframe-empty">
                        {item.subChannelLogo ? (
                          <img
                            src={item.subChannelLogo}
                            alt=""
                            className="lt-iframe-empty-logo"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <span>{(item.subChannelName || "?").charAt(0)}</span>
                        )}
                      </div>
                    )}
                  </span>
                  <span className="lt-col lt-col-id">{item.id}</span>
                  <span className="lt-col lt-col-status">
                    {genResult?.status === "success" && (
                      <span className="item-badge item-badge-success" style={{ borderRadius: 999, padding: "3px 12px", marginRight: 0 }}>✓ 已生成</span>
                    )}
                    {genResult?.status === "error" && (
                      <span className="item-badge item-badge-error" title={genResult.message} style={{ borderRadius: 999, padding: "3px 12px", marginRight: 0 }}>✗ 失败</span>
                    )}
                    {ftpResult?.status === "success" && (
                      <span className="item-badge item-badge-ftp" style={{ borderRadius: 999, padding: "3px 12px", marginRight: 0 }}>↑ 已上传</span>
                    )}
                  </span>
                  <span className="lt-col lt-col-action">
                    {genResult?.status === "success" && (
                      <button
                        className="lt-preview-btn"
                        onClick={() => {
                          openInAppPreview(
                            getTemplateIframeSrc(genResult, currentTemplateIndex),
                            `${item.subChannelName || ""} - 模板${currentTemplateIndex + 1}`
                          );
                        }}
                        title="在应用内预览"
                      >
                        <Eye size={13} /> 预览
                      </button>
                    )}
                    {genResult?.status === "error" && (
                      <span className="lt-error-text" title={genResult.message}>失败</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========== 模板管理弹窗 ========== */}
      {showTemplateManager && (
        <div className="modal-overlay" onClick={closeTemplateManager}>
          <div
            className="template-manager-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                <Package size={16} /> 管理模板
              </h3>
              <button className="modal-close" onClick={closeTemplateManager} title="关闭">
                <X size={16} />
              </button>
            </div>

            <div className="template-manager-modal-body">
              <div className="landing-actions" style={{ marginBottom: 12 }}>
                <button
                  className="save-btn"
                  onClick={handleUploadTemplateZip}
                  disabled={isUploadingTemplate}
                >
                  {isUploadingTemplate ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <FolderOpen size={14} />
                  )}
                  上传模板 zip
                </button>
              </div>

              {templateInfos.length === 0 ? (
                <p className="template-manager-empty">暂无模板目录</p>
              ) : (
                <div className="template-group-list">
                  {templateGroups.map(({ category, dirs }) => {
                    const expanded = expandedGroup === category;
                    return (
                      <div key={category} className="template-group">
                        <button
                          className="template-group-header"
                          onClick={() => toggleGroup(category)}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="template-group-name">{category}</span>
                          <span className="template-group-count">{dirs.length} 个</span>
                        </button>
                        {expanded && (
                          <div className="template-group-items">
                            {dirs.map((dir) => (
                              <div
                                key={dir}
                                className="template-card"
                                title={`点击预览 ${dir}`}
                                onClick={() => {
                                  const src = getTemplatePreviewSrc(dir);
                                  if (src) {
                                    openInAppPreview(src, `模板: ${dir}`);
                                  }
                                }}
                              >
                                <div className="template-card-preview">
                                  {(() => {
                                    const src = getTemplatePreviewSrc(dir);
                                    return src ? (
                                      <iframe
                                        src={src}
                                        className="template-preview-iframe"
                                        loading="lazy"
                                        title={dir}
                                      />
                                    ) : (
                                      <div className="template-preview-empty">…</div>
                                    );
                                  })()}
                                </div>
                                {/* 放大预览按钮 */}
                                <button
                                  className="template-maximize-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const src = getTemplatePreviewSrc(dir);
                                    if (src) {
                                      openInAppPreview(src, `模板: ${dir}`);
                                    }
                                  }}
                                  title={`放大预览 ${dir}`}
                                >
                                  <Maximize2 size={13} />
                                </button>
                                {/* 删除按钮 */}
                                <button
                                  className="template-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTemplate(dir);
                                  }}
                                  title={`删除 ${dir}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========== 应用内预览浮层 ========== */}
      {previewOverlay && (
        <div className="preview-overlay" onClick={closePreviewOverlay}>
          <div
            className="preview-overlay-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-overlay-header">
              <span className="preview-overlay-title">{previewOverlay.title}</span>
              <div className="preview-overlay-actions">
                {/* 同时提供外部分浏览器按钮作为备选 */}
                <button
                  className="preview-overlay-external-btn"
                  title="在外部浏览器打开"
                  onClick={() => {
                    window.open(previewOverlay.src, '_blank');
                  }}
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  className="preview-overlay-close"
                  onClick={closePreviewOverlay}
                  title="关闭预览"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="preview-overlay-body">
              <iframe
                src={previewOverlay.src}
                className="preview-overlay-iframe"
                title={previewOverlay.title}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
