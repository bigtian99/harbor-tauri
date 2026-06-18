import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings, CheckCircle, AlertCircle, Eye, EyeOff, FolderOpen, Archive
} from "lucide-react";
import type { HarborConfig } from "../types";
import { isTauriRuntime } from "../types";

interface ConfigPanelProps {
  config: HarborConfig;
  configSaved: boolean;
  showPassword: boolean;
  onConfigChange: (field: keyof HarborConfig, value: string) => void;
  onSaveConfig: () => void;
  onTogglePassword: () => void;
}

export function ConfigPanel({
  config, configSaved, showPassword,
  onConfigChange, onSaveConfig, onTogglePassword,
}: ConfigPanelProps) {
  return (
    <div className="config-panel">
      <div className="form-group">
        <label>Harbor地址</label>
        <input
          type="text"
          value={config.harbor_url}
          onChange={(e) => onConfigChange("harbor_url", e.target.value)}
          placeholder="例如: harbor.example.com"
        />
      </div>
      <div className="form-group">
        <label>用户名</label>
        <input
          type="text"
          value={config.username}
          onChange={(e) => onConfigChange("username", e.target.value)}
          placeholder="Harbor登录用户名"
        />
      </div>
      <div className="form-group">
        <label>密码</label>
        <div className="password-input-wrapper">
          <input
            type={showPassword ? "text" : "password"}
            value={config.password}
            onChange={(e) => onConfigChange("password", e.target.value)}
            placeholder="Harbor登录密码"
          />
          <button
            type="button"
            className="password-toggle"
            onClick={onTogglePassword}
            title={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>
      <div className="form-group">
        <label>项目名称</label>
        <input
          type="text"
          value={config.project}
          onChange={(e) => onConfigChange("project", e.target.value)}
          placeholder="例如: my-project"
        />
      </div>
      <div className="form-group">
        <label>JAR基础镜像</label>
        <input
          type="text"
          value={config.base_image}
          onChange={(e) => onConfigChange("base_image", e.target.value)}
          placeholder="例如: eclipse-temurin:17-jre"
        />
      </div>
      <div className="form-group">
        <label>JAR暴露端口</label>
        <input
          type="text"
          value={config.expose_port}
          onChange={(e) => onConfigChange("expose_port", e.target.value)}
          placeholder="例如: 8181"
        />
      </div>
      <div className="form-group">
        <label>前端基础镜像</label>
        <input
          type="text"
          value={config.frontend_base_image}
          onChange={(e) => onConfigChange("frontend_base_image", e.target.value)}
          placeholder="例如: nginx:alpine"
        />
      </div>
      <div className="form-group">
        <label>前端暴露端口</label>
        <input
          type="text"
          value={config.frontend_expose_port}
          onChange={(e) => onConfigChange("frontend_expose_port", e.target.value)}
          placeholder="例如: 80"
        />
      </div>
      <div className="form-group">
        <label>前端 Dockerfile 模板</label>
        <textarea
          value={config.frontend_dockerfile_template}
          onChange={(e) => onConfigChange("frontend_dockerfile_template", e.target.value)}
          spellCheck={false}
          rows={6}
        />
        <p className="template-hint">可用变量：{"{{BASE_IMAGE}}"}、{"{{EXPOSE_PORT}}"}、{"{{NGINX_CONF_PATH}}"}、{"{{DIST_DIR}}"}、{"{{IMAGE_NAME}}"}、{"{{IMAGE_TAG}}"}、{"{{FULL_IMAGE}}"}</p>
      </div>
      <div className="form-group">
        <label>nginx.conf 模板</label>
        <textarea
          value={config.frontend_nginx_template}
          onChange={(e) => onConfigChange("frontend_nginx_template", e.target.value)}
          spellCheck={false}
          rows={9}
        />
      </div>

      <div className="form-group">
        <label><Archive size={14} /> 打包产物目录</label>
        <div className="path-picker-row">
          <input
            type="text"
            value={config.artifact_output_dir}
            onChange={(e) => onConfigChange("artifact_output_dir", e.target.value)}
            placeholder="默认: 桌面"
          />
          <button
            type="button"
            className="path-picker-btn"
            onClick={async () => {
              if (!isTauriRuntime()) {
                return;
              }
              try {
                const selected = await open({
                  multiple: false,
                  directory: true,
                  recursive: false,
                  title: "选择打包产物输出目录",
                });
                if (selected) {
                  onConfigChange("artifact_output_dir", selected as string);
                }
              } catch (e) {
                console.error("选择目录失败:", e);
              }
            }}
          >
            <FolderOpen size={16} /> 选择
          </button>
        </div>
        <p className="template-hint">打包产物将自动复制到此目录，留空则不复制</p>
      </div>

      <button className="save-btn" onClick={onSaveConfig}>
        {configSaved ? (
          <>
            <CheckCircle size={18} /> 已保存
          </>
        ) : (
          <>
            <Settings size={18} /> 保存配置
          </>
        )}
      </button>

      <div className="config-tip">
        <p><AlertCircle size={16} className="inline-icon" /> 配置说明：</p>
        <ul>
          <li>配置保存后无需重复填写</li>
          <li>Harbor地址不需要带 https:// 前缀</li>
          <li>项目名称为Harbor中的项目名</li>
          <li>JAR模式使用JAR基础镜像和JAR暴露端口</li>
          <li>前端dist模式会把所选 dist 目录的内容复制为 nginx 站点根目录，不会在镜像里嵌套 dist 目录</li>
          <li>默认 nginx.conf 的 /index.html 回退路径对应 /usr/share/nginx/html/index.html</li>
        </ul>
      </div>
    </div>
  );
}
