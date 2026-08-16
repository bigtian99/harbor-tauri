import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings, CheckCircle, AlertCircle, Eye, EyeOff, FolderOpen, Archive,
  Server, Package, Globe, FolderOutput, Info, RefreshCw, Loader2, ExternalLink, Trash2,
  CloudUpload,
} from "lucide-react";
import type { HarborConfig } from "../types";
import { isTauriRuntime } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

export type CheckUpdateResult = {
  status: "update" | "latest" | "error";
  message: string;
};

interface ConfigPanelProps {
  config: HarborConfig;
  configSaved: boolean;
  showPassword: boolean;
  onConfigChange: (field: keyof HarborConfig, value: string | boolean) => void;
  onSaveConfig: () => void;
  onTogglePassword: () => void;
  /** 当前应用版本（Cargo） */
  appVersion?: string;
  /** 手动检查更新 */
  onCheckUpdate?: () => Promise<CheckUpdateResult>;
  /** 清空 Git 本地记录（路径历史与分支记忆） */
  onClearGitRecords?: () => Promise<boolean>;
}

type ConfigTab = "connection" | "jar" | "frontend" | "bt" | "output" | "about";

const TABS: { key: ConfigTab; label: string; icon: React.ReactNode }[] = [
  { key: "connection", label: "Harbor 连接", icon: <Server size={14} /> },
  { key: "jar", label: "JAR 打包", icon: <Package size={14} /> },
  { key: "frontend", label: "前端打包", icon: <Globe size={14} /> },
  { key: "bt", label: "宝塔部署", icon: <CloudUpload size={14} /> },
  { key: "output", label: "输出设置", icon: <FolderOutput size={14} /> },
  { key: "about", label: "关于", icon: <Info size={14} /> },
];

export function ConfigPanel({
  config, configSaved, showPassword,
  onConfigChange, onSaveConfig, onTogglePassword,
  appVersion, onCheckUpdate, onClearGitRecords,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>("connection");
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ type: "ok" | "update" | "err"; text: string } | null>(null);
  const [clearingGit, setClearingGit] = useState(false);
  const [gitClearMsg, setGitClearMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showClearGitConfirm, setShowClearGitConfirm] = useState(false);

  const gitRecordCount =
    (config.repo_path_history?.length ?? 0) + Object.keys(config.branch_repo_settings ?? {}).length;
  const hasGitRecords = Boolean(
    gitRecordCount > 0 ||
    config.last_repo_path?.trim() ||
    config.last_branch?.trim() ||
    config.last_frontend_dir?.trim() ||
    config.last_build_script?.trim() ||
    config.last_spring_profile?.trim() ||
    config.last_expose_port?.trim(),
  );

  const handleClearGitRecords = async () => {
    if (!onClearGitRecords || clearingGit) return;
    setClearingGit(true);
    setGitClearMsg(null);
    try {
      const cleared = await onClearGitRecords();
      if (cleared) {
        setShowClearGitConfirm(false);
        setGitClearMsg({ type: "ok", text: "已清空 Git 记录" });
      } else {
        setGitClearMsg({ type: "err", text: "清空失败，请稍后重试" });
      }
    } catch (e) {
      setGitClearMsg({ type: "err", text: String(e) });
    } finally {
      setClearingGit(false);
    }
  };

  const handleCheckUpdate = async () => {
    if (!onCheckUpdate || checking) return;
    setChecking(true);
    setCheckMsg(null);
    try {
      const r = await onCheckUpdate();
      if (r.status === "update") setCheckMsg({ type: "update", text: r.message });
      else if (r.status === "latest") setCheckMsg({ type: "ok", text: r.message });
      else setCheckMsg({ type: "err", text: r.message });
    } catch (e) {
      setCheckMsg({ type: "err", text: String(e) });
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="config-panel">
      <div className="config-subtabs" role="tablist">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={`config-subtab ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="config-tab-panel">
        {activeTab === "connection" && (
          <>
            <div className="form-group">
              <label>Harbor 地址</label>
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
                placeholder="Harbor 登录用户名"
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.password}
                  onChange={(e) => onConfigChange("password", e.target.value)}
                  placeholder="Harbor 登录密码"
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
              <label>Harbor 项目</label>
              <input
                type="text"
                value={config.project}
                onChange={(e) => onConfigChange("project", e.target.value)}
                placeholder="例如: my-project"
              />
              <p className="template-hint">推送时自动拼在镜像名前，最终地址为 harbor地址/项目名/镜像名:标签</p>
            </div>
          </>
        )}

        {activeTab === "jar" && (
          <>
            <div className="form-group">
              <label>JAR 基础镜像</label>
              <input
                type="text"
                value={config.base_image}
                onChange={(e) => onConfigChange("base_image", e.target.value)}
                placeholder="例如: eclipse-temurin:17-jre"
              />
            </div>
            <div className="form-group">
              <label>JAR 暴露端口</label>
              <input
                type="text"
                value={config.expose_port}
                onChange={(e) => onConfigChange("expose_port", e.target.value)}
                placeholder="例如: 8181"
              />
            </div>
            <div className="form-group">
              <label><FolderOpen size={14} /> tools 目录 (--build-context)</label>
              <div className="path-picker-row">
                <input
                  type="text"
                  value={config.custom_docker_extras_dir}
                  onChange={(e) => onConfigChange("custom_docker_extras_dir", e.target.value)}
                  placeholder="例如: /Users/daijunxiong/code/packingmachine/tools"
                />
                <button
                  type="button"
                  className="path-picker-btn"
                  onClick={async () => {
                    if (!isTauriRuntime()) return;
                    try {
                      const selected = await open({
                        multiple: false,
                        directory: true,
                        recursive: false,
                        title: "选择 tools 目录",
                      });
                      if (selected) {
                        onConfigChange("custom_docker_extras_dir", selected as string);
                      }
                    } catch (e) {
                      console.error("选择目录失败:", e);
                    }
                  }}
                >
                  <FolderOpen size={16} /> 选择
                </button>
              </div>
              <p className="template-hint">填 tools/ 的绝对路径，jarporter 通过 <code>--build-context tools=</code> 注入。Dockerfile 里用 <code>COPY --from=tools ./ /opt/tools/</code> 获取。</p>
            </div>
          </>
        )}

        {activeTab === "bt" && (
          <>
            <div className="form-group">
              <label>宝塔自动部署（Profile=test）</label>
              <p className="template-hint">
                Maven 打包且 Spring Profile 为 test 时，FTP 覆盖面板 JAR 并重启 Java 项目
              </p>
              <label className="checkbox-label" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={config.bt_auto_deploy_test !== false}
                  onChange={(e) => onConfigChange("bt_auto_deploy_test", e.target.checked)}
                />
                <span className="checkbox-toggle"></span>
                <span>启用 test 打包后自动部署</span>
              </label>
            </div>
            <div className="form-group">
              <label>面板地址</label>
              <input
                type="text"
                value={config.bt_panel_url ?? ""}
                onChange={(e) => onConfigChange("bt_panel_url", e.target.value)}
                placeholder="https://47.107.51.228:10163"
              />
            </div>
            <div className="form-group">
              <label>面板 API 密钥</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.bt_panel_secret ?? ""}
                  onChange={(e) => onConfigChange("bt_panel_secret", e.target.value)}
                  placeholder="面板设置 → API 接口密钥"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={onTogglePassword}
                  title={showPassword ? "隐藏" : "显示"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.bt_panel_insecure !== false}
                  onChange={(e) => onConfigChange("bt_panel_insecure", e.target.checked)}
                />
                <span className="checkbox-toggle"></span>
                <span>跳过面板 TLS 证书校验（自签证书）</span>
              </label>
            </div>
            <div className="form-group">
              <label>FTP 主机</label>
              <input
                type="text"
                value={config.bt_ftp_host ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_host", e.target.value)}
                placeholder="47.107.51.228"
              />
            </div>
            <div className="form-group">
              <label>FTP 用户</label>
              <input
                type="text"
                value={config.bt_ftp_user ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_user", e.target.value)}
                placeholder="admin"
              />
            </div>
            <div className="form-group">
              <label>FTP 密码</label>
              <input
                type={showPassword ? "text" : "password"}
                value={config.bt_ftp_pass ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_pass", e.target.value)}
                placeholder="FTP 密码"
              />
            </div>
          </>
        )}

        {activeTab === "frontend" && (
          <>
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
          </>
        )}

        {activeTab === "output" && (
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
        )}

        {activeTab === "about" && (
          <div className="about-panel">
            <div className="about-card">
              <div className="about-app-name">JarPorter</div>
              <div className="about-version">
                当前版本 <strong>v{appVersion || "—"}</strong>
              </div>
              <p className="about-desc">JAR / 前端 dist 一键打包推送 Harbor</p>

              <div className="about-actions">
                <button
                  type="button"
                  className="about-check-btn"
                  onClick={handleCheckUpdate}
                  disabled={checking || !onCheckUpdate}
                >
                  {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  {checking ? "检查中…" : "检查更新"}
                </button>
                <a
                  className="about-link"
                  href="https://github.com/bigtian99/harbor-tauri/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  发布页
                  <ExternalLink size={12} />
                </a>
              </div>

              {checkMsg && (
                <div className={`about-check-msg about-check-msg--${checkMsg.type}`}>
                  {checkMsg.type === "ok" && <CheckCircle size={14} />}
                  {checkMsg.type === "update" && <RefreshCw size={14} />}
                  {checkMsg.type === "err" && <AlertCircle size={14} />}
                  <span>{checkMsg.text}</span>
                </div>
              )}
            </div>

            <div className="about-card about-data-card">
              <div className="about-data-title">Git 本地记录</div>
              <p className="about-data-desc">
                包含分支打包与快捷合并中的仓库路径历史，以及各仓库的高级设置记忆。
                {gitRecordCount > 0 ? ` 当前共 ${gitRecordCount} 条路径/仓库记忆。` : hasGitRecords ? " 当前有分支选择记忆。" : " 当前暂无记录。"}
              </p>
              <div className="about-actions">
                <button
                  type="button"
                  className="about-danger-btn"
                  onClick={() => setShowClearGitConfirm(true)}
                  disabled={!onClearGitRecords || !hasGitRecords}
                >
                  <Trash2 size={16} />
                  清空 Git 记录
                </button>
              </div>
              {gitClearMsg && (
                <div className={`about-check-msg about-check-msg--${gitClearMsg.type === "ok" ? "ok" : "err"}`}>
                  {gitClearMsg.type === "ok" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  <span>{gitClearMsg.text}</span>
                </div>
              )}
            </div>

            <div className="config-tip">
              <p><AlertCircle size={16} className="inline-icon" /> 配置说明：</p>
              <ul>
                <li>配置保存后无需重复填写</li>
                <li>Harbor 地址不需要带 https:// 前缀</li>
                <li>Harbor 项目为仓库中的项目名，会与镜像名称拼接</li>
                <li>JAR 模式使用 JAR 基础镜像和 JAR 暴露端口</li>
                <li>前端 dist 模式会把所选 dist 目录的内容复制为 nginx 站点根目录，不会在镜像里嵌套 dist 目录</li>
                <li>默认 nginx.conf 的 /index.html 回退路径对应 /usr/share/nginx/html/index.html</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {activeTab !== "about" && (
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
      )}

      <ConfirmDialog
        open={showClearGitConfirm}
        title="清空 Git 记录"
        message="此操作不可恢复，将清除以下本地记忆："
        details={[
          "分支打包 / 快捷合并的仓库路径历史",
          "上次选择的仓库与分支",
          "各仓库的高级设置（端口、nginx 等）",
        ]}
        confirmLabel="确认清空"
        cancelLabel="取消"
        variant="danger"
        loading={clearingGit}
        onConfirm={() => { void handleClearGitRecords(); }}
        onCancel={() => {
          if (!clearingGit) setShowClearGitConfirm(false);
        }}
      />
    </div>
  );
}
