import { useState } from "react";
import { Eye, FileText, Plus, Trash2 } from "lucide-react";
import type { BranchProjectType, HarborConfig, NginxLocationBlock } from "../../types";

export interface BranchAdvancedSettingsProps {
  branchProjectType: BranchProjectType;
  showAdvancedSettings: boolean;
  setShowAdvancedSettings: (show: boolean) => void;
  branchHasDockerfile: boolean;
  imageName: string;
  setImageName: (name: string) => void;
  exposePort: string;
  setExposePort: (port: string) => void;
  imageTag: string;
  setImageTag: (tag: string) => void;
  nginxLocations: NginxLocationBlock[];
  onNginxLocationsChange: (locations: NginxLocationBlock[]) => void;
  config: HarborConfig;
}

/** 分支打包高级设置：镜像名/端口/标签与 nginx location */
export function BranchAdvancedSettings({
  branchProjectType,
  showAdvancedSettings,
  setShowAdvancedSettings,
  branchHasDockerfile,
  imageName,
  setImageName,
  exposePort,
  setExposePort,
  imageTag,
  setImageTag,
  nginxLocations,
  onNginxLocationsChange,
  config,
}: BranchAdvancedSettingsProps) {
  const [showNginxPreview, setShowNginxPreview] = useState(false);

  return (
    <div className="advanced-settings">
      <div
        className="advanced-settings-header"
        onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
      >
        <span>{showAdvancedSettings ? "▼" : "▶"}</span>
        <span>高级设置</span>
        <span className="template-hint" style={{ marginLeft: "8px" }}>
          可选：自定义镜像名称和标签
        </span>
        {branchHasDockerfile && (
          <span
            className="dockerfile-badge"
            title="检测到项目根目录有 Dockerfile，将使用自定义 Dockerfile 构建"
          >
            <FileText size={12} /> 自定义 Dockerfile
          </span>
        )}
      </div>
      {showAdvancedSettings && (
        <>
          <div className="form-group">
            <label>镜像名称</label>
            <input
              type="text"
              value={imageName}
              onChange={(e) => setImageName(e.target.value)}
              placeholder={
                branchProjectType === "npm"
                  ? "例如: my-frontend（小写）"
                  : "例如: sdk（小写，不含项目名）"
              }
            />
            <p className="template-hint">
              留空则自动推断；Harbor 项目名在配置中填写，推送时自动拼接
            </p>
          </div>
          <div className="form-group">
            <label>JAR 暴露端口</label>
            <input
              type="text"
              value={exposePort}
              onChange={(e) => setExposePort(e.target.value)}
              placeholder={config.expose_port || "例如: 8181"}
            />
            <p className="template-hint">
              留空则使用配置中的默认端口 {config.expose_port || "8181"}
            </p>
          </div>
          <div className="form-group">
            <label>镜像标签</label>
            <input
              type="text"
              value={imageTag}
              onChange={(e) => setImageTag(e.target.value)}
              placeholder="留空自动生成"
            />
            <p className="template-hint">留空则自动生成 分支名-v.YY.MM.DD.HH.MM</p>
          </div>
          {branchProjectType === "npm" && (
            <div className="form-group">
              <label>nginx Location 代理</label>
              {(nginxLocations ?? []).map((loc, i) => (
                <div key={i} className="location-row">
                  <input
                    type="text"
                    placeholder="路径, 如 /test-api/"
                    value={loc.path}
                    onChange={(e) => {
                      const next = [...(nginxLocations ?? [])];
                      next[i] = { ...next[i], path: e.target.value };
                      onNginxLocationsChange(next);
                    }}
                  />
                  <input
                    type="text"
                    placeholder="proxy_pass"
                    value={loc.proxy_pass}
                    onChange={(e) => {
                      const next = [...(nginxLocations ?? [])];
                      next[i] = { ...next[i], proxy_pass: e.target.value };
                      onNginxLocationsChange(next);
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Host (可选)"
                    value={loc.host}
                    onChange={(e) => {
                      const next = [...(nginxLocations ?? [])];
                      next[i] = { ...next[i], host: e.target.value };
                      onNginxLocationsChange(next);
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="删除"
                    onClick={() => {
                      const next = [...(nginxLocations ?? [])];
                      next.splice(i, 1);
                      onNginxLocationsChange(next);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  className="add-btn"
                  onClick={() => {
                    const next = [
                      ...(nginxLocations ?? []),
                      { path: "", proxy_pass: "", host: "" },
                    ];
                    onNginxLocationsChange(next);
                  }}
                >
                  <Plus size={14} /> 添加 Location
                </button>
                {(nginxLocations ?? []).length > 0 && (
                  <button
                    type="button"
                    className="add-btn"
                    onClick={() => setShowNginxPreview(!showNginxPreview)}
                  >
                    <Eye size={14} /> {showNginxPreview ? "收起预览" : "预览 nginx.conf"}
                  </button>
                )}
              </div>
              {showNginxPreview && (nginxLocations ?? []).length > 0 && (
                <pre className="nginx-preview">
                  {(() => {
                    const template = config.frontend_nginx_template || "";
                    const locs = (nginxLocations ?? []).filter((l) => l.path || l.proxy_pass);
                    if (locs.length === 0) return template;
                    const rendered = locs
                      .map(
                        (l) =>
                          `\n    location ${l.path || "/api/"} {\n        proxy_pass ${l.proxy_pass || "http://backend/"};${l.host ? `\n        proxy_set_header Host ${l.host};` : ""}\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }`
                      )
                      .join("");
                    if (template.includes("{{CUSTOM_LOCATIONS}}")) {
                      return template.replace("{{CUSTOM_LOCATIONS}}", rendered);
                    }
                    const lastBrace = template.lastIndexOf("}");
                    if (lastBrace > 0) {
                      return template.slice(0, lastBrace) + rendered + "\n" + template.slice(lastBrace);
                    }
                    return template + rendered;
                  })()}
                </pre>
              )}
              <p className="template-hint">
                配置的代理会注入到 nginx.conf 的 {"{{CUSTOM_LOCATIONS}}"} 位置或 server block 末尾
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
