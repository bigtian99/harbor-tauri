import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  Globe, Rocket, ExternalLink, Copy, Loader2, Eye
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
                      <div
                        className="lt-iframe-carousel"
                        onClick={() => {
                          if (isTauriRuntime()) {
                            invoke("preview_landing_page", { path: genResult.output_dir });
                          }
                        }}
                        title="点击放大预览"
                      >
                        <div className="lt-iframe-wrapper">
                          <iframe
                            src={convertFileSrc(`${genResult.output_dir}/index.html`)}
                            className="lt-iframe"
                            sandbox="allow-same-origin"
                            loading="lazy"
                            title={item.subChannelName || ""}
                          />
                        </div>
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
                            invoke("preview_landing_page", { path: genResult.output_dir });
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
