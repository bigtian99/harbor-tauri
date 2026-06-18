import { useState, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  Globe, Rocket, ExternalLink, Copy, Loader2, Eye,
  ChevronLeft, ChevronRight
} from "lucide-react";
import type { SubChannelData, LandingPageResult, FtpUploadResult } from "../types";
import { isTauriRuntime } from "../types";

interface LandingPanelProps {
  landingTemplateBase: string;
  landingIds: string;
  landingPreviewData: SubChannelData[];
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  isFetchingPreview: boolean;
  isGenerating: boolean;
  isUploadingToFtp: boolean;
  progress: number;
  progressMessage: string;
  setLandingTemplateBase: (value: string) => void;
  setLandingIds: (value: string) => void;
  onPreview: () => void;
  onFtpUpload: () => void;
  onCopyAllLinks: () => void;
}

export function LandingPanel({
  landingTemplateBase, landingIds,
  landingPreviewData, landingGenerated, ftpUploadResults,
  isFetchingPreview, isGenerating, isUploadingToFtp,
  progress, progressMessage,
  setLandingTemplateBase, setLandingIds,
  onPreview, onFtpUpload, onCopyAllLinks,
}: LandingPanelProps) {
  const [templateIndices, setTemplateIndices] = useState<Record<string, number>>({});
  const [animatingCards, setAnimatingCards] = useState<Record<string, string>>({});
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!genResult.template_dirs || genResult.template_dirs.length === 0) {
      return convertFileSrc(`${genResult.output_dir}/template_0/index.html`);
    }
    return convertFileSrc(`${genResult.output_dir}/template_${templateIdx}/index.html`);
  }, []);

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

  return (
    <div className="landing-panel">
      <h2><Globe size={20} /> 生成落地页</h2>

      <div className="form-group">
        <label>模板目录 (tksy-h5-app)</label>
        <input
          type="text"
          className="form-input"
          value={landingTemplateBase}
          onChange={(e) => setLandingTemplateBase(e.target.value)}
          placeholder="/Users/daijunxiong/Desktop/tksy-h5-app"
        />
      </div>

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
      </div>

      {(isGenerating || isUploadingToFtp || progress > 0) && (
        <div className="build-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p>{progressMessage || (isGenerating ? "处理中..." : "")}</p>
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
                                  if (isTauriRuntime()) {
                                    invoke("preview_landing_page", {
                                      path: genResult.output_dir,
                                      templateIndex: tempIdx
                                    });
                                  }
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
                              if (isTauriRuntime()) {
                                invoke("preview_landing_page", {
                                  path: genResult.output_dir,
                                  templateIndex: 0
                                });
                              }
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
                      <span className="item-badge item-badge-success">✓ 已生成</span>
                    )}
                    {genResult?.status === "error" && (
                      <span className="item-badge item-badge-error" title={genResult.message}>✗ 失败</span>
                    )}
                    {ftpResult?.status === "success" && (
                      <span className="item-badge item-badge-ftp">↑ 已上传</span>
                    )}
                  </span>
                  <span className="lt-col lt-col-action">
                    {genResult?.status === "success" && (
                      <button
                        className="lt-preview-btn"
                        onClick={() => {
                          if (isTauriRuntime()) {
                            invoke("preview_landing_page", {
                              path: genResult.output_dir,
                              templateIndex: currentTemplateIndex
                            });
                          }
                        }}
                        title="在浏览器中预览"
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
    </div>
  );
}
